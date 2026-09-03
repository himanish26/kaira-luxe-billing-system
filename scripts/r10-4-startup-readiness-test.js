const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const sqlite3 = require("sqlite3").verbose();
const { hashCredential, verifyCredential } = require("../src/services/credentialCrypto");
const { createAdministratorSecurityService } = require("../src/services/administratorSecurityService");

const root = path.resolve(__dirname, "..");
let productMode = "zero";
const startupDb = {
    get(sql, params, callback) { callback(null, { ok: 1 }); },
    all(sql, params, callback) {
        if (sql.includes("sqlite_master")) {
            callback(null, productMode === "schemaFailure" ? [{ name: "products" }] : [
                { name: "products" }, { name: "inventory_transactions" }
            ]);
            return;
        }
        if (sql.includes("COUNT(*) AS product_count")) {
            callback(null, [{ product_count: productMode === "present" ? 198 : 0 }]);
            return;
        }
        if (sql.includes("PRAGMA integrity_check")) callback(null, [{ integrity_check: "ok" }]);
        else callback(null, []);
    }
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "../database/database" && parent && parent.filename.endsWith("statusService.js")) {
        return startupDb;
    }
    if (request === "../services/backupService" && parent && parent.filename.endsWith("statusService.js")) {
        return { getBackupHistory: async () => [] };
    }
    if (request === "../database/settingsService" && parent && parent.filename.endsWith("statusService.js")) {
        return { getSettings: async () => ({ default_printer: null }) };
    }
    if (request === "electron" && parent && parent.filename.endsWith("statusService.js")) {
        return { BrowserWindow: { getAllWindows: () => [] } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const { getStartupCheck } = require("../src/main/statusService");
Module._load = originalLoad;

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, error => error ? reject(error) : resolve());
});
const get = (db, sql) => new Promise((resolve, reject) => {
    db.get(sql, (error, row) => error ? reject(error) : resolve(row));
});

async function main() {
    productMode = "zero";
    const zero = await getStartupCheck("productInventory", {});
    assert.strictEqual(zero.state, "warning");
    assert.strictEqual(zero.productCount, 0);
    assert(zero.message.includes("import products from Inventory to start billing"));

    productMode = "present";
    const present = await getStartupCheck("productInventory", {});
    assert.strictEqual(present.state, "ready");
    assert.strictEqual(present.productCount, 198);

    productMode = "schemaFailure";
    const failed = await getStartupCheck("productInventory", {});
    assert.strictEqual(failed.state, "failed");
    assert(!failed.message.toLowerCase().includes("no products"));

    const openDay = await getStartupCheck("businessDay", {
        getBusinessDayState: async () => ({ closed: false, closing: false, businessDate: "2026-09-01" })
    });
    const closedDay = await getStartupCheck("businessDay", {
        getBusinessDayState: async () => ({ closed: true, closing: false, businessDate: "2026-09-01" })
    });
    assert.strictEqual(openDay.state, "ready");
    assert.strictEqual(closedDay.state, "failed");

    const database = new sqlite3.Database(":memory:");
    await run(database, `CREATE TABLE settings (
        id INTEGER PRIMARY KEY, ff_pin TEXT, admin_pin_hash TEXT,
        admin_security_initialized INTEGER NOT NULL DEFAULT 0,
        manager_pin_hash TEXT, manager_security_initialized INTEGER NOT NULL DEFAULT 0
    )`);
    await run(database, "INSERT INTO settings (id) VALUES (1)");
    const events = [];
    const security = createAdministratorSecurityService(database, {
        masterVerifier: await hashCredential("654321"),
        logEvent: async event => events.push(event)
    });
    const uninitialized = await getStartupCheck("administratorSecurity", {
        getAdministratorSecurityStatus: () => security.getStatus()
    });
    assert.strictEqual(uninitialized.state, "failed");
    assert.strictEqual(uninitialized.action, "completeSecuritySetup");
    assert.strictEqual(uninitialized.administratorPinConfigured, false);
    assert.strictEqual(uninitialized.managerPinConfigured, false);

    const beforeCancel = await security.getStatus();
    assert.strictEqual(beforeCancel.initialized, false);
    const wrong = await security.recoverPin({ masterPin: "000000", newPin: "2468", confirmPin: "2468" });
    assert.strictEqual(wrong.success, false);
    assert.strictEqual((await security.getStatus()).initialized, false);
    const initialized = await security.recoverPin({
        masterPin: "654321", newPin: "2468", confirmPin: "2468"
    });
    assert.strictEqual(initialized.success, true);
    const stored = await get(database, "SELECT * FROM settings WHERE id = 1");
    assert(await verifyCredential("2468", stored.admin_pin_hash));
    assert.strictEqual(await verifyCredential("654321", stored.admin_pin_hash), false);
    assert.strictEqual(stored.manager_pin_hash, null);
    const managerMissing = await getStartupCheck("administratorSecurity", {
        getAdministratorSecurityStatus: () => security.getStatus()
    });
    assert.strictEqual(managerMissing.state, "failed");
    assert.strictEqual(managerMissing.administratorPinConfigured, true);
    assert.strictEqual(managerMissing.managerPinConfigured, false);
    const managerInitialized = await security.recoverManagerPin({
        masterPin: "654321", newPin: "1357", confirmPin: "1357"
    });
    assert.strictEqual(managerInitialized.success, true);
    const ready = await getStartupCheck("administratorSecurity", {
        getAdministratorSecurityStatus: () => security.getStatus()
    });
    assert.strictEqual(ready.state, "ready");
    assert(events.some(event => event.action === "MASTER_RECOVERY_FAILED"));
    assert(events.some(event => event.action === "ADMIN_SECURITY_INITIALIZED"));

    const setupDatabase = new sqlite3.Database(":memory:");
    await run(setupDatabase, `CREATE TABLE settings (
        id INTEGER PRIMARY KEY, ff_pin TEXT, admin_pin_hash TEXT,
        admin_security_initialized INTEGER NOT NULL DEFAULT 0,
        manager_pin_hash TEXT, manager_security_initialized INTEGER NOT NULL DEFAULT 0
    )`);
    await run(setupDatabase, "INSERT INTO settings (id) VALUES (1)");
    let setupNow = 1000;
    const setupSecurity = createAdministratorSecurityService(setupDatabase, {
        masterVerifier: await hashCredential("654321"),
        grantTtlMs: 100,
        now: () => setupNow,
        logEvent: async () => {}
    });
    const setupAuthorization = await setupSecurity.beginStartupSetup("654321");
    assert.strictEqual(setupAuthorization.success, true);
    assert.strictEqual((await setupSecurity.configureMissingAdministratorPin({
        setupToken: setupAuthorization.setupToken, newPin: "2468", confirmPin: "2468"
    })).success, true);
    assert.strictEqual((await setupSecurity.configureMissingManagerPin({
        setupToken: setupAuthorization.setupToken, newPin: "1357", confirmPin: "1357"
    })).success, true);
    assert.strictEqual((await setupSecurity.configureMissingManagerPin({
        setupToken: setupAuthorization.setupToken, newPin: "9999", confirmPin: "9999"
    })).success, false);
    const completedSetup = await get(setupDatabase, "SELECT * FROM settings WHERE id = 1");
    assert(await verifyCredential("2468", completedSetup.admin_pin_hash));
    assert(await verifyCredential("1357", completedSetup.manager_pin_hash));

    await run(setupDatabase, `UPDATE settings SET
        admin_pin_hash = NULL, admin_security_initialized = 0,
        manager_pin_hash = NULL, manager_security_initialized = 0 WHERE id = 1`);
    const expiringAuthorization = await setupSecurity.beginStartupSetup("654321");
    setupNow += 101;
    assert.strictEqual((await setupSecurity.configureMissingAdministratorPin({
        setupToken: expiringAuthorization.setupToken, newPin: "2468", confirmPin: "2468"
    })).success, false);

    const splash = fs.readFileSync(path.join(root, "src/renderer/startupSplash.js"), "utf8");
    const splashHtml = fs.readFileSync(path.join(root, "src/renderer/startupSplash.html"), "utf8");
    const mainSource = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
    const preload = fs.readFileSync(path.join(root, "src/main/startupPreload.js"), "utf8");
    assert(splash.includes("securityIncomplete"));
    assert(splash.includes("openSecuritySetup"));
    assert(splash.includes("await runChecks()"));
    assert(splashHtml.includes("COMPLETE SECURITY SETUP"));
    assert(!splashHtml.includes("IMPORT PRODUCTS"));
    assert(!splash.includes("importProducts"));
    assert(!preload.includes("import-products"));
    assert(mainSource.includes('ipcMain.handle("startup:open-security-setup"'));
    assert(mainSource.includes("status.initialized && status.managerPinConfigured"));
    assert(mainSource.includes("readinessChecks.some"));
    assert(mainSource.includes('authorizePin(pin, "DAY_REOPEN")'));

    await new Promise(resolve => database.close(resolve));
    await new Promise(resolve => setupDatabase.close(resolve));
    console.log("R10.4 startup readiness/recovery focused tests: PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
