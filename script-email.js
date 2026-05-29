/**
 * Email Notification Service for Inainthu Othuvom
 * Uses EmailJS for client-side email sending
 * 
 * Setup Instructions:
 * 1. Go to https://www.emailjs.com/ and create a free account
 * 2. Create an Email Service (connect your Gmail)
 * 3. Create an Email Template with these variables:
 *    - {{to_email}} - Recipient email
 *    - {{user_name}} - Reader's English name
 *    - {{user_tamil_name}} - Reader's Tamil name
 *    - {{juz}} - Juz number
 *    - {{week}} - Week date
 *    - {{status}} - Status (Completed, Exception, etc.)
 *    - {{old_status}} - Previous status
 *    - {{timestamp}} - Time of update
 *    - {{action_type}} - Type of action (completed, exception, support_assigned, etc.)
 *    - {{support_reader}} - Support reader name (if applicable)
 * 4. Replace YOUR_SERVICE_ID, YOUR_TEMPLATE_ID, YOUR_PUBLIC_KEY below
 */

(function() {
    // ==================== CONFIGURATION ====================
    var EMAILJS_CONFIG = {
        publicKey: 'zvp-rNo55tW_eQY6K',   // Get from EmailJS Dashboard
        serviceId: 'service_loz60yl',     // Your Email Service ID
        exceptionTemplateId: 'template_j5w4t0k',   // Template for Exception Raised
        generalUpdateTemplateId: 'template_hd4fbhs'  // Template for Completed / Support updates
    };

    // Admin and select members who receive notifications
    var NOTIFICATION_RECIPIENTS = {
        admin: 'kmusthak916@gmail.com',
        selectMembers: [
            // Add email addresses of select members who should receive notifications
            // 'member1@example.com',
            // 'member2@example.com'
        ]
    };

    // ==================== INITIALIZATION ====================
    function initEmailJS() {
        if (typeof emailjs !== 'undefined') {
            emailjs.init(EMAILJS_CONFIG.publicKey);
            console.log('EmailJS initialized');
        } else {
            console.error('EmailJS not loaded. Add script tag:');
            console.error('<script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js"><\/script>');
        }
    }

    // Initialize when script loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEmailJS);
    } else {
        initEmailJS();
    }

    // ==================== EMAIL FUNCTIONS ====================

    /**
     * Send admin notification email
     * @param {Object} params - Email parameters
     */
    function sendAdminNotification(params) {
        var tamilStatus = function(s) {
            var map = {'Completed': 'நிறைவேற்றப்பட்டது', 'Reciting': 'ஓதிக்கொண்டிருக்கிறார்', 'Exception Raised': 'விதிவிலக்கு', 'Not Started': 'தொடங்கவில்லை'};
            return map[s] || s;
        };
        var formattedTime = function(iso) {
            if (!iso) return '';
            var d = new Date(iso);
            return d.toLocaleString('en-IN', {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
        };

        // Common template params for both templates
        var templateParams = {
            to_email: NOTIFICATION_RECIPIENTS.admin,
            reader_english: params.userName || 'Unknown',
            reader_tamil: params.userTamilName || '',
            juz_no: 'Juz ' + (params.juz || '-'),
            week_date: params.week || '',
            current_status_english: params.oldStatus || '',
            current_status_tamil: tamilStatus(params.oldStatus),
            proposed_status_english: params.status || '',
            proposed_status_tamil: tamilStatus(params.status),
            updated_by: params.updatedBy || 'System',
            date_time_updated: formattedTime(params.timestamp),
            Dashboard_Link: 'https://tinyurl.com/InainthuOthuvom'
        };

        // Template mapping:
        //   Exception Raised, Support Assigned, Support Completed -> template_j5w4t0k (has support_reader / support_status fields)
        //   Completed, status_changed -> template_hd4fbhs (no support fields)
        var usesSupportTemplate = (params.actionType === 'exception' || params.actionType === 'support_assigned' || params.actionType === 'support_completed');
        var templateId = usesSupportTemplate ? EMAILJS_CONFIG.exceptionTemplateId : EMAILJS_CONFIG.generalUpdateTemplateId;

        // Add subject line based on action type
        var subject = 'Inainthu Othuvom - ';
        switch (params.actionType) {
            case 'completed': subject += '✅ Completed: Juz ' + (params.juz || '-') + ' - ' + (params.userName || ''); break;
            case 'exception': subject += '⚠️ Exception Raised: Juz ' + (params.juz || '-') + ' - ' + (params.userName || ''); break;
            case 'support_assigned': subject += '🤝 Support Assigned: Juz ' + (params.juz || '-') + ' - ' + (params.userName || ''); break;
            case 'support_completed': subject += '✅ Support Completed: Juz ' + (params.juz || '-') + ' - ' + (params.userName || ''); break;
            default: subject += '📋 Update: Juz ' + (params.juz || '-') + ' - ' + (params.userName || ''); break;
        }
        templateParams.subject = subject;

        // Add support reader fields for templates that use support fields (j5w4t0k)
        if (usesSupportTemplate) {
            templateParams.support_reader_english = params.supportReader || '';
            templateParams.support_reader_tamil = params.supportReader || '';
            templateParams.support_status_english = (params.actionType === 'support_completed' ? 'Completed' : 'Reciting');
            templateParams.support_status_tamil = (params.actionType === 'support_completed' ? 'நிறைவேற்றப்பட்டது' : 'ஓதிக்கொண்டிருக்கிறார்');
        }

        return sendEmail(templateParams, templateId);
    }

    /**
     * Send notification to select members
     * @param {Object} params - Email parameters
     * @param {Array} recipients - Array of email addresses
     */
    function sendToSelectMembers(params, recipients) {
        if (!recipients || recipientsi.length === 0) {
            recipients = NOTIFICATION_RECIPIENTS.selectMembers;
        }

        if (recipients.length === 0) {
            console.warn('No recipients configured for select members');
            return Promise.resolve(null);
        }

        var templateParams = {
            to_email: recipients.join(','),
            user_name: params.userName || 'Unknown',
            user_tamil_name: params.userTamilName || '',
            juz: params.juz || '-',
            week: params.week || '',
            status: params.status || '',
            old_status: params.oldStatus || '',
            timestamp: params.timestamp || new Date().toISOString(),
            action_type: params.actionType || 'status_update',
            support_reader: params.supportReader || '',
            updated_by: params.updatedBy || ''
        };

        return sendEmail(templateParams);
    }

    /**
     * Build HTML email body with formatted table
     * @param {Object} params - Email parameters
     * @returns {string} HTML string
     */
    function buildHTMLEmail(params) {
        var actionInfo = getActionInfo(params.actionType);
        var timestamp = params.timestamp || new Date().toISOString();
        var formattedTime = formatTimestamp(timestamp);

        // Tamil table rows
        var taRows = [
            ['ஓதுபவர்', params.userTamilName || '-'],
            ['ஜுஸ்', 'Juz ' + (params.juz || '-')],
            ['வாரம்', params.week || '-'],
            ['புதிய நிலை', tamilStatus(params.status)],
            ['நேரம்', formattedTime]
        ];

        // Add support reader if applicable
        if (params.supportReader) {
            taRows.push(['உதவி வாசகர்', params.supportReader]);
        }

        // English table rows
        var enRows = [
            ['Reader', params.userName || '-'],
            ['Juz', 'Juz ' + (params.juz || '-')],
            ['Week', params.week || '-'],
            ['New Status', params.status || '-'],
            ['Time', formattedTime]
        ];

        // Add support reader if applicable
        if (params.supportReader) {
            enRows.push(['Support Reader', params.supportReader]);
        }

        var htmlBody =
            '<div style="font-family: Arial, sans-serif; max-width: 520px; color: #202124; margin: 0 auto;">' +
            '<p style="font-size: 14px; margin: 0 0 4px;">Assalamu Alaikum / அஸ்ஸலாமுஅலைக்கும்</p>' +
            '<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 12px 0;">' +

            // Tamil Section
            '<p style="font-size: 14px; font-weight: 600; margin: 0 0 6px; color: #1a73e8;">— தமிழ் —</p>' +
            '<p style="font-size: 13px; margin: 0 0 10px;">' + escapeHtml(actionInfo.msgTa) + '</p>' +
            buildHTMLTable(taRows) +

            '<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 12px 0;">' +

            // English Section
            '<p style="font-size: 14px; font-weight: 600; margin: 0 0 6px; color: #1a73e8;">— English —</p>' +
            '<p style="font-size: 13px; margin: 0 0 10px;">' + escapeHtml(actionInfo.msgEn) + '</p>' +
            buildHTMLTable(enRows) +

            '<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 12px 0;">' +
            '<p style="font-size: 12px; margin: 0 0 2px;">' +
            '<a href="https://tinyurl.com/InainthuOthuvom" style="color: #1a73e8; text-decoration: none;">Dashboard →</a>' +
            '</p>' +
            '<p style="font-size: 11px; color: #80868b; margin: 0;">System Auto-Notification / தானியங்கி முறைமை அறிவிப்பு</p>' +
            '</div>';

        return htmlBody;
    }

    /**
     * Build HTML table from rows array
     * @param {Array} rows - Array of [label, value] pairs
     * @returns {string} HTML table string
     */
    function buildHTMLTable(rows) {
        var html = '<table style="border-collapse: collapse; width: 100%; max-width: 480px; font-family: Arial, sans-serif; font-size: 13px; margin: 8px 0;">';
        for (var i = 0; i < rows.length; i++) {
            html += '<tr>' +
                '<td style="padding: 6px 10px; border: 1px solid #d0d0d0; font-weight: 600; white-space: nowrap; background-color: #f8f9fa; width: 40%;">' +
                escapeHtml(rows[i][0]) +
                '</td>' +
                '<td style="padding: 6px 10px; border: 1px solid #d0d0d0;">' +
                escapeHtml(rows[i][1]) +
                '</td>' +
                '</tr>';
        }
        return html + '</table>';
    }

    /**
     * Get action-specific messages
     */
    function getActionInfo(actionType) {
        var emoji, msgEn, msgTa;
        switch (actionType) {
            case 'completed':
                emoji = '✅';
                msgEn = 'Completed their recitation.';
                msgTa = 'ஓதுதலை நிறைவேற்றினார்.';
                break;
            case 'exception':
                emoji = '⚠️';
                msgEn = 'Raised an exception.';
                msgTa = 'விதிவிலக்கு பதிவு செய்தார்.';
                break;
            case 'support_assigned':
                emoji = '🤝';
                msgEn = 'A support reader was assigned.';
                msgTa = 'உதவி வாசகர் நியமிக்கப்பட்டார்.';
                break;
            case 'support_completed':
                emoji = '✅';
                msgEn = 'Support reader completed recitation.';
                msgTa = 'உதவி வாசகர் ஓதுதலை நிறைவேற்றினார்.';
                break;
            case 'status_changed':
                emoji = '🔄';
                msgEn = 'Status has been updated.';
                msgTa = 'நிலை மாற்றப்பட்டது.';
                break;
            default:
                emoji = '📋';
                msgEn = 'An update was registered.';
                msgTa = 'மாற்றம் பதிவாகியுள்ளது.';
        }
        return { emoji: emoji, msgEn: msgEn, msgTa: msgTa };
    }

    /**
     * Tamil status translation
     */
    function tamilStatus(status) {
        var translations = {
            'Completed': 'நிறைவேற்றப்பட்டது',
            'Reciting': 'ஓதிக்கொண்டிருக்கிறார்',
            'Exception Raised': 'விதிவிலக்கு',
            'Not Started': 'தொடங்கவில்லை'
        };
        return translations[status] || status;
    }

    /**
     * Format timestamp to readable string
     */
    function formatTimestamp(isoString) {
        var d = new Date(isoString);
        var options = { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit',
            timeZone: 'Asia/Kolkata'
        };
        return d.toLocaleString('en-IN', options);
    }

    /**
     * Escape HTML special characters
     */
    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/"/g, '"');
    }

    /**
     * Core email sending function
     * @param {Object} templateParams - Template parameters for EmailJS
     * @param {String} templateId - EmailJS template ID (optional, uses default if not provided)
     */
    function sendEmail(templateParams, templateId) {
        return new Promise(function(resolve, reject) {
            if (typeof emailjs === 'undefined') {
                reject(new Error('EmailJS not initialized'));
                return;
            }

            var tid = templateId || EMAILJS_CONFIG.exceptionTemplateId;
            emailjs.send(EMAILJS_CONFIG.serviceId, tid, templateParams)
                .then(function(response) {
                    console.log('Email sent successfully!', response.status, response.text);
                    resolve({ success: true, response: response });
                })
                .catch(function(error) {
                    console.error('Failed to send email:', error);
                    reject({ success: false, error: error });
                });
        });
    }

    // ==================== CONVENIENCE FUNCTIONS ====================

    /**
     * Send notification when status is completed
     */
    function sendCompletedNotification(userData) {
        return sendAdminNotification({
            userName: userData.userName,
            userTamilName: userData.userTamilName,
            juz: userData.juz,
            week: userData.week,
            status: 'Completed',
            oldStatus: userData.oldStatus || 'Reciting',
            actionType: 'completed',
            timestamp: userData.timestamp || new Date().toISOString()
        });
    }

    /**
     * Send notification when exception is raised
     */
    function sendExceptionNotification(userData) {
        return sendAdminNotification({
            userName: userData.userName,
            userTamilName: userData.userTamilName,
            juz: userData.juz,
            week: userData.week,
            status: 'Exception Raised',
            oldStatus: userData.oldStatus || 'Reciting',
            actionType: 'exception',
            timestamp: userData.timestamp || new Date().toISOString()
        });
    }

    /**
     * Send notification when support is assigned
     */
    function sendSupportAssignedNotification(userData) {
        return sendAdminNotification({
            userName: userData.userName,
            userTamilName: userData.userTamilName,
            juz: userData.juz,
            week: userData.week,
            status: userData.status || 'Exception Raised',
            oldStatus: userData.oldStatus || 'Reciting',
            actionType: 'support_assigned',
            supportReader: userData.supportReader,
            timestamp: userData.timestamp || new Date().toISOString()
        });
    }

    /**
     * Send notification when support is completed
     */
    function sendSupportCompletedNotification(userData) {
        return sendAdminNotification({
            userName: userData.userName,
            userTamilName: userData.userTamilName,
            juz: userData.juz,
            week: userData.week,
            status: userData.status || 'Completed',
            oldStatus: userData.oldStatus || 'Reciting',
            actionType: 'support_completed',
            supportReader: userData.supportReader,
            timestamp: userData.timestamp || new Date().toISOString()
        });
    }

    /**
     * Send notification when status changes
     */
    function sendStatusChangeNotification(userData) {
        return sendAdminNotification({
            userName: userData.userName,
            userTamilName: userData.userTamilName,
            juz: userData.juz,
            week: userData.week,
            status: userData.newStatus,
            oldStatus: userData.oldStatus,
            actionType: 'status_changed',
            timestamp: userData.timestamp || new Date().toISOString()
        });
    }

    // ==================== PUBLIC API ====================
    window.EmailService = {
        // Initialize EmailJS
        init: initEmailJS,

        // Core functions
        sendAdminNotification: sendAdminNotification,
        sendToSelectMembers: sendToSelectMembers,
        sendEmail: sendEmail,

        // Convenience functions
        sendCompletedNotification: sendCompletedNotification,
        sendExceptionNotification: sendExceptionNotification,
        sendSupportAssignedNotification: sendSupportAssignedNotification,
        sendSupportCompletedNotification: sendSupportCompletedNotification,
        sendStatusChangeNotification: sendStatusChangeNotification,

        // Configuration
        config: EMAILJS_CONFIG,
        recipients: NOTIFICATION_RECIPIENTS
    };

    console.log('Email Service loaded. Configure EmailJS keys in script-email.js');
})();