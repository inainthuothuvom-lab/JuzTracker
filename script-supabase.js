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
                var d = new Date(targetDate); d.setHours(0,0,0,0);
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
                var inputDate = new Date(selectedDate); inputDate.setHours(0,0,0,0);
                // Friday 10PM cutoff
                if (inputDate.getDay() === 5) {
                    var _cutoff = new Date(inputDate); _cutoff.setHours(22,0,0,0);
                    if (new Date() < _cutoff) inputDate.setDate(inputDate.getDate() - 1);
                }
                // Find latest weekly_status row before/on inputDate
                _supabase.from('weekly_status').select('week_start,juz_number,member_name,status,completed_date_time,exception_raised_time,supported_by_name,supported_by_id,support_status').eq('member_id', userId).lte('week_start', formatLocalDate(inputDate)).order('week_start', { ascending: false }).limit(1).then(function(rStat) {
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
                                    // No rows at all — use a default base (e.g. 2026-01-05, first Monday of 2026)
                                    baseDate = new Date('2026-01-05');
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
            },
            // ----------------------------------------------------------------
            // getHadiyaDetails
            // ----------------------------------------------------------------
            getHadiyaDetails: function(selectedDate) {
                var self = this;
                var inputDate = new Date(selectedDate); inputDate.setHours(0,0,0,0);
                // Fetch ALL hadiya rows + status rows (for completed/reciting lists)
                _supabase.from('hadiya_details').select('*').order('start_date', { ascending: true }).then(function(rH) {
                    if (!rH.data || rH.data.length === 0) { if (_ok) _ok(null); return; }
                    var hadData = rH.data;
                    // Find currentIndex (latest <= inputDate)
                    var currentIdx = -1; var latestDate = null;
                    for (var i = 0; i < hadData.length; i++) {
                        var rd = new Date(hadData[i].start_date); rd.setHours(0,0,0,0);
                        if (rd <= inputDate && (!latestDate || rd > latestDate)) { latestDate = rd; currentIdx = i; }
                    }
                    if (currentIdx === -1) { if (_ok) _ok(null); return; }
                    // Find todayIndex
                    var today = new Date(); today.setHours(0,0,0,0);
                    var todayIdx = -1; var todayDate = null;
                    for (var i = 0; i < hadData.length; i++) {
                        var rd = new Date(hadData[i].start_date); rd.setHours(0,0,0,0);
                        if (rd <= today && (!todayDate || rd > todayDate)) { todayDate = rd; todayIdx = i; }
                    }
                    var getRowData = function(idx) {
                        if (idx < 0 || idx >= hadData.length || !hadData[idx].nominated_to) return null;
                        var row = hadData[idx];
                        var startDate = new Date(row.start_date);
                        var endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 6);
                        var rangeStr = formatDateDDMMM(startDate) + ' - ' + formatDateDDMMM(endDate);
                        var nominatedTo = row.nominated_to || '';
                        var nominatedToTa = row.nominated_to_ta || '';
                        var dedicatedTo = row.dedicated_to || '';
                        var dedicatedToTa = row.dedicated_to_ta || '';
                        var hadiyaStatus = row.status || 'Pending';
                        var rawDeadline = row.countdown_end_moment || '';
                        var rawNextStart = row.next_hadiya_start_moment || '';
                        // Default: next Friday from inputDate
                        var nextFri = new Date(inputDate); nextFri.setHours(0,0,0,0);
                        var day = nextFri.getDay();
                        if (day !== 5) nextFri.setDate(nextFri.getDate() + ((5 - day + 7) % 7));
                        var defaultDeadline = new Date(nextFri); defaultDeadline.setHours(15,0,0,0);
                        var defaultNextStart = new Date(nextFri); defaultNextStart.setHours(22,0,0,0);
                        if (rawDeadline) { var pd = new Date(rawDeadline.replace(' ','T')); if (!isNaN(pd.getTime())) defaultDeadline = pd; }
                        if (rawNextStart) { var pn = new Date(rawNextStart.replace(' ','T')); if (!isNaN(pn.getTime())) defaultNextStart = pn; }
                        return {
                            en: nominatedTo, ta: nominatedToTa, range: rangeStr,
                            dedicatedTo: dedicatedTo, dedicatedToTa: dedicatedToTa,
                            status: hadiyaStatus,
                            weekEndDate: endDate.toISOString(),
                            deadlineISO: defaultDeadline.toISOString(),
                            nextStartISO: defaultNextStart.toISOString(),
                            rawIdx: idx
                        };
                    };
                    // Read nextStart for cutoff
                    var curRow = getRowData(currentIdx);
                    if (!curRow) { if (_ok) _ok(null); return; }
                    var nsDate = new Date(curRow.nextStartISO);
                    var nsHour = nsDate.getHours();
                    var nsMin = nsDate.getMinutes();
                    // Friday before nextStart cutoff → show current (ending) week
                    if (inputDate.getDay() === 5) {
                        var _cutoff = new Date(inputDate); _cutoff.setHours(nsHour, nsMin, 0, 0);
                        if (new Date() < _cutoff) inputDate.setDate(inputDate.getDate() - 1);
                        // Re-evaluate
                        currentIdx = -1; latestDate = null;
                        for (var i = 0; i < hadData.length; i++) {
                            var rd = new Date(hadData[i].start_date); rd.setHours(0,0,0,0);
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
                        if (curStatus === 'Completed' || deadlinePassed) {
                            var advDate = new Date(curRow.nextStartISO);
                            if (advDate && new Date() >= advDate && currentIdx + 1 < hadData.length) {
                                currentIdx++;
                                curRow = getRowData(currentIdx);
                                if (!curRow) { if (_ok) _ok(null); return; }
                            }
                        }
                    }
                    // Collect completed / reciting lists from weekly_status
                    var targetMonday = latestDate || new Date(0);
                    targetMonday.setHours(0,0,0,0);
                    var mondayStr = normalizeToWeekStart(formatLocalDate(targetMonday));
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
                var monday = normalizeToWeekStart(selectedDate);
                if (!monday) { if (_ok) _ok({ error: "Invalid date." }); return; }
                // Determine if this week is the current week
                var today = new Date(); today.setHours(0,0,0,0);
                if (today.getDay() === 5) {
                    var _cutoff = new Date(today); _cutoff.setHours(22,0,0,0);
                    if (new Date() < _cutoff) today.setDate(today.getDate() - 1);
                }
                var currentMonday = normalizeToWeekStart(formatLocalDate(today));
                var isCurrentWeek = monday === currentMonday;
                // Get weekly_status for this week (has juz_number + status + member_name all in one table)
                _supabase.from('weekly_status').select('member_id,juz_number,member_name,status,completed_date_time,exception_raised_time,supported_by_name,support_status').eq('week_start', monday).then(function(rStat) {
                    // If no rows exist, generate dynamically from members
                    if (!rStat.data || rStat.data.length === 0) {
                        // Get all members + a base date for offset calculation
                        _supabase.from('members').select('id,sequence,name_en,name_ta').order('sequence', { ascending: true }).then(function(rMem) {
                            if (!rMem.data || rMem.data.length === 0) { if (_ok) _ok({ error: "No members found." }); return; }
                            // Find earliest week_start across all members
                            _supabase.from('weekly_status').select('week_start').order('week_start', { ascending: true }).limit(1).then(function(rFirst) {
                                var baseDate;
                                if (rFirst.data && rFirst.data.length > 0) {
                                    baseDate = new Date(rFirst.data[0].week_start);
                                } else {
                                    baseDate = new Date('2026-01-05');
                                }
                                baseDate.setHours(0, 0, 0, 0);
                                var targetDate = new Date(monday + 'T00:00:00');
                                var weekDiff = Math.round((targetDate - baseDate) / (7 * 86400000));
                                if (weekDiff < 0) weekDiff = 0;
                                // Get Juz details from members by sequence
                                _supabase.from('members').select('sequence,juz_ar,juz_en,juz_ta').order('sequence', { ascending: true }).then(function(rJuz) {
                                    var juzMap = {};
                                    if (rJuz.data) rJuz.data.forEach(function(j) { juzMap[j.sequence] = { arabic: j.juz_ar||'', english: j.juz_en||'', tamil: j.juz_ta||'' }; });
                                    var reportList = [];
                                    rMem.data.forEach(function(m) {
                                        var dynJuz = ((m.sequence - 1 + weekDiff) % 30) + 1;
                                        var juzStr = String(dynJuz);
                                        var jDetails = juzMap[dynJuz] || { arabic: '', english: '', tamil: '' };
                                        var displayName = (m.name_en || '') + ' | ' + (m.name_ta || '');
                                        reportList.push({
                                            userId: m.id, name: displayName, juzNum: juzStr,
                                            juzAr: jDetails.arabic, juzEn: jDetails.english, juzTa: jDetails.tamil,
                                            status: 'Not Started',
                                            dateLogged: '',
                                            supportedBy: '',
                                            supportStatus: '',
                                            isEditable: isCurrentWeek
                                        });
                                    });
                                    if (_ok) _ok({ week: monday, data: reportList, isEditable: isCurrentWeek });
                                });
                            });
                        });
                        return;
                    }
                    // Get Juz details from members by sequence
                    _supabase.from('members').select('id,sequence,name_en,name_ta,juz_ar,juz_en,juz_ta').order('sequence', { ascending: true }).then(function(rJuz) {
                        var juzMap = {};
                        var nameMap = {};
                        if (rJuz.data) rJuz.data.forEach(function(j) { 
                            juzMap[j.sequence] = { arabic: j.juz_ar||'', english: j.juz_en||'', tamil: j.juz_ta||'' }; 
                            nameMap[j.id] = { en: j.name_en||'', ta: j.name_ta||'' };
                        });
                        var reportList = [];
                        rStat.data.forEach(function(s) {
                            var uid = s.member_id; var juzNum = String(s.juz_number);
                            var jDetails = juzMap[s.juz_number] || { arabic: '', english: '', tamil: '' };
                            var memberInfo = nameMap[uid] || {};
                            var enName = memberInfo.en || s.member_name || '';
                            var taName = memberInfo.ta || '';
                            var displayName = enName + ' | ' + taName;
                            reportList.push({
                                userId: uid, name: displayName, juzNum: juzNum,
                                juzAr: jDetails.arabic, juzEn: jDetails.english, juzTa: jDetails.tamil,
                                status: s.status || 'Not Started',
                                dateLogged: (s.status === 'Completed' ? s.completed_date_time : (s.status === 'Exception Raised' ? s.exception_raised_time : '')) || '',
                                supportedBy: s.supported_by_name || '',
                                supportStatus: s.support_status || '',
                                isEditable: isCurrentWeek
                            });
                        });
                        if (_ok) _ok({ week: monday, data: reportList, isEditable: isCurrentWeek });
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
                        var upsertData = {
                            week_start: monday, member_id: userId, member_name: nameEn,
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
                            upsertData.support_status = 'Reciting';
                        } else {
                            upsertData.completed_date_time = null;
                            upsertData.exception_raised_time = null;
                            upsertData.supported_by_name = '';
                            upsertData.supported_by_id = '';
                            upsertData.support_status = 'Reciting';
                        }
                        var newLog = '[' + timestamp + ' - ' + updaterEmail + '] Modified Status from \'' + oldStatus + '\' to \'' + statusUpdate + '\'';
                        upsertData.audit_log = existing ? (existing.audit_log || '') + '\n' + newLog : newLog;
                        // Upsert
                        _supabase.from('weekly_status').upsert(upsertData, { onConflict: 'week_start,member_id' }).then(function(rUp) {
                            if (rUp.error) { if (_ok) _ok({ success: false, error: rUp.error.message }); return; }
                            if (_ok) _ok({ success: true });
                        });
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
