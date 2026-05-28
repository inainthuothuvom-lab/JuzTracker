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
            if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
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

    var isPast = cur.deadlineISO ? new Date() >= new Date(cur.deadlineISO) : false;
    var alertEl = document.getElementById('hadiyaScheduleTimeAlert');
    alertEl.innerHTML = isPast ? '⚠️ This week is in the past.' : '';
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
    function getDL(id) { var v = document.getElementById(id).value; return v ? new Date(v).toISOString() : ''; }
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

function navigateHadiya(dir) {
    var input = document.getElementById('dateInput');
    var d = new Date(input.value || new Date());
    d.setDate(d.getDate() + dir * 7);
    var p = function(n) { return String(n).padStart(2,'0'); };
    input.value = d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
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

    var deadlineDisplay = cur.deadlineDisplay ? formatDisplayDate(cur.deadlineDisplay) : '';
    var counterCol = `<div class="hadiya-counter-col">
        <div class="counter-days" id="hadiyaCounterDays">--</div>
        <div class="counter-hms" id="hadiyaCounterHms">--:--:--</div>
        <div class="hadiya-deadline-label" style="font-size:0.55rem;color:#8b949e;margin-top:1px;white-space:nowrap;">Deadline: ${deadlineDisplay}</div>
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
        var nextStartDisplay = res.next.nextStartDisplay ? formatDisplayDate(res.next.nextStartDisplay) : '';
        document.getElementById('hadNext').innerHTML = 
            `<b style="font-size:0.65rem;">${res.next.range}</b><br>` +
            `${res.next.en}<br>` +
            `<span style="font-size:0.65rem; color:#8b949e;">${res.next.ta}</span>` +
            (nextStartDisplay ? `<div style="font-size:0.55rem;color:#8b949e;margin-top:2px;">Starts: ${nextStartDisplay}</div>` : '');
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
