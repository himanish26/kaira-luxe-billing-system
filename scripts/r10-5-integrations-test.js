const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
    createIntegrationConfigService, extractSheetId, validateWebAppUrl, validateEmailInput
} = require("../src/services/integrationConfigService");
const { AUTHORIZATION_POLICY } = require("../src/services/administratorSecurityService");
const { createDsrSyncService, signTestRequest } = require("../src/services/dsrSyncService");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-r10-5-"));
const storagePath = path.join(temporary, "integration-config.json");
let decryptionEnabled = true;
const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`protected:${value}`, "utf8"),
    decryptString: value => {
        if (!decryptionEnabled) throw new Error("injected decrypt failure");
        return value.toString("utf8").replace(/^protected:/, "");
    }
};

function emailInput(overrides = {}) {
    return {
        accountName: "KLBS Mail", senderEmail: "sender@example.com",
        smtpHost: "smtp.example.com", smtpPort: 587, securityMode: "STARTTLS",
        smtpUsername: "mailer@example.com", password: "mail-test-value",
        automaticEmailBackup: true,
        recipients: ["one@example.com", "two@example.com"], ...overrides
    };
}

async function main() {
    assert.strictEqual(
        extractSheetId("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890/edit#gid=0"),
        "1AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890"
    );
    assert.strictEqual(extractSheetId("1AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890"), "1AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890");
    assert.throws(() => extractSheetId("https://example.com/not-a-sheet"));
    assert.throws(() => validateWebAppUrl("http://script.google.com/macros/s/test/exec"));
    assert(validateWebAppUrl("https://script.google.com/macros/s/test-id/exec"));
    assert.throws(() => validateEmailInput(emailInput({ smtpPort: 70000 }), false));
    assert.throws(() => validateEmailInput(emailInput({ securityMode: "NONE" }), false));
    assert.throws(() => validateEmailInput(emailInput({ recipients: ["invalid"] }), false));

    const emptyEnvironment = {};
    const service = createIntegrationConfigService({ safeStorage, storagePath, environment: emptyEnvironment });
    assert.strictEqual(service.getPublicConfig().email.configured, false);
    service.saveEmail(emailInput());
    const emailPublic = service.getConfigurationDetails().email;
    assert.strictEqual(emailPublic.configured, true);
    assert.strictEqual(emailPublic.passwordConfigured, true);
    assert(!Object.prototype.hasOwnProperty.call(emailPublic, "password"));
    assert(!fs.readFileSync(storagePath, "utf8").includes("mail-test-value"));
    assert.strictEqual(service.resolveEmailRuntime().password, "mail-test-value");
    const summary = service.getPublicConfig().email;
    assert(!Object.prototype.hasOwnProperty.call(summary, "smtpUsername"));
    assert(!Object.prototype.hasOwnProperty.call(summary, "recipients"));
    assert(!Object.prototype.hasOwnProperty.call(summary, "passwordConfigured"));
    service.saveEmail(emailInput({ password: "", recipients: ["changed@example.com"] }));
    assert.deepStrictEqual(service.getConfigurationDetails().email.recipients, ["changed@example.com"]);
    assert.strictEqual(service.resolveEmailRuntime().password, "mail-test-value");

    service.saveDsr({
        sheetUrlOrId: "1AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890",
        tabName: "KLBS_Daily_Data", webAppUrl: "https://script.google.com/macros/s/test-id/exec",
        secret: "dsr-test-value", automaticSync: true
    });
    const dsrPublic = service.getConfigurationDetails().dsr;
    assert.strictEqual(dsrPublic.configured, true);
    assert(!Object.prototype.hasOwnProperty.call(dsrPublic, "secret"));
    assert(!fs.readFileSync(storagePath, "utf8").includes("dsr-test-value"));
    assert.strictEqual(service.resolveDsrRuntime().secret, "dsr-test-value");
    decryptionEnabled = false;
    assert.throws(() => service.resolveEmailRuntime(), /cannot be decrypted safely/);
    assert.throws(() => service.resolveDsrRuntime(), /cannot be decrypted safely/);
    decryptionEnabled = true;

    const environmentService = createIntegrationConfigService({
        safeStorage, storagePath: path.join(temporary, "environment.json"),
        environment: {
            SMTP_USER: "env@example.com", SMTP_PASSWORD: "environment-mail-value",
            SMTP_FROM: "env@example.com", DAY_CLOSING_EMAIL: "backup@example.com",
            KLBS_DSR_WEB_APP_URL: "https://script.google.com/macros/s/env/exec",
            KLBS_DSR_SYNC_SECRET: "environment-dsr-value"
        }
    });
    assert.strictEqual(environmentService.getPublicConfig().email.source, "ENVIRONMENT");
    assert.strictEqual(environmentService.getPublicConfig().dsr.source, "ENVIRONMENT");
    assert.strictEqual(environmentService.resolveEmailRuntime().password, "environment-mail-value");
    assert.strictEqual(environmentService.resolveDsrRuntime().secret, "environment-dsr-value");
    environmentService.saveDsr({
        sheetUrlOrId: "1AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890", tabName: "KLBS_Daily_Data",
        webAppUrl: "https://script.google.com/macros/s/stored/exec",
        secret: "stored-dsr-value", automaticSync: true
    });
    assert.strictEqual(environmentService.getConfigurationDetails().dsr.source, "KLBS");
    assert.strictEqual(environmentService.resolveDsrRuntime().endpoint, "https://script.google.com/macros/s/stored/exec");

    const migrationPath = path.join(temporary, "migration.json");
    const migrationService = createIntegrationConfigService({
        safeStorage, storagePath: migrationPath,
        environment: { DAY_CLOSING_EMAIL: "backup@example.com" }
    });
    assert.strictEqual(migrationService.migrateLegacyEmail({
        smtp_host: "smtp.legacy.example", smtp_port: 465, smtp_secure: 1,
        smtp_user: "legacy@example.com", smtp_password: "legacy-mail-value",
        smtp_from: "legacy@example.com"
    }).migrated, true);
    assert(!fs.readFileSync(migrationPath, "utf8").includes("legacy-mail-value"));
    assert.strictEqual(migrationService.resolveEmailRuntime().password, "legacy-mail-value");

    const nodemailer = require("nodemailer");
    const originalCreateTransport = nodemailer.createTransport;
    let transportOptions = null;
    let sentMessage = null;
    nodemailer.createTransport = options => {
        transportOptions = options;
        return {
            verify: async () => true,
            sendMail: async message => { sentMessage = message; return { messageId: "mock-message" }; }
        };
    };
    const emailService = require("../src/services/emailService");
    emailService.setIntegrationConfigService(migrationService);
    assert.strictEqual((await emailService.verifyEmailConnection()).success, true);
    assert.strictEqual(transportOptions.auth.pass, "legacy-mail-value");
    assert.strictEqual((await emailService.sendTestEmail("backup@example.com")).success, true);
    assert.strictEqual(sentMessage.to, "backup@example.com");
    assert(!JSON.stringify(sentMessage).includes("legacy-mail-value"));
    nodemailer.createTransport = originalCreateTransport;

    let testEnvelope = null;
    const dsrTest = createDsrSyncService({
        now: () => new Date("2026-09-01T15:20:12.000Z"),
        configProvider: () => ({ endpoint: "https://script.google.com/macros/s/test/exec", secret: "test-secret" }),
        httpClient: { post: async (url, body) => {
            testEnvelope = body;
            return { data: { success: true, action: "TEST_CONNECTION", status: "SUCCESS" } };
        }}
    });
    assert.strictEqual((await dsrTest.testConnection("1.0.0")).success, true);
    assert.deepStrictEqual(Object.keys(testEnvelope).sort(), ["action", "appVersion", "signature", "timestamp"]);
    assert.strictEqual(testEnvelope.action, "TEST_CONNECTION");
    assert.strictEqual(testEnvelope.signature, signTestRequest(testEnvelope.timestamp, "test-secret"));
    assert(!Object.prototype.hasOwnProperty.call(testEnvelope, "payload"));
    const invalidDsrTest = createDsrSyncService({
        configProvider: () => ({ endpoint: "https://script.google.com/macros/s/test/exec", secret: "test-secret" }),
        httpClient: { post: async () => ({ data: { ok: true, action: "INSERTED" } }) }
    });
    assert.strictEqual((await invalidDsrTest.testConnection("1.0.0")).success, false);

    assert.strictEqual(AUTHORIZATION_POLICY.INTEGRATION_EMAIL_SETTINGS, "ADMINISTRATOR");
    assert.strictEqual(AUTHORIZATION_POLICY.INTEGRATION_DSR_SETTINGS, "ADMINISTRATOR");
    const root = path.resolve(__dirname, "..");
    const preload = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");
    const main = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
    const ui = fs.readFileSync(path.join(root, "src/renderer/modules/system/integrations.js"), "utf8");
    const dayClosing = fs.readFileSync(path.join(root, "src/database/dayClosingService.js"), "utf8");
    const appsScript = fs.readFileSync(path.join(root, "deployment/google-apps-script/KLBS_DSR_WebApp.gs"), "utf8");
    const backupUi = fs.readFileSync(path.join(root, "src/renderer/modules/system/backup.js"), "utf8");
    assert(!/get.*secret|get.*password/i.test(preload));
    assert(main.includes('requireIntegrationSession(grant, "INTEGRATION_EMAIL_SETTINGS")'));
    assert(main.includes('requireIntegrationSession(grant, "INTEGRATION_DSR_SETTINGS")'));
    assert(ui.includes("KLBS_Test"));
    assert(!ui.includes("Automatic Email Backup"));
    assert(!ui.includes("Automatic DSR Sync"));
    assert(!ui.includes("Google password"));
    assert(!backupUi.includes('id="testEmailCard"'));
    assert(appsScript.includes("appendConnectionTest_"));
    assert(appsScript.includes("KLBS_Test"));
    assert(dayClosing.indexOf("createBackupFn()") < dayClosing.indexOf("getEmailConfiguration()"));
    console.log("R10.5 external integrations focused tests: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
