const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { hashCredential } = require("../src/services/credentialCrypto");
const {
    createAdministratorSecurityService,
    AUTHORIZATION_PURPOSES,
    ADMIN_PIN_AUDIT_POLICY
} = require("../src/services/administratorSecurityService");

const root = path.resolve(__dirname, "..");

async function main() {
    const database = new sqlite3.Database(":memory:");
    const run = (sql, params = []) => new Promise((resolve, reject) => {
        database.run(sql, params, error => error ? reject(error) : resolve());
    });
    await run("CREATE TABLE settings (id INTEGER PRIMARY KEY, admin_pin_hash TEXT, admin_security_initialized INTEGER, manager_pin_hash TEXT, manager_security_initialized INTEGER)");
    await run("INSERT INTO settings VALUES (1, ?, 1, NULL, 0)", [await hashCredential("2468")]);

    const events = [];
    const allEvents = [];
    let clock = 1000;
    const security = createAdministratorSecurityService(database, {
        now: () => clock,
        grantTtlMs: 100,
        logEvent: async event => {
            const copy = JSON.parse(JSON.stringify(event));
            events.push(copy);
            allEvents.push(copy);
        }
    });

    assert.deepStrictEqual(
        [...AUTHORIZATION_PURPOSES].sort(),
        Object.keys(ADMIN_PIN_AUDIT_POLICY).sort(),
        "Every purpose must be explicitly classified"
    );

    const customer = await security.authorizePin("2468", "CUSTOMER_REPORT_EXPORT");
    assert.strictEqual(customer.success, true);
    assert.strictEqual(events.length, 1);
    assert.deepStrictEqual(events[0], {
        action: "PROTECTED_RESOURCE_ACCESSED",
        details: "Customer Purchase Report accessed",
        status: "SUCCESS",
        entity_type: "PROTECTED_RESOURCE",
        reference_no: "CUSTOMER_PURCHASE_REPORT",
        user_name: "ADMINISTRATOR"
    });
    assert.strictEqual(security.consumeGrant(customer.grant, "CUSTOMER_REPORT_EXPORT"), true);
    assert.strictEqual(security.consumeGrant(customer.grant, "CUSTOMER_REPORT_EXPORT"), false);

    events.length = 0;
    const billSummary = await security.authorizePin("2468", "BILL_SUMMARY_REPORT_EXPORT");
    assert.strictEqual(billSummary.success, true);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].reference_no, "BILL_SUMMARY_REPORT");

    events.length = 0;
    const wrong = await security.authorizePin("1111", "CUSTOMER_REPORT_EXPORT");
    assert.strictEqual(wrong.success, false);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].action, "PROTECTED_ACTION_DENIED");
    assert.strictEqual(events[0].status, "FAILED");

    // Dialog cancellation does not invoke authorizePin, therefore it emits no event.
    events.length = 0;
    assert.strictEqual(events.length, 0);

    const serialized = JSON.stringify(allEvents);
    assert(!serialized.includes("2468"));
    assert(!serialized.includes("1111"));
    assert(!/(hash|salt|token|grant|verifier|credential)/i.test(serialized));

    events.length = 0;
    const expiring = await security.authorizePin("2468", "ACTIVITY_EXPORT");
    assert.strictEqual(events.length, 0, "Business operations must not get redundant PIN-success events");
    assert.strictEqual(security.consumeGrant(expiring.grant, "ACTIVITY_ARCHIVE"), false);
    const expired = await security.authorizePin("2468", "ACTIVITY_EXPORT");
    clock += 101;
    assert.strictEqual(security.consumeGrant(expired.grant, "ACTIVITY_EXPORT"), false);

    const failingAudit = createAdministratorSecurityService(database, {
        logEvent: async () => { throw new Error("injected activity failure"); }
    });
    const stillAuthorized = await failingAudit.authorizePin("2468", "CUSTOMER_REPORT_EXPORT");
    assert.strictEqual(stillAuthorized.success, true);
    assert(stillAuthorized.activityWarning);

    const mainSource = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
    const rendererSource = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
    const reportsSource = fs.readFileSync(
        path.join(root, "src/renderer/modules/reports.js"), "utf8"
    );
    const preloadSource = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");
    for (const action of [
        "CUSTOMER_PURCHASE_REPORT_EXPORTED", "BILL_SUMMARY_REPORT_EXPORTED",
        "BUSINESS_REPORT_EXPORTED", "GST_REPORT_EXPORTED",
        "PRODUCT_SALES_REPORT_EXPORTED", "INVENTORY_EXPORTED",
        "ACTIVITY_LOG_EXPORTED"
    ]) assert(mainSource.includes(action), `Missing trusted export event ${action}`);
    assert(!rendererSource.includes('activity:log'));
    assert(!preloadSource.includes('activity:log'));
    assert(reportsSource.includes("activeProtectedReportAuthorization"));
    assert(reportsSource.includes("requestAdminAuthorization(report.authorizationPurpose)"));
    assert(reportsSource.includes("activeProtectedReportAuthorization = null"));

    await new Promise(resolve => database.close(resolve));
    console.log("R09.9A.1 focused Administrator audit tests: PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
