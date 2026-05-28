    function normalizeToFriday(dateStr) {
        if (!dateStr) return null;
        var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
        var d = m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(dateStr);
        d.setHours(0,0,0,0,0);
        if (isNaN(d.getTime())) return null;
        var day = d.getDay();
        var diff = (day >= 5) ? (day - 5) : (day + 2);
        var friday = new Date(d); friday.setDate(d.getDate() - diff);
        friday.setHours(0,0,0,0,0);
        return formatLocalDate(friday);
    }
    function normalizeToWeekStart(dateStr) {
        if (!dateStr) return null;
        var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
        var d = m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(dateStr);
        d.setHours(0,0,0,0,0);
        if (isNaN(d.getTime())) return null;
        var day = d.getDay();
        var diff = (day >= 5) ? (day - 5) : (day + 2);
        var friday = new Date(d); friday.setDate(d.getDate() - diff);
        friday.setHours(0,0,0,0,0);
        return formatLocalDate(friday);
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

function showSnackbar(message, isError) {
    const snack = document.getElementById('toastSnackbar');
    snack.innerText = message;
    snack.className = "snackbar show " + (isError ? "snackbar-error" : "snackbar-success");
    setTimeout(function(){ snack.className = snack.className.replace("show", ""); }, 3000);
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
