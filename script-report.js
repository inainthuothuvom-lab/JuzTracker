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
        var banner = document.getElementById('weekBanner');
        if (res.week) {
            var m = new Date(res.week + 'T00:00:00');
            if (!isNaN(m.getTime())) {
                var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                var monthTa = ['ஜன','பிப்','மார்','ஏப்','மே','ஜூன்','ஜூலை','ஆக','செப்','அக்','நவ','டிச'];
                var s = new Date(m); s.setDate(s.getDate() + 6);
                var bannerText = m.getDate() + ' ' + months[m.getMonth()] + ' - ' + s.getDate() + ' ' + months[s.getMonth()] + ' ' + s.getFullYear();
                var bannerTa = m.getDate() + ' ' + monthTa[m.getMonth()] + ' - ' + s.getDate() + ' ' + monthTa[s.getMonth()];
                banner.innerHTML = bannerText + '<br>' + bannerTa;
                banner.style.display = 'block';
            }
        } else { banner.style.display = 'none'; }
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
