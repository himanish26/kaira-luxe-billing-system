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
    return `${get("day")} ${get("month")} ${get("year")}  ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}
function integrationEvent(event) { return event ? `${integrationTime(event.at)} · ${integrationLabel(event.status)}` : "Never"; }

async function showSystemHealthPage() {
    const config = await window.electronAPI.getIntegrationConfig();
    const source = item => item.source === "ENVIRONMENT" ? '<p class="integration-source">Using Windows system configuration</p>' : "";
    renderSettingsPage({ title:"SYSTEM HEALTH", icon:"&#129658;", subtitle:"Application integrations and operational status.", backText:"← System", backAction:showSystemPage,
        content:`<section class="integration-section"><h2>INTEGRATIONS</h2><div class="integration-summary-grid">
        <article class="integration-card"><h3>EMAIL &amp; BACKUP</h3><strong>${config.email.configured ? "CONFIGURED" : "NOT CONFIGURED"}</strong>${source(config.email)}
        <dl><div><dt>SMTP Email Service</dt><dd>${config.email.configured ? "Configured" : "Not Configured"}</dd></div><div><dt>Email After Day Closing</dt><dd class="integration-enabled">ENABLED</dd></div><div><dt>Last Email Backup</dt><dd>${integrationEscape(integrationEvent(config.email.lastEmailBackup))}</dd></div><div><dt>Last Connection Test</dt><dd>${integrationEscape(config.email.lastTestAt ? integrationTime(config.email.lastTestAt) + " · " + integrationLabel(config.email.lastTestResult) : "Never")}</dd></div></dl><button id="configureEmailIntegration" class="dashboard-btn">CONFIGURE</button></article>
        <article class="integration-card"><h3>DAILY SALES REPORT</h3><strong>${config.dsr.configured ? "CONFIGURED" : "NOT CONFIGURED"}</strong>${source(config.dsr)}
        <dl><div><dt>Google Sheets</dt><dd>${integrationEscape(config.dsr.tabName || "KLBS_Daily_Data")}</dd></div><div><dt>Daily Sales Report Sync</dt><dd class="integration-enabled">ENABLED</dd></div><div><dt>Last DSR Sync</dt><dd>${integrationEscape(integrationEvent(config.dsr.lastSync))}</dd></div><div><dt>Last Connection Test</dt><dd>${integrationEscape(config.dsr.lastTestAt ? integrationTime(config.dsr.lastTestAt) + " · " + integrationLabel(config.dsr.lastTestResult) : "Never")}</dd></div></dl><button id="configureDsrIntegration" class="dashboard-btn">CONFIGURE</button></article>
        </div></section>` });
    document.getElementById("configureEmailIntegration").onclick = () => enterIntegration("email");
    document.getElementById("configureDsrIntegration").onclick = () => enterIntegration("dsr");
}
async function enterIntegration(kind) {
    const purpose = kind === "email" ? "INTEGRATION_EMAIL_SETTINGS" : "INTEGRATION_DSR_SETTINGS";
    const grant = await requestAdminAuthorization(purpose); if (!grant) return;
    try { const details = await window.electronAPI.getIntegrationDetails(kind, grant); kind === "email" ? showEmailIntegrationForm(details, grant) : showDsrIntegrationForm(details, grant); }
    catch (error) { alert(error.message); }
}
function recipientRows(values) {
    return (values.length ? values : [""]).map(value => `<div class="integration-recipient-row"><input class="integration-recipient" type="email" value="${integrationEscape(value)}" placeholder="backup@example.com" aria-label="Backup recipient"><button type="button" class="removeIntegrationRecipient integration-button integration-button-small integration-button-destructive">REMOVE</button></div>`).join("");
}
function secretControl(kind, configured) {
    const email = kind === "email";
    return `<div class="integration-secret"><span>${email ? "SMTP App Password" : "Sync Secret"}</span><strong>${configured ? "CONFIGURED" : "NOT CONFIGURED"}</strong><button id="replaceSecret" type="button" class="integration-button integration-button-small integration-button-secondary">${configured ? (email ? "REPLACE PASSWORD" : "REPLACE SECRET") : (email ? "ENTER PASSWORD" : "ENTER SECRET")}</button><label id="secretReplacement" hidden>${email ? "New SMTP App Password" : "New Sync Secret"}<input id="integrationSecret" type="password" autocomplete="new-password"><button id="cancelSecret" type="button" class="integration-button integration-button-small integration-button-secondary">CANCEL REPLACEMENT</button></label></div>`;
}
function wireSecret() {
    const block = document.getElementById("secretReplacement");
    document.getElementById("replaceSecret").onclick = () => { block.hidden = false; };
    document.getElementById("cancelSecret").onclick = () => { document.getElementById("integrationSecret").value = ""; block.hidden = true; };
}
function showEmailIntegrationForm(email, grant) {
    renderSettingsPage({ title:"EMAIL & BACKUP", icon:"&#128231;", subtitle:"Configure the outgoing email service used for automated KLBS Day Closing backups.", backText:"← System Health", backAction:showSystemHealthPage,
        content:`<div class="integration-form"><h2>EMAIL ACCOUNT</h2><div class="integration-form-grid"><label>Account Name<input id="accountName" value="${integrationEscape(email.accountName)}"></label><label>Sender<input id="senderEmail" type="email" value="${integrationEscape(email.senderEmail)}"></label><label>SMTP Server<input id="smtpHost" value="${integrationEscape(email.smtpHost)}"></label><label>SMTP Port<input id="smtpPort" type="number" min="1" max="65535" value="${email.smtpPort}"></label><label>Security Mode<select id="securityMode"><option>STARTTLS</option><option value="SSL_TLS">SSL/TLS</option></select></label><label>SMTP Username<input id="smtpUsername" value="${integrationEscape(email.smtpUsername)}"></label></div><h2>SECURITY</h2>${secretControl("email", email.passwordConfigured)}<fieldset><legend>Backup Recipients</legend><div id="recipients">${recipientRows(email.recipients)}</div><button id="addRecipient" type="button" class="integration-button integration-button-small integration-button-secondary">+ ADD RECIPIENT</button></fieldset><div class="integration-info-row"><span>Email After Day Closing</span><strong>ENABLED</strong></div><div id="message" class="security-message" aria-live="polite"></div><div class="integration-actions"><button id="testConnection" class="integration-button integration-button-secondary">TEST CONNECTION</button><button id="sendTest" class="integration-button integration-button-secondary">SEND TEST EMAIL</button><button id="cancel" class="integration-button integration-button-neutral">CANCEL</button><button id="save" class="integration-button integration-button-primary">SAVE CHANGES</button></div>${emailGuide()}</div>` });
    document.getElementById("securityMode").value = email.securityMode; wireSecret();
    const wireRemove = () => document.querySelectorAll(".removeIntegrationRecipient").forEach(b => { b.onclick = () => b.closest(".integration-recipient-row").remove(); }); wireRemove();
    document.getElementById("addRecipient").onclick = () => { document.getElementById("recipients").insertAdjacentHTML("beforeend", recipientRows([""])); wireRemove(); };
    const read = () => ({ accountName:accountName.value, senderEmail:senderEmail.value, smtpHost:smtpHost.value, smtpPort:smtpPort.value, securityMode:securityMode.value, smtpUsername:smtpUsername.value, password:integrationSecret.value, recipients:[...document.querySelectorAll(".integration-recipient")].map(i => i.value) });
    save.onclick = async () => { try { const r=await window.electronAPI.saveEmailIntegration(read(), grant); message.textContent="Configuration saved securely."+(r.activityWarning?` ${r.activityWarning}`:""); setTimeout(showSystemHealthPage, r.activityWarning?1800:500); } catch(e){ message.textContent=e.message; } };
    testConnection.onclick = async () => { const r=await window.electronAPI.testEmailIntegration(grant); message.textContent=(r.success?"Connection Successful":integrationLabel(r.error))+(r.activityWarning?` ${r.activityWarning}`:""); };
    sendTest.onclick = async () => { const to=read().recipients.map(v=>v.trim().toLowerCase()).find(Boolean)||""; const r=await window.electronAPI.sendIntegrationTestEmail(to, grant); message.textContent=(r.success?"Test Email Sent":integrationLabel(r.error))+(r.activityWarning?` ${r.activityWarning}`:""); }; cancel.onclick=showSystemHealthPage;
}
function emailGuide() { return `<section class="integration-guide"><h2>SETUP GUIDE</h2><ol><li>Enter the Gmail/email address KLBS will use for Day Closing backups.</li><li>For Gmail use smtp.gmail.com, port 587 and STARTTLS.</li><li>Enter the Gmail address as SMTP Username.</li><li>Generate and enter a Google App Password.</li><li>Add one or more backup recipients.</li><li>Save the configuration.</li><li>Click Test Connection.</li><li>Click Send Test Email and confirm receipt.</li></ol><p><strong>IMPORTANT:</strong> Use a Google App Password, not the normal Gmail account password. Saved SMTP credentials are never displayed by KLBS.</p></section>`; }
function detectedSheetId(value) { const input=String(value||"").trim(); if(/^[A-Za-z0-9_-]{20,}$/.test(input))return input; const m=/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(input); return m?m[1]:""; }
function showDsrIntegrationForm(dsr, grant) {
    const banner=dsr.source==="ENVIRONMENT"?'<aside class="integration-banner"><strong>CURRENT CONFIGURATION</strong><p>Some DSR connection settings are currently supplied by Windows system configuration. Saving this form will create a KLBS-managed configuration.</p></aside>':"";
    renderSettingsPage({ title:"DAILY SALES REPORT", icon:"&#128202;", subtitle:"KLBS → Apps Script Web App → Google Sheet. No Google login is required.", backText:"← System Health", backAction:showSystemHealthPage,
        content:`<div class="integration-form">${banner}<h2>GOOGLE SHEET</h2><label>Google Sheet URL or Sheet ID<input id="sheetInput" value="${integrationEscape(dsr.sheetId)}"></label><label>Detected Sheet ID<input id="detectedSheet" value="${integrationEscape(dsr.sheetId)}" readonly></label><label>Data Sheet / Tab Name<input id="tabName" value="${integrationEscape(dsr.tabName||"KLBS_Daily_Data")}"></label><h2>APPS SCRIPT CONNECTION</h2><label>Apps Script Web App URL<input id="webAppUrl" type="url" value="${integrationEscape(dsr.webAppUrl)}"></label>${secretControl("dsr",dsr.secretConfigured)}<h2>SYNC STATUS</h2><div class="integration-info-row"><span>Daily Sales Report Sync</span><strong>ENABLED</strong></div><p>Test Connection verifies the Apps Script and Google Sheet connection. A diagnostic entry will be written to KLBS_Test.</p><div id="message" class="security-message" aria-live="polite"></div><div class="integration-actions"><button id="testConnection" class="integration-button integration-button-secondary">TEST CONNECTION</button><button id="cancel" class="integration-button integration-button-neutral">CANCEL</button><button id="save" class="integration-button integration-button-primary">SAVE CHANGES</button></div>${dsrGuide()}</div>` });
    wireSecret(); sheetInput.oninput=()=>{detectedSheet.value=detectedSheetId(sheetInput.value);};
    save.onclick=async()=>{try{const r=await window.electronAPI.saveDsrIntegration({sheetUrlOrId:sheetInput.value,tabName:tabName.value,webAppUrl:webAppUrl.value,secret:integrationSecret.value},grant);message.textContent="Configuration saved securely."+(r.activityWarning?` ${r.activityWarning}`:"");setTimeout(showSystemHealthPage,r.activityWarning?1800:500);}catch(e){message.textContent=e.message;}};
    testConnection.onclick=async()=>{const r=await window.electronAPI.testDsrIntegration(grant);message.textContent=(r.success?"Connection Successful\nTest log written to KLBS_Test.":integrationLabel(r.error))+(r.activityWarning?` ${r.activityWarning}`:"");}; cancel.onclick=showSystemHealthPage;
}
function dsrGuide(){return `<section class="integration-guide"><h2>SETUP GUIDE</h2><ol><li>Paste the Google Sheet URL.</li><li>KLBS detects the Sheet ID.</li><li>Confirm KLBS_Daily_Data.</li><li>Enter the Apps Script Web App URL.</li><li>Enter the DSR Sync Secret.</li><li>Save the configuration.</li><li>Click Test Connection.</li><li>Verify a SUCCESS entry in KLBS_Test.</li></ol><p><strong>IMPORTANT:</strong> Normal DSR data is written only to KLBS_Daily_Data. Test logs are written only to KLBS_Test. No Google username or password is required.</p></section>`;}
function showIntegrationsPage(){return showSystemHealthPage();}
