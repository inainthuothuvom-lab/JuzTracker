// Initialize Supabase Client
const SUPABASE_URL = 'https://ylxuwsxgtqyqxutgouik.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jYlMjdj7klfJoD4CFvcpnQ_DC2qcGZQ';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentActiveUserId = null;
let currentActiveRawDate = null;
let currentActiveJuzNumber = null;
let rawReportData = [];
let currentHadiyaDetails = null; // Store Hadiya details locally for copying
let bulkMode = false;
let selectedUserIds = new Set();
let bulkAvailableData = [];
let searchVisible = false;
let bulkSelectedStatus = '';
let sortColumn = 'name';
let sortAsc = true;

// Hold local reference copy to restore upon cancels
let fetchedStateCache = null;

let userListData = [];

// ===== SUPABASE CLIENT SHIM =====
// Replaces google.script.run so all existing UI code stays unchanged.
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
            _supabase.from('hadiya_details').select('*').order('start_date', { ascending: true }).then(function(rH) {
                if (!rH.data || rH.data.length === 0) { if (_ok) _ok(null); return; }
                var hadData = rH.data;
                var currentIdx = -1; var latestDate = null;
                for (var i = 0; i < hadData.length; i++) {
                    var rd = new Date(hadData[i].start_date); rd.setHours(0,0,0,0);
                    if (rd <= inputDate && (!latestDate || rd > latestDate)) { latestDate = rd; currentIdx = i; }
                }
                if (currentIdx === -1) { if (_ok) _ok(null); return; }
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
                var curRow = getRowData(currentIdx);
                if (!curRow) { if (_ok) _ok(null); return; }
                var nsDate = new Date(curRow.nextStartISO);
                var nsHour = nsDate.getHours();
                var nsMin = nsDate.getMinutes();
                if (inputDate.getDay() === 5) {
                    var _cutoff = new Date(inputDate); _cutoff.setHours(nsHour, nsMin, 0, 0);
                    if (new Date() < _cutoff) inputDate.setDate(inputDate.getDate() - 1);
                    currentIdx = -1; latestDate = null;
                    for (var i = 0; i < hadData.length; i++) {
                        var rd = new Date(hadData[i].start_date); rd.setHours(0,0,0,0);
                        if (rd <= inputDate && (!latestDate || rd > latestDate)) { latestDate = rd; currentIdx = i; }
                    }
                    if (currentIdx === -1) { if (_ok) _ok(null); return; }
                    curRow = getRowData(currentIdx);
                    if (!curRow) { if (_ok) _ok(null); return; }
                }
                if (currentIdx === todayIdx) {
                    var curStatus = hadData[currentIdx].status || 'Pending';
                    if (curStatus === 'Completed') {
                        var advDate = new Date(curRow.nextStartISO);
                        if (advDate && new Date() >= advDate && currentIdx + 1 < hadData.length) {
                            currentIdx++;
                            curRow = getRowData(currentIdx);
                            if (!curRow) { if (_ok) _ok(null); return; }
                        }
                    }
                }
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
            if (!monday) { if (_ok) _ok({ error: "Invalid date." }); return this; }
            var today = new Date(); today.setHours(0,0,0,0);
            if (today.getDay() === 5) {
                var _cutoff = new Date(today); _cutoff.setHours(22,0,0,0);
                if (new Date() < _cutoff) today.setDate(today.getDate() - 1);
            }
            var currentMonday = normalizeToWeekStart(formatLocalDate(today));
            var isCurrentWeek = monday === currentMonday;
            _supabase.from('weekly_status').select('member_id,juz_number,member_name,status,completed_date_time,exception_raised_time,supported_by_name,support_status').eq('week_start', monday).then(function(rStat) {
                if (!rStat.data || rStat.data.length === 0) {
                    _supabase.from('members').select('id,sequence,name_en,name_ta').order('sequence', { ascending: true }).then(function(rMem) {
                        if (!rMem.data || rMem.data.length === 0) { if (_ok) _ok({ error: "No members found." }); return; }
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
                _supabase.from('members').select('sequence,juz_ar,juz_en,juz_ta').order('sequence', { ascending: true }).then(function(rJuz) {
                    var juzMap = {};
                    if (rJuz.data) rJuz.data.forEach(function(j) { juzMap[j.sequence] = { arabic: j.juz_ar||'', english: j.juz_en||'', tamil: j.juz_ta||'' }; });
                    var reportList = [];
                    rStat.data.forEach(function(s) {
                        var uid = s.member_id; var juzNum = String(s.juz_number);
                        var jDetails = juzMap[s.juz_number] || { arabic: '', english: '', tamil: '' };
                        var displayName = s.member_name || ('User ' + uid);
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
                    var oldSupportStatus = existing.support_status || 'None';
                    var updateData = { support_status: newSupportStatus };
                    if (newSupportStatus === 'Completed') updateData.completed_date_time = timestamp;
                    else updateData.completed_date_time = null;
                    var newLog = '[' + timestamp + ' - ' + updaterEmail + '] Updated Support Status from \'' + oldSupportStatus + '\' to \'' + newSupportStatus + '\'';
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
                _supabase.from('members').select('name_en,name_ta').eq('id', supportUserId).single().then(function(rSup) {
                    var supName = rSup.data ? (rSup.data.name_en || 'Support') + ' | ' + (rSup.data.name_ta || '') : 'Support Reader';
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

// ===== HELPERS (replacing server-side Utilities) =====
function normalizeToFriday(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr); d.setHours(0,0,0,0);
    if (isNaN(d.getTime())) return null;
    if (d.getDay() === 5) {
        var _cutoff = new Date(d); _cutoff.setHours(22,0,0,0);
        if (new Date() < _cutoff) d.setDate(d.getDate() - 1);
    }
    var day = d.getDay();
    var diff = (day >= 5) ? (day - 5) : (day + 2);
    var friday = new Date(d); friday.setDate(d.getDate() - diff);
    friday.setHours(0,0,0,0);
    return formatLocalDate(friday);
}
function normalizeToWeekStart(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr); d.setHours(0,0,0,0);
    if (isNaN(d.getTime())) return null;
    if (d.getDay() === 5) {
        var _cutoff = new Date(d); _cutoff.setHours(22,0,0,0);
        if (new Date() < _cutoff) d.setDate(d.getDate() - 1);
    }
    var day = d.getDay();
    var diff = (day >= 5) ? (day - 5) : (day + 2);
    var friday = new Date(d); friday.setDate(d.getDate() - diff);
    var monday = new Date(friday); monday.setDate(monday.getDate() - 4);
    monday.setHours(0,0,0,0);
    return formatLocalDate(monday);
}
function formatDateDDMMMYYYY(dateVal) {
    var d = new Date(dateVal);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}
function formatDateDDMMM(dateVal) {
    var d = new Date(dateVal);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return ('0'+d.getDate()).slice(-2) + ' ' + months[d.getMonth()];
}
function formatCurrentTimestamp() {
    var d = new Date();
    var p = function(n){return String(n).padStart(2,'0');};
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function formatLocalDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

window.onload = function() {
    google.script.run.withSuccessHandler(function(users) {
        userListData = users;
        const dropdown = document.getElementById('userDropdown');
        dropdown.innerHTML = users.map(u =>
            `<div class="opt" data-id="${u.id}" onmousedown="selectUserOption('${u.id}','${(u.english + ' | ' + u.tamil).replace(/'/g, "\\'")}')">${u.english} | ${u.tamil}</div>`
        ).join('');
        const today = document.getElementById('dateInput').value;
        fetchHadiyaDetails(today);
    }).getUserList();

    document.getElementById('dateInput').addEventListener('change', resetAssignmentDetails);
};

function fetchHadiyaDetails(dateVal) {
    google.script.run
        .withSuccessHandler(function(res) {
            displayHadiya(res);
        })
        .withFailureHandler(function(err) {
            document.getElementById('hadiyaBox').classList.remove('hadiya-loading');
            showSnackbar("Error loading Hadiya data", true);
        })
        .getHadiyaDetails(dateVal);
}

var countdownInterval = null;
function startHadiyaCountdown(deadlineISO) {
    if (countdownInterval) clearInterval(countdownInterval);
    if (!deadlineISO) return;
    var target = new Date(deadlineISO);
    var dEl = document.getElementById('hadiyaCounterDays');
    var hEl = document.getElementById('hadiyaCounterHms');
    if (!dEl || !hEl) return;
    function update() {
        var now = new Date();
        var diff = target - now;
        if (diff <= 0) {
            dEl.textContent = '0D';
            hEl.textContent = '00:00:00';
            return;
        }
        var days = Math.floor(diff / 86400000);
        var hours = Math.floor((diff % 86400000) / 3600000);
        var minutes = Math.floor((diff % 3600000) / 60000);
        var seconds = Math.floor((diff % 60000) / 1000);
        var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
        dEl.textContent = days + 'D';
        hEl.textContent = pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
    }
    update();
    countdownInterval = setInterval(update, 1000);
}

function openHadiyaEditModal() {
    var cur = currentHadiyaDetails && currentHadiyaDetails.current;
    if (!cur) return;
    document.getElementById('hadiyaEditNominee').innerHTML = cur.en + ' / ' + cur.ta + ' (' + cur.range + ')';
    document.getElementById('hadiyaEditStatus').innerHTML = (cur.status === "Completed" ? '✅ ' : '⏳ ') + cur.status;

    function setDL(id, iso) {
        if (!iso) return;
        var d = new Date(iso);
        if (!isNaN(d.getTime())) {
            var y = d.getFullYear(), mo = String(d.getMonth()+1).padStart(2,'0'), da = String(d.getDate()).padStart(2,'0');
            var h = String(d.getHours()).padStart(2,'0'), mi = String(d.getMinutes()).padStart(2,'0');
            document.getElementById(id).value = y + '-' + mo + '-' + da + 'T' + h + ':' + mi;
        }
    }
    setDL('hadiyaDeadlineInput', cur.deadlineISO);
    setDL('hadiyaNextStartInput', cur.nextStartISO);

    var today = new Date(); today.setHours(0,0,0,0);
    var weekEnd = new Date(cur.weekEndDate);
    weekEnd.setHours(0,0,0,0);
    var isPast = weekEnd < today;
    ['hadiyaDeadlineInput','hadiyaNextStartInput','hadiyaConfigSaveBtn'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.disabled = isPast;
    });
    var alertEl = document.getElementById('hadiyaScheduleTimeAlert');
    alertEl.innerHTML = isPast ? '🔒 Schedule times cannot be changed for past weeks.' : '';
    document.getElementById('hadiyaEditModal').style.display = 'flex';
}
function closeHadiyaEditModal() {
    document.getElementById('hadiyaEditModal').style.display = 'none';
}
function submitHadiyaEditComplete() {
    closeHadiyaEditModal();
    updateHadiyaStatusUI('Completed');
}
function openHadiyaEditDedication() {
    closeHadiyaEditModal();
    setTimeout(function() { openDedicationModal(); }, 200);
}
function saveHadiyaScheduleTimes() {
    function getDL(id) { var v = document.getElementById(id).value; return v ? v.replace('T', ' ') + ':00' : ''; }
    var deadlineStr = getDL('hadiyaDeadlineInput');
    var nextStr = getDL('hadiyaNextStartInput');
    if (!deadlineStr || !nextStr) { showSnackbar("Please set both date-time values.", true); return; }
    document.getElementById('hadiyaConfigSaveBtn').disabled = true;
    document.getElementById('hadiyaConfigSaveBtn').innerText = "Saving...";
    var dateVal = document.getElementById('dateInput').value;
    google.script.run.withSuccessHandler(function(r) {
        document.getElementById('hadiyaConfigSaveBtn').disabled = false;
        document.getElementById('hadiyaConfigSaveBtn').innerHTML = 'Save Schedule Times<br>நேரத்தை சேமிக்க';
        if (r.success) {
            showSnackbar("Schedule times saved!", false);
            if (dateVal) fetchHadiyaDetails(dateVal);
        } else {
            showSnackbar("Failed: " + (r.error || 'Error'), true);
        }
    }).updateHadiyaScheduleTimes(dateVal, deadlineStr, nextStr);
}

function showSnackbar(message, isError) {
    const snack = document.getElementById('toastSnackbar');
    snack.innerText = message;
    snack.className = "snackbar show " + (isError ? "snackbar-error" : "snackbar-success");
    setTimeout(function(){ snack.className = snack.className.replace("show", ""); }, 3000);
}

function resetAssignmentDetails() {
    document.getElementById('result').style.display = "none";
    currentActiveUserId = null;
    currentActiveRawDate = null;
    currentActiveJuzNumber = null;
    fetchedStateCache = null;
    document.getElementById('hadiyaBox').classList.add('hadiya-loading');
    var d = document.getElementById('dateInput').value;
    if (d) fetchHadiyaDetails(d);
}

function navigateHadiya(dir) {
    var input = document.getElementById('dateInput');
    var d = new Date(input.value || new Date());
    d.setDate(d.getDate() + dir * 7);
    input.value = d.toISOString().split('T')[0];
    input.dispatchEvent(new Event('change'));
}

function displayHadiya(res) {
    document.getElementById('hadiyaBox').classList.remove('hadiya-loading');
    if (!res || !res.current) {
        document.getElementById('hadiyaBox').style.display = "none";
        currentHadiyaDetails = null;
        return;
    }
    document.getElementById('hadiyaBox').style.display = "block";
    currentHadiyaDetails = res;

    var cur = res.current;

    var headerHtml = `<div class="hadiya-header">
        <div style="font-size:0.75rem; color:#7ee787; font-weight:bold;">
            <a href="#" class="hadiya-nav-arrow" onclick="event.preventDefault(); navigateHadiya(-1);">&lt;</a>
            ${cur.range}
            <a href="#" class="hadiya-nav-arrow" onclick="event.preventDefault(); navigateHadiya(1);">&gt;</a>
        </div>
        <a href="#" id="hadiyaEditBtn" class="hadiya-edit-btn" onclick="event.preventDefault(); openHadiyaEditModal();">Edit / மாற்ற</a>
    </div>`;

    var hasDedication = cur.dedicatedTo && cur.dedicatedTo !== cur.en;
    var dedName = hasDedication ? (cur.dedicatedToTa || cur.dedicatedTo) : '';

    var nomSize = hasDedication ? '0.85rem' : '1rem';
    var nameCol = `<div class="hadiya-name-col">
        <div style="font-size:${nomSize}; font-weight:600; color:#e6edf3;">${cur.en}</div>
        <div style="font-size:0.75rem; color:#8b949e;">${cur.ta}</div>
    </div>`;

    var counterCol = `<div class="hadiya-counter-col">
        <div class="counter-days" id="hadiyaCounterDays">--</div>
        <div class="counter-hms" id="hadiyaCounterHms">--:--:--</div>
    </div>`;

    var nameRow = `<div class="hadiya-name-row">${nameCol}${counterCol}</div>`;

    var dedicationHtml = '';
    if (hasDedication) {
        dedicationHtml = `<div class="hadiya-name-col" style="margin-top:2px;">
            <div style="font-size:0.75rem; color:#d29922; font-weight:600;">🎯 Dedicated | அர்பணித்தல்:</div>
            <div style="font-size:1rem; font-weight:600; color:#d29922;">${dedName}</div>
        </div>`;
    }

    var isCompleted = cur.status === "Completed";
    var statusLabel = isCompleted ? '✅ Completed | நிறைவேறியது' : '⏳ Pending | நிலுவையில்';
    var statusColor = isCompleted ? '#3fb950' : '#d29922';
    var statusHtml = `<div style="margin-top:8px; font-size:0.8rem; color:${statusColor}; font-weight:600;">${statusLabel}</div>`;

    var pendingCount = (res.recitingList || []).length;
    var pendingBadge = (!isCompleted && pendingCount > 0) ?
        `<div style="margin-top:4px; padding:4px 10px; background:#3b1818; color:#f87171; border-radius:16px; font-size:0.75rem; font-weight:600; display:inline-block; border:1px dashed #da3633;">
            ⏳ ${pendingCount} left to start Hadiya | இன்னும் ${pendingCount} பேர் மீதம்
        </div>` : '';

    document.getElementById('hadCurrent').innerHTML = headerHtml + nameRow + dedicationHtml + (isCompleted ? statusHtml : '') + pendingBadge;

    startHadiyaCountdown(cur.deadlineISO);

    const prevSec = document.getElementById('prevSection');
    if (res.previous) {
        prevSec.style.display = "block";
        document.getElementById('hadPrev').innerHTML = 
            `<b style="font-size:0.65rem;">${res.previous.range}</b><br>` +
            `${res.previous.en}<br>` +
            `<span style="font-size:0.65rem; color:#8b949e;">${res.previous.ta}</span>`;
    } else {
        prevSec.style.display = "none";
    }
    
    const nextSec = document.getElementById('nextSection');
    if (res.next) {
        nextSec.style.display = "block";
        document.getElementById('hadNext').innerHTML = 
            `<b style="font-size:0.65rem;">${res.next.range}</b><br>` +
            `${res.next.en}<br>` +
            `<span style="font-size:0.65rem; color:#8b949e;">${res.next.ta}</span>`;
    } else {
        nextSec.style.display = "none";
    }
}

function updateHadiyaStatusUI(newStatus) {
    const dateVal = document.getElementById('dateInput').value;
    if (!dateVal) return;
    google.script.run.withSuccessHandler(function(r) {
        if (r.success) {
            showSnackbar("Hadiya status updated: " + newStatus, false);
            fetchHadiyaDetails(dateVal);
        } else {
            showSnackbar("Failed: " + (r.error || 'Error'), true);
        }
    }).updateHadiyaStatus(dateVal, newStatus);
}

function openDedicationModal() {
    document.getElementById('dedicationModal').style.display = "flex";
    document.getElementById('dedicationUserSelect').innerHTML = '<option value="">-- Select / தேர்ந்தெடு --</option>';
    document.getElementById('dedicationCustomInput').value = '';
    google.script.run.withSuccessHandler(function(users) {
        var sel = document.getElementById('dedicationUserSelect');
        users.forEach(function(u) {
            var opt = document.createElement('option');
            opt.value = u.english + ' | ' + u.tamil;
            opt.text = u.english + ' | ' + u.tamil;
            sel.appendChild(opt);
        });
    }).getUserList();
}

function closeDedicationModal() {
    document.getElementById('dedicationModal').style.display = "none";
}

function onDedicationUserSelect() {
    var sel = document.getElementById('dedicationUserSelect');
    if (sel.value) {
        document.getElementById('dedicationCustomInput').value = '';
    }
}

function onDedicationCustomInput() {
    var inp = document.getElementById('dedicationCustomInput');
    if (inp.value.trim()) {
        document.getElementById('dedicationUserSelect').value = '';
    }
}

function saveDedication() {
    var dateVal = document.getElementById('dateInput').value;
    if (!dateVal) { showSnackbar("Select a date first.", true); return; }
    var sel = document.getElementById('dedicationUserSelect');
    var custom = document.getElementById('dedicationCustomInput').value.trim();
    var dedicationEn = '', dedicationTa = '';

    if (sel.value) {
        var parts = sel.value.split(' | ');
        dedicationEn = parts[0] || sel.value;
        dedicationTa = parts[1] || '';
    } else if (custom) {
        dedicationEn = custom;
        dedicationTa = custom;
    } else {
        showSnackbar("Select or type a name.", true);
        return;
    }

    document.getElementById('saveDedicationBtn').disabled = true;
    google.script.run.withSuccessHandler(function(r) {
        document.getElementById('saveDedicationBtn').disabled = false;
        if (r.success) {
            showSnackbar("Dedication updated! / அர்பணிப்பு மாற்றப்பட்டது!", false);
            closeDedicationModal();
            fetchHadiyaDetails(dateVal);
        } else {
            showSnackbar("Failed: " + (r.error || 'Error'), true);
        }
    }).updateHadiyaDedication(dateVal, dedicationEn, dedicationTa);
}

function updateStatusBoxColorByValue(val) {
    const box = document.getElementById('statusBoxContainer');
    box.classList.remove('state-progress', 'state-completed', 'state-exception');
    
    if (!val || val === "Reciting" || val === "Not Started") {
        box.classList.add('state-progress');
    } else if (val === "Completed") {
        box.classList.add('state-completed');
    } else if (val === "Exception Raised") {
        box.classList.add('state-exception');
    }
}

function isSelectedDateInFuture() {
    const selectedDateStr = document.getElementById('dateInput').value;
    if (!selectedDateStr) return false;
    
    const selectedDate = new Date(selectedDateStr);
    selectedDate.setHours(0,0,0,0);
    
    const today = new Date();
    today.setHours(0,0,0,0);
    
    return selectedDate > today;
}

function configureStatusEditLock(statusVal, resData) {
    const unlockLink = document.getElementById('unlockBtn');
    const closeEditLink = document.getElementById('closeEditBtn');
    const buttonsGroup = document.getElementById('statusButtonsGroup');
    const textDisplay = document.getElementById('statusTextDisplay');
    const mainSupportWidget = document.getElementById('mainSupportWidget');
    const supportBtnsGroup = document.getElementById('supportButtonsGroup');
    const unlockSupportLink = document.getElementById('unlockSupportBtn');
    const closeSupportEditLink = document.getElementById('closeSupportEditBtn');
    const futureLockBanner = document.getElementById('futureScheduleLockBanner');
    const mainTimeToggle = document.getElementById('mainTimeToggle');
    const mainTimeRow = document.getElementById('mainTimePickerRow');
    const supportTimeToggle = document.getElementById('supportTimeToggle');
    const supportTimeRow = document.getElementById('supportTimePickerRow');

    closeEditLink.style.display = "none";
    closeSupportEditLink.style.display = "none";

    if (isSelectedDateInFuture()) {
        unlockLink.style.display = "none";
        buttonsGroup.style.display = "none";
        textDisplay.style.display = "none";
        mainSupportWidget.style.display = "none";
        futureLockBanner.style.display = "block";
        if (mainTimeToggle) { mainTimeToggle.style.display = 'none'; mainTimeRow.style.display = 'none'; mainTimeToggle.classList.remove('active'); }
        if (supportTimeToggle) { supportTimeToggle.style.display = 'none'; supportTimeRow.style.display = 'none'; supportTimeToggle.classList.remove('active'); }
        updateStatusBoxColorByValue("Reciting");
        return;
    }

    futureLockBanner.style.display = "none";

    if (!statusVal || statusVal === "Not Started") {
        statusVal = "Reciting";
    }

    if (statusVal === "Reciting") {
        unlockLink.style.display = "none";
        buttonsGroup.style.display = "flex"; 
        textDisplay.innerText = "Reciting \n ஓதிக்கொண்டிருக்கிறேன் 🔄";
        textDisplay.style.display = "block";
        mainSupportWidget.style.display = "none";
        if (mainTimeToggle) { mainTimeToggle.style.display = 'inline-flex'; }
        if (supportTimeToggle) { supportTimeToggle.style.display = 'none'; supportTimeRow.style.display = 'none'; supportTimeToggle.classList.remove('active'); }
        updateStatusBoxColorByValue("Reciting");
    } else {
        unlockLink.style.display = "inline-block";
        buttonsGroup.style.display = "none";
        if (mainTimeToggle) { mainTimeToggle.style.display = 'none'; mainTimeRow.style.display = 'none'; mainTimeToggle.classList.remove('active'); }
        
        if (statusVal === "Completed") {
            textDisplay.innerText = "Completed \n நிறைவேற்றபட்டது ✓";
            mainSupportWidget.style.display = "none";
        } else if (statusVal === "Exception Raised") {
            textDisplay.innerText = "Exception Raised \n விதிவிலக்கு ⚠️";
            
            if (resData && resData.supportedByName) {
                mainSupportWidget.style.display = "block";
                let supStatus = resData.supportStatus || "Reciting";
                document.getElementById('supportDetailsBanner').innerHTML = 
                    `🤝<br><b>Backup Reader | உதவி வாசகர்:</b><br>${resData.supportedByName}<br><br>` +
                    `<b>Status | நிலை :</b> ${supStatus === "Completed" ? "Completed ✅ <br> நிறைவேற்றபட்டது" : "Reciting 🔄 <br> ஓதிக்கொண்டிருக்கிறேன்"}`;
                
                if (supStatus === "Reciting") {
                    unlockSupportLink.style.display = "none";
                    closeSupportEditLink.style.display = "none";
                    supportBtnsGroup.style.display = "flex"; 
                    if (supportTimeToggle) { supportTimeToggle.style.display = 'inline-flex'; }
                } else {
                    unlockSupportLink.style.display = "inline-block";
                    supportBtnsGroup.style.display = "none";
                    if (supportTimeToggle) { supportTimeToggle.style.display = 'none'; supportTimeRow.style.display = 'none'; supportTimeToggle.classList.remove('active'); }
                }

            } else if (resData) {
                mainSupportWidget.style.display = "block";
                document.getElementById('supportDetailsBanner').innerHTML = `⚠️ <b>Exception: NOT Reassigned Yet</b>`;
                supportBtnsGroup.style.display = "none";
                unlockSupportLink.style.display = "none";
                closeSupportEditLink.style.display = "none";
                if (supportTimeToggle) { supportTimeToggle.style.display = 'none'; supportTimeRow.style.display = 'none'; supportTimeToggle.classList.remove('active'); }
                
                let assignBtn = document.createElement('button');
                assignBtn.className = "btn-support-status";
                assignBtn.style.marginTop = "10px";
                assignBtn.innerText = "Assign Backup Reader\nஉதவி வாசகர் நியமனம்";
                assignBtn.onclick = function() { openReassignModal(); };
                
                let container = document.getElementById('supportDetailsBanner');
                container.innerHTML = '⚠️ <b>Exception: NOT Reassigned Yet</b>';
                container.appendChild(assignBtn);
            } else {
                if (supportTimeToggle) { supportTimeToggle.style.display = 'none'; supportTimeRow.style.display = 'none'; supportTimeToggle.classList.remove('active'); }
            }
        }
        textDisplay.style.display = "block";
    }
    updateStatusBoxColorByValue(statusVal);
}

function enableStatusEditing() {
    document.getElementById('unlockBtn').style.display = "none";
    document.getElementById('closeEditBtn').style.display = "inline-block";
    document.getElementById('statusButtonsGroup').style.display = "flex";
    document.getElementById('statusTextDisplay').style.display = "none";
    document.getElementById('mainSupportWidget').style.display = "none";
    const mt = document.getElementById('mainTimeToggle');
    if (mt) { mt.style.display = 'inline-flex'; }
    
    const box = document.getElementById('statusBoxContainer');
    box.classList.remove('state-completed', 'state-exception');
    box.classList.add('state-progress');
    
    showSnackbar("Status edit mode unlocked!", false);
}

function cancelStatusEditing() {
    closeTimePickers();
    if (fetchedStateCache) {
        configureStatusEditLock(fetchedStateCache.savedStatus, fetchedStateCache);
        showSnackbar("Status changes cancelled.", false);
    }
}

function enableSupportStatusEditing() {
    document.getElementById('supportButtonsGroup').style.display = "flex";
    document.getElementById('unlockSupportBtn').style.display = "none";
    document.getElementById('closeSupportEditBtn').style.display = "inline-block";
    const st = document.getElementById('supportTimeToggle');
    if (st) { st.style.display = 'inline-flex'; }
    showSnackbar("Support reader edits unlocked!", false);
}

function cancelSupportStatusEditing() {
    closeTimePickers();
    if (fetchedStateCache) {
        configureStatusEditLock(fetchedStateCache.savedStatus, fetchedStateCache);
        showSnackbar("Support reader status changes cancelled.", false);
    }
}

function openUserDropdown() {
    document.getElementById('userDropdown').style.display = 'block';
}
function closeUserDropdown() {
    document.getElementById('userDropdown').style.display = 'none';
}
function filterUserOptions() {
    const q = document.getElementById('userSearch').value.toLowerCase();
    const dropdown = document.getElementById('userDropdown');
    const filtered = userListData.filter(u =>
        (u.english + ' | ' + u.tamil).toLowerCase().includes(q)
    );
    if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="opt no-match">No matches found / பொருந்தவில்லை</div>';
    } else {
        dropdown.innerHTML = filtered.map(u =>
            `<div class="opt" data-id="${u.id}" onmousedown="selectUserOption('${u.id}','${(u.english + ' | ' + u.tamil).replace(/'/g, "\\'")}')">${u.english} | ${u.tamil}</div>`
        ).join('');
    }
    dropdown.style.display = 'block';
}
function selectUserOption(id, displayName) {
    document.getElementById('userSearch').value = displayName;
    document.getElementById('userSelect').value = id;
    document.getElementById('userDropdown').style.display = 'none';
    document.getElementById('submitBtn').disabled = false;
    resetAssignmentDetails();
}

const _origResetAssignment = resetAssignmentDetails;
// Redefine resetAssignmentDetails to release timers
resetAssignmentDetails = function() {
    _origResetAssignment();
    closeTimePickers();
};

let timePickerState = { main: '', support: '', report: '' };
function toggleTimePicker(area) {
    const row = document.getElementById(area + 'TimePickerRow');
    const btn = document.getElementById(area + 'TimeToggle');
    const isOpen = row.style.display !== 'none' && row.style.display !== '';
    if (isOpen) {
        row.style.display = 'none';
        btn.classList.remove('active');
    } else {
        row.style.display = 'flex';
        btn.classList.add('active');
        const input = document.getElementById(area + 'CustomTime');
        if (!input.value) {
            input.value = new Date().toISOString().slice(0, 16);
        }
    }
}
function closeTimePickers() {
    ['main', 'support', 'report', 'bulkstep2'].forEach(area => {
        const row = document.getElementById(area + 'TimePickerRow');
        const btn = document.getElementById(area + 'TimeToggle');
        if (row) row.style.display = 'none';
        if (btn) btn.classList.remove('active');
    });
}
function resetCustomTime(area) {
    const input = document.getElementById(area + 'CustomTime');
    input.value = new Date().toISOString().slice(0, 16);
}
function getCustomTime(area) {
    const input = document.getElementById(area + 'CustomTime');
    if (!input || !input.value) return '';
    return input.value.replace('T', ' ') + ':00';
}
function setCustomTime(area, dateTimeStr) {
    const input = document.getElementById(area + 'CustomTime');
    if (!input) return;
    if (dateTimeStr) {
        const m = dateTimeStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
        if (m) {
            input.value = m[1] + 'T' + m[2];
        }
    }
}

function submitQuery() {
    const id = document.getElementById('userSelect').value;
    const date = document.getElementById('dateInput').value;
    const btn = document.getElementById('submitBtn');
    const loader = document.getElementById('loader');
    const resDiv = document.getElementById('result');

    document.getElementById('lastModLabel').innerText = "";

    btn.disabled = true;
    resDiv.style.display = "none";
    loader.style.display = "block";

    google.script.run.withSuccessHandler(function(res) {
        btn.disabled = false;
        loader.style.display = "none";
        
        if (res.error) {
            resDiv.innerHTML = `<div class="error">${res.error}</div>`;
        } else {
            currentActiveUserId = id;
            currentActiveRawDate = res.rawDate;
            currentActiveJuzNumber = res.number;
            fetchedStateCache = res; 

            document.getElementById('weekInfo').innerText = "Schedule for week of: " + res.dateFound + " | Juz " + res.number;
            document.getElementById('resAr').innerText = res.arabic;
            document.getElementById('resEn').innerText = res.english;
            document.getElementById('resTa').innerText = res.tamil;

            if (res.savedStatus) {
                configureStatusEditLock(res.savedStatus, res);
            }

            if (res.savedLastModified) {
                document.getElementById('lastModLabel').innerText = res.savedLastModified;
            }

            setCustomTime('main', res.statusTimestamp || '');
        }
        resDiv.style.display = "block";
    }).findJuzAssignment(id, date);
}

function submitDirectStatus(statusVal) {
    const id = document.getElementById('userSelect').value;
    const dateInputVal = document.getElementById('dateInput').value;
    
    if (!id || !dateInputVal) {
        showSnackbar("Please select a date and name first.", true);
        return;
    }

    if (isSelectedDateInFuture()) {
        showSnackbar("You cannot modify the status of a future schedule date.", true);
        return;
    }

    const compBtn = document.getElementById('completedActionBtn');
    const recBtn = document.getElementById('recitingActionBtn');
    const excBtn = document.getElementById('exceptionActionBtn');
    
    compBtn.disabled = true;
    recBtn.disabled = true;
    excBtn.disabled = true;

    const customTime = getCustomTime('main');
    google.script.run.withSuccessHandler(function(response) {
        compBtn.disabled = false;
        recBtn.disabled = false;
        excBtn.disabled = false;
        
        if (response.success) {
            submitQuery();
            fetchHadiyaDetails(dateInputVal);

            if (response.noChange) {
                showSnackbar("No changes detected. Tracker was not modified.", false);
                if (statusVal === "Exception Raised") {
                    openReassignModal();
                }
            } else {
                showSnackbar("Status updated successfully!", false);
            }
        } else {
            showSnackbar("Failed to update status: " + response.error, true);
        }
    }).updateWeeklyStatus(id, dateInputVal, statusVal, customTime);
}

function submitSupportStatusDirect(newSupStatus) {
    const dateInputVal = document.getElementById('dateInput').value;
    const compBtn = document.getElementById('supportCompletedBtn');
    const recBtn = document.getElementById('supportRecitingBtn');

    compBtn.disabled = true;
    recBtn.disabled = true;

    const customTime = getCustomTime('support');
    google.script.run.withSuccessHandler(function(response) {
        compBtn.disabled = false;
        recBtn.disabled = false;
        if (response.success) {
            showSnackbar("Support Reciting status updated to " + newSupStatus, false);
            submitQuery(); 
            fetchHadiyaDetails(dateInputVal);
        } else {
            showSnackbar("Failed to update support status: " + response.error, true);
        }
    }).updateSupportStatus(currentActiveUserId, dateInputVal, newSupStatus, customTime);
}

function openReassignModal() {
    const modal = document.getElementById('reassignModal');
    const select = document.getElementById('supportUserSelect');
    const metaText = document.getElementById('reassignMetaText');
    const reassignBtn = document.getElementById('reassignBtn');
    const dateVal = document.getElementById('dateInput').value;

    select.innerHTML = '<option value="">Loading available candidates...</option>';
    select.disabled = true;
    reassignBtn.disabled = true;
    modal.style.display = "flex";

    let originalName = document.getElementById('userSearch').value;
    metaText.innerHTML = `An exception has been registered.<br><br>விதிவிலக்கு பதிவு செய்யப்பட்டுள்ளது<br><br><b>Juz ${currentActiveJuzNumber}</b><br><b>Original Reader:</b> ${originalName}`;

    google.script.run.withSuccessHandler(function(candidates) {
        select.innerHTML = '<option value="">Select Support Partner...</option>';
        if (candidates.length === 0) {
            select.innerHTML = '<option value="">No readers available</option>';
            return;
        }
        candidates.forEach(c => {
            let opt = document.createElement('option');
            opt.value = c.id;
            opt.text = c.english + " | " + c.tamil;
            select.appendChild(opt);
        });
        select.disabled = false;
        reassignBtn.disabled = false;
    }).getAvailableSupportUsers(dateVal, currentActiveUserId);
}

function submitReassignment() {
    const supportId = document.getElementById('supportUserSelect').value;
    const dateInputVal = document.getElementById('dateInput').value;
    const reassignBtn = document.getElementById('reassignBtn');

    if (!supportId) {
        showSnackbar("Please select a support partner first.", true);
        return;
    }

    reassignBtn.disabled = true;
    reassignBtn.innerText = "Assigning...";

    google.script.run.withSuccessHandler(function(response) {
        reassignBtn.disabled = false;
        reassignBtn.innerText = "Assign Reciting Partner";
        
        if (response.success) {
            showSnackbar("Successfully reassigned Reciting support to " + response.assignedName, false);
            closeReassignModal();
            submitQuery(); 
        } else {
            showSnackbar("Failed to reassign support: " + response.error, true);
        }
    }).reassignJuz(currentActiveUserId, dateInputVal, supportId);
}

function closeReassignModal() {
    document.getElementById('reassignModal').style.display = "none";
    submitQuery(); 
}

let reportIsEditable = false;

function fetchAndRenderReport(dateVal, onComplete) {
    const tableBody = document.getElementById('reportTableBody');
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color:#8b949e;">Fetching status records from database...</td></tr>';

    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.filter-btn[data-filter="ALL"]')?.classList.add('active');

    google.script.run.withSuccessHandler(function(res) {
        if (res.error) {
            tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#f87171; padding:20px;">${res.error}</td></tr>`;
            if (onComplete) onComplete();
            return;
        }
        document.getElementById('reportTitle').querySelector('span').innerText = "Week / வாரம் : " + res.week;
        rawReportData = res.data;
        reportIsEditable = res.isEditable || false;
        document.querySelectorAll('.sort-indicator').forEach(el => { el.textContent = ''; el.classList.remove('active'); });
        sortColumn = 'dateLogged';
        sortAsc = false;
        applyReportFilter();
        if (onComplete) onComplete();
    }).getWeeklyReport(dateVal);
}

function openReportModal() {
    const modal = document.getElementById('reportModal');
    const dateVal = document.getElementById('dateInput').value;
    const reportBtn = document.getElementById('reportBtn');

    if (!dateVal) {
        showSnackbar("Please select a date first.", true);
        return;
    }

    reportBtn.disabled = true;
    reportBtn.innerText = "Loading Report...";
    modal.style.display = "flex";

    fetchAndRenderReport(dateVal, function() {
        reportBtn.disabled = false;
        reportBtn.innerText = "View Weekly Report \n வாராந்திர அறிக்கை";
    });
}

let reportEditUserId = null;

function openReportEditModal(userId, name, currentStatus, dateLogged) {
    reportEditUserId = userId;
    document.getElementById('reportEditName').innerText = name;
    document.getElementById('reportEditCurrentStatus').innerText = currentStatus === "Not Started" ? "Reciting" : currentStatus;
    setCustomTime('report', dateLogged || '');
    document.getElementById('reportEditModal').style.display = "flex";
}

function closeReportEditModal() {
    document.getElementById('reportEditModal').style.display = "none";
    const rtr = document.getElementById('reportTimePickerRow');
    const rtt = document.getElementById('reportTimeToggle');
    if (rtr) rtr.style.display = 'none';
    if (rtt) rtt.classList.remove('active');
    reportEditUserId = null;
}

function submitReportEditStatus(newStatus) {
    if (!reportEditUserId) return;
    const dateVal = document.getElementById('dateInput').value;
    const btns = document.querySelectorAll('#reportEditModal .status-btn');
    btns.forEach(b => b.disabled = true);

    google.script.run.withSuccessHandler(function(response) {
        btns.forEach(b => b.disabled = false);
        if (response.success) {
            const entry = rawReportData.find(r => r.userId === reportEditUserId);
            if (entry) {
                entry.status = newStatus;
                const customReportTime = getCustomTime('report');
                const useTs = (newStatus === 'Completed' || newStatus === 'Exception Raised') ? (customReportTime || (function(){const d=new Date();const p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());})()) : '';
                entry.dateLogged = useTs;
                if (newStatus !== 'Exception Raised') {
                    entry.supportedBy = '';
                    entry.supportStatus = '';
                }
            }
            showSnackbar("Status updated: " + newStatus, false);
            closeReportEditModal();
            applyReportFilter();
            fetchHadiyaDetails(dateVal);
        } else {
            showSnackbar("Failed: " + (response.error || 'Error'), true);
        }
    }).updateWeeklyStatus(reportEditUserId, dateVal, newStatus, getCustomTime('report'));
}

function updateReportCounter(filteredCount, totalCount) {
    const badge = document.getElementById('reportCountBadge');
    badge.innerText = `Count / எண்ணிக்கை - ${filteredCount}`;
}

function scrollReportToResults() {
    setTimeout(function() {
        const el = document.getElementById('reportSearchInput') || document.getElementById('reportTableWrapper');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 400);
}
function toggleSearchBar() {
    searchVisible = !searchVisible;
    const input = document.getElementById('reportSearchInput');
    input.style.display = searchVisible ? 'block' : 'none';
    if (searchVisible) {
        setTimeout(function() {
            input.focus();
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    } else {
        input.value = '';
        applyReportFilter();
    }
}
function toggleBulkMode() {
    bulkMode = !bulkMode;
    const btn = document.getElementById('bulkToggleBtn');
    const panel = document.getElementById('bulkPanel');
    const ths = document.querySelectorAll('.report-bulk-th');
    if (bulkMode) {
        btn.classList.add('active');
        btn.innerHTML = 'Bulk ⚡';
        panel.style.display = 'flex';
        ths.forEach(th => th.style.display = 'table-cell');
        document.getElementById('reportSearchInput').style.display = 'block';
        searchVisible = true;
    } else {
        btn.classList.remove('active');
        btn.innerHTML = 'Bulk ⚡';
        panel.style.display = 'none';
        ths.forEach(th => th.style.display = 'none');
        selectedUserIds.clear();
        document.getElementById('bulkApplyBtn').disabled = true;
        document.getElementById('bulkApplyBtn').innerText = 'Process 0';
        if (!searchVisible) {
            document.getElementById('reportSearchInput').style.display = 'none';
        }
    }
    closeTimePickers();
    applyReportFilter();
}
function toggleBulkSelect(uid, checked) {
    if (checked) selectedUserIds.add(uid);
    else selectedUserIds.delete(uid);
    updateBulkApplyBtn();
}
function toggleSelectAll() {
    const allChecked = bulkAvailableData.every(r => selectedUserIds.has(r.userId));
    if (allChecked) {
        bulkAvailableData.forEach(r => selectedUserIds.delete(r.userId));
    } else {
        bulkAvailableData.forEach(r => selectedUserIds.add(r.userId));
    }
    applyReportFilter();
    updateBulkApplyBtn();
}
function updateBulkApplyBtn() {
    const btn = document.getElementById('bulkApplyBtn');
    const n = selectedUserIds.size;
    btn.disabled = n === 0;
    btn.innerText = 'Process ' + n;
}
function openBulkStep2() {
    if (selectedUserIds.size === 0) return;
    bulkSelectedStatus = '';
    const names = [];
    rawReportData.forEach(r => {
        if (selectedUserIds.has(r.userId)) {
            const parts = r.name.split(' | ');
            names.push(parts[0] || r.name);
        }
    });
    document.getElementById('bulkStep2Info').innerHTML = `<b>${names.length}</b> record(s) selected`;
    document.getElementById('bulkStep2List').innerHTML = names.join('<br>');
    document.getElementById('bulkStep2ConfirmBtn').disabled = true;
    document.getElementById('bulkStep2Overlay').style.display = 'flex';
    document.getElementById('bulkstep2CustomTime').value = '';
}
function closeBulkStep2() {
    document.getElementById('bulkStep2Overlay').style.display = 'none';
    const row = document.getElementById('bulkstep2TimePickerRow');
    const btn = document.getElementById('bulkstep2TimeToggle');
    if (row) row.style.display = 'none';
    if (btn) btn.classList.remove('active');
}
function selectBulkStatus(status) {
    bulkSelectedStatus = status;
    const labels = {'Completed':'Completed ✓','Reciting':'Reciting 🔄','Exception Raised':'Exception ⚠️'};
    document.getElementById('bulkStep2ConfirmBtn').disabled = false;
    document.getElementById('bulkStep2ConfirmBtn').innerText = 'Continue — ' + (labels[status] || status);
    document.querySelectorAll('#bulkStep2Overlay .btn-status-completed, #bulkStep2Overlay .btn-status-reciting, #bulkStep2Overlay .btn-status-exception').forEach(b => {
        b.style.outline = b.getAttribute('onclick').includes("'" + status + "'") ? '2px solid #5eead4' : 'none';
    });
}
function openBulkConfirm() {
    const dateVal = document.getElementById('dateInput').value;
    const names = [];
    rawReportData.forEach(r => {
        if (selectedUserIds.has(r.userId)) {
            const parts = r.name.split(' | ');
            names.push(parts[0] || r.name);
        }
    });
    const labels = {'Completed':'Completed ✓','Reciting':'Reciting 🔄','Exception Raised':'Exception ⚠️'};
    document.getElementById('bulkConfirmInfo').innerHTML =
        `<b>Status:</b> ${labels[bulkSelectedStatus] || bulkSelectedStatus}<br><b>Date:</b> ${dateVal}<br><b>Records:</b> ${names.length}`;
    document.getElementById('bulkConfirmList').innerHTML = names.join('<br>');
    document.getElementById('bulkConfirmOverlay').style.display = 'flex';
    closeBulkStep2();
}
function closeBulkConfirm() {
    document.getElementById('bulkConfirmOverlay').style.display = 'none';
}
function executeBulkUpdate() {
    const status = bulkSelectedStatus;
    const dateVal = document.getElementById('dateInput').value;
    const customTime = getCustomTime('bulkstep2');
    const userIds = Array.from(selectedUserIds);
    const btn = document.getElementById('bulkConfirmYesBtn');
    btn.disabled = true;
    btn.innerText = 'Updating...';
    let completed = 0, failed = 0;
    const total = userIds.length;
    function processNext(i) {
        if (i >= total) {
            btn.disabled = false;
            btn.innerText = 'Confirm / உறுதி';
            closeBulkConfirm();
            showSnackbar('Bulk update: ' + completed + ' updated, ' + failed + ' failed', failed > 0);
            if (completed > 0) {
                selectedUserIds.clear();
                fetchAndRenderReport(dateVal);
            }
            return;
        }
        google.script.run.withSuccessHandler(function(res) {
            if (res.success) completed++;
            else failed++;
            processNext(i + 1);
        }).updateWeeklyStatus(userIds[i], dateVal, status, customTime);
    }
    processNext(0);
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    if (m) {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const h = +m[4], min = +m[5];
        var dt = new Date(+m[1], +m[2]-1, +m[3]);
        var dayName = days[dt.getDay()];
        return dayName + ', ' + (+m[3]) + ' ' + months[+m[2]-1] + ' ' + m[1] + ', ' + (h % 12 || 12) + ':' + String(min).padStart(2,'0') + ' ' + (h >= 12 ? 'PM' : 'AM');
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const h = d.getHours(), min = d.getMinutes();
        return days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ', ' + (h % 12 || 12) + ':' + String(min).padStart(2,'0') + ' ' + (h >= 12 ? 'PM' : 'AM');
    }
    return dateStr;
}

function formatDisplayDateParts(dateStr) {
    if (!dateStr) return null;
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    let d, h, min;
    if (m) {
        d = new Date(+m[1], +m[2] - 1, +m[3]);
        h = +m[4];
        min = +m[5];
    } else {
        d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        h = d.getHours();
        min = d.getMinutes();
    }
    return {
        day: days[d.getDay()],
        date: d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear(),
        time: (h % 12 || 12) + ':' + String(min).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM')
    };
}

function renderReportRows(items) {
    const tableBody = document.getElementById('reportTableBody');
    bulkAvailableData = items;
    if (items.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#8b949e;">No matching records found.</td></tr>';
        return;
    }

    let html = "";
    items.forEach(row => {
        let badgeClass = "badge-default";
        
        let resolvedStatus = row.status;
        if (!resolvedStatus || resolvedStatus === "Not Started") {
            resolvedStatus = "Reciting";
        }

        if (resolvedStatus === "Completed") badgeClass = "badge-completed";
        else if (resolvedStatus === "Reciting") badgeClass = "badge-progress";
        else if (resolvedStatus === "Exception Raised") badgeClass = "badge-exception";

        let dateLoggedInfo = '';
        if (row.dateLogged) {
            var dtParts = formatDisplayDateParts(row.dateLogged);
            if (dtParts) {
                dateLoggedInfo = '<span class="date-logged"><span>' + dtParts.day + '</span><span class="date-line">' + dtParts.date + '</span><span class="time-line">' + dtParts.time + '</span></span>';
            } else {
                dateLoggedInfo = '<span class="date-logged">' + formatDisplayDate(row.dateLogged) + '</span>';
            }
        }
        
        if (row.status === "Exception Raised") {
            if (row.supportedBy) {
                let supStatusText = row.supportStatus === "Completed" ? "Completed ✅" : "Reciting 🔄";
                dateLoggedInfo += `<span class="date-logged" style="color: #58a6ff; font-weight:600;">🤝 Support: ${row.supportedBy} (${supStatusText})</span>`;
            } else {
                dateLoggedInfo += `<span class="date-logged" style="color: #f87171; font-weight:600;">⚠️ Exception Unassigned</span>`;
            }
        }

        let nameParts = row.name.split(" | ");
        let enName = nameParts[0];
        let taName = nameParts[1] ? `<span>${nameParts[1]}</span>` : '';

        let editLink = '';
        let timeEditIcon = '';
        if (reportIsEditable && row.userId) {
            const rawStatus = row.status || "Not Started";
            const needsEdit = rawStatus === "Reciting" || rawStatus === "Not Started" ||
                (rawStatus === "Exception Raised" && (!row.supportedBy || row.supportStatus !== "Completed"));
            if (needsEdit) {
                const encName = row.name.replace(/'/g, "\\'");
                const encDate = (row.dateLogged || '').replace(/'/g, "\\'");
                editLink = `<br><a href="#" onclick="openReportEditModal('${row.userId}','${encName}','${rawStatus}','${encDate}'); return false;" style="font-size:0.7rem; color:#58a6ff; font-weight:600;">Edit / மாற்ற</a>`;
            }
            if (rawStatus === "Completed") {
                const encName = row.name.replace(/'/g, "\\'");
                const encDate = (row.dateLogged || '').replace(/'/g, "\\'");
                timeEditIcon = `<span class="report-time-edit" style="cursor:pointer;" onclick="openReportEditModal('${row.userId}','${encName}','Completed','${encDate}')" title="Update completion time"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e6edf3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>`;
            }
        }

        const isChecked = selectedUserIds.has(row.userId);
        const cbHtml = bulkMode ? `<td class="bulk-checkbox-cell"><input type="checkbox" class="bulk-checkbox" data-uid="${row.userId}" ${isChecked ? 'checked' : ''} onchange="toggleBulkSelect('${row.userId}', this.checked)"></td>` : '';

        html += `<tr>
            ${cbHtml}
            <td class="report-name-col">
                <div class="name-cell">
                    ${enName}
                    ${taName}
                </div>
            </td>
            <td class="report-juz-col">
                <div class="juz-info-block">
                    <span class="num-badge">Juz ${row.juzNum}</span>
                    <span class="ar-val">${row.juzAr}</span>
                    <span class="en-val">${row.juzEn}</span>
                    <span class="ta-val">${row.juzTa}</span>
                </div>
            </td>
            <td class="report-status-col">
                <span class="badge ${badgeClass}">${resolvedStatus}</span>
                ${dateLoggedInfo}
                ${editLink}
                ${timeEditIcon}
            </td>
        </tr>`;
    });

    tableBody.innerHTML = html;
}

function getSortValue(row, col) {
    if (col === 'name') return row.name.toLowerCase();
    if (col === 'juz') return parseInt(row.juzNum) || 0;
    if (col === 'status') {
        let s = row.status;
        if (!s || s === "Not Started") s = "Reciting";
        return s;
    }
    if (col === 'dateLogged') {
        if (!row.dateLogged) return 0;
        var t = new Date(row.dateLogged).getTime();
        return isNaN(t) ? 0 : t;
    }
    return '';
}

function sortReportData(col) {
    if (sortColumn === col) {
        sortAsc = !sortAsc;
    } else {
        sortColumn = col;
        sortAsc = true;
    }
    document.querySelectorAll('.sort-indicator').forEach(el => el.classList.remove('active'));
    const indicator = document.getElementById('sortIndicator' + col.charAt(0).toUpperCase() + col.slice(1));
    if (indicator) {
        indicator.textContent = sortAsc ? ' ▲' : ' ▼';
        indicator.classList.add('active');
    }
    applyReportFilter();
}

function applyReportFilter(filterVal) {
    if (filterVal === undefined) {
        const activeBtn = document.querySelector('.filter-btn.active');
        filterVal = activeBtn ? activeBtn.dataset.filter : 'ALL';
    } else {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-btn[data-filter="' + filterVal + '"]')?.classList.add('active');
    }

    const searchQ = document.getElementById('reportSearchInput').value.toLowerCase().trim();

    let filtered = [];
    if (filterVal === "ALL") {
        filtered = rawReportData;
    } else if (filterVal === "EXCEPTION_ALL") {
        filtered = rawReportData.filter(row => row.status === "Exception Raised");
    } else if (filterVal === "EXCEPTION_REASSIGNED") {
        filtered = rawReportData.filter(row => row.status === "Exception Raised" && row.supportedBy);
    } else if (filterVal === "EXCEPTION_UNASSIGNED") {
        filtered = rawReportData.filter(row => row.status === "Exception Raised" && !row.supportedBy);
    } else if (filterVal === "Reciting") {
        filtered = rawReportData.filter(row => !row.status || row.status === "Reciting" || row.status === "Not Started");
    } else {
        filtered = rawReportData.filter(row => row.status === filterVal);
    }

    if (searchQ) {
        filtered = filtered.filter(row =>
            row.name.toLowerCase().includes(searchQ) ||
            (row.juzNum && row.juzNum.toString() === searchQ) ||
            (row.juzEn && row.juzEn.toLowerCase().includes(searchQ)) ||
            (row.juzTa && row.juzTa.toLowerCase().includes(searchQ)) ||
            (row.juzAr && row.juzAr.toLowerCase().includes(searchQ))
        );
    }

    filtered.sort((a, b) => {
        let va = getSortValue(a, sortColumn);
        let vb = getSortValue(b, sortColumn);
        if (typeof va === 'string') {
            return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return sortAsc ? va - vb : vb - va;
    });

    renderReportRows(filtered);
    updateReportCounter(filtered.length, rawReportData.length);
}

function captureElementToClipboard(element, btn, fileName, successMsg) {
    btn.disabled = true;
    btn.innerText = "Rendering...";
    btn.style.background = "#37474f";
    btn.style.color = "#ffffff";

    html2canvas(element, {
        scale: 4,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
    }).then(function(canvas) {
        canvas.toBlob(function(blob) {
            try {
                navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).then(function() {
                    btn.innerText = "Copied! ✓";
                    btn.style.background = "#1b5e20";
                    btn.style.color = "#ffffff";
                    setTimeout(function() {
                        btn.innerText = fileName;
                        btn.style.background = btn.id === 'shareBtn' ? "#2e7d32" : "#e65100";
                        btn.style.color = "#ffffff";
                        btn.disabled = false;
                    }, 2500);
                    showSnackbar(successMsg || "Image copied!", false);
                }).catch(function() {
                    btn.disabled = false;
                    btn.innerText = fileName;
                    btn.style.background = btn.id === 'shareBtn' ? "#2e7d32" : "#e65100";
                    btn.style.color = "#ffffff";
                    showSnackbar("Failed to copy image. Try again.", true);
                });
            } catch(e) {
                btn.disabled = false;
                btn.innerText = fileName;
                btn.style.background = btn.id === 'shareBtn' ? "#2e7d32" : "#e65100";
                btn.style.color = "#ffffff";
                showSnackbar("Failed to copy image.", true);
            }
        }, 'image/png');
    }).catch(function(err) {
        btn.disabled = false;
        btn.innerText = fileName;
        btn.style.background = btn.id === 'shareBtn' ? "#2e7d32" : "#e65100";
        btn.style.color = "#ffffff";
        showSnackbar("Rendering failed.", true);
    });
}

function copyReportToClipboard() {
    if (!rawReportData || rawReportData.length === 0) {
        showSnackbar("No data available to copy.", true);
        return;
    }

    var captureArea = document.getElementById('reportCaptureArea');
    var shareBtn = document.getElementById('shareBtn');

    var tempDiv = document.createElement('div');
    var w = captureArea.offsetWidth;
    tempDiv.style.cssText = 'position:fixed;left:-9999px;top:0;width:' + w + 'px;box-sizing:border-box;background:#0d1117;border-top:1px solid #21262d;border-bottom:1px solid #21262d;padding:12px 0;font-family:Poppins,sans-serif;';
    tempDiv.innerHTML = captureArea.innerHTML;

    tempDiv.querySelectorAll('th').forEach(function(th) { th.style.position = 'static'; });
    tempDiv.querySelectorAll('a[onclick*="openReportEditModal"]').forEach(function(el) { el.style.display = 'none'; });
    var cw = tempDiv.querySelector('#reportTableWrapper');
    if (cw) { cw.style.maxHeight = 'none'; }

    document.body.appendChild(tempDiv);

    shareBtn.disabled = true;
    shareBtn.innerText = "Rendering...";
    shareBtn.style.background = "#37474f";
    shareBtn.style.color = "#ffffff";

    html2canvas(tempDiv, {
        scale: 4,
        useCORS: true,
        backgroundColor: '#0d1117',
        logging: false
    }).then(function(canvas) {
        document.body.removeChild(tempDiv);
        canvas.toBlob(function(blob) {
            try {
                navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).then(function() {
                    shareBtn.innerText = "Copied! ✓";
                    shareBtn.style.background = "#1b5e20";
                    shareBtn.style.color = "#ffffff";
                    setTimeout(function() {
                        shareBtn.innerText = "Copy Report 📋";
                        shareBtn.style.background = "#2e7d32";
                        shareBtn.style.color = "#ffffff";
                        shareBtn.disabled = false;
                    }, 2500);
                    showSnackbar("Report copied as image!", false);
                }).catch(function() {
                    shareBtn.disabled = false;
                    shareBtn.innerText = "Copy Report 📋";
                    shareBtn.style.background = "#2e7d32";
                    shareBtn.style.color = "#ffffff";
                    showSnackbar("Failed to copy image. Try again.", true);
                });
            } catch(e) {
                shareBtn.disabled = false;
                shareBtn.innerText = "Copy Report 📋";
                shareBtn.style.background = "#2e7d32";
                shareBtn.style.color = "#ffffff";
                showSnackbar("Failed to copy image.", true);
            }
        }, 'image/png');
    }).catch(function(err) {
        document.body.removeChild(tempDiv);
        shareBtn.disabled = false;
        shareBtn.innerText = "Copy Report 📋";
        shareBtn.style.background = "#2e7d32";
        shareBtn.style.color = "#ffffff";
        showSnackbar("Rendering failed.", true);
    });
}

function copyHadiyaNoteToClipboard() {
    if (!currentHadiyaDetails || !currentHadiyaDetails.current) {
        showSnackbar("No Hadiya details available to copy.", true);
        return;
    }

    var hadiyaBtn = document.getElementById('hadiyaShareBtn');
    var res = currentHadiyaDetails;
    var cur = res.current;

    var captureDiv = document.getElementById('hadiyaCaptureArea');

    var dedHtml = '';
    if (cur.dedicatedTo && cur.dedicatedTo !== cur.en) {
        dedHtml = '<div style="font-size:0.85rem; color:#d29922; font-weight:600; margin-bottom:8px;">🎯 Dedicated to / அர்ப்பணித்தல்: ' +
            (cur.dedicatedToTa || cur.dedicatedTo) + '</div>';
    }

    var tHadiyaSub = 'ஹதியா நிறைவேற்றப்பட்டது';
    var tWeek = 'வாரம்';
    var tAlhamdulillah = 'அல்ஹம்துலில்லாஹ், இந்த வாரத்திற்கான<br>அனைத்து ஜுஸ் ஓதுதல்களும்<br>திட்டமிட்டபடி சரியான நேரத்தில்<br>வெற்றிகரமாக நிறைவு பெற்றுள்ளன!';
    var tJazak = 'ஜஜாக்குமுல்லாஹு கைரான், உங்களின் விரைவான அர்ப்பணிப்பிற்கு நன்றி!';
    var tDedicated = 'இந்த வார முழுமையான கத்தம் ஹதியா<br>கீழே உள்ள உறுப்பினரால் நிறைவேற்றப்பட்டு அர்ப்பணிக்கப்படுகிறது:';
    var tDua = 'யா அல்லாஹ், எங்களின் ஒருங்கிணைந்த முயற்சிகளை ஏற்றுக்கொண்டு,<br>ஈடுபட்ட அனைவருக்கும் மகத்தான பரக்கத்தை வழங்கி,<br>அனைத்து ஓதுனர்களுக்கும் இம்மையிலும் மறுமையிலும்<br>உயர்ந்த அந்தஸ்தை வழங்குவாயாக்!';

    captureDiv.innerHTML =
        '<div style="width:480px; background:linear-gradient(180deg, #161b22 0%, #0d1117 100%); padding:24px; box-sizing:border-box; font-family:Poppins, Arial, sans-serif;">' +
        '<div style="height:4px; background:#2dd4bf; margin:-24px -24px 20px -24px;"></div>' +
        '<div style="font-size:1.2rem; font-weight:700; color:#5eead4; text-align:center; margin-bottom:2px;">' +
        'Hadiya Completed</div>' +
        '<div style="font-size:0.9rem; font-weight:600; color:#5eead4; text-align:center; margin-bottom:8px;">' +
        tHadiyaSub + '</div>' +
        '<div style="text-align:center; font-size:0.7rem; color:#30363d; margin-bottom:8px;">' +
        '——————————————————</div>' +
        '<div style="text-align:center; font-size:0.95rem; font-weight:700; color:#e6edf3; margin-bottom:16px;">' +
        'Week / ' + tWeek + ': ' + cur.range + '</div>' +
        '<div style="text-align:center; font-size:0.85rem; color:#c9d1d9; line-height:1.6; margin-bottom:4px;">' +
        tAlhamdulillah + '</div>' +
        '<div style="text-align:center; font-size:0.85rem; color:#c9d1d9; line-height:1.6; margin-bottom:4px;">' +
        tJazak + '</div>' +
        '<div style="text-align:center; font-size:0.85rem; color:#c9d1d9; line-height:1.6; margin-bottom:16px;">' +
        tDedicated + '</div>' +
        '<div style="text-align:center; font-size:1.2rem; font-weight:700; color:#5eead4; margin-bottom:2px;">' +
        (cur.ta || cur.en) + '</div>' +
        '<div style="text-align:center; font-size:1rem; font-weight:600; color:#c9d1d9; margin-bottom:12px;">' +
        cur.en + '</div>' +
        dedHtml +
        '<div style="text-align:center; font-size:0.85rem; color:#c9d1d9; line-height:1.6; margin-bottom:4px;">' +
        'Alhamdulillah, all assigned Juz recitations<br>for this week have been completed<br>successfully on time!</div>' +
        '<div style="text-align:center; font-size:0.85rem; color:#c9d1d9; line-height:1.6; margin-bottom:4px;">' +
        'Jazakumullahu Khairan for your swift dedication!</div>' +
        '<div style="text-align:center; font-size:0.85rem; color:#c9d1d9; line-height:1.6; margin-bottom:16px;">' +
        'The Khatam Hadiya is dedicated to and<br>completed by the above member.</div>' +
        '<div style="text-align:center; font-size:0.7rem; color:#30363d; margin-bottom:12px;">' +
        '——————————————————</div>' +
        '<div style="text-align:center; font-size:0.8rem; color:#8b949e; line-height:1.6; margin-bottom:12px;">' +
        tDua + '</div>' +
        '<div style="text-align:center; font-size:0.75rem; color:#8b949e; line-height:1.5; margin-bottom:16px;">' +
        'May Allah accept our combined efforts,<br>grant immense barakah to everyone involved,<br>and reward all readers with the highest<br>ranks in Dunya and Akhirah.</div>' +
        '<div style="text-align:center; font-size:0.7rem; color:#30363d;">— Inainthu Othuvom —</div>' +
        '</div>';

    captureDiv.style.display = 'block';
    captureElementToClipboard(captureDiv, hadiyaBtn, "Hadiya Note 📋", "Hadiya note copied as image!");
    setTimeout(function() { captureDiv.style.display = 'none'; captureDiv.innerHTML = ''; }, 1000);
}

function closeReportModal() {
    document.getElementById('reportModal').style.display = "none";
    if (bulkMode) toggleBulkMode();
}

window.onclick = function(event) {
    const modal = document.getElementById('reportModal');
    const reassignModal = document.getElementById('reassignModal');
    if (event.target == modal) {
        modal.style.display = "none";
    }
    if (event.target == reassignModal) {
        reassignModal.style.display = "none";
    }
}
