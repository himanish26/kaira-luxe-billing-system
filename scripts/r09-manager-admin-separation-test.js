const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const sqlite3 = require("sqlite3").verbose();
const { hashCredential, verifyCredential } = require("../src/services/credentialCrypto");
const { migrateManagerSecurity } = require("../src/database/managerSecurityMigration");
const {
    createAdministratorSecurityService,
    AUTHORIZATION_LEVELS,
    AUTHORIZATION_POLICY,
    AUTHORIZATION_PURPOSES,
    ADMIN_PIN_AUDIT_POLICY
} = require("../src/services/administratorSecurityService");

const openMemory = () => new sqlite3.Database(":memory:");
const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(error) { error ? reject(error) : resolve(this); });
});
const get = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
});
const close = db => new Promise(resolve => db.close(resolve));

async function main() {
    const legacy = openMemory();
    await run(legacy, `
        CREATE TABLE settings (
            id INTEGER PRIMARY KEY, ff_pin TEXT,
            admin_pin_hash TEXT, admin_security_initialized INTEGER NOT NULL DEFAULT 0
        )
    `);
    const adminHash = await hashCredential("2468");
    await run(legacy, "INSERT INTO settings VALUES (1, '1357', ?, 1)", [adminHash]);
    await migrateManagerSecurity(legacy);
    await migrateManagerSecurity(legacy);
    const migrated = await get(legacy, "SELECT * FROM settings WHERE id = 1");
    assert.strictEqual(migrated.manager_pin_hash, null);
    assert.strictEqual(migrated.manager_security_initialized, 0);
    assert.strictEqual(migrated.admin_pin_hash, adminHash);
    assert.strictEqual(migrated.ff_pin, "1357");

    const setupEvents = [];
    const unconfigured = createAdministratorSecurityService(legacy, {
        logEvent: async event => setupEvents.push(event)
    });
    assert.strictEqual((await unconfigured.authorizePin("1357", "FF")).success, false);
    assert.strictEqual((await unconfigured.configureManagerPin(
        "1357", "1357", AUTHORIZATION_LEVELS.ADMINISTRATOR
    )).success, true);
    assert.strictEqual(setupEvents.at(-1).action, "MANAGER_PIN_CONFIGURED");
    assert.strictEqual(setupEvents.at(-1).user_name, "ADMINISTRATOR");
    const storedManager = await get(legacy, "SELECT manager_pin_hash FROM settings WHERE id = 1");
    assert(await verifyCredential("1357", storedManager.manager_pin_hash));
    assert.notStrictEqual(storedManager.manager_pin_hash, "1357");
    await migrateManagerSecurity(legacy);

    assert.deepStrictEqual(
        [...AUTHORIZATION_PURPOSES].sort(),
        Object.keys(AUTHORIZATION_POLICY).sort()
    );
    assert.deepStrictEqual(
        [...AUTHORIZATION_PURPOSES].sort(),
        Object.keys(ADMIN_PIN_AUDIT_POLICY).sort()
    );
    for (const purpose of ["FF", "GIFT_VOUCHER", "DAY_REOPEN"]) {
        assert.strictEqual(AUTHORIZATION_POLICY[purpose], AUTHORIZATION_LEVELS.MANAGER);
    }
    for (const purpose of [...AUTHORIZATION_PURPOSES].filter(purpose =>
        !["FF", "GIFT_VOUCHER", "DAY_REOPEN"].includes(purpose))) {
        assert.strictEqual(AUTHORIZATION_POLICY[purpose], AUTHORIZATION_LEVELS.ADMINISTRATOR);
    }

    let clock = 1000;
    const events = [];
    const masterVerifier = await hashCredential("654321");
    const security = createAdministratorSecurityService(legacy, {
        now: () => clock,
        grantTtlMs: 100,
        masterVerifier,
        logEvent: async event => events.push(JSON.parse(JSON.stringify(event)))
    });
    const status = await security.getStatus();
    assert.strictEqual(status.initialized, true);
    assert.strictEqual(status.managerPinConfigured, true);

    const managerGrant = await security.authorizePin("1357", "FF");
    assert.strictEqual(managerGrant.success, true);
    assert.strictEqual(security.consumeGrant(managerGrant.grant, "FF"), true);
    assert.strictEqual(security.consumeGrant(managerGrant.grant, "FF"), false);
    assert.strictEqual((await security.authorizePin("2468", "FF")).success, false);
    assert.strictEqual((await security.authorizePin("1357", "PRODUCT_IMPORT")).success, false);
    const adminGrant = await security.authorizePin("2468", "PRODUCT_IMPORT");
    assert.strictEqual(adminGrant.success, true);
    assert.strictEqual(security.consumeGrant(adminGrant.grant, "INVENTORY_RESET"), false);

    const expired = await security.authorizePin("1357", "DAY_REOPEN");
    clock += 101;
    assert.strictEqual(security.consumeGrant(expired.grant, "DAY_REOPEN"), false);
    assert.strictEqual((await security.authorizePin("1357", "UNKNOWN")).success, false);
    assert.strictEqual((await security.authorizePin("654321", "FF")).success, false);

    assert.strictEqual(
        (await security.configureManagerPin("9999", "9999", "MANAGER")).success,
        false
    );
    const changed = await security.configureManagerPin(
        "9999", "9999", AUTHORIZATION_LEVELS.ADMINISTRATOR
    );
    assert.strictEqual(changed.success, true);
    const afterChange = await get(legacy, "SELECT * FROM settings WHERE id = 1");
    assert(await verifyCredential("9999", afterChange.manager_pin_hash));
    assert(await verifyCredential("2468", afterChange.admin_pin_hash));
    assert.strictEqual((await security.authorizePin("1357", "FF")).success, false);
    assert.strictEqual((await security.authorizePin("9999", "FF")).success, true);

    const recovered = await security.recoverPin({
        masterPin: "654321", newPin: "8642", confirmPin: "8642"
    });
    assert.strictEqual(recovered.success, true);
    const afterRecovery = await get(legacy, "SELECT * FROM settings WHERE id = 1");
    assert(await verifyCredential("8642", afterRecovery.admin_pin_hash));
    assert(await verifyCredential("9999", afterRecovery.manager_pin_hash));
    assert.strictEqual(
        (await security.changePin("9999", "1122", "1122")).success,
        false
    );
    assert.strictEqual(
        (await security.changePin("8642", "1122", "1122")).success,
        true
    );

    const configuredEvent = events.find(event => event.action === "MANAGER_PIN_CHANGED");
    assert(configuredEvent);
    assert.strictEqual(configuredEvent.user_name, "ADMINISTRATOR");
    const deniedManager = events.find(event =>
        event.action === "PROTECTED_ACTION_DENIED" && event.user_name === "MANAGER"
    );
    assert(deniedManager);
    const serialized = JSON.stringify([...setupEvents, ...events]);
    for (const secret of ["1357", "2468", "9999", "654321", "8642"]) {
        assert(!serialized.includes(secret));
    }
    assert(!/(manager_pin_hash|admin_pin_hash|salt|verifier)/i.test(serialized));

    const root = path.resolve(__dirname, "..");
    const sources = {
        main: fs.readFileSync(path.join(root, "src/main/main.js"), "utf8"),
        renderer: fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8"),
        dayClosing: fs.readFileSync(path.join(root, "src/renderer/modules/system/dayClosing.js"), "utf8"),
        splash: fs.readFileSync(path.join(root, "src/renderer/startupSplash.js"), "utf8"),
        settings: fs.readFileSync(path.join(root, "src/database/settingsService.js"), "utf8")
    };
    assert(sources.renderer.includes('.authorizePin(enteredPin, purpose)'));
    assert(sources.renderer.includes('pinAuthorizationAction === "FF"'));
    assert(sources.dayClosing.includes('requestAdminAuthorization("DAY_REOPEN")'));
    assert(sources.main.includes('authorizePin(pin, "DAY_REOPEN")'));
    assert(sources.splash.includes("4-digit Manager PIN"));
    assert(sources.settings.includes("manager_pin_hash"));
    assert(sources.settings.includes("manager_security_initialized"));
    assert(sources.main.includes('"SUCCESS", "MANAGER"'));

    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "./database" && parent && parent.filename.endsWith("activityService.js")) {
            return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    const activityPath = path.join(root, "src/database/activityService.js");
    delete require.cache[require.resolve(activityPath)];
    const { normalizeActivity } = require(activityPath);
    Module._load = originalLoad;
    assert.strictEqual(normalizeActivity({
        category: "SECURITY", action: "MANAGER_AUTHORIZATION_TEST",
        details: "Manager actor accepted", user_name: "MANAGER", status: "SUCCESS"
    }, new Date("2026-09-01T00:00:00Z")).user_name, "MANAGER");

    await close(legacy);
    console.log("R09 Manager/Administrator privilege separation focused tests: PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
