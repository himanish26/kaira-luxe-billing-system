const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
    createIntegrationConfigService,
    validateRemoteDashboardBaseUrl
} = require("../src/services/integrationConfigService");
const {
    createRemoteDashboardService
} = require("../src/services/remoteDashboardService");
const {
    remoteDashboardSettingsEvent,
    remoteDashboardSecretEvent,
    remoteDashboardClearEvent,
    connectionEvent
} = require("../src/services/integrationActivityService");
const { AUTHORIZATION_POLICY } = require("../src/services/administratorSecurityService");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-r10-5c-"));
const storagePath = path.join(temporary, "integration-config.json");
const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`windows-safe-storage:${value}`, "utf8"),
    decryptString: value => value.toString("utf8").replace(/^windows-safe-storage:/, "")
};

function assertNoSecret(value, secret) {
    assert(!JSON.stringify(value).includes(secret));
}

async function main() {
    assert.throws(() => validateRemoteDashboardBaseUrl("http://gateway.example", "Gateway"), /HTTPS/);
    assert.throws(() => validateRemoteDashboardBaseUrl("https://user:pass@gateway.example", "Gateway"), /HTTPS/);
    assert.strictEqual(validateRemoteDashboardBaseUrl("https://gateway.example/", "Gateway"), "https://gateway.example/");

    const service = createIntegrationConfigService({
        safeStorage,
        storagePath,
        environment: {},
        now: () => new Date("2026-09-29T18:00:00.000Z")
    });
    service.saveEmail({
        accountName: "Mail", senderEmail: "sender@example.com", smtpHost: "smtp.example.com",
        smtpPort: 587, securityMode: "STARTTLS", smtpUsername: "sender@example.com",
        password: "email-secret", recipients: ["backup@example.com"]
    });
    service.saveDsr({
        sheetUrlOrId: "1AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890",
        tabName: "KLBS_Daily_Data", webAppUrl: "https://script.google.com/macros/s/test/exec",
        secret: "dsr-secret"
    });
    assert.throws(() => service.saveRemoteDashboard({
        webAppBase: "https://script.google.com/macros/s/test/exec",
        gatewayBase: "https://gateway.example/", enabled: true
    }), /installation secret is required/);

    const first = service.saveRemoteDashboard({
        webAppBase: "https://script.google.com/macros/s/test/exec",
        gatewayBase: "https://gateway.example/", enabled: true, secret: "remote-secret"
    });
    assert.strictEqual(first.configurationAction, "CONFIGURED");
    assert.strictEqual(first.secretAction, "CONFIGURED");
    assert.strictEqual(first.secretConfigured, true);
    assertNoSecret(first, "remote-secret");
    const firstStore = JSON.parse(fs.readFileSync(storagePath, "utf8"));
    assert(firstStore.remoteDashboard.secret);
    assert(!fs.readFileSync(storagePath, "utf8").includes("remote-secret"));
    assert(!Object.prototype.hasOwnProperty.call(service.getConfigurationDetails().remoteDashboard, "secret"));
    assert.strictEqual(service.resolveRemoteDashboardRuntime().secret, "remote-secret");
    assert.strictEqual(service.getConfigurationDetails().email.configured, true);
    assert.strictEqual(service.getConfigurationDetails().dsr.configured, true);

    const preserved = service.saveRemoteDashboard({
        webAppBase: "https://script.google.com/macros/s/changed/exec",
        gatewayBase: "https://gateway.example/v2", enabled: true, secret: "", replaceSecret: false
    });
    assert.strictEqual(preserved.secretAction, "PRESERVED");
    assert.strictEqual(service.resolveRemoteDashboardRuntime().secret, "remote-secret");
    const preservedStore = JSON.parse(fs.readFileSync(storagePath, "utf8"));
    assert.strictEqual(preservedStore.remoteDashboard.secret, firstStore.remoteDashboard.secret);

    assert.throws(() => service.saveRemoteDashboard({
        webAppBase: "https://script.google.com/macros/s/changed/exec",
        gatewayBase: "https://gateway.example/v2", enabled: true, secret: "", replaceSecret: true
    }), /installation secret is required/);
    assert.strictEqual(service.resolveRemoteDashboardRuntime().secret, "remote-secret");
    const replaced = service.saveRemoteDashboard({
        webAppBase: "https://script.google.com/macros/s/changed/exec",
        gatewayBase: "https://gateway.example/v2", enabled: true, secret: "remote-secret-2", replaceSecret: true
    });
    assert.strictEqual(replaced.secretAction, "REPLACED");
    assert.strictEqual(service.resolveRemoteDashboardRuntime().secret, "remote-secret-2");
    assertNoSecret(service.getPublicConfig(), "remote-secret-2");

    service.recordTest("remoteDashboard", true);
    assert.strictEqual(service.getPublicConfig().remoteDashboard.lastTestResult, "SUCCESS");

    const posted = [];
    const database = {
        get(sql, params, callback) {
            if (sql.includes("FROM bills WHERE bill_date")) return callback(null, { sales: 0, bills: 0, qty: 0, cash: 0, upi: 0, card: 0 });
            if (sql.includes("substr(bill_date")) return callback(null, { sales: 0, bills: 0, qty: 0 });
            callback(null, null);
        },
        all(sql, params, callback) { callback(null, []); },
        run(sql, params, callback) { callback.call({ lastID: 0, changes: 0 }, null); }
    };
    const runtime = createRemoteDashboardService({
        database,
        configProvider: () => service.resolveRemoteDashboardRuntime(),
        now: () => new Date("2026-09-29T18:00:00.000Z"),
        post: async (url, body) => { posted.push({ url, body }); return { status: 200, data: { code: "ACCEPTED" } }; }
    });
    const connection = await runtime.testConnection();
    assert.strictEqual(connection.success, true);
    assert.strictEqual(posted.length, 1);
    assert.strictEqual(posted[0].url, "https://script.google.com/macros/s/changed/exec");
    assert.strictEqual(posted[0].body.context, "/snapshot");
    assert(!JSON.stringify(posted[0]).includes("remote-secret-2"));

    const events = [
        remoteDashboardSettingsEvent({ configurationAction: "CONFIGURED" }),
        remoteDashboardSecretEvent({ secretAction: "REPLACED" }),
        connectionEvent("remoteDashboard", { success: true }),
        connectionEvent("remoteDashboard", { success: false, error: "secret=remote-secret-2" }),
        remoteDashboardClearEvent()
    ];
    assert.deepStrictEqual(events.map(event => event.action), [
        "REMOTE_DASHBOARD_SETTINGS_CONFIGURED",
        "REMOTE_DASHBOARD_SECRET_REPLACED",
        "REMOTE_DASHBOARD_CONNECTION_TEST_SUCCESS",
        "REMOTE_DASHBOARD_CONNECTION_TEST_FAILED",
        "REMOTE_DASHBOARD_CONFIGURATION_CLEARED"
    ]);
    assertNoSecret(events, "remote-secret-2");
    assert.strictEqual(AUTHORIZATION_POLICY.INTEGRATION_REMOTE_DASHBOARD_SETTINGS, "ADMINISTRATOR");

    const cleared = service.clearRemoteDashboard();
    assert.strictEqual(cleared.configured, false);
    assert.strictEqual(service.getConfigurationDetails().email.configured, true);
    assert.strictEqual(service.getConfigurationDetails().dsr.configured, true);

    const ui = fs.readFileSync(path.join(root, "src/renderer/modules/system/integrations.js"), "utf8");
    const css = fs.readFileSync(path.join(root, "src/renderer/styles/settings.css"), "utf8");
    const preload = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");
    const mainSource = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
    const appSource = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
    assert(ui.includes("REMOTE DASHBOARD") && ui.includes("configureRemoteDashboardIntegration"));
    assert(css.includes(".integration-card .dashboard-btn"));
    assert(css.includes("width:100%; max-width:360px; box-sizing:border-box"));
    assert(!css.includes(".integration-summary-grid .dashboard-btn"));
    assert(!ui.includes('remote.lastTestAt ? integrationTime(remote.lastTestAt) + " &middot; "'));
    assert(ui.includes('remote.lastTestAt ? integrationTime(remote.lastTestAt) + " · "'));
    assert(ui.includes('const savedRemote = await window.electronAPI.getIntegrationDetails("remoteDashboard", freshGrant);'));
    assert(ui.includes('showRemoteDashboardForm(savedRemote, freshGrant);'));
    const clearHandlerStart = ui.indexOf('document.getElementById("clearRemoteDashboard").onclick = async () => {');
    const clearHandlerEnd = ui.indexOf('document.getElementById("cancel").onclick = leaveIntegrationConfiguration;', clearHandlerStart);
    assert(clearHandlerStart >= 0 && clearHandlerEnd > clearHandlerStart, "clear handler is identifiable for regression assertions");
    const clearHandler = ui.slice(clearHandlerStart, clearHandlerEnd);
    assert(clearHandler.includes("await showNativeConfirm("), "clear uses the existing asynchronous native confirmation");
    assert(!/\bconfirm\s*\(/.test(clearHandler), "clear must not invoke a synchronous browser confirmation");
    assert(clearHandler.indexOf("if (!confirmed) return;") < clearHandler.indexOf("requestFreshIntegrationGrant"), "Cancel exits before authorization or clearing");
    assert(clearHandler.includes('await window.electronAPI.clearRemoteDashboardIntegration(freshGrant)'));
    assert(clearHandler.includes('getIntegrationDetails("remoteDashboard", freshGrant)'));
    assert(clearHandler.includes('showRemoteDashboardForm(clearedRemote, freshGrant);'), "cleared settings are re-rendered on the detail page");
    assert(clearHandler.includes('"Remote Dashboard configuration cleared."'));
    assert(!clearHandler.includes("showSystemHealthPage()"), "successful clear must remain on the detail page");
    assert(ui.includes('value="${integrationEscape(remote.webAppBase)}"') && ui.includes('value="${integrationEscape(remote.gatewayBase)}"'));
    assert(ui.includes('secretControl("remoteDashboard", remote.secretConfigured)'));
    assert(ui.includes('remote.identity || { merchant: "KAIRA_LUXE", store: "KL001", terminal: "POS01" }'));
    assert(appSource.includes("function showNativeConfirm(message, preferredFocusTarget = null)"));
    assert(appSource.includes("window.electronAPI.onNativeDialogClosed(restoreRendererFocusAfterNativeDialog)"));
    assert(appSource.includes("const modalControl = firstUsableControlWithinVisibleModal()"));
    assert(appSource.includes("adminPin.focus()") && appSource.includes('"Administrator Access"'));
    assert(/showMessageBox:\s*\(options\)\s*=>\s*ipcRenderer\.invoke\(\s*"dialog:showMessageBox"/.test(preload));
    assert(/onNativeDialogClosed:\s*callback\s*=>\s*ipcRenderer\.on\("dialog:native-closed"/.test(preload));
    assert(mainSource.includes("restoreWindowAfterNativeDialog(window)"));
    assert(mainSource.includes("dialog.showMessageBox(request.owner, request.options)"));
    assert(mainSource.includes('window.webContents.send("dialog:native-closed")'));
    assert(!ui.includes('setTimeout(() => showSystemHealthPage(), 350)'));
    assert(ui.includes('type="password"') && ui.includes("replaceSecret") && ui.includes("clearRemoteDashboard"));
    assert(preload.includes("saveRemoteDashboardIntegration") && preload.includes("testRemoteDashboardIntegration"));
    assert(mainSource.includes('requireIntegrationSession(grant, "INTEGRATION_REMOTE_DASHBOARD_SETTINGS")'));
    assert(!mainSource.includes("console.log(data.secret)"));

    runtime.stop();
    fs.rmSync(temporary, { recursive: true, force: true });
    console.log("R10.5C Remote Dashboard settings focused tests: PASS (configuration, security, authorization, UI contract, business-neutral test, activity events)");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
