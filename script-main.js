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

window.onload = function() {
    (function(){var d=new Date();var p=function(n){return String(n).padStart(2,'0')};document.getElementById('dateInput').value=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());})();
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

function resetAssignmentDetails() {
    document.getElementById('result').style.display = "none";
    currentActiveUserId = null;
    currentActiveRawDate = null;
    currentActiveJuzNumber = null;
    fetchedStateCache = null;
    document.getElementById('hadiyaBox').classList.add('hadiya-loading');
    const nextHadiyaLockBanner = document.getElementById('nextHadiyaLockBanner');
    if (nextHadiyaLockBanner) nextHadiyaLockBanner.style.display = "none";
    var d = document.getElementById('dateInput').value;
    if (d) fetchHadiyaDetails(d);
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
    selectedDate.setHours(0,0,0,0,0);
    
    const today = new Date();
    today.setHours(0,0,0,0,0);
    
    return selectedDate > today;
}

function isPastNextHadiyaStart() {
    if (!currentHadiyaDetails || !currentHadiyaDetails.next || !currentHadiyaDetails.next.nextStartISO) {
        return false;
    }
    const nextStart = new Date(currentHadiyaDetails.next.nextStartISO);
    return new Date() >= nextStart;
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
     const nextHadiyaLockBanner = document.getElementById('nextHadiyaLockBanner');

     if (isPastNextHadiyaStart()) {
         unlockLink.style.display = "none";
         buttonsGroup.style.display = "none";
         textDisplay.style.display = "none";
         mainSupportWidget.style.display = "none";
         if (nextHadiyaLockBanner) {
             nextHadiyaLockBanner.innerHTML = "🔒 Next Hadiya has started. Status updates are now locked for this week.<br>அடுத்த ஹதியா தொடங்கியுள்ளது. இந்த வாரத்தின் நிலை புதுப்பிக்க முடியாமல்.";
             nextHadiyaLockBanner.style.display = "block";
         }
         if (mainTimeToggle) { mainTimeToggle.style.display = 'none'; mainTimeRow.style.display = 'none'; mainTimeToggle.classList.remove('active'); }
         if (supportTimeToggle) { supportTimeToggle.style.display = 'none'; supportTimeRow.style.display = 'none'; supportTimeToggle.classList.remove('active'); }
         updateStatusBoxColorByValue("Reciting");
         return;
     }

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
    if (isPastNextHadiyaStart()) {
        showSnackbar("Next Hadiya has started. Status updates are locked.", true);
        return;
    }
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
    if (isPastNextHadiyaStart()) {
        showSnackbar("Next Hadiya has started. Support status updates are locked.", true);
        return;
    }
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
    var now = new Date();
    var pad = function(n) { return String(n).padStart(2, '0'); };
    input.value = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());
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
    const weekVal = (currentHadiyaDetails && currentHadiyaDetails.weekStart) || dateInputVal;
    
    if (!id || !dateInputVal) {
        showSnackbar("Please select a date and name first.", true);
        return;
    }

    if (isSelectedDateInFuture()) {
        showSnackbar("You cannot modify the status of a future schedule date.", true);
        return;
    }

    if (isPastNextHadiyaStart()) {
        showSnackbar("Next Hadiya has started. Status updates are locked for this week.", true);
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
                // Email notification is handled inside script-supabase.js -> updateWeeklyStatus()
            }
        } else {
            showSnackbar("Failed to update status: " + response.error, true);
        }
    }).updateWeeklyStatus(id, weekVal, statusVal, customTime);
}

function submitSupportStatusDirect(newSupStatus) {
    if (isPastNextHadiyaStart()) {
        showSnackbar("Next Hadiya has started. Support status updates are locked.", true);
        return;
    }
    const dateInputVal = document.getElementById('dateInput').value;
    const weekVal = (currentHadiyaDetails && currentHadiyaDetails.weekStart) || dateInputVal;
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
    }).updateSupportStatus(currentActiveUserId, weekVal, newSupStatus, customTime);
}

function openReassignModal() {
    const modal = document.getElementById('reassignModal');
    const select = document.getElementById('supportUserSelect');
    const metaText = document.getElementById('reassignMetaText');
    const reassignBtn = document.getElementById('reassignBtn');
    const dateVal = (currentHadiyaDetails && currentHadiyaDetails.weekStart) || document.getElementById('dateInput').value;

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
    if (isPastNextHadiyaStart()) {
        showSnackbar("Next Hadiya has started. Reassignment is locked.", true);
        return;
    }
    const supportId = document.getElementById('supportUserSelect').value;
    const dateInputVal = document.getElementById('dateInput').value;
    const weekVal = (currentHadiyaDetails && currentHadiyaDetails.weekStart) || dateInputVal;
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
    }).reassignJuz(currentActiveUserId, weekVal, supportId);
}

function closeReassignModal() {
    document.getElementById('reassignModal').style.display = "none";
    submitQuery(); 
}
