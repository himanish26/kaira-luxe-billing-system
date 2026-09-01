const SAFE_FAILURE_MAX_LENGTH = 120;

function safeFailure(value) {
    const text = String(value || "Connection test failed")
        .replace(/https?:\/\/\S+/gi, "[URL]")
        .replace(/\b(password|secret|signature|token|grant|pin)\b\s*[:=]\s*[^,;|\s]+/gi, "$1=[REDACTED]")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return (text || "Connection test failed").slice(0, SAFE_FAILURE_MAX_LENGTH);
}

async function recordIntegrationActivity(logActivity, event) {
    try {
        await logActivity({
            category: "SETTINGS", action: event.action, details: event.details,
            user_name: "ADMINISTRATOR", status: event.status,
            entity_type: "SETTINGS", reference_no: event.reference
        });
        return null;
    }
    catch (error) {
        console.error("Integration Activity Log write failed:", error.message);
        return "Integration action completed, but its Activity Log event could not be recorded.";
    }
}

function emailSettingsEvent(configuration) {
    return {
        action: "EMAIL_SETTINGS_UPDATED", status: "SUCCESS", reference: "EMAIL_INTEGRATION",
        details: `Email settings updated; security mode ${configuration.securityMode}; recipients ${configuration.recipients.length}`
    };
}

function dsrSettingsEvent(configuration) {
    return {
        action: "DSR_SETTINGS_UPDATED", status: "SUCCESS", reference: "DSR_INTEGRATION",
        details: `DSR settings updated; data tab ${String(configuration.tabName || "KLBS_Daily_Data").slice(0, 80)}`
    };
}

function connectionEvent(kind, result) {
    const email = kind === "email";
    const success = Boolean(result && result.success);
    return {
        action: `${email ? "EMAIL" : "DSR"}_CONNECTION_TEST_${success ? "SUCCESS" : "FAILED"}`,
        status: success ? "SUCCESS" : "FAILED",
        reference: email ? "EMAIL_INTEGRATION" : "DSR_INTEGRATION",
        details: success
            ? `${email ? "Email" : "DSR"} connection test successful`
            : `${email ? "Email" : "DSR"} connection test failed; ${safeFailure(result && result.error)}`
    };
}

function emailTestMessageEvent() {
    return {
        action: "EMAIL_TEST_MESSAGE_SENT", status: "SUCCESS", reference: "EMAIL_INTEGRATION",
        details: "Email test message sent"
    };
}

module.exports = {
    recordIntegrationActivity, emailSettingsEvent, dsrSettingsEvent,
    connectionEvent, emailTestMessageEvent, safeFailure
};
