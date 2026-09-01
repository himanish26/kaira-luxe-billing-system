const fs = require("fs");
const path = require("path");

const EMAIL_MODES = new Set(["SSL_TLS", "STARTTLS"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SENDER_PATTERN = /^(?:[^<>\r\n]{1,100}\s*)?<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>$/;
const SHEET_ID_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

function extractSheetId(value) {
    const input = String(value || "").trim();
    if (SHEET_ID_PATTERN.test(input)) return input;
    let url;
    try { url = new URL(input); }
    catch (_) { throw new Error("Enter a valid Google Sheet URL or Sheet ID."); }
    if (url.protocol !== "https:" || !/(^|\.)docs\.google\.com$/i.test(url.hostname)) {
        throw new Error("Enter a valid Google Sheets HTTPS URL.");
    }
    const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname);
    if (!match || !SHEET_ID_PATTERN.test(match[1])) {
        throw new Error("Google Sheet ID could not be detected from the URL.");
    }
    return match[1];
}

function validateWebAppUrl(value) {
    let url;
    try { url = new URL(String(value || "").trim()); }
    catch (_) { throw new Error("Enter a valid Apps Script Web App URL."); }
    if (url.protocol !== "https:" || !/(^|\.)script\.google\.com$/i.test(url.hostname)) {
        throw new Error("Apps Script Web App URL must use HTTPS on script.google.com.");
    }
    return url.toString();
}

function validateEmailInput(input, hasExistingSecret) {
    const senderEmail = String(input.senderEmail || "").trim();
    const smtpHost = String(input.smtpHost || "").trim();
    const smtpPort = Number(input.smtpPort);
    const securityMode = String(input.securityMode || "");
    const smtpUsername = String(input.smtpUsername || "").trim();
    const recipients = [...new Set((Array.isArray(input.recipients) ? input.recipients : [])
        .map(value => String(value || "").trim().toLowerCase()).filter(Boolean))];
    if (!EMAIL_PATTERN.test(senderEmail) && !SENDER_PATTERN.test(senderEmail)) {
        throw new Error("Enter a valid sender email address or Name <email> sender.");
    }
    if (!smtpHost || /\s/.test(smtpHost)) throw new Error("Enter a valid SMTP server.");
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
        throw new Error("SMTP port must be between 1 and 65535.");
    }
    if (!EMAIL_MODES.has(securityMode)) throw new Error("Select a supported email security mode.");
    if (!smtpUsername) throw new Error("SMTP username is required.");
    if (!recipients.length || recipients.some(value => !EMAIL_PATTERN.test(value))) {
        throw new Error("Add at least one valid backup recipient.");
    }
    if (!hasExistingSecret && !String(input.password || "")) {
        throw new Error("SMTP password is required for initial configuration.");
    }
    return {
        accountName: String(input.accountName || "").trim().slice(0, 100),
        senderEmail, smtpHost, smtpPort, securityMode, smtpUsername, recipients,
        automaticEmailBackup: true
    };
}

function createIntegrationConfigService(options) {
    const safeStorage = options.safeStorage;
    const environment = options.environment || process.env;
    const storagePath = options.storagePath;
    const now = options.now || (() => new Date());

    function readStore() {
        try {
            if (!fs.existsSync(storagePath)) return { version: 1 };
            const parsed = JSON.parse(fs.readFileSync(storagePath, "utf8"));
            return parsed && parsed.version === 1 ? parsed : { version: 1 };
        }
        catch (_) { throw new Error("Integration configuration could not be read safely."); }
    }
    function writeStore(store) {
        fs.mkdirSync(path.dirname(storagePath), { recursive: true });
        const temporary = `${storagePath}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
        fs.renameSync(temporary, storagePath);
    }
    function encrypt(secret) {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("Windows secure credential storage is unavailable.");
        }
        return safeStorage.encryptString(String(secret)).toString("base64");
    }
    function decrypt(value) {
        if (!value || !safeStorage.isEncryptionAvailable()) {
            throw new Error("Saved credential cannot be decrypted safely.");
        }
        try { return safeStorage.decryptString(Buffer.from(value, "base64")); }
        catch (_) { throw new Error("Saved credential cannot be decrypted safely."); }
    }
    function emailEnvironmentConfigured() {
        return Boolean(environment.SMTP_USER && environment.SMTP_PASSWORD &&
            (environment.SMTP_FROM || environment.SMTP_USER) && environment.DAY_CLOSING_EMAIL);
    }
    function dsrEnvironmentConfigured() {
        return Boolean(environment.KLBS_DSR_WEB_APP_URL && environment.KLBS_DSR_SYNC_SECRET);
    }
    function getConfigurationDetails() {
        const store = readStore();
        const email = store.email || null;
        const dsr = store.dsr || null;
        const diagnostics = store.diagnostics || {};
        const emailTest = diagnostics.email || email || {};
        const dsrTest = diagnostics.dsr || dsr || {};
        return {
            email: {
                source: email ? "KLBS" : emailEnvironmentConfigured() ? "ENVIRONMENT" : "NONE",
                configured: Boolean(email ? (email.secret || environment.SMTP_PASSWORD) : emailEnvironmentConfigured()),
                passwordConfigured: Boolean(email ? (email.secret || environment.SMTP_PASSWORD) : environment.SMTP_PASSWORD),
                accountName: email ? email.accountName : "",
                senderEmail: email ? email.senderEmail : environment.SMTP_FROM || environment.SMTP_USER || "",
                smtpHost: email ? email.smtpHost : environment.SMTP_HOST || "smtp.gmail.com",
                smtpPort: email ? email.smtpPort : Number(environment.SMTP_PORT || 587),
                securityMode: email ? email.securityMode : environment.SMTP_SECURE === "true" ? "SSL_TLS" : "STARTTLS",
                smtpUsername: email ? email.smtpUsername : environment.SMTP_USER || "",
                recipients: email ? email.recipients : String(environment.DAY_CLOSING_EMAIL || "").split(",").map(v => v.trim()).filter(Boolean),
                automaticEmailBackup: true,
                lastTestAt: emailTest.lastTestAt || null,
                lastTestResult: emailTest.lastTestResult || "NEVER_TESTED"
            },
            dsr: {
                source: dsr ? "KLBS" : dsrEnvironmentConfigured() ? "ENVIRONMENT" : "NONE",
                configured: Boolean(dsr ? (dsr.secret || environment.KLBS_DSR_SYNC_SECRET) : dsrEnvironmentConfigured()),
                secretConfigured: Boolean(dsr ? (dsr.secret || environment.KLBS_DSR_SYNC_SECRET) : environment.KLBS_DSR_SYNC_SECRET),
                sheetId: dsr ? dsr.sheetId : "",
                tabName: dsr ? dsr.tabName : "KLBS_Daily_Data",
                webAppUrl: dsr ? dsr.webAppUrl : environment.KLBS_DSR_WEB_APP_URL || "",
                automaticSync: true,
                lastTestAt: dsrTest.lastTestAt || null,
                lastTestResult: dsrTest.lastTestResult || "NEVER_TESTED"
            }
        };
    }
    function getPublicConfig() {
        const details = getConfigurationDetails();
        return {
            email: {
                source: details.email.source,
                configured: details.email.configured,
                lastTestAt: details.email.lastTestAt,
                lastTestResult: details.email.lastTestResult
            },
            dsr: {
                source: details.dsr.source,
                configured: details.dsr.configured,
                tabName: details.dsr.tabName,
                lastTestAt: details.dsr.lastTestAt,
                lastTestResult: details.dsr.lastTestResult
            }
        };
    }
    function saveEmail(input) {
        const store = readStore();
        const existing = store.email || null;
        const hasSecret = Boolean(existing && existing.secret) || emailEnvironmentConfigured();
        const validated = validateEmailInput(input || {}, hasSecret);
        const replacement = String(input.password || "");
        store.email = {
            ...validated,
            secret: replacement ? encrypt(replacement) : existing && existing.secret || null,
            lastTestAt: existing && existing.lastTestAt || null,
            lastTestResult: existing && existing.lastTestResult || "NEVER_TESTED",
            updatedAt: now().toISOString()
        };
        if (!store.email.secret && !environment.SMTP_PASSWORD) {
            throw new Error("SMTP password is required for initial configuration.");
        }
        writeStore(store);
        return getConfigurationDetails().email;
    }
    function saveDsr(input) {
        const store = readStore();
        const existing = store.dsr || null;
        const replacement = String(input.secret || "");
        if (!replacement && !(existing && existing.secret) && !environment.KLBS_DSR_SYNC_SECRET) {
            throw new Error("DSR Sync Secret is required for initial configuration.");
        }
        store.dsr = {
            sheetId: extractSheetId(input.sheetUrlOrId),
            tabName: String(input.tabName || "").trim(),
            webAppUrl: validateWebAppUrl(input.webAppUrl),
            automaticSync: true,
            secret: replacement ? encrypt(replacement) : existing && existing.secret || null,
            lastTestAt: existing && existing.lastTestAt || null,
            lastTestResult: existing && existing.lastTestResult || "NEVER_TESTED",
            updatedAt: now().toISOString()
        };
        if (!store.dsr.tabName) throw new Error("DSR data sheet/tab name is required.");
        writeStore(store);
        return getConfigurationDetails().dsr;
    }
    function resolveEmailRuntime() {
        const store = readStore();
        if (store.email) {
            const email = store.email;
            return {
                host: email.smtpHost, port: email.smtpPort,
                secure: email.securityMode === "SSL_TLS",
                requireTLS: email.securityMode === "STARTTLS",
                user: email.smtpUsername,
                password: email.secret ? decrypt(email.secret) : environment.SMTP_PASSWORD,
                from: email.senderEmail, recipients: email.recipients,
                automaticEmailBackup: true
            };
        }
        return {
            host: environment.SMTP_HOST || "smtp.gmail.com", port: Number(environment.SMTP_PORT || 587),
            secure: environment.SMTP_SECURE === "true", requireTLS: environment.SMTP_SECURE !== "true",
            user: environment.SMTP_USER, password: environment.SMTP_PASSWORD,
            from: environment.SMTP_FROM || environment.SMTP_USER,
            recipients: String(environment.DAY_CLOSING_EMAIL || "").split(",").map(v => v.trim()).filter(Boolean),
            automaticEmailBackup: true
        };
    }
    function resolveDsrRuntime() {
        const store = readStore();
        if (store.dsr) return {
            endpoint: store.dsr.webAppUrl,
            secret: store.dsr.secret ? decrypt(store.dsr.secret) : environment.KLBS_DSR_SYNC_SECRET,
            automaticSync: true
        };
        return {
            endpoint: environment.KLBS_DSR_WEB_APP_URL,
            secret: environment.KLBS_DSR_SYNC_SECRET,
            automaticSync: true
        };
    }
    function recordTest(kind, success) {
        if (kind !== "email" && kind !== "dsr") {
            throw new Error("Unsupported integration diagnostic type.");
        }
        const store = readStore();
        const diagnostic = {
            lastTestAt: now().toISOString(),
            lastTestResult: success ? "SUCCESS" : "FAILED"
        };
        store.diagnostics = { ...(store.diagnostics || {}), [kind]: diagnostic };
        if (store[kind]) Object.assign(store[kind], diagnostic);
        writeStore(store);
        return diagnostic;
    }
    function migrateLegacyEmail(legacy) {
        const store = readStore();
        if (!legacy || !legacy.smtp_password) return { migrated: false };
        if (!store.email) {
            store.email = {
                accountName: "", senderEmail: legacy.smtp_from || legacy.smtp_user || "",
                smtpHost: legacy.smtp_host || "smtp.gmail.com", smtpPort: Number(legacy.smtp_port || 587),
                securityMode: Number(legacy.smtp_secure) === 1 ? "SSL_TLS" : "STARTTLS",
                smtpUsername: legacy.smtp_user || "",
                recipients: String(environment.DAY_CLOSING_EMAIL || "").split(",").map(v => v.trim()).filter(Boolean),
                automaticEmailBackup: Boolean(environment.DAY_CLOSING_EMAIL),
                secret: encrypt(legacy.smtp_password), lastTestAt: null,
                lastTestResult: "NEVER_TESTED", updatedAt: now().toISOString()
            };
            writeStore(store);
        }
        return { migrated: true };
    }
    return {
        getPublicConfig, getConfigurationDetails, saveEmail, saveDsr, resolveEmailRuntime, resolveDsrRuntime,
        recordTest, migrateLegacyEmail
    };
}

module.exports = { createIntegrationConfigService, extractSheetId, validateWebAppUrl, validateEmailInput };
