const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const { createIntegrationConfigService } = require("../src/services/integrationConfigService");
const {
    recordIntegrationActivity, emailSettingsEvent, dsrSettingsEvent,
    connectionEvent, emailTestMessageEvent, safeFailure
} = require("../src/services/integrationActivityService");
const { AUTHORIZATION_POLICY } = require("../src/services/administratorSecurityService");

const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`protected:${value}`),
    decryptString: value => value.toString().replace(/^protected:/, "")
};

async function main() {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-r10-5b-"));
    const storagePath = path.join(temporary, "integration-config.json");
    const instant = new Date("2026-09-01T16:20:00.000Z");
    const service = createIntegrationConfigService({
        safeStorage, storagePath, now: () => instant,
        environment: {
            SMTP_USER: "mail@example.com", SMTP_PASSWORD: "email-secret-value",
            SMTP_FROM: "mail@example.com", DAY_CLOSING_EMAIL: "backup@example.com",
            KLBS_DSR_WEB_APP_URL: "https://script.google.com/macros/s/test/exec",
            KLBS_DSR_SYNC_SECRET: "dsr-secret-value"
        }
    });

    assert.strictEqual(service.getPublicConfig().dsr.source, "ENVIRONMENT");
    service.recordTest("dsr", true);
    assert.strictEqual(service.getPublicConfig().dsr.lastTestAt, instant.toISOString());
    assert.strictEqual(service.getPublicConfig().dsr.lastTestResult, "SUCCESS");
    service.recordTest("dsr", false);
    assert.strictEqual(service.getPublicConfig().dsr.lastTestResult, "FAILED");
    service.recordTest("email", true);
    assert.strictEqual(service.getPublicConfig().email.lastTestResult, "SUCCESS");
    const persisted = fs.readFileSync(storagePath, "utf8");
    assert(!persisted.includes("email-secret-value"));
    assert(!persisted.includes("dsr-secret-value"));
    assert(!persisted.includes("script.google.com"));

    const captured = [];
    const write = event => recordIntegrationActivity(async activity => captured.push(activity), event);
    await write(emailSettingsEvent({ securityMode: "STARTTLS", recipients: ["a", "b"] }));
    await write(connectionEvent("email", { success: true }));
    await write(connectionEvent("email", { success: false, error: "AUTHENTICATION FAILED" }));
    await write(emailTestMessageEvent());
    await write(dsrSettingsEvent({ tabName: "KLBS_Daily_Data" }));
    await write(connectionEvent("dsr", { success: true }));
    await write(connectionEvent("dsr", { success: false, error: "secret=dsr-secret-value https://secret.example/path" }));
    assert.deepStrictEqual(captured.map(item => item.action), [
        "EMAIL_SETTINGS_UPDATED", "EMAIL_CONNECTION_TEST_SUCCESS",
        "EMAIL_CONNECTION_TEST_FAILED", "EMAIL_TEST_MESSAGE_SENT",
        "DSR_SETTINGS_UPDATED", "DSR_CONNECTION_TEST_SUCCESS", "DSR_CONNECTION_TEST_FAILED"
    ]);
    assert(captured.every(item => item.category === "SETTINGS" && item.user_name === "ADMINISTRATOR"));
    const auditText = JSON.stringify(captured);
    assert(!auditText.includes("dsr-secret-value"));
    assert(!auditText.includes("secret.example"));
    assert(safeFailure("x".repeat(500)).length <= 120);
    assert(await recordIntegrationActivity(async () => { throw new Error("injected"); }, emailTestMessageEvent()));

    const uiSource = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/system/integrations.js"), "utf8");
    const context = { Intl, Date, Number, String };
    vm.createContext(context);
    vm.runInContext(uiSource, context);
    assert(/^01 Sep(?:t)? 2026  09:50 PM$/.test(context.integrationTime(instant.toISOString())));
    assert.strictEqual(context.integrationLabel("SUCCESS"), "Successful");
    assert(uiSource.includes("integration-button-primary\">SAVE CHANGES"));
    assert(uiSource.includes("integration-button-neutral\">CANCEL"));
    assert(uiSource.includes("integration-button-destructive\">REMOVE"));

    assert.strictEqual(AUTHORIZATION_POLICY.INTEGRATION_EMAIL_SETTINGS, "ADMINISTRATOR");
    assert.strictEqual(AUTHORIZATION_POLICY.INTEGRATION_DSR_SETTINGS, "ADMINISTRATOR");
    const mainSource = fs.readFileSync(path.join(__dirname, "../src/main/main.js"), "utf8");
    assert(mainSource.includes('requireIntegrationSession(grant, "INTEGRATION_EMAIL_SETTINGS")'));
    assert(mainSource.includes('requireIntegrationSession(grant, "INTEGRATION_DSR_SETTINGS")'));
    assert(!mainSource.includes('requireIntegrationSession(grant, "ADMINISTRATOR")'));

    fs.rmSync(temporary, { recursive: true, force: true });
    console.log("R10.5B integrations final polish focused tests: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
