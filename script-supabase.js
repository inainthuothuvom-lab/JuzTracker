    (function() {
        var _ok = null, _err = null;
        function run() { return this; }
        var api = {
            withSuccessHandler: function(fn) { _ok = fn; return this; },
            withFailureHandler: function(fn) { _err = fn; return this; },
            // ----------------------------------------------------------------
            // getUserList
            // ----------------------------------------------------------------
            getUserList: function() {
                var self = this;
                _supabase.from('members').select('id,name_en,name_ta').order('sequence', { ascending: true }).then(function(r) {
                    if (r.error) { if (_err) _err(r.error); else console.error(r.error); return; }
                    var out = r.data.map(function(u) { return { id: u.id, arabic: '', english: u.name_en||'', tamil: u.name_ta||'' }; });
                    if (_ok) _ok(out);
                });
                return this;
            },
            // ----------------------------------------------------------------
            // lookupTamilName
            // ----------------------------------------------------------------
            lookupTamilName: function(userId) {
                var self = this;
                _supabase.from('members').select('name_ta').eq('id', userId).single().then(function(r) {
                    if (_ok) _ok((r.data && r.data.name_ta) || '');
                });
                return this;
            },
            // ----------------------------------------------------------------
            // lookupJuzFromSchedule
            // ----------------------------------------------------------------
            lookupJuzFromSchedule: function(userId, targetDate) {
                var self = this;
                var d = new Date(targetDate); d.setHours(0,0,0,0,0);
                _supabase.from('weekly_status').select('juz_number').eq('member_id', userId).lte('week_start', formatLocalDate(d)).order('week_start', { ascending: false }).limit(1).then(function(r) {
                    if (_ok) _ok((r.data && r.data[0]) ? String(r.data[0].juz_number) : '');
                });
                return this;
            },
            // ----------------------------------------------------------------
            // getAvailableSupportUsers
            // ----------------------------------------------------------------
            getAvailableSupportUsers: function(selectedDate, excludeUserId) {
                var self = this;
                var norm = normalizeToWeekStart(selectedDate);
                // Get all users who have an exception this week
                _supabase.from('weekly_status').select('member_id').eq('week_start', norm).eq('status', 'Exception Raised').then(function(rExc) {
                    var excIds = {};
                    if (rExc.data) rExc.data.forEach(function(x) { excIds[x.member_id] = true; });
                    // Get all non-exception users from members
                    _supabase.from('members').select('id,name_en,name_ta').order('sequence', { ascending: true }).then(function(rCfg) {
                        var out = [];
                        if (rCfg.data) rCfg.data.forEach(function(u) {
                            if (u.id !== excludeUserId && !excIds[u.id]) out.push({ id: u.id, english: u.name_en||'', tamil: u.name_ta||'' });
                        });
                        if (_ok) _ok(out);
                    });
                });
                return this;
            },
            // ----------------------------------------------------------------
            // findJuzAssignment
            // ----------------------------------------------------------------
            findJuzAssignment: function(userId, selectedDate) {
                var self = this;
                var inputDate = new Date(selectedDate); inputDate.setHours(0,0,0,0,0);
                
                // Apply Friday cutoff logic - if today is Friday before next hadiya start, use previous week
                var now = new Date();
                var IST_MS = 5.5 * 3600000;
                var istNow = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + IST_MS);
                var nowStr = formatLocalDate(istNow);
                var isToday = selectedDate === nowStr;
                
                function fridayOf(dateStr) {
                    var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
                    var d = m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(dateStr);
                    d.setHours(0,0,0,0,0);
                    if (isNaN(d.getTime())) return null;
                    var day = d.getDay();
                    var diff = (day >= 5) ? (day - 5) : (day + 2);
                    var f = new Date(d); f.setDate(d.getDate() - diff);
                    return formatLocalDate(f);
                }
                
                var todayFriday = fridayOf(nowStr);
                var prevFridayDate = new Date(todayFriday + 'T00:00:00');
                prevFridayDate.setDate(prevFridayDate.getDate() - 7);
                var prevFriday = formatLocalDate(prevFridayDate);
                
                // Query the previous week's next_hadiya_start_moment for cutoff
                _supabase.from('hadiya_details').select('next_hadiya_start_moment').eq('start_date', prevFriday).limit(1).then(function(rH) {
                    var cutoffTime = null;
                    if (rH.data && rH.data.length > 0 && rH.data[0].next_hadiya_start_moment) {
                        var raw = rH.data[0].next_hadiya_start_moment;
                        var s = String(raw).trim().replace(' ', 'T');
                        var hasTimezone = s.endsWith('Z') || /[\+\-]\d{2}:\d{2}$/.test(s) || /[\+\-]\d{4}$/.test(s);
                        var d;
                        if (hasTimezone) {
                            d = new Date(s);
                        } else {
                            var p = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
                            if (p) {
                                d = new Date(+p[1], +p[2]-1, +p[3], +p[4], +p[5], +(p[6]||0));
                            } else {
                                d = new Date(s);
                            }
                        }
                        if (!isNaN(d.getTime())) cutoffTime = d;
                    }
                    
                    var isBeforeNextStart = cutoffTime && now.getTime() < cutoffTime.getTime();
                    
                    // Adjust inputDate if before cutoff and today is Friday
                    var adjustedInputDate = inputDate;
                    if (isBeforeNextStart && isToday) {
                        var inputDay = inputDate.getDay();
                        if (inputDay === 5) { // Friday
                            adjustedInputDate = new Date(inputDate);
                            adjustedInputDate.setDate(adjustedInputDate.getDate() - 7);
                        }
                    }
                    
                    // Find latest weekly_status row before/on adjustedInputDate
                    _supabase.from('weekly_status').select('week_start,juz_number,member_name,status,completed_date_time,exception_raised_time,supported_by_name,supported_by_id,support_status').eq('member_id', userId).lte('week_start', formatLocalDate(adjustedInputDate)).order('week_start', { ascending: false }).limit(1).then(function(rStat) {
                    if (!rStat.data || rStat.data.length === 0) {
                        // No weekly_status row found — calculate Juz dynamically
                        _supabase.from('members').select('sequence').eq('id', userId).single().then(function(rSeq) {
                            if (!rSeq.data) { if (_ok) _ok({ error: "Member not found." }); return; }
                            var seq = rSeq.data.sequence;
                            // Find earliest week_start for this user to determine base week
                            _supabase.from('weekly_status').select('week_start').eq('member_id', userId).order('week_start', { ascending: true }).limit(1).then(function(rFirst) {
                                var baseDate;
                                if (rFirst.data && rFirst.data.length > 0) {
                                    baseDate = new Date(rFirst.data[0].week_start);
                                } else {
                                    // No rows at all — use a default base (first Friday of 2026)
                                    baseDate = new Date('2026-01-02');
                                }
                                baseDate.setHours(0, 0, 0, 0);
                                var weekDiff = Math.round((inputDate - baseDate) / (7 * 86400000));
                                if (weekDiff < 0) weekDiff = 0;
                                var dynamicJuz = ((seq - 1 + weekDiff) % 30) + 1;
                                var juzStr = String(dynamicJuz);
                                // Look up Juz details
                                _supabase.from('members').select('juz_ar,juz_en,juz_ta').eq('sequence', parseInt(juzStr)).single().then(function(rJuz) {
                                    var jDetail = rJuz.data || {};
                                    var monday = normalizeToWeekStart(formatLocalDate(inputDate));
                                    var result = {
                                        number: juzStr,
                                        dateFound: formatDateDDMMMYYYY(monday),
                                        rawDate: new Date(monday).toISOString(),
                                        arabic: jDetail.juz_ar || '',
                                        english: jDetail.juz_en || '',
                                        tamil: jDetail.juz_ta || '',
                                        savedStatus: 'Not Started',
                                        savedLastModified: '',
                                        statusTimestamp: '',
                                        supportedByName: '',
                                        supportedById: '',
                                        supportStatus: ''
                                    };
                                    if (_ok) _ok(result);
                                });
                            });
                        });
                        return;
                    }
                    var st = rStat.data[0]; var assignedJuz = String(st.juz_number);
                    // Look up Juz details from members by sequence
                    _supabase.from('members').select('juz_ar,juz_en,juz_ta').eq('sequence', parseInt(assignedJuz)).single().then(function(rJuz) {
                        var jDetail = rJuz.data || {};
                        var currentTrackerStatus = st.status || 'Reciting';
                        var statusTimestamp = '';
                        var supportedByName = st.supported_by_name || '';
                        var supportedById = st.supported_by_id || '';
                        var supportStatus = st.support_status || '';
                        var trackerLastModified = '';
                        var compTime = st.completed_date_time || '';
                        var excTime = st.exception_raised_time || '';
                        statusTimestamp = compTime || excTime || '';
                        if (currentTrackerStatus === 'Completed' && compTime) trackerLastModified = 'Completed on: ' + compTime;
                        else if (currentTrackerStatus === 'Exception Raised' && excTime) trackerLastModified = 'Exception raised on: ' + excTime;
                        var result = {
                            number: assignedJuz,
                            dateFound: formatDateDDMMMYYYY(st.week_start),
                            rawDate: new Date(st.week_start).toISOString(),
                            arabic: jDetail.juz_ar || '',
                            english: jDetail.juz_en || '',
                            tamil: jDetail.juz_ta || '',
                            savedStatus: currentTrackerStatus,
                            savedLastModified: trackerLastModified,
                            statusTimestamp: statusTimestamp,
                            supportedByName: supportedByName,
                            supportedById: supportedById,
                            supportStatus: supportStatus
                        };
                        if (_ok) _ok(result);
                    });
                });
                    return this;
                });
                return this;
            },
            // ----------------------------------------------------------------
            // getHadiyaDetails
            // ----------------------------------------------------------------
            getHadiyaDetails: function(selectedDate) {
                var self = this;
                function ld(s) {
                    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
                    return m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(s);
                }
                var inputDate = ld(selectedDate); inputDate.setHours(0,0,0,0,0);
                // Fetch ALL hadiya rows + status rows (for completed/reciting lists)
                _supabase.from('hadiya_details').select('*').order('start_date', { ascending: true }).then(function(rH) {
                    if (!rH.data || rH.data.length === 0) { if (_ok) _ok(null); return; }
                    var hadData = rH.data;
                    // Find currentIndex (latest <= inputDate)
                    var currentIdx = -1; var latestDate = null;
                    for (var i = 0; i < hadData.length; i++) {
                        var rd = ld(hadData[i].start_date); rd.setHours(0,0,0,0,0);
                        if (rd <= inputDate && (!latestDate || rd > latestDate)) { latestDate = rd; currentIdx = i; }
                    }
                    if (currentIdx === -1) { if (_ok) _ok(null); return; }
                    // Find todayIndex
                    var today = new Date(); today.setHours(0,0,0,0,0);
                    var todayIdx = -1; var todayDate = null;
                    for (var i = 0; i < hadData.length; i++) {
                        var rd = ld(hadData[i].start_date); rd.setHours(0,0,0,0,0);
                        if (rd <= today && (!todayDate || rd > todayDate)) { todayDate = rd; todayIdx = i; }
                    }
                    var getRowData = function(idx) {
                        if (idx < 0 || idx >= hadData.length || !hadData[idx].nominated_to) return null;
                        var row = hadData[idx];
                        var startDate = ld(row.start_date);
                        var endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 6);
                        var rangeStr = formatDateDDMMM(startDate) + ' - ' + formatDateDDMMM(endDate);
                        var nominatedTo = row.nominated_to || '';
                        var nominatedToTa = row.nominated_to_ta || '';
                        var dedicatedTo = row.dedicated_to || '';
                        var dedicatedToTa = row.dedicated_to_ta || '';
                        var hadiyaStatus = row.status || 'Pending';
                        var rawDeadline = row.countdown_end_moment || '';
                        var rawNextStart = row.next_hadiya_start_moment || '';
                        function parseDT(str) {
                            var s = String(str);
                            var hasTZ = s.endsWith('Z') || /[\+-]\d{2}:\d{2}$/.test(s.replace(' ', 'T'));
                            var p = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
                            var result;
                            if (p) result = new Date(+p[1],+p[2]-1,+p[3],+p[4],+p[5],+(p[6]||0));
                            else { var d = new Date(s); result = isNaN(d.getTime()) ? ld(s) : d; }
                            if (!hasTZ && !isNaN(result.getTime())) {
                                result = new Date(result.getTime() - result.getTimezoneOffset() * 60000);
                            }
                            return result;
                        }
                        function fmtDL(d) {
                            return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
                        }
                        var deadlineISO = '', deadlineDisplay = '', nextStartISO = '', nextStartDisplay = '';
                        if (rawDeadline) { var pd = parseDT(rawDeadline); if (!isNaN(pd.getTime())) { deadlineISO = pd.toISOString(); deadlineDisplay = fmtDL(pd); } }
                        if (rawNextStart) { var pn = parseDT(rawNextStart); if (!isNaN(pn.getTime())) { nextStartISO = pn.toISOString(); nextStartDisplay = fmtDL(pn); } }
                        return {
                            en: nominatedTo, ta: nominatedToTa, range: rangeStr,
                            dedicatedTo: dedicatedTo, dedicatedToTa: dedicatedToTa,
                            status: hadiyaStatus,
                            weekEndDate: endDate.toISOString(),
                            deadlineISO: deadlineISO,
                            nextStartISO: nextStartISO,
                            deadlineDisplay: deadlineDisplay,
                            nextStartDisplay: nextStartDisplay,
                            rawIdx: idx
                        };
                    };
                    // Read nextStart for cutoff
                    var curRow = getRowData(currentIdx);
                    if (!curRow) { if (_ok) _ok(null); return; }
                    // Use DB nextStartISO for cutoff
                    if (inputDate.getDay() === 5 && curRow && curRow.nextStartISO) {
                        var _cutoff = new Date(curRow.nextStartISO);
                        if (new Date() < _cutoff) inputDate.setDate(inputDate.getDate() - 1);
                        // Re-evaluate
                        currentIdx = -1; latestDate = null;
                        for (var i = 0; i < hadData.length; i++) {
                            var rd = new Date(hadData[i].start_date); rd.setHours(0,0,0,0,0);
                            if (rd <= inputDate && (!latestDate || rd > latestDate)) { latestDate = rd; currentIdx = i; }
                        }
                        if (currentIdx === -1) { if (_ok) _ok(null); return; }
                        curRow = getRowData(currentIdx);
                        if (!curRow) { if (_ok) _ok(null); return; }
                    }
                    // Auto-advance (only for current-week view)
                    if (currentIdx === todayIdx) {
                        var curStatus = hadData[currentIdx].status || 'Pending';
                        var deadlinePassed = curRow.deadlineISO && new Date() >= new Date(curRow.deadlineISO);
                        if ((curStatus === 'Completed' || deadlinePassed) && curRow && curRow.nextStartISO) {
                            if (new Date() >= new Date(curRow.nextStartISO) && currentIdx + 1 < hadData.length) {
                                currentIdx++;
                                curRow = getRowData(currentIdx);
                                if (!curRow) { if (_ok) _ok(null); return; }
                            }
                        }
                    }
                    // Collect completed / reciting lists from weekly_status (use Friday week)
                    var targetRef = latestDate || new Date(0);
                    targetRef.setHours(0,0,0,0,0);
                    var tDay = targetRef.getDay();
                    var tDiff = (tDay >= 5) ? (tDay - 5) : (tDay + 2);
                    var fridayBase = new Date(targetRef); fridayBase.setDate(targetRef.getDate() - tDiff);
                    var mondayStr = formatLocalDate(fridayBase);
                    _supabase.from('weekly_status').select('*').eq('week_start', mondayStr).then(function(rStat) {
                        var completedList = []; var recitingList = []; var supportersList = [];
                        if (rStat.data) {
                            rStat.data.forEach(function(s) {
                                var name = s.member_name || '';
                                if (!name) return;
                                var status = s.status || 'Not Started';
                                var supportStatus = s.support_status || '';
                                var enName = name.indexOf('|') > -1 ? name.split('|')[0].trim() : name;
                                var taName = name.indexOf('|') > -1 ? name.split('|')[1].trim() : name;
                                var isDone = (status === 'Completed') || (status === 'Exception Raised' && supportStatus === 'Completed');
                                var person = { en: enName, ta: taName };
                                if (isDone) completedList.push(person);
                                else if (status === 'Reciting' || status === 'Not Started' || status === 'Exception Raised') recitingList.push(person);
                                var supporterName = s.supported_by_name || '';
                                if (supporterName) {
                                    var sEn = supporterName.indexOf('|') > -1 ? supporterName.split('|')[0].trim() : supporterName;
                                    var sTa = supporterName.indexOf('|') > -1 ? supporterName.split('|')[1].trim() : supporterName;
                                    supportersList.push({ en: sEn, ta: sTa });
                                }
                            });
                        }
                        var result = {
                            current: getRowData(currentIdx),
                            previous: getRowData(currentIdx - 1),
                            next: getRowData(currentIdx + 1),
                            currentIndex: currentIdx,
                            weekStart: mondayStr,
                            completedList: completedList,
                            recitingList: recitingList,
                            supportersList: supportersList
                        };
                        if (_ok) _ok(result);
                    });
                });
                return this;
            },
            // ----------------------------------------------------------------
            // getWeeklyReport
            // ----------------------------------------------------------------
            getWeeklyReport: function(selectedDate) {
                var self = this;
                function fridayOf(dateStr) {
                    var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
                    var d = m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(dateStr);
                    d.setHours(0,0,0,0,0);
                    if (isNaN(d.getTime())) return null;
                    var day = d.getDay();
                    var diff = (day >= 5) ? (day - 5) : (day + 2);
                    var f = new Date(d); f.setDate(d.getDate() - diff);
                    return formatLocalDate(f);
                }
                var now = new Date();
                var IST_MS = 5.5 * 3600000;
                var istNow = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + IST_MS);
                var nowStr = formatLocalDate(istNow);
                var isToday = selectedDate === nowStr;
                // Query next_hadiya_start_moment for the current week row (the row whose next_hadiya_start_moment is the cutoff)
                var todayFriday = fridayOf(nowStr);
                // Get the row for 7 days ago - that row's next_hadiya_start_moment is the cutoff for this week
                var prevFridayDate = new Date(todayFriday + 'T00:00:00');
                prevFridayDate.setDate(prevFridayDate.getDate() - 7);
                var prevFriday = formatLocalDate(prevFridayDate);
                _supabase.from('hadiya_details').select('next_hadiya_start_moment').eq('start_date', prevFriday).limit(1).then(function(rH) {
                    var cutoffTime = null;
                    if (rH.data && rH.data.length > 0 && rH.data[0].next_hadiya_start_moment) {
                        var raw = rH.data[0].next_hadiya_start_moment;
                        var s = String(raw).trim().replace(' ', 'T');
                        // Check if the string already has timezone info
                        var hasTimezone = s.endsWith('Z') || /[\+\-]\d{2}:\d{2}$/.test(s) || /[\+\-]\d{4}$/.test(s);
                        var d;
                        if (hasTimezone) {
                            d = new Date(s);
                        } else {
                            // Parse as local time (IST) - use manual construction to ensure local interpretation
                            var p = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
                            if (p) {
                                d = new Date(+p[1], +p[2]-1, +p[3], +p[4], +p[5], +(p[6]||0));
                            } else {
                                d = new Date(s);
                            }
                        }
                        if (!isNaN(d.getTime())) cutoffTime = d;
                    }
                    // No fallback — only use DB value
                    var isBeforeNextStart = cutoffTime && now.getTime() < cutoffTime.getTime();
                    var correctMonday;
                    if (isBeforeNextStart) {
                        var tmp = new Date(nowStr + 'T00:00:00');
                        tmp.setDate(tmp.getDate() - 7);
                        correctMonday = fridayOf(formatLocalDate(tmp));
                    } else {
                        correctMonday = fridayOf(nowStr);
                    }
                    var adjDate = selectedDate;
                    if (isBeforeNextStart && isToday) {
                        var sd = new Date(selectedDate + 'T00:00:00');
                        sd.setDate(sd.getDate() - 7);
                        adjDate = formatLocalDate(sd);
                    }
                    var monday = fridayOf(adjDate);
                    if (!monday) { if (_ok) _ok({ error: "Invalid date." }); return; }
                    var editable = monday === correctMonday && isBeforeNextStart;
                    // Fetch report data
                    _supabase.from('weekly_status').select('member_id,juz_number,member_name,status,completed_date_time,exception_raised_time,supported_by_name,support_status').eq('week_start', monday).then(function(rStat) {
                        if (!rStat.data || rStat.data.length === 0) {
                            _supabase.from('members').select('id,sequence,name_en,name_ta').order('sequence', { ascending: true }).then(function(rMem) {
                                if (!rMem.data || rMem.data.length === 0) { if (_ok) _ok({ error: "No members found." }); return; }
                                _supabase.from('weekly_status').select('week_start').order('week_start', { ascending: true }).limit(1).then(function(rFirst) {
                                    var baseDate = (rFirst.data && rFirst.data.length > 0) ? new Date(rFirst.data[0].week_start) : new Date('2026-01-02');
                                    baseDate.setHours(0, 0, 0, 0);
                                    var weekDiff = Math.round((new Date(monday + 'T00:00:00') - baseDate) / (7 * 86400000));
                                    if (weekDiff < 0) weekDiff = 0;
                                    _supabase.from('members').select('sequence,juz_ar,juz_en,juz_ta').order('sequence', { ascending: true }).then(function(rJuz) {
                                        var juzMap = {};
                                        if (rJuz.data) rJuz.data.forEach(function(j) { juzMap[j.sequence] = { arabic: j.juz_ar||'', english: j.juz_en||'', tamil: j.juz_ta||'' }; });
                                        var reportList = rMem.data.map(function(m) {
                                            var n = ((m.sequence - 1 + weekDiff) % 30) + 1;
                                            var jd = juzMap[n] || {};
                                            return { userId: m.id, name: (m.name_en||'')+' | '+(m.name_ta||''), juzNum: String(n), juzAr: jd.arabic||'', juzEn: jd.english||'', juzTa: jd.tamil||'', status: 'Not Started', dateLogged: '', supportedBy: '', supportStatus: '', isEditable: editable };
                                        });
                                        if (_ok) _ok({ week: monday, data: reportList, isEditable: editable });
                                    });
                                });
                            });
                            return;
                        }
                        _supabase.from('members').select('id,sequence,name_en,name_ta,juz_ar,juz_en,juz_ta').order('sequence', { ascending: true }).then(function(rJuz) {
                            var juzMap = {}, nameMap = {};
                            if (rJuz.data) rJuz.data.forEach(function(j) { juzMap[j.sequence] = { arabic: j.juz_ar||'', english: j.juz_en||'', tamil: j.juz_ta||'' }; nameMap[j.id] = { en: j.name_en||'', ta: j.name_ta||'' }; });
                            var reportList = rStat.data.map(function(s) {
                                var mi = nameMap[s.member_id] || {};
                                var jd = juzMap[s.juz_number] || {};
                                var dn = (mi.en||s.member_name||'') + ' | ' + (mi.ta||'');
                                var dl = (s.status === 'Completed' ? s.completed_date_time : (s.status === 'Exception Raised' ? s.exception_raised_time : '')) || '';
                                return { userId: s.member_id, name: dn, juzNum: String(s.juz_number), juzAr: jd.arabic||'', juzEn: jd.english||'', juzTa: jd.tamil||'', status: s.status||'Not Started', dateLogged: dl, supportedBy: s.supported_by_name||'', supportStatus: s.support_status||'', isEditable: editable };
                            });
                            if (_ok) _ok({ week: monday, data: reportList, isEditable: editable });
                        });
                    });
                });
                return this;
            },
            // ----------------------------------------------------------------
            // updateWeeklyStatus
            // ----------------------------------------------------------------
            updateWeeklyStatus: function(userId, inputDateStr, statusUpdate, customTimestamp) {
                var self = this;
                try {
                    var monday = normalizeToWeekStart(inputDateStr);
                    if (!monday) { if (_ok) _ok({ success: false, error: 'Invalid date' }); return this; }
                    // Get existing status
                    _supabase.from('weekly_status').select('*').eq('week_start', monday).eq('member_id', userId).single().then(function(rGet) {
                        var existing = rGet.data;
                        var nameEn = userId;
                        if (existing) nameEn = existing.member_name || userId;
                        var timestamp = (customTimestamp && customTimestamp.trim()) ? customTimestamp.trim() : formatCurrentTimestamp();
                        var updaterEmail = 'Web User (Supabase)';
                        var oldStatus = existing ? existing.status : 'Not Started';
                        if (existing && existing.status === statusUpdate && !(customTimestamp && customTimestamp.trim())) {
                            if (_ok) _ok({ success: true, noChange: true }); return;
                        }
                        // Determine juz_number: use existing or compute dynamically
                        function doUpsert(juzNum) {
                            var upsertData = {
                                week_start: monday, member_id: userId, member_name: nameEn, juz_number: juzNum,
                                status: statusUpdate, completed_date_time: null, exception_raised_time: null,
                                supported_by_name: '', supported_by_id: '', support_status: 'Reciting',
                                audit_log: existing ? (existing.audit_log || '') : ''
                            };
                            if (statusUpdate === 'Exception Raised') {
                                upsertData.exception_raised_time = timestamp;
                                upsertData.completed_date_time = existing ? existing.completed_date_time : null;
                                upsertData.supported_by_name = existing ? existing.supported_by_name : '';
                                upsertData.supported_by_id = existing ? existing.supported_by_id : '';
                                upsertData.support_status = existing ? (existing.support_status || 'Reciting') : 'Reciting';
                            } else if (statusUpdate === 'Completed') {
                                upsertData.completed_date_time = timestamp;
                                upsertData.exception_raised_time = null;
                                upsertData.supported_by_name = '';
                                upsertData.supported_by_id = '';
                                upsertData.support_status = '';
                            } else {
                                upsertData.completed_date_time = null;
                                upsertData.exception_raised_time = null;
                                upsertData.supported_by_name = '';
                                upsertData.supported_by_id = '';
                                upsertData.support_status = '';
                            }
                            var newLog = '[' + timestamp + ' - ' + updaterEmail + '] Modified Status from \'' + oldStatus + '\' to \'' + statusUpdate + '\'';
                            upsertData.audit_log = existing ? (existing.audit_log || '') + '\n' + newLog : newLog;
                            _supabase.from('weekly_status').upsert(upsertData, { onConflict: 'week_start,member_id' }).then(function(rUp) {
                                if (rUp.error) { if (_ok) _ok({ success: false, error: rUp.error.message }); return; }
                                
                                // Send email notification if status is Completed or Exception (or changing from those)
                                var notableStatuses = ['Completed', 'Exception Raised'];
                                if (notableStatuses.includes(statusUpdate) || notableStatuses.includes(oldStatus)) {
                                    try {
                                        var enName = (nameEn || '').split('|')[0].trim() || 'Unknown';
                                        // Look up Tamil name from members table
                                        _supabase.from('members').select('name_ta').eq('id', userId).single().then(function(rTa) {
                                            var taName = rTa.data ? rTa.data.name_ta : enName;
                                            var emailData = {
                                                userName: enName,
                                                userTamilName: taName,
                                                juz: String(juzNum),
                                                week: formatDateDDMMMYYYY(monday),
                                                status: statusUpdate,
                                                oldStatus: oldStatus,
                                                actionType: statusUpdate === 'Completed' ? 'completed' : statusUpdate === 'Exception Raised' ? 'exception' : 'status_changed',
                                                timestamp: timestamp
                                            };
                                            if (typeof EmailService !== 'undefined') {
                                                EmailService.sendAdminNotification(emailData);
                                            }
                                        });
                                    } catch(emailErr) {
                                        console.error('Email notification failed:', emailErr);
                                    }
                                }
                                
                                if (_ok) _ok({ success: true });
                            });
                        }
                        if (existing && existing.juz_number) {
                            doUpsert(existing.juz_number);
                        } else {
                            // No existing record — compute juz number dynamically
                            _supabase.from('members').select('sequence').eq('id', userId).single().then(function(rSeq) {
                                if (!rSeq.data) { if (_ok) _ok({ success: false, error: 'Member not found' }); return; }
                                var seq = rSeq.data.sequence;
                                _supabase.from('weekly_status').select('week_start').order('week_start', { ascending: true }).limit(1).then(function(rFirst) {
                                    var baseDate;
                                    if (rFirst.data && rFirst.data.length > 0) {
                                        baseDate = new Date(rFirst.data[0].week_start);
                                    } else {
                                        baseDate = new Date('2026-01-02');
                                    }
                                    baseDate.setHours(0, 0, 0, 0);
                                    var targetDate = new Date(monday + 'T00:00:00');
                                    var weekDiff = Math.round((targetDate - baseDate) / (7 * 86400000));
                                    if (weekDiff < 0) weekDiff = 0;
                                    var dynJuz = ((seq - 1 + weekDiff) % 30) + 1;
                                    doUpsert(dynJuz);
                                });
                            });
                        }
                    });
                } catch(err) { if (_ok) _ok({ success: false, error: err.toString() }); }
                return this;
            },
            // ----------------------------------------------------------------
            // updateSupportStatus
            // ----------------------------------------------------------------
            updateSupportStatus: function(userId, inputDateStr, newSupportStatus, customTimestamp) {
                var self = this;
                try {
                    var monday = normalizeToWeekStart(inputDateStr);
                    if (!monday) { if (_ok) _ok({ success: false, error: 'Invalid date' }); return this; }
                    _supabase.from('weekly_status').select('*').eq('week_start', monday).eq('member_id', userId).single().then(function(rGet) {
                        var existing = rGet.data;
                        if (!existing) { if (_ok) _ok({ success: false, error: 'Record not found' }); return; }
                        var timestamp = (customTimestamp && customTimestamp.trim()) ? customTimestamp.trim() : formatCurrentTimestamp();
                        var updaterEmail = 'Web User (Supabase)';
                        var oldSupStatus = existing.support_status || 'None';
                        // Update support_status and completed_date_time
                        var updateData = { support_status: newSupportStatus };
                        if (newSupportStatus === 'Completed') updateData.completed_date_time = timestamp;
                        else updateData.completed_date_time = null;
                        var newLog = '[' + timestamp + ' - ' + updaterEmail + '] Updated Support Status from \'' + oldSupStatus + '\' to \'' + newSupportStatus + '\'';
                        updateData.audit_log = (existing.audit_log || '') + '\n' + newLog;
                        _supabase.from('weekly_status').update(updateData).eq('week_start', monday).eq('member_id', userId).then(function(rUp) {
                            if (rUp.error) { if (_ok) _ok({ success: false, error: rUp.error.message }); return; }
                            
                            // Send email notification if support status is Completed (or changing from Completed)
                            if (newSupportStatus === 'Completed' || oldSupStatus === 'Completed') {
                                try {
                                    var memberName = existing.member_name || '';
                                    var enName = memberName.split('|')[0].trim() || memberName.trim();
                                    var supportName = existing.supported_by_name || 'Support Reader';
                                    var supEnName = supportName.split('|')[0].trim() || 'Support';
                                    
                                    // Juz number comes from the existing record directly
                                    var juzNum = existing.juz_number ? String(existing.juz_number) : '-';
                                    
                                    // Look up Tamil names from members table
                                    var readerId = existing.member_id;
                                    var supId = existing.supported_by_id || '';
                                    
                                    Promise.all([
                                        _supabase.from('members').select('name_ta').eq('id', readerId).single(),
                                        supId ? _supabase.from('members').select('name_ta').eq('id', supId).single() : Promise.resolve({ data: null })
                                    ]).then(function(results) {
                                        var readerTaName = results[0].data ? results[0].data.name_ta : enName;
                                        var supTaName = results[1].data ? results[1].data.name_ta : supEnName;
                                        
                                        var emailData = {
                                            userName: enName,
                                            userTamilName: readerTaName,
                                            juz: juzNum,
                                            week: formatDateDDMMMYYYY(monday),
                                            status: newSupportStatus,
                                            oldStatus: oldSupStatus,
                                            actionType: newSupportStatus === 'Completed' ? 'support_completed' : 'status_changed',
                                            supportReader: supEnName,
                                            supportReaderTamil: supTaName,
                                            timestamp: timestamp
                                        };
                                        if (typeof EmailService !== 'undefined') {
                                            EmailService.sendAdminNotification(emailData);
                                        }
                                    });
                                } catch(emailErr) {
                                    console.error('Email notification failed:', emailErr);
                                }
                            }
                            
                            if (_ok) _ok({ success: true });
                        });
                    });
                } catch(err) { if (_ok) _ok({ success: false, error: err.toString() }); }
                return this;
            },
            // ----------------------------------------------------------------
            // reassignJuz
            // ----------------------------------------------------------------
            reassignJuz: function(userId, inputDateStr, supportUserId) {
                var self = this;
                try {
                    var monday = normalizeToWeekStart(inputDateStr);
                    if (!monday) { if (_ok) _ok({ success: false, error: 'Invalid date' }); return this; }
                    // Get support user name
                    _supabase.from('members').select('name_en,name_ta').eq('id', supportUserId).single().then(function(rSup) {
                        var supName = rSup.data ? (rSup.data.name_en || 'Support') + ' | ' + (rSup.data.name_ta || '') : 'Support Reader';
                        // Get existing record
                        _supabase.from('weekly_status').select('*').eq('week_start', monday).eq('member_id', userId).single().then(function(rGet) {
                            var existing = rGet.data;
                            if (!existing) { if (_ok) _ok({ success: false, error: 'Record not found' }); return; }
                            var timestamp = formatCurrentTimestamp();
                            var updaterEmail = 'Web User (Supabase)';
                            var updateData = {
                                supported_by_name: supName,
                                supported_by_id: supportUserId,
                                support_status: 'Reciting'
                            };
                            var newLog = '[' + timestamp + ' - ' + updaterEmail + '] Reassigned Juz Reciting to: ' + supName + ' (Status: Reciting)';
                            updateData.audit_log = (existing.audit_log || '') + '\n' + newLog;
                            _supabase.from('weekly_status').update(updateData).eq('week_start', monday).eq('member_id', userId).then(function(rUp) {
                                if (rUp.error) { if (_ok) _ok({ success: false, error: rUp.error.message }); return; }
                                
                                // Send email notification for support assignment
                                try {
                                    var memberName = existing.member_name || '';
                                    var enName = memberName.split('|')[0].trim() || 'Unknown';
                                    var supNames = (supName || '').split('|');
                                    var supEnName = (supNames[0] || 'Support').trim();
                                    var supTaName = (supNames[1] || supNames[0] || 'Support').trim();
                                    
                                    // Look up reader's Tamil name from members table
                                    _supabase.from('members').select('name_ta').eq('id', userId).single().then(function(rTa) {
                                        var taName = rTa.data ? rTa.data.name_ta : enName;
                                        var emailData = {
                                            userName: enName,
                                            userTamilName: taName,
                                            juz: String(existing.juz_number || '-'),
                                            week: formatDateDDMMMYYYY(monday),
                                            status: existing.status || 'Exception Raised',
                                            oldStatus: existing.status || '',
                                            actionType: 'support_assigned',
                                            supportReader: supEnName,
                                            supportReaderTamil: supTaName,
                                            timestamp: timestamp
                                        };
                                        if (typeof EmailService !== 'undefined') {
                                            EmailService.sendAdminNotification(emailData);
                                        }
                                    });
                                } catch(emailErr) {
                                    console.error('Email notification failed:', emailErr);
                                }
                                
                                if (_ok) _ok({ success: true, assignedName: supName });
                            });
                        });
                    });
                } catch(err) { if (_ok) _ok({ success: false, error: err.toString() }); }
                return this;
            },
            // ----------------------------------------------------------------
            // updateHadiyaStatus
            // ----------------------------------------------------------------
            updateHadiyaStatus: function(selectedDate, newStatus) {
                var self = this;
                try {
                    var friday = normalizeToFriday(selectedDate);
                    if (!friday) { if (_ok) _ok({ success: false, error: 'Invalid date' }); return this; }
                    // Find the hadiya row for this week (PK is start_date)
                    _supabase.from('hadiya_details').select('start_date').lte('start_date', friday).order('start_date', { ascending: false }).limit(1).single().then(function(rGet) {
                        if (!rGet.data) { if (_ok) _ok({ success: false, error: 'Hadiya row not found' }); return; }
                        _supabase.from('hadiya_details').update({ status: newStatus }).eq('start_date', rGet.data.start_date).then(function(rUp) {
                            if (rUp.error) { if (_ok) _ok({ success: false, error: rUp.error.message }); return; }
                            if (_ok) _ok({ success: true });
                        });
                    });
                } catch(err) { if (_ok) _ok({ success: false, error: err.toString() }); }
                return this;
            },
            // ----------------------------------------------------------------
            // updateHadiyaDedication
            // ----------------------------------------------------------------
            updateHadiyaDedication: function(selectedDate, dedicationEn, dedicationTa) {
                var self = this;
                try {
                    var friday = normalizeToFriday(selectedDate);
                    if (!friday) { if (_ok) _ok({ success: false, error: 'Invalid date' }); return this; }
                    _supabase.from('hadiya_details').select('start_date').lte('start_date', friday).order('start_date', { ascending: false }).limit(1).single().then(function(rGet) {
                        if (!rGet.data) { if (_ok) _ok({ success: false, error: 'Hadiya row not found' }); return; }
                        _supabase.from('hadiya_details').update({ dedicated_to: dedicationEn, dedicated_to_ta: dedicationTa }).eq('start_date', rGet.data.start_date).then(function(rUp) {
                            if (rUp.error) { if (_ok) _ok({ success: false, error: rUp.error.message }); return; }
                            if (_ok) _ok({ success: true });
                        });
                    });
                } catch(err) { if (_ok) _ok({ success: false, error: err.toString() }); }
                return this;
            },
            // ----------------------------------------------------------------
            // fixAllHadiyaScheduleTimes - updates all rows to correct IST times
            // ----------------------------------------------------------------
            fixAllHadiyaScheduleTimes: function() {
                var self = this;
                _supabase.from('hadiya_details').select('start_date').order('start_date', { ascending: true }).then(function(rAll) {
                    if (!rAll.data || rAll.data.length === 0) {
                        if (_ok) _ok({ success: false, error: 'No hadiya rows found' });
                        return;
                    }
                    var total = rAll.data.length;
                    var done = 0;
                    rAll.data.forEach(function(row) {
                        var sd = new Date(row.start_date + 'T00:00:00');
                        var nextFri = new Date(sd);
                        nextFri.setDate(nextFri.getDate() + 7);
                        // Build UTC timestamps directly (3PM IST = 09:30 UTC, 8PM IST = 14:30 UTC)
                        var dlUTC = new Date(Date.UTC(nextFri.getFullYear(), nextFri.getMonth(), nextFri.getDate(), 9, 30, 0));
                        var nsUTC = new Date(Date.UTC(nextFri.getFullYear(), nextFri.getMonth(), nextFri.getDate(), 14, 30, 0));
                        _supabase.from('hadiya_details').update({
                            countdown_end_moment: dlUTC.toISOString(),
                            next_hadiya_start_moment: nsUTC.toISOString()
                        }).eq('start_date', row.start_date).then(function(rUp) {
                            done++;
                            if (done === total) {
                                if (_ok) _ok({ success: true, updated: total });
                            }
                        });
                    });
                });
                return this;
            },
            // ----------------------------------------------------------------
            // updateHadiyaScheduleTimes
            // ----------------------------------------------------------------
            updateHadiyaScheduleTimes: function(selectedDate, deadlineISO, nextStartISO) {
                var self = this;
                try {
                    var friday = normalizeToFriday(selectedDate);
                    if (!friday) { if (_ok) _ok({ success: false, error: 'Invalid date' }); return this; }
                    _supabase.from('hadiya_details').select('start_date').lte('start_date', friday).order('start_date', { ascending: false }).limit(1).single().then(function(rGet) {
                        if (!rGet.data) { if (_ok) _ok({ success: false, error: 'Hadiya row not found' }); return; }
                        _supabase.from('hadiya_details').update({ countdown_end_moment: deadlineISO, next_hadiya_start_moment: nextStartISO }).eq('start_date', rGet.data.start_date).then(function(rUp) {
                            if (rUp.error) { if (_ok) _ok({ success: false, error: rUp.error.message }); return; }
                            if (_ok) _ok({ success: true, deadline: deadlineISO, nextStart: nextStartISO });
                        });
                    });
                } catch(err) { if (_ok) _ok({ success: false, error: err.toString() }); }
                return this;
            }
        };
        window.google = window.google || {};
        window.google.script = window.google.script || {};
        window.google.script.run = api;
    })();
