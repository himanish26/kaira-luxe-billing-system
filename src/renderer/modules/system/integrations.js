function integrationEscape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}
function integrationLabel(value) {
    const labels = { NOT_ATTEMPTED:"Not Attempted", NEVER_TESTED:"Not Attempted", UNKNOWN:"Status Unavailable", NEVER:"Never", FAILED:"Failed", SUCCESS:"Successful", PENDING:"Pending", SYNCED:"Synced" };
    return labels[String(value || "").toUpperCase()] || String(value || "Status Unavailable").replace(/_/g, " ");
}
function integrationTime(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return "Never";
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone:"Asia/Kolkata", day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:true }).formatToParts(new Date(value));
    const get = type => (parts.find(p => p.type === type) || {}).value || "";
    return `${get("day")} ${get("month")}, ${get("year")}, ${get("hour").padStart(2, "0")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}
function integrationEvent(event) { return event ? `${integrationTime(event.at)} · ${integrationLabel(event.status)}` : "Never"; }

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
    const remoteStatus = config.remoteDashboard.configured
        ? config.remoteDashboard.lastTestResult === "FAILED" ? "CONNECTION ERROR" : "CONFIGURED"
        : "NOT CONFIGURED";
    const remoteStatusClass = remoteStatus === "CONNECTION ERROR" ? "integration-error" : config.remoteDashboard.configured ? "integration-enabled" : "";
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
        <article class="integration-card"><h3>EMAIL &amp; BACKUP</h3><strong>${config.email.configured ? "CONFIGURED" : "NOT CONFIGURED"}</strong>${source(config.email)}
        <dl><div><dt>SMTP Email Service</dt><dd>${config.email.configured ? "Configured" : "Not Configured"}</dd></div><div><dt>Email After Day Closing</dt><dd class="integration-enabled">ENABLED</dd></div><div><dt>Last Email Backup</dt><dd>${integrationEscape(integrationEvent(config.email.lastEmailBackup))}</dd></div><div><dt>Last Connection Test</dt><dd>${integrationEscape(config.email.lastTestAt ? integrationTime(config.email.lastTestAt) + " · " + integrationLabel(config.email.lastTestResult) : "Never")}</dd></div></dl><button id="configureEmailIntegration" class="dashboard-btn">CONFIGURE</button></article>
        <article class="integration-card"><h3>DAILY SALES REPORT</h3><strong>${config.dsr.configured ? "CONFIGURED" : "NOT CONFIGURED"}</strong>${source(config.dsr)}
        <dl><div><dt>Google Sheets</dt><dd>${integrationEscape(config.dsr.tabName || "KLBS_Daily_Data")}</dd></div><div><dt>Daily Sales Report Sync</dt><dd class="integration-enabled">ENABLED</dd></div><div><dt>Last DSR Sync</dt><dd>${integrationEscape(integrationEvent(config.dsr.lastSync))}</dd></div><div><dt>Last Connection Test</dt><dd>${integrationEscape(config.dsr.lastTestAt ? integrationTime(config.dsr.lastTestAt) + " · " + integrationLabel(config.dsr.lastTestResult) : "Never")}</dd></div></dl><button id="configureDsrIntegration" class="dashboard-btn">CONFIGURE</button></article>
        <article class="integration-card"><h3>REMOTE DASHBOARD</h3><strong class="${remoteStatusClass}">${remoteStatus}</strong>
        <dl><div><dt>Remote Dashboard</dt><dd>${config.remoteDashboard.configured ? "Configured" : "Not Configured"}</dd></div><div><dt>Installation</dt><dd>KL001 · POS01</dd></div><div><dt>Last Connection Test</dt><dd>${integrationEscape(config.remoteDashboard.lastTestAt ? integrationTime(config.remoteDashboard.lastTestAt) + " · " + integrationLabel(config.remoteDashboard.lastTestResult) : "Never")}</dd></div></dl><button id="configureRemoteDashboardIntegration" class="dashboard-btn">CONFIGURE</button></article>
        </div></section>` });
    delete settingsPage.dataset.integrationConfigure;
    document.getElementById("configureEmailIntegration").onclick = () => enterIntegration("email");
    document.getElementById("configureDsrIntegration").onclick = () => enterIntegration("dsr");
    document.getElementById("configureRemoteDashboardIntegration").onclick = () => enterIntegration("remoteDashboard");
    document.getElementById("refreshIntegrationStatus").onclick = showSystemHealthPage;
}
async function enterIntegration(kind) {
    const request = {
        kind,
        generation: ++integrationConfigureGeneration
    };
    activeIntegrationConfigureRequest = request;
    const purpose = kind === "email" ? "INTEGRATION_EMAIL_SETTINGS" : kind === "dsr" ? "INTEGRATION_DSR_SETTINGS" : "INTEGRATION_REMOTE_DASHBOARD_SETTINGS";
    const grant = await requestAdminAuthorization(purpose); if (!grant) return;
    if (activeIntegrationConfigureRequest !== request || request.generation !== integrationConfigureGeneration) return;
    try {
        const details = await window.electronAPI.getIntegrationDetails(kind, grant);
        if (activeIntegrationConfigureRequest !== request || request.generation !== integrationConfigureGeneration) return;
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
        content:`<div class="integration-form"><h2>EMAIL ACCOUNT</h2><div class="integration-form-grid"><label>Account Name<input id="accountName" value="${integrationEscape(email.accountName)}"></label><label>Sender<input id="senderEmail" type="email" value="${integrationEscape(email.senderEmail)}"></label><label>SMTP Server<input id="smtpHost" value="${integrationEscape(email.smtpHost)}"></label><label>SMTP Port<input id="smtpPort" type="number" min="1" max="65535" value="${email.smtpPort}"></label><label>Security Mode<select id="securityMode"><option>STARTTLS</option><option value="SSL_TLS">SSL/TLS</option></select></label><label>SMTP Username<input id="smtpUsername" value="${integrationEscape(email.smtpUsername)}"></label></div><h2>SECURITY</h2>${secretControl("email", email.passwordConfigured)}<fieldset><legend>Backup Recipients</legend><div id="recipients">${recipientRows(email.recipients)}</div><button id="addRecipient" type="button" class="integration-button integration-button-small integration-button-secondary">+ ADD RECIPIENT</button></fieldset><div class="integration-info-row"><span>Email After Day Closing</span><strong>ENABLED</strong></div><div id="message" class="security-message" aria-live="polite"></div><div class="integration-actions"><button id="testConnection" class="integration-button integration-button-secondary">TEST CONNECTION</button><button id="sendTest" class="integration-button integration-button-secondary">SEND TEST EMAIL</button><button id="cancel" class="integration-button integration-button-neutral">CANCEL</button><button id="save" class="integration-button integration-button-primary">SAVE CHANGES</button></div>${emailGuide()}</div>` });
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
        content:`<div class="integration-form">${banner}<h2>GOOGLE SHEET</h2><label>Google Sheet URL or Sheet ID<input id="sheetInput" value="${integrationEscape(dsr.sheetId)}"></label><label>Detected Sheet ID<input id="detectedSheet" value="${integrationEscape(dsr.sheetId)}" readonly></label><label>Data Sheet / Tab Name<input id="tabName" value="${integrationEscape(dsr.tabName||"KLBS_Daily_Data")}"></label><h2>APPS SCRIPT CONNECTION</h2><label>Apps Script Web App URL<input id="webAppUrl" type="url" value="${integrationEscape(dsr.webAppUrl)}"></label>${secretControl("dsr",dsr.secretConfigured)}<h2>SYNC STATUS</h2><div class="integration-info-row"><span>Daily Sales Report Sync</span><strong>ENABLED</strong></div><p>Test Connection verifies the Apps Script and Google Sheet connection. A diagnostic entry will be written to KLBS_Test.</p><div id="message" class="security-message" aria-live="polite"></div><div class="integration-actions"><button id="testConnection" class="integration-button integration-button-secondary">TEST CONNECTION</button><button id="cancel" class="integration-button integration-button-neutral">CANCEL</button><button id="save" class="integration-button integration-button-primary">SAVE CHANGES</button></div>${dsrGuide()}</div>` });
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
            <div class="integration-info-row"><span>Last Connection Test</span><strong id="remoteConnectionStatus">${integrationEscape(remote.lastTestAt ? integrationTime(remote.lastTestAt) + " · " + integrationLabel(remote.lastTestResult) : "Never")}</strong></div>
            <div id="message" class="security-message" aria-live="polite"></div>
            <div class="integration-actions"><button id="testConnection" class="integration-button integration-button-secondary">TEST CONNECTION</button><button id="cancel" class="integration-button integration-button-neutral">CANCEL</button><button id="save" class="integration-button integration-button-primary">SAVE CHANGES</button></div>
            <section class="integration-guide"><h2>SETUP GUIDE</h2><ol><li>Enter the Apps Script Web App URL.</li><li>Enter the Remote Dashboard Gateway URL.</li><li>Confirm the installation identity.</li><li>Enter the authorized Installation Secret.</li><li>Save the configuration.</li><li>Run Test Connection.</li><li>Confirm the connection succeeds.</li><li>KLBS will use the saved configuration for Remote Dashboard integration and notification events.</li></ol><p><strong>IMPORTANT:</strong> The Installation Secret is protected using the operating system's secure storage and is never displayed by KLBS after it is saved.</p></section>
            <section class="integration-advanced"><h2>ADVANCED</h2><button id="clearRemoteDashboard" class="integration-button integration-button-destructive">CLEAR REMOTE DASHBOARD CONFIGURATION</button></section>
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
            if (result.success) document.getElementById("remoteConnectionStatus").textContent = `${integrationTime(new Date().toISOString())} · Successful`;
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
function showIntegrationsPage(){return showSystemHealthPage();}
