function integrationEscape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}
function integrationLabel(value) {
    const labels = { NOT_ATTEMPTED:"Not Attempted", NEVER_TESTED:"Not Attempted", UNKNOWN:"Status Unavailable", NEVER:"Never", FAILED:"Failed", SUCCESS:"Successful", PENDING:"Pending", SYNCED:"Synced" };
    return labels[String(value || "").toUpperCase()] || String(value || "Status Unavailable").replace(/_/g, " ");
}
function integrationStatusClass(value) {
    const status = String(value || "").trim().toUpperCase();
    if (["SUCCESS", "ENABLED", "CONFIGURED", "CONNECTED", "DELIVERED", "SYNCED"].includes(status)) return "integration-status-success";
    if (["FAILED", "FAILURE", "CONNECTION ERROR"].includes(status)) return "integration-status-failed";
    if (["PENDING", "RETRYING", "QUEUED"].includes(status)) return "integration-status-pending";
    return "integration-status-muted";
}
function integrationTime(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return "Never";
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone:"Asia/Kolkata", day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:true }).formatToParts(new Date(value));
    const get = type => (parts.find(p => p.type === type) || {}).value || "";
    return `${get("day")} ${get("month")}, ${get("year")}, ${get("hour").padStart(2, "0")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}
function integrationEvent(event) { return event ? `${integrationTime(event.at)} · ${integrationLabel(event.status)}` : "Never"; }
async function loadCustomerCrmForm() {
    const [crm, config] = await Promise.all([
        window.electronAPI.getIntegrationDetails("customerCrm"),
        window.electronAPI.getIntegrationConfig()
    ]);
    showCustomerCrmForm(crm, config.customerCrmStatus || {});
}

let integrationConfigureGeneration = 0;
let activeIntegrationConfigureRequest = null;
let systemHealthGeneration = 0;
let integrationNavigationInProgress = false;

function invalidateSystemHealthRequests() {
    systemHealthGeneration += 1;
}

function invalidateIntegrationConfigureRequests() {
    integrationConfigureGeneration += 1;
    activeIntegrationConfigureRequest = null;
}

if (typeof window !== "undefined") {
    window.invalidateIntegrationConfigureRequests = invalidateIntegrationConfigureRequests;
    window.invalidateSystemHealthRequests = invalidateSystemHealthRequests;
}

function leaveIntegrationConfiguration() {
    if (integrationNavigationInProgress) return;

    integrationNavigationInProgress = true;
    invalidateIntegrationConfigureRequests();
    return showSystemHealthPage().finally(() => {
        integrationNavigationInProgress = false;
    });
}

async function showSystemHealthPage() {
    invalidateIntegrationConfigureRequests();
    const requestGeneration = ++systemHealthGeneration;
    const config = await window.electronAPI.getIntegrationConfig();
    const outbox = await window.electronAPI.getIntegrationOutboxStatus();
    if (requestGeneration !== systemHealthGeneration) return;
    const source = item => item.source === "ENVIRONMENT" ? '<p class="integration-source">Using Windows system configuration</p>' : "";
    const remoteConfigurationStatus = config.remoteDashboard.configured ? "CONFIGURED" : "NOT CONFIGURED";
    const displayDate = value => { const parts = String(value || "").split("-"); return parts.length === 3 ? `${parts[2]} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(parts[1]) - 1]}, ${parts[0]}` : value; };
    const state = value => value === "SUCCESS" ? "SENT" : "PENDING";
    const checkedAt = integrationTime(new Date().toISOString());
    const deliveryClass = value => value === "FAILED" ? "failed" : value === "DELIVERED" || value === "SUCCESS" ? "success" : "pending";
    const deliveryText = value => value === "DELIVERED" ? "DELIVERED" : value || "NOT APPLICABLE";
    const outboxRows = outbox.deliveries.map(item => `<article class="integration-outbox-date"><strong>${integrationEscape(displayDate(item.businessDate))}</strong><div><span>EMAIL &amp; BACKUP</span><b class="integration-outbox-status ${item.emailStatus === "SUCCESS" ? "success" : "pending"}">${state(item.emailStatus)}</b></div><div><span>LEGACY DSR</span><b class="integration-outbox-status ${item.dsrStatus === "SUCCESS" ? "success" : "pending"}">${item.dsrRetired ? "RETIRED - NOT SENT" : item.dsrStatus === "SUCCESS" ? "SYNCED" : "PENDING"}</b></div>${item.consolidatedJobId ? `<div><span>V1.1 SHEET</span><b class="integration-outbox-status ${deliveryClass(item.consolidatedSheetStatus)}">${integrationEscape(deliveryText(item.consolidatedSheetStatus))}</b></div><div><span>V1.1 EMAIL</span><b class="integration-outbox-status ${deliveryClass(item.consolidatedEmailStatus)}">${integrationEscape(deliveryText(item.consolidatedEmailStatus))}</b></div>` : ""}</article>`).join("");
    const reportStatus = outbox.failedCount > 0 ? "ACTION REQUIRED" : outbox.pendingCount > 0 ? "DELIVERIES PENDING" : "ALL REPORTS UP TO DATE";
    const reportStatusClass = outbox.failedCount > 0 ? "failed" : outbox.pendingCount > 0 ? "pending" : "success";
    const reportStatusDetail = outbox.failedCount > 0 ? `${outbox.failedCount} failed ${outbox.failedCount === 1 ? "delivery requires" : "deliveries require"} attention.` : outbox.pendingCount > 0 ? "One or more Day Closing deliveries are pending." : "No actionable Day Closing deliveries.";
    const outboxSection = `<section class="integration-section integration-outbox"><div class="integration-outbox-header"><div><h2>INTEGRATION OUTBOX</h2><p>Automatic delivery of Day Closing reports</p></div><button id="refreshIntegrationStatus" class="integration-button integration-button-secondary">REFRESH STATUS</button></div><div class="integration-outbox-summary"><div><span>INTERNET</span><strong style="color:${outbox.online ? "#198754" : "#c62828"}; background:transparent;">${outbox.online ? "ONLINE" : "OFFLINE"}</strong></div><div><span>PENDING DELIVERIES</span><strong>${outbox.pendingCount}</strong></div><div><span>FAILED DELIVERIES</span><strong>${outbox.failedCount || 0}</strong></div><div><span>LAST CHECKED</span><strong>${checkedAt}</strong></div></div>${outbox.upToDate ? `<div class="integration-outbox-empty"><strong>${reportStatus}</strong><span>${reportStatusDetail}</span></div>` : `<div class="integration-outbox-list"><strong class="integration-outbox-status ${reportStatusClass}">${reportStatus}</strong>${outboxRows}</div>`}</section>`;
    renderSettingsPage({ title:"SYSTEM HEALTH", icon:"&#129658;", subtitle:"Application integrations and operational status.", backText:"← System", backAction:() => { invalidateSystemHealthRequests(); showSystemPage(); },
        content:`${outboxSection}<section class="integration-section"><h2>INTEGRATIONS</h2><div class="integration-summary-grid">
        <article class="integration-card"><h3>EMAIL &amp; BACKUP</h3><strong class="${integrationStatusClass(config.email.configured ? "CONFIGURED" : "NOT CONFIGURED")}">${config.email.configured ? "CONFIGURED" : "NOT CONFIGURED"}</strong>${source(config.email)}
        <dl><div><dt>SMTP Email Service</dt><dd>${config.email.configured ? "Configured" : "Not Configured"}</dd></div><div><dt>Email After Day Closing</dt><dd class="${integrationStatusClass("ENABLED")}">ENABLED</dd></div><div><dt>Last Email Backup</dt><dd class="${integrationStatusClass(config.email.lastEmailBackup?.status)}">${integrationEscape(integrationEvent(config.email.lastEmailBackup))}</dd></div><div><dt>Last Connection Test</dt><dd class="${integrationStatusClass(config.email.lastTestResult)}">${integrationEscape(config.email.lastTestAt ? integrationTime(config.email.lastTestAt) + " · " + integrationLabel(config.email.lastTestResult) : "Never")}</dd></div></dl><button id="configureEmailIntegration" class="dashboard-btn">CONFIGURE</button></article>
        <article class="integration-card"><h3>DAILY SALES REPORT</h3><strong class="${integrationStatusClass(config.dsr.configured ? "CONFIGURED" : "NOT CONFIGURED")}">${config.dsr.configured ? "CONFIGURED" : "NOT CONFIGURED"}</strong>${source(config.dsr)}
        <dl><div><dt>Google Sheets</dt><dd>${integrationEscape(config.dsr.tabName || "KLBS_Daily_Data")}</dd></div><div><dt>Daily Sales Report Sync</dt><dd class="${integrationStatusClass("ENABLED")}">ENABLED</dd></div><div><dt>Last DSR Sync</dt><dd class="${integrationStatusClass(config.dsr.lastSync?.status)}">${integrationEscape(integrationEvent(config.dsr.lastSync))}</dd></div><div><dt>Last Connection Test</dt><dd class="${integrationStatusClass(config.dsr.lastTestResult)}">${integrationEscape(config.dsr.lastTestAt ? integrationTime(config.dsr.lastTestAt) + " · " + integrationLabel(config.dsr.lastTestResult) : "Never")}</dd></div></dl><button id="configureDsrIntegration" class="dashboard-btn">CONFIGURE</button></article>
        <article class="integration-card"><h3>REMOTE DASHBOARD</h3><strong class="${integrationStatusClass(config.remoteDashboard.configured ? "CONFIGURED" : "NOT CONFIGURED")}">${remoteConfigurationStatus}</strong>
        <dl><div><dt>Operational Status</dt><dd class="${integrationStatusClass(config.remoteDashboard.enabled ? "ENABLED" : "DISABLED")}">${config.remoteDashboard.enabled ? "ENABLED" : "DISABLED"}</dd></div><div><dt>Installation</dt><dd>KL001 · POS01</dd></div><div><dt>Connection Test</dt><dd class="${integrationStatusClass(config.remoteDashboard.lastTestResult)}">${integrationEscape(config.remoteDashboard.lastTestAt ? integrationTime(config.remoteDashboard.lastTestAt) + " · " + integrationLabel(config.remoteDashboard.lastTestResult) : "Never")}</dd></div></dl><button id="configureRemoteDashboardIntegration" class="dashboard-btn">CONFIGURE</button></article>
        <article class="integration-card"><h3>CUSTOMER CRM</h3><strong class="${integrationStatusClass(config.customerCrm.configured ? "CONFIGURED" : "NOT CONFIGURED")}">${config.customerCrm.configured ? "CONFIGURED" : "NOT CONFIGURED"}</strong><dl><div><dt>Google Sheets</dt><dd>Customer_Master</dd></div><div><dt>Customer Sync</dt><dd class="${integrationStatusClass(config.customerCrm.enabled ? "ENABLED" : "DISABLED")}">${config.customerCrm.enabled ? "ENABLED" : "DISABLED"}</dd></div><div><dt>Pending Customers</dt><dd class="${integrationStatusClass(Number(config.customerCrmStatus?.pendingCount || 0) > 0 ? "PENDING" : "")}">${Number(config.customerCrmStatus?.pendingCount || 0)}</dd></div><div><dt>Last Successful Sync</dt><dd class="${integrationStatusClass(config.customerCrmStatus?.lastSuccessAt ? "SUCCESS" : "")}">${integrationEscape(config.customerCrmStatus?.lastSuccessAt ? integrationTime(config.customerCrmStatus.lastSuccessAt) : "Never")}</dd></div><div><dt>Last Connection Test</dt><dd class="${integrationStatusClass(config.customerCrm.lastTestResult)}">${integrationEscape(config.customerCrm.lastTestAt ? integrationTime(config.customerCrm.lastTestAt) + " · " + integrationLabel(config.customerCrm.lastTestResult) : "Never")}</dd></div></dl><button id="configureCustomerCrmIntegration" class="dashboard-btn">CONFIGURE</button></article>
        </div></section>` });
    delete settingsPage.dataset.integrationConfigure;
    document.getElementById("configureEmailIntegration").onclick = () => enterIntegration("email");
    document.getElementById("configureDsrIntegration").onclick = () => enterIntegration("dsr");
    document.getElementById("configureRemoteDashboardIntegration").onclick = () => enterIntegration("remoteDashboard");
    document.getElementById("configureCustomerCrmIntegration").onclick = () => enterIntegration("customerCrm");
    document.getElementById("refreshIntegrationStatus").onclick = showSystemHealthPage;
}
async function enterIntegration(kind) {
    const request = {
        kind,
        generation: ++integrationConfigureGeneration
    };
    activeIntegrationConfigureRequest = request;
    const purpose = kind === "email" ? "INTEGRATION_EMAIL_SETTINGS" : kind === "dsr" ? "INTEGRATION_DSR_SETTINGS" : "INTEGRATION_REMOTE_DASHBOARD_SETTINGS";
    const grant = kind === "customerCrm" ? null : await requestAdminAuthorization(purpose);
    if (kind !== "customerCrm" && !grant) return;
    if (activeIntegrationConfigureRequest !== request || request.generation !== integrationConfigureGeneration) return;
    try {
        const details = await window.electronAPI.getIntegrationDetails(kind, grant);
        if (activeIntegrationConfigureRequest !== request || request.generation !== integrationConfigureGeneration) return;
        if (kind === "customerCrm") {
            const config = await window.electronAPI.getIntegrationConfig();
            if (activeIntegrationConfigureRequest !== request || request.generation !== integrationConfigureGeneration) return;
            showCustomerCrmForm(details, config.customerCrmStatus || {});
            return;
        }
        kind === "email" ? showEmailIntegrationForm(details, grant) : kind === "dsr" ? showDsrIntegrationForm(details, grant) : showRemoteDashboardForm(details, grant);
    }
    catch (error) {
        if (activeIntegrationConfigureRequest !== request || request.generation !== integrationConfigureGeneration) return;
        alert(error.message);
    }
}
async function requestFreshIntegrationGrant(kind) {
    const purpose =
        kind === "email"
            ? "INTEGRATION_EMAIL_SETTINGS"
            : kind === "dsr" ? "INTEGRATION_DSR_SETTINGS" : "INTEGRATION_REMOTE_DASHBOARD_SETTINGS";

    return await requestAdminAuthorization(purpose);
}
function recipientRows(values) {
    return (values.length ? values : [""]).map(value => `<div class="integration-recipient-row"><input class="integration-recipient" type="email" value="${integrationEscape(value)}" placeholder="backup@example.com" aria-label="Backup recipient"><button type="button" class="removeIntegrationRecipient integration-button integration-button-small integration-button-destructive">REMOVE</button></div>`).join("");
}
function secretControl(kind, configured) {
    const email = kind === "email";
    const remote = kind === "remoteDashboard";
    const label = remote ? "Installation Secret" : email ? "SMTP App Password" : "Sync Secret";
    const replacement = remote ? "New Installation Secret" : email ? "New SMTP App Password" : "New Sync Secret";
    const enter = remote ? "ENTER SECRET" : email ? "ENTER PASSWORD" : "ENTER SECRET";
    return `<div class="integration-secret"><span>${label}</span><strong>${configured ? "CONFIGURED" : "NOT CONFIGURED"}</strong><button id="replaceSecret" type="button" class="integration-button integration-button-small integration-button-secondary">${configured ? (email ? "REPLACE PASSWORD" : "REPLACE SECRET") : enter}</button><label id="secretReplacement" hidden>${replacement}<input id="integrationSecret" type="password" autocomplete="new-password"><button id="cancelSecret" type="button" class="integration-button integration-button-small integration-button-secondary">CANCEL REPLACEMENT</button></label></div>`;
}
function wireSecret() {
    const block = document.getElementById("secretReplacement");
    document.getElementById("replaceSecret").onclick = () => { block.hidden = false; };
    document.getElementById("cancelSecret").onclick = () => { document.getElementById("integrationSecret").value = ""; block.hidden = true; };
}
function showEmailIntegrationForm(email, grant) {
    renderSettingsPage({ title:"EMAIL & BACKUP", icon:"&#128231;", subtitle:"Configure the outgoing email service used for automated KLBS Day Closing backups.", backText:"← System Health", backAction:leaveIntegrationConfiguration,
        content:`<div class="integration-form"><h2>EMAIL ACCOUNT</h2><div class="integration-form-grid"><label>Account Name<input id="accountName" value="${integrationEscape(email.accountName)}"></label><label>Sender<input id="senderEmail" type="email" value="${integrationEscape(email.senderEmail)}"></label><label>SMTP Server<input id="smtpHost" value="${integrationEscape(email.smtpHost)}"></label><label>SMTP Port<input id="smtpPort" type="number" min="1" max="65535" value="${email.smtpPort}"></label><label>Security Mode<select id="securityMode"><option>STARTTLS</option><option value="SSL_TLS">SSL/TLS</option></select></label><label>SMTP Username<input id="smtpUsername" value="${integrationEscape(email.smtpUsername)}"></label></div><h2>SECURITY</h2>${secretControl("email", email.passwordConfigured)}<fieldset><legend>Backup Recipients</legend><div id="recipients">${recipientRows(email.recipients)}</div><button id="addRecipient" type="button" class="integration-button integration-button-small integration-button-secondary">+ ADD RECIPIENT</button></fieldset><h2>SYNC STATUS</h2><div class="integration-info-row"><span class="integration-status-label">Email After Day Closing</span><strong class="${integrationStatusClass("ENABLED")}">ENABLED</strong></div><div class="integration-info-row"><span class="integration-status-label">Last Connection Test</span><strong class="${integrationStatusClass(email.lastTestResult)}">${integrationEscape(email.lastTestAt ? integrationTime(email.lastTestAt) + " · " + integrationLabel(email.lastTestResult) : "Never")}</strong></div><div id="message" class="security-message" aria-live="polite"></div><div class="integration-actions"><button id="testConnection" class="integration-button integration-button-secondary">TEST CONNECTION</button><button id="sendTest" class="integration-button integration-button-secondary">SEND TEST EMAIL</button><button id="cancel" class="integration-button integration-button-neutral">CANCEL</button><button id="save" class="integration-button integration-button-primary">SAVE CHANGES</button></div>${emailGuide()}</div>` });
    settingsPage.dataset.integrationConfigure = "true";
    document.getElementById("securityMode").value = email.securityMode; wireSecret();
    const wireRemove = () => document.querySelectorAll(".removeIntegrationRecipient").forEach(b => { b.onclick = () => b.closest(".integration-recipient-row").remove(); }); wireRemove();
    document.getElementById("addRecipient").onclick = () => { document.getElementById("recipients").insertAdjacentHTML("beforeend", recipientRows([""])); wireRemove(); };
    const read = () => ({ accountName:accountName.value, senderEmail:senderEmail.value, smtpHost:smtpHost.value, smtpPort:smtpPort.value, securityMode:securityMode.value, smtpUsername:smtpUsername.value, password:integrationSecret.value, recipients:[...document.querySelectorAll(".integration-recipient")].map(i => i.value) });
save.onclick = async () => {
    try {
        const freshGrant = await requestFreshIntegrationGrant("email");
        if (!freshGrant) return;

        const r = await window.electronAPI.saveEmailIntegration(
            read(),
            freshGrant
        );

        const savedEmail = await window.electronAPI.getIntegrationDetails("email", freshGrant);
        showEmailIntegrationForm(savedEmail, freshGrant);
        document.getElementById("message").textContent =
            "Configuration saved securely." +
            (r.activityWarning ? ` ${r.activityWarning}` : "");
    } catch (e) {
        document.getElementById("message").textContent = e.message;
    }
};

testConnection.onclick = async () => {
    try {
        const r = await window.electronAPI.testEmailIntegration(
            grant
        );

        document.getElementById("message").textContent =
            (r.success
                ? "Connection Successful"
                : integrationLabel(r.error)) +
            (r.activityWarning ? ` ${r.activityWarning}` : "");
    } catch (e) {
        document.getElementById("message").textContent = e.message;
    }
};

sendTest.onclick = async () => {
    try {
        const to =
            read().recipients
                .map(v => v.trim().toLowerCase())
                .find(Boolean) || "";

        const r =
            await window.electronAPI.sendIntegrationTestEmail(
                to,
                grant
            );

        document.getElementById("message").textContent =
            (r.success
                ? "Test Email Sent"
                : integrationLabel(r.error)) +
            (r.activityWarning ? ` ${r.activityWarning}` : "");
    } catch (e) {
        document.getElementById("message").textContent = e.message;
    }
};

cancel.onclick = leaveIntegrationConfiguration;
}
function emailGuide() { return `<section class="integration-guide"><h2>SETUP GUIDE</h2><ol><li>Enter the Gmail/email address KLBS will use for Day Closing backups.</li><li>For Gmail use smtp.gmail.com, port 587 and STARTTLS.</li><li>Enter the Gmail address as SMTP Username.</li><li>Generate and enter a Google App Password.</li><li>Add one or more backup recipients.</li><li>Save the configuration.</li><li>Click Test Connection.</li><li>Click Send Test Email and confirm receipt.</li></ol><p><strong>IMPORTANT:</strong> Use a Google App Password, not the normal Gmail account password. Saved SMTP credentials are never displayed by KLBS.</p></section>`; }
function detectedSheetId(value) { const input=String(value||"").trim(); if(/^[A-Za-z0-9_-]{20,}$/.test(input))return input; const m=/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(input); return m?m[1]:""; }
function showDsrIntegrationForm(dsr, grant) {
    const banner=dsr.source==="ENVIRONMENT"?'<aside class="integration-banner"><strong>CURRENT CONFIGURATION</strong><p>Some DSR connection settings are currently supplied by Windows system configuration. Saving this form will create a KLBS-managed configuration.</p></aside>':"";
    renderSettingsPage({ title:"DAILY SALES REPORT", icon:"&#128202;", subtitle:"KLBS → Apps Script Web App → Google Sheet. No Google login is required.", backText:"← System Health", backAction:leaveIntegrationConfiguration,
        content:`<div class="integration-form">${banner}<h2>GOOGLE SHEET</h2><label>Google Sheet URL or Sheet ID<input id="sheetInput" value="${integrationEscape(dsr.sheetId)}"></label><label>Detected Sheet ID<input id="detectedSheet" value="${integrationEscape(dsr.sheetId)}" readonly></label><label>Data Sheet / Tab Name<input id="tabName" value="${integrationEscape(dsr.tabName||"KLBS_Daily_Data")}"></label><h2>APPS SCRIPT CONNECTION</h2><label>Apps Script Web App URL<input id="webAppUrl" type="url" value="${integrationEscape(dsr.webAppUrl)}"></label>${secretControl("dsr",dsr.secretConfigured)}<h2>SYNC STATUS</h2><div class="integration-info-row"><span class="integration-status-label">Daily Sales Report Sync</span><strong class="${integrationStatusClass("ENABLED")}">ENABLED</strong></div><p>Test Connection verifies the Apps Script and Google Sheet connection. A diagnostic entry will be written to KLBS_Test.</p><div id="message" class="security-message" aria-live="polite"></div><div class="integration-actions"><button id="testConnection" class="integration-button integration-button-secondary">TEST CONNECTION</button><button id="cancel" class="integration-button integration-button-neutral">CANCEL</button><button id="save" class="integration-button integration-button-primary">SAVE CHANGES</button></div>${dsrGuide()}</div>` });
    settingsPage.dataset.integrationConfigure = "true";
    wireSecret(); sheetInput.oninput=()=>{detectedSheet.value=detectedSheetId(sheetInput.value);};
save.onclick = async () => {
    try {
        const freshGrant = await requestFreshIntegrationGrant("dsr");
        if (!freshGrant) return;

        const r = await window.electronAPI.saveDsrIntegration(
            {
                sheetUrlOrId: sheetInput.value,
                tabName: tabName.value,
                webAppUrl: webAppUrl.value,
                secret: integrationSecret.value
            },
            freshGrant
        );

        const savedDsr = await window.electronAPI.getIntegrationDetails("dsr", freshGrant);
        showDsrIntegrationForm(savedDsr, freshGrant);
        document.getElementById("message").textContent =
            "Configuration saved securely." +
            (r.activityWarning ? ` ${r.activityWarning}` : "");
    } catch (e) {
        document.getElementById("message").textContent = e.message;
    }
};

testConnection.onclick = async () => {
    try {
        const r =
            await window.electronAPI.testDsrIntegration(
                grant
            );

        document.getElementById("message").textContent =
            (r.success
                ? "Connection Successful\nTest log written to KLBS_Test."
                : integrationLabel(r.error)) +
            (r.activityWarning ? ` ${r.activityWarning}` : "");
    } catch (e) {
        document.getElementById("message").textContent = e.message;
    }
};

cancel.onclick = leaveIntegrationConfiguration;
}
function dsrGuide(){return `<section class="integration-guide"><h2>SETUP GUIDE</h2><ol><li>Paste the Google Sheet URL.</li><li>KLBS detects the Sheet ID.</li><li>Confirm KLBS_Daily_Data.</li><li>Enter the Apps Script Web App URL.</li><li>Enter the DSR Sync Secret.</li><li>Save the configuration.</li><li>Click Test Connection.</li><li>Verify a SUCCESS entry in KLBS_Test.</li></ol><p><strong>IMPORTANT:</strong> Normal DSR data is written only to KLBS_Daily_Data. Test logs are written only to KLBS_Test. No Google username or password is required.</p></section>`;}
function showRemoteDashboardForm(remote, grant) {
    const identity = remote.identity || { merchant: "KAIRA_LUXE", store: "KL001", terminal: "POS01" };
    renderSettingsPage({
        title: "REMOTE DASHBOARD",
        icon: "&#128225;",
        subtitle: "Configure the secure connection used by KLBS Remote Dashboard and push notifications.",
        backText: "← System Health",
        backAction: leaveIntegrationConfiguration,
        content: `<div class="integration-form remote-dashboard-form">
            <h2>REMOTE DASHBOARD CONNECTION</h2>
            <label>Web App URL<input id="remoteWebAppBase" type="url" required value="${integrationEscape(remote.webAppBase)}" placeholder="https://script.google.com/macros/s/.../exec"></label>
            <label>Gateway URL<input id="remoteGatewayBase" type="url" required value="${integrationEscape(remote.gatewayBase)}" placeholder="https://gateway.example.com/"></label>
            <h2>INSTALLATION IDENTITY</h2>
            <div class="integration-identity-grid"><div><span>Merchant</span><strong>${integrationEscape(identity.merchant)}</strong></div><div><span>Store</span><strong>${integrationEscape(identity.store)}</strong></div><div><span>Terminal</span><strong>${integrationEscape(identity.terminal)}</strong></div></div>
            <h2>SECURITY</h2>
            ${secretControl("remoteDashboard", remote.secretConfigured)}
            <p class="integration-security-note">The Installation Secret is protected using Windows secure storage and is never displayed by KLBS after it is saved.</p>
            <h2>CONNECTION STATUS</h2>
            <div class="integration-info-row"><span class="integration-status-label">Configuration</span><strong class="${integrationStatusClass(remote.configured ? "CONFIGURED" : "NOT CONFIGURED")}">${remote.configured ? "CONFIGURED" : "NOT CONFIGURED"}</strong></div>
            <div class="integration-info-row"><span class="integration-status-label">Operational Status</span><strong class="${integrationStatusClass(remote.enabled ? "ENABLED" : "DISABLED")}">${remote.enabled ? "ENABLED" : "DISABLED"}</strong></div>
            <div class="integration-info-row"><span class="integration-status-label">Last Connection Test</span><strong id="remoteConnectionStatus" class="${integrationStatusClass(remote.lastTestResult)}">${integrationEscape(remote.lastTestAt ? integrationTime(remote.lastTestAt) + " · " + integrationLabel(remote.lastTestResult) : "Never")}</strong></div>
            <div id="message" class="security-message" aria-live="polite"></div>
            <section class="integration-advanced"><h2>ADVANCED</h2><button id="clearRemoteDashboard" class="integration-button integration-button-destructive">CLEAR REMOTE DASHBOARD CONFIGURATION</button></section>
            <div class="integration-actions"><button id="testConnection" class="integration-button integration-button-secondary">TEST CONNECTION</button><button id="cancel" class="integration-button integration-button-neutral">CANCEL</button><button id="save" class="integration-button integration-button-primary">SAVE CHANGES</button></div>
            <section class="integration-guide"><h2>SETUP GUIDE</h2><ol><li>Enter the Apps Script Web App URL.</li><li>Enter the Remote Dashboard Gateway URL.</li><li>Confirm the installation identity.</li><li>Enter the authorized Installation Secret.</li><li>Save the configuration.</li><li>Run Test Connection.</li><li>Confirm the connection succeeds.</li><li>KLBS will use the saved configuration for Remote Dashboard integration and notification events.</li></ol><p><strong>IMPORTANT:</strong> The Installation Secret is protected using the operating system's secure storage and is never displayed by KLBS after it is saved.</p></section>
        </div>`
    });
    settingsPage.dataset.integrationConfigure = "true";
    wireSecret();
    const message = document.getElementById("message");
    const saveButton = document.getElementById("save");
    const testButton = document.getElementById("testConnection");
    const secretInput = document.getElementById("integrationSecret");
    const secretBlock = document.getElementById("secretReplacement");
    const showMessage = (text, success = false) => { message.textContent = text; message.classList.toggle("success", success); };
    const validateUrl = (input, label) => {
        const value = input.value.trim();
        try {
            const parsed = new URL(value);
            if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) throw new Error();
            input.setCustomValidity("");
            return parsed.toString();
        }
        catch (_) {
            input.setCustomValidity(`${label} must be a valid HTTPS URL.`);
            return "";
        }
    };
    const read = () => ({
        webAppBase: validateUrl(document.getElementById("remoteWebAppBase"), "Web App URL"),
        gatewayBase: validateUrl(document.getElementById("remoteGatewayBase"), "Gateway URL"),
        enabled: remote.enabled !== false,
        secret: secretInput.value,
        replaceSecret: !secretBlock.hidden
    });
    saveButton.onclick = async () => {
        const data = read();
        if (!data.webAppBase || !data.gatewayBase || (!remote.secretConfigured && !data.secret.trim()) || (data.replaceSecret && !data.secret.trim())) {
            data.secret = "";
            showMessage("Enter valid HTTPS URLs and the Installation Secret.");
            return;
        }
        saveButton.disabled = true;
        testButton.disabled = true;
        showMessage("Saving configuration...");
        try {
            const freshGrant = await requestFreshIntegrationGrant("remoteDashboard");
            if (!freshGrant) return;
            const result = await window.electronAPI.saveRemoteDashboardIntegration(data, freshGrant);
            data.secret = "";
            secretInput.value = "";
            const savedRemote = await window.electronAPI.getIntegrationDetails("remoteDashboard", freshGrant);
            showRemoteDashboardForm(savedRemote, freshGrant);
            document.getElementById("message").textContent =
                "Configuration saved securely." + (result.activityWarning ? ` ${result.activityWarning}` : "");
            document.getElementById("message").classList.add("success");
        }
        catch (error) {
            data.secret = "";
            secretInput.value = "";
            showMessage(error.message || "Remote Dashboard configuration could not be saved.");
        }
        finally {
            data.secret = "";
            saveButton.disabled = false;
            testButton.disabled = false;
        }
    };
    testButton.onclick = async () => {
        testButton.disabled = true;
        saveButton.disabled = true;
        showMessage("Testing...");
        try {
            const result = await window.electronAPI.testRemoteDashboardIntegration(grant);
            showMessage(result.success ? "Successful" : "Connection failed. Check the configuration and try again.", result.success);
            if (result.success) {
                const status = document.getElementById("remoteConnectionStatus");
                status.textContent = `${integrationTime(new Date().toISOString())} · Successful`;
                status.className = integrationStatusClass("SUCCESS");
            } else {
                const status = document.getElementById("remoteConnectionStatus");
                status.textContent = integrationLabel(result.error || "FAILED");
                status.className = integrationStatusClass("FAILED");
            }
        }
        catch (error) { showMessage(error.message || "Connection failed. Check the configuration and try again."); }
        finally { testButton.disabled = false; saveButton.disabled = false; }
    };
    document.getElementById("clearRemoteDashboard").onclick = async () => {
        const clearButton = document.getElementById("clearRemoteDashboard");
        const confirmed = await showNativeConfirm(
            "Clear Remote Dashboard configuration? Email and DSR configuration will not be affected.",
            clearButton
        );
        if (!confirmed) return;
        const freshGrant = await requestFreshIntegrationGrant("remoteDashboard");
        if (!freshGrant) return;
        try {
            const result = await window.electronAPI.clearRemoteDashboardIntegration(freshGrant);
            secretInput.value = "";
            const clearedRemote = await window.electronAPI.getIntegrationDetails("remoteDashboard", freshGrant);
            showRemoteDashboardForm(clearedRemote, freshGrant);
            document.getElementById("message").textContent =
                "Remote Dashboard configuration cleared." + (result.activityWarning ? ` ${result.activityWarning}` : "");
            document.getElementById("message").classList.add("success");
        }
        catch (error) { showMessage(error.message || "Remote Dashboard configuration could not be cleared."); }
    };
    document.getElementById("cancel").onclick = leaveIntegrationConfiguration;
}
function showCustomerCrmForm(crm, crmStatus = {}) {
    renderSettingsPage({ title:"CUSTOMER CRM", icon:"&#128202;", subtitle:"KLBS customer profiles → authenticated Apps Script receiver → Customer_Master.", backText:"← System Health", backAction:leaveIntegrationConfiguration,
        content:`<div class="integration-form customer-crm-form">
            <h2>GOOGLE SHEET</h2>
            <label>Spreadsheet Name<input value="KAIRA LUXE - CUSTOMER CRM" readonly></label>
            <label>Google Spreadsheet ID<input id="crmSpreadsheetId" value="${integrationEscape(crm.spreadsheetId)}"></label>
            <label>Worksheet / Tab Name<input value="${integrationEscape(crm.worksheet)}" readonly></label>
            <h2>APPS SCRIPT CONNECTION</h2>
            <label>Google Apps Script Web App URL<input id="crmEndpoint" type="url" value="${integrationEscape(crm.endpoint)}"></label>
            ${secretControl("crm",crm.secretConfigured)}
            <h2>SYNC STATUS</h2>
            <div class="integration-info-row crm-sync-status"><span class="integration-status-label">Customer Sync</span><strong id="crmSyncStatus" class="${integrationStatusClass(crm.enabled ? "ENABLED" : "DISABLED")}">${crm.enabled ? "ENABLED" : "DISABLED"}</strong></div>
            <div class="integration-info-row"><span class="integration-status-label">Pending Customers</span><strong class="${integrationStatusClass(Number(crmStatus.pendingCount || 0) > 0 ? "PENDING" : "")}">${Number(crmStatus.pendingCount || 0)}</strong></div>
            <div class="integration-info-row"><span class="integration-status-label">Last Successful Sync</span><strong class="${integrationStatusClass(crmStatus.lastSuccessAt ? "SUCCESS" : "")}">${integrationEscape(crmStatus.lastSuccessAt ? integrationTime(crmStatus.lastSuccessAt) : "Never")}</strong></div>
            <div class="integration-info-row"><span class="integration-status-label">Last Connection Test</span><strong class="${integrationStatusClass(crm.lastTestResult)}">${integrationEscape(crm.lastTestAt ? integrationTime(crm.lastTestAt) + " · " + integrationLabel(crm.lastTestResult) : "Never")}</strong></div>
            <div class="crm-sync-actions"><button id="syncNow" class="integration-button integration-button-primary">SYNC NOW</button><button id="syncExisting" class="integration-button integration-button-secondary">SYNC EXISTING CUSTOMERS</button></div>
            <p id="crmSyncDisabledReason" class="crm-sync-unavailable" aria-live="polite"></p>
            <p id="message" class="security-message" aria-live="polite"></p>
            <div class="integration-actions"><button id="testConnection" class="integration-button integration-button-secondary">TEST CONNECTION</button><button id="cancel" class="integration-button integration-button-neutral">CANCEL</button><button id="save" class="integration-button integration-button-primary">SAVE CHANGES</button></div>
            ${crmGuide()}
        </div>` });
    settingsPage.dataset.integrationConfigure = "true"; wireSecret();
    const msg = value => { document.getElementById("message").textContent = value; };
    const syncNowButton = document.getElementById("syncNow");
    const syncExistingButton = document.getElementById("syncExisting");
    const disabledReason = document.getElementById("crmSyncDisabledReason");
    const secretReplacement = document.getElementById("secretReplacement");
    const secretInput = document.getElementById("integrationSecret");
    const updateSyncAvailability = () => {
        const endpoint = document.getElementById("crmEndpoint").value.trim();
        const spreadsheetId = document.getElementById("crmSpreadsheetId").value.trim();
        const hasReplacementSecret = !secretReplacement.hidden && Boolean(secretInput.value.trim());
        const destinationEdited = endpoint !== String(crm.endpoint || "") || spreadsheetId !== String(crm.spreadsheetId || "");
        let reason = "";
        if (!endpoint) reason = "Enter and save the Apps Script Web App URL.";
        else if (!spreadsheetId || !/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) reason = "Enter a valid Google Spreadsheet ID.";
        else if (!crm.secretConfigured && !hasReplacementSecret) reason = "Configure the CRM Authentication Secret.";
        else if (!crm.enabled) reason = "Enable Customer Sync to use these actions.";
        else if (destinationEdited || hasReplacementSecret) reason = "Save configuration changes, then pass Test Connection for this destination.";
        else if (crm.lastTestResult !== "SUCCESS") reason = "Pass Test Connection before synchronizing customers.";
        const disabled = Boolean(reason);
        syncNowButton.disabled = disabled;
        syncExistingButton.disabled = disabled;
        syncNowButton.title = reason;
        syncExistingButton.title = reason;
        disabledReason.textContent = reason;
    };
    ["crmEndpoint", "crmSpreadsheetId", "integrationSecret"].forEach(id =>
        document.getElementById(id).addEventListener("input", updateSyncAvailability));
    document.getElementById("replaceSecret").addEventListener("click", updateSyncAvailability);
    document.getElementById("cancelSecret").addEventListener("click", updateSyncAvailability);
    updateSyncAvailability();
    document.getElementById("save").onclick = async () => {
        try { await window.electronAPI.saveCustomerCrmIntegration({endpoint:crmEndpoint.value,spreadsheetId:crmSpreadsheetId.value,enabled:crm.enabled,secret:integrationSecret.value}); integrationSecret.value=""; await loadCustomerCrmForm(); msg("Configuration saved securely. Editing a destination requires a new successful connection test before sync."); }
        catch (e) { integrationSecret.value=""; msg(e.message || "Configuration could not be saved."); }
    };
    document.getElementById("testConnection").onclick = async () => {
        const button = document.getElementById("testConnection"); button.disabled = true; msg("Testing the saved CRM destination...");
        try {
            const r = await window.electronAPI.testCustomerCrmIntegration();
            await loadCustomerCrmForm();
            msg(r.success ? "Connection Successful. Customer synchronization is available." : "Connection test failed. Deploy the CRM receiver and verify its URL, secret, Spreadsheet ID, and worksheet.");
        } catch (error) { msg(error.message || "Connection test failed."); }
        finally { const current = document.getElementById("testConnection"); if (current) current.disabled = false; }
    };
    document.getElementById("syncNow").onclick = async () => { msg("Synchronizing eligible customers..."); try { const r=await window.electronAPI.syncCustomerCrm(); msg(r.success ? `Delivered ${r.successCount||0}; pending ${r.pendingCount||0}.` : `Sync not completed${r.errorCodes?.length ? `: ${r.errorCodes.join(", ")}` : r.error ? `: ${r.error}` : ": receiver failures"}. Pending ${r.pendingCount||0}.`); } catch (error) { msg(error.message || "Customer synchronization could not be started."); } };
    document.getElementById("syncExisting").onclick = async () => {
        const confirmed = await showNativeConfirm("Queue all existing customer profiles for synchronization to the configured Customer CRM destination?", syncExistingButton);
        if (!confirmed) return;
        msg("Queueing existing customer profiles...");
        try { const r=await window.electronAPI.syncExistingCustomersCrm(); msg(`Queued ${r.queued||0}; delivered ${r.successCount||0}; pending ${r.pendingCount||0}${r.errorCodes?.length ? `; errors: ${r.errorCodes.join(", ")}` : ""}.`); }
        catch (error) { msg(error.message || "Existing customer synchronization could not be started."); }
    };
    document.getElementById("cancel").onclick = leaveIntegrationConfiguration;
}
function crmGuide() {
    return `<section class="integration-guide"><h2>SETUP GUIDE</h2><ol><li>Confirm the Customer CRM Google Spreadsheet ID.</li><li>Confirm the Customer_Master worksheet.</li><li>Enter the deployed CRM Apps Script Web App URL.</li><li>Configure the Customer CRM Sync Secret.</li><li>Save the configuration.</li><li>Click Test Connection and confirm success.</li><li>Create or update a customer in KLBS.</li><li>Verify the customer appears or updates in Customer_Master.</li><li>Use SYNC NOW to retry pending customer records.</li><li>Use SYNC EXISTING CUSTOMERS only when an authorized historical backfill is required.</li></ol><p><strong>IMPORTANT:</strong> Customer profiles created through Billing and Customer Management synchronize automatically after successful database persistence, including when optional mobile, email, birthday, or anniversary fields are blank. Customer updates change the existing Google Sheets row. Customer identity is Store Code + Customer ID. SYNC NOW is for retrying pending records; it is not required for normal operation.</p></section>`;
}
function showIntegrationsPage(){return showSystemHealthPage();}
