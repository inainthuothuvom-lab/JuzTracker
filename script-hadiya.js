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

    var isCompleted = cur.status === "Completed";
    var deadlineDisplay = '';
    var counterCol = '';
    
    // Only show countdown if not completed
    if (!isCompleted && cur.deadlineDisplay) {
        deadlineDisplay = formatDisplayDate(cur.deadlineDisplay);
        counterCol = `<div class="hadiya-counter-col">
            <div class="counter-days" id="hadiyaCounterDays">--</div>
            <div class="counter-hms" id="hadiyaCounterHms">--:--:--</div>
            <div class="hadiya-deadline-label" style="font-size:0.55rem;color:#8b949e;margin-top:1px;white-space:nowrap;">Deadline: ${deadlineDisplay}</div>
        </div>`;
        startHadiyaCountdown(cur.deadlineISO);
    }

    var nameRow = `<div class="hadiya-name-row">${nameCol}${counterCol}</div>`;

    var dedicationHtml = '';
    if (hasDedication) {
        var purposes = cur.dedicatedPurposeEn ? cur.dedicatedPurposeEn.split(';').map(s => s.trim()).filter(s => s) : [];
        var purposeTas = cur.dedicatedPurposeTa ? cur.dedicatedPurposeTa.split(';').map(s => s.trim()).filter(s => s) : [];
        var purposeHtml = '';
        
        for (var i = 0; i < purposes.length; i++) {
            purposeHtml += `<div style="font-size:0.75rem; color:#8b949e; margin-top:2px;">${purposeTas[i] || purposes[i]}</div>`;
        }
        
        dedicationHtml = `<div class="hadiya-name-col" style="margin-top:2px;">
            <div style="font-size:0.75rem; color:#d29922; font-weight:600;">🎯 Dedicated | அர்பணித்தல்:</div>
            <div style="font-size:1rem; font-weight:600; color:#d29972;">${dedName}</div>
            ${purposeHtml}
        </div>`;
    }

    var statusLabel = isCompleted ? '✅ Completed | நிறைவேறியது' : '⏳ Pending | நிலுவையில்';
    var statusColor = isCompleted ? '#3fb950' : '#d29922';
    var statusHtml = `<div style="margin-top:8px; font-size:0.8rem; color:${statusColor}; font-weight:600;">${statusLabel}</div>`;

    var pendingCount = (res.recitingList || []).length;
    var pendingBadge = (!isCompleted && pendingCount > 0) ?
        `<div style="margin-top:4px; padding:4px 10px; background:#3b1818; color:#f87171; border-radius:16px; font-size:0.75rem; font-weight:600; display:inline-block; border:1px dashed #da3633;">
            ⏳ ${pendingCount} left to start Hadiya | இன்னும் ${pendingCount} பேர் மீதம்
        </div>` : '';

    document.getElementById('hadCurrent').innerHTML = headerHtml + nameRow + dedicationHtml + (isCompleted ? statusHtml : '') + pendingBadge;

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

var dedicationEntries = [];

function openDedicationModal() {
    document.getElementById('dedicationModal').style.display = "flex";
    dedicationEntries = [];
    loadExistingDedications();
}

function loadExistingDedications() {
    var container = document.getElementById('dedicationListContainer');
    container.innerHTML = '<div style="font-size:0.8rem;color:#8b949e;margin-bottom:8px;">Loading existing dedications...</div>';
    
    if (currentHadiyaDetails && currentHadiyaDetails.current) {
        var cur = currentHadiyaDetails.current;
        var dedEn = cur.dedicatedToEn || cur.dedicatedTo || '';
        var dedTa = cur.dedicatedToTa || '';
        var purpEn = cur.dedicatedPurposeEn || '';
        var purpTa = cur.dedicatedPurposeTa || '';
        
        var entries = [];
        if (dedEn && dedEn.length > 0) {
            var names = dedEn.split(';').map(s => s.trim()).filter(s => s);
            var purposes = purpEn ? purpEn.split(';').map(s => s.trim()).filter(s => s) : [];
            var purposeTas = purpTa ? purpTa.split(';').map(s => s.trim()).filter(s => s) : [];
            
            for (var i = 0; i < names.length; i++) {
                entries.push({
                    nameEn: names[i],
                    nameTa: (dedTa.split(';')[i] || names[i]).trim(),
                    purposeEn: purposes[i] || '',
                    purposeTa: purposeTas[i] || ''
                });
            }
        }
        
        dedicationEntries = entries;
        renderDedicationEntries();
    } else {
        dedicationEntries = [{ nameEn: '', nameTa: '', purposeEn: '', purposeTa: '' }];
        renderDedicationEntries();
    }
}

function renderDedicationEntries() {
    var container = document.getElementById('dedicationListContainer');
    var html = '';
    
    dedicationEntries.forEach(function(entry, idx) {
        html += `
        <div class="dedication-entry-box" style="border:1px solid #30363d; border-radius:8px; padding:12px; margin-bottom:10px; position:relative; background:#0d1117;">
            <span class="close-btn" onclick="removeDedicationEntry(${idx})" style="position:absolute; top:6px; right:6px; font-size:1.2rem; cursor:pointer;">&times;</span>
            
            <div style="font-size:0.75rem; color:#c9d1d9; margin-bottom:4px; font-weight:600;">Name (English)</div>
            <input type="text" id="dedNameEn${idx}" value="${entry.nameEn}" placeholder="Name in English" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:6px; color:#e6edf3; padding:8px; font-size:0.85rem; font-family:inherit; margin-bottom:8px; box-sizing:border-box;">
            
            <div style="font-size:0.75rem; color:#c9d1d9; margin-bottom:4px; font-weight:600;">பெயர் (தமிழ்)</div>
            <input type="text" id="dedNameTa${idx}" value="${entry.nameTa}" placeholder="பெயர் தமிழில்" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:6px; color:#e6edf3; padding:8px; font-size:0.85rem; font-family:inherit; margin-bottom:8px; box-sizing:border-box;">
            
            <div style="font-size:0.75rem; color:#c9d1d9; margin-bottom:4px; font-weight:600;">Purpose (English) <button onclick="translatePurpose(${idx}, 'toTa')" style="background:none; border:1px solid #30363d; border-radius:4px; color:#5eead4; font-size:0.7rem; padding:2px 6px; margin-left:6px;">Translate to தமிழ்</button></div>
            <textarea id="dedPurposeEn${idx}" placeholder="Purpose in English" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:6px; color:#e6edf3; padding:8px; font-size:0.85rem; font-family:inherit; margin-bottom:8px; box-sizing:border-box; min-height:50px;">${entry.purposeEn}</textarea>
            
            <div style="font-size:0.75rem; color:#c9d1d9; margin-bottom:4px; font-weight:600;">நோக்கம் (தமிழ்) <button onclick="translatePurpose(${idx}, 'toEn')" style="background:none; border:1px solid #30363d; border-radius:4px; color:#5eead4; font-size:0.7rem; padding:2px 6px; margin-left:6px;">Translate to English</button></div>
            <textarea id="dedPurposeTa${idx}" placeholder="நோக்கம் தமிழில்" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:6px; color:#e6edf3; padding:8px; font-size:0.85rem; font-family:inherit; margin-bottom:4px; box-sizing:border-box; min-height:50px;">${entry.purposeTa}</textarea>
        </div>`;
    });
    
    container.innerHTML = html;
    if (dedicationEntries.length === 0) {
        container.innerHTML = '<div style="font-size:0.8rem;color:#8b949e;margin-bottom:8px;">No dedications added yet.</div>';
    }
}

function addDedicationEntry() {
    dedicationEntries.push({ nameEn: '', nameTa: '', purposeEn: '', purposeTa: '' });
    renderDedicationEntries();
}

function removeDedicationEntry(idx) {
    if (confirm("Remove this dedication? / இந்த அர்ப்பணிப்பை நீக்கவேண்டியதா?")) {
        dedicationEntries.splice(idx, 1);
        renderDedicationEntries();
    }
}

function translatePurpose(idx, direction) {
    var srcEn = document.getElementById('dedPurposeEn' + idx).value;
    var srcTa = document.getElementById('dedPurposeTa' + idx).value;
    var targetField = direction === 'toTa' ? document.getElementById('dedPurposeTa' + idx) : document.getElementById('dedPurposeEn' + idx);
    var sourceText = direction === 'toTa' ? srcEn : srcTa;
    
    if (!sourceText.trim()) {
        showSnackbar("Enter text to translate / மொழிபடுத்த உரையை உள்ளிடவும்", true);
        return;
    }
    
    // Use free translation API (MyMemory)
    var url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(sourceText) + '&langpair=' + (direction === 'toTa' ? 'en|ta' : 'ta|en');
    
    fetch(url).then(function(res) {
        return res.json();
    }).then(function(data) {
        if (data && data.responseData && data.responseData.translatedText) {
            targetField.value = data.responseData.translatedText;
        } else {
            showSnackbar("Translation failed / மொழிபடுத்தல் தோல்வியடைந்தது", true);
        }
    }).catch(function(err) {
        showSnackbar("Translation error / மொழிபடுத்தல் பிழை", true);
    });
}

function closeDedicationModal() {
    document.getElementById('dedicationModal').style.display = "none";
}

function saveDedication() {
    var dateVal = document.getElementById('dateInput').value;
    if (!dateVal) { showSnackbar("Select a date first.", true); return; }
    
    // Collect all dedication data
    var namesEn = [];
    var namesTa = [];
    var purposesEn = [];
    var purposesTa = [];
    
    dedicationEntries.forEach(function(entry) {
        if (entry.nameEn.trim() || entry.nameTa.trim()) {
            namesEn.push(entry.nameEn.trim());
            namesTa.push(entry.nameTa.trim() || entry.nameEn.trim());
            purposesEn.push(entry.purposeEn.trim());
            purposesTa.push(entry.purposeTa.trim());
        }
    });
    
    // Update entries from inputs
    for (var i = 0; i < 10; i++) {
        var nameEn = document.getElementById('dedNameEn' + i);
        var nameTa = document.getElementById('dedNameTa' + i);
        var purpEn = document.getElementById('dedPurposeEn' + i);
        var purpTa = document.getElementById('dedPurposeTa' + i);
        
        if (nameEn && nameTa && purpEn && purpTa) {
            if (nameEn.value.trim() || nameTa.value.trim()) {
                namesEn.push(nameEn.value.trim());
                namesTa.push(nameTa.value.trim());
                purposesEn.push(purpEn.value.trim());
                purposesTa.push(purpTa.value.trim());
            }
        }
    }
    
    document.getElementById('saveDedicationBtn').disabled = true;
    google.script.run.withSuccessHandler(function(r) {
        document.getElementById('saveDedicationBtn').disabled = false;
        if (r.success) {
            showSnackbar("Dedication updated! / அர்ப்பணிப்பு சேமிக்கப்பட்டது!", false);
            closeDedicationModal();
            fetchHadiyaDetails(dateVal);
        } else {
            showSnackbar("Failed: " + (r.error || 'Error'), true);
        }
    }).updateHadiyaDedication(dateVal, namesEn.join(';'), namesTa.join(';'), purposesEn.join(';'), purposesTa.join(';'));
}