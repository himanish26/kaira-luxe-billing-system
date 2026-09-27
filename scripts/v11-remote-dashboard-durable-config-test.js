const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createIntegrationConfigService } = require("../src/services/integrationConfigService");
const packageJson = require("../package.json");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-v11-remote-config-"));
const storagePath = path.join(temporary, "integration-config.json");
let decryptable = true;
let encryptionAvailable = true;
const safeStorage = {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: value => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: value => {
        if (!decryptable) throw new Error("synthetic decrypt failure");
        return value.toString("utf8").replace(/^encrypted:/, "");
    }
};
const environment = {
    KLBS_REMOTE_DASHBOARD_WEB_APP_BASE: "https://env-script.example/exec",
    KLBS_REMOTE_DASHBOARD_GATEWAY_BASE: "https://env-gateway.example",
    KLBS_INSTALLATION_SECRET: "synthetic-environment-secret"
};

function makeService() {
    return createIntegrationConfigService({ safeStorage, storagePath, environment });
}

async function main() {
    const provisionerSource = fs.readFileSync(path.join(__dirname, "provision-remote-dashboard.js"), "utf8");
    const mainSource = fs.readFileSync(path.join(__dirname, "../src/main/main.js"), "utf8");
    assert.strictEqual(packageJson.productName, "KAIRA LUXE BILLING SYSTEM");
    assert(mainSource.includes('app.getPath("userData")'));
    assert(provisionerSource.includes("app.setName(productName)"));
    assert(provisionerSource.indexOf("app.setName(productName)") < provisionerSource.indexOf('app.getPath("userData")'));
    const initial = makeService();
    assert.deepStrictEqual(initial.resolveRemoteDashboardRuntime(), {
        webAppBase: environment.KLBS_REMOTE_DASHBOARD_WEB_APP_BASE,
        gatewayBase: environment.KLBS_REMOTE_DASHBOARD_GATEWAY_BASE,
        secret: environment.KLBS_INSTALLATION_SECRET,
        enabled: true
    });
    const durableSecret = "synthetic-durable-secret";
    const preservedStore = {
        version: 1,
        email: { smtpHost: "smtp.example", secret: "encrypted-email", recipients: ["ops@example"] },
        dsr: { webAppUrl: "https://script.google.com/macros/s/test/exec", secret: "encrypted-dsr" },
        diagnostics: { email: { lastTestResult: "SUCCESS" } }
    };
    fs.writeFileSync(storagePath, JSON.stringify(preservedStore));
    initial.saveRemoteDashboard({
        webAppBase: "https://durable-script.example/exec",
        gatewayBase: "https://durable-gateway.example/base",
        enabled: true,
        secret: durableSecret
    });
    const persisted = fs.readFileSync(storagePath, "utf8");
    assert(!persisted.includes(durableSecret));
    assert.match(JSON.parse(persisted).remoteDashboard.secret, /^[A-Za-z0-9+/]+=*$/);
    assert.deepStrictEqual(makeService().resolveRemoteDashboardRuntime(), {
        webAppBase: "https://durable-script.example/exec",
        gatewayBase: "https://durable-gateway.example/base",
        secret: durableSecret,
        enabled: true
    });
    const afterProvision = JSON.parse(fs.readFileSync(storagePath, "utf8"));
    assert.deepStrictEqual(afterProvision.email, preservedStore.email);
    assert.deepStrictEqual(afterProvision.dsr, preservedStore.dsr);
    assert.deepStrictEqual(afterProvision.diagnostics, preservedStore.diagnostics);
    assert(!JSON.stringify(makeService().getPublicConfig()).includes(durableSecret));
    const knownGood = persisted;
    assert.throws(() => initial.saveRemoteDashboard({ webAppBase: "http://unsafe.example", gatewayBase: "https://gateway.example", enabled: true, secret: "synthetic-rejected" }), /HTTPS/);
    assert.throws(() => initial.saveRemoteDashboard({ webAppBase: "https://script.example", gatewayBase: "not-a-url", enabled: true, secret: "synthetic-rejected" }), /HTTPS/);
    assert.strictEqual(fs.readFileSync(storagePath, "utf8"), knownGood);
    const originalRename = fs.renameSync;
    fs.renameSync = () => { throw new Error("synthetic write failure"); };
    assert.throws(() => initial.saveRemoteDashboard({ webAppBase: "https://write-script.example", gatewayBase: "https://write-gateway.example", enabled: true, secret: "synthetic-write-failure" }), /synthetic write failure/);
    fs.renameSync = originalRename;
    assert.strictEqual(fs.readFileSync(storagePath, "utf8"), knownGood);
    encryptionAvailable = false;
    assert.throws(() => initial.saveRemoteDashboard({ webAppBase: "https://new-script.example", gatewayBase: "https://new-gateway.example", enabled: false, secret: "synthetic-rejected" }), /secure credential storage/);
    assert.strictEqual(fs.readFileSync(storagePath, "utf8"), knownGood);
    encryptionAvailable = true;
    decryptable = false;
    assert.throws(() => makeService().resolveRemoteDashboardRuntime(), /cannot be decrypted safely/);
    decryptable = true;
    fs.writeFileSync(storagePath, JSON.stringify({ version: 1 }));
    assert.deepStrictEqual(makeService().resolveRemoteDashboardRuntime(), {
        webAppBase: environment.KLBS_REMOTE_DASHBOARD_WEB_APP_BASE,
        gatewayBase: environment.KLBS_REMOTE_DASHBOARD_GATEWAY_BASE,
        secret: environment.KLBS_INSTALLATION_SECRET,
        enabled: true
    });
    fs.rmSync(temporary, { recursive: true, force: true });
    console.log("Remote Dashboard durable configuration tests: PASS (19 assertions)");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
