const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const { hashCredential } = require("../src/services/credentialCrypto");
const { createAdministratorSecurityService } = require("../src/services/administratorSecurityService");

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, error => error ? reject(error) : resolve());
});
const close = db => new Promise(resolve => db.close(resolve));

async function main() {
    const db = new sqlite3.Database(":memory:");
    await run(db, `CREATE TABLE settings (
        id INTEGER PRIMARY KEY, admin_pin_hash TEXT, admin_security_initialized INTEGER,
        manager_pin_hash TEXT, manager_security_initialized INTEGER
    )`);
    await run(db, "INSERT INTO settings VALUES (1, ?, 1, ?, 1)", [
        await hashCredential("2468"),
        await hashCredential("1357")
    ]);

    let clock = 1000;
    const security = createAdministratorSecurityService(db, {
        now: () => clock,
        logEvent: async () => null
    });

    // FF uses the production default of exactly 600,000 ms.
    const ff = await security.authorizePin("1357", "FF");
    assert.strictEqual(ff.success, true);
    assert.strictEqual(security.validateGrant(ff.grant, "FF"), true);
    clock += 599999;
    assert.strictEqual(security.validateGrant(ff.grant, "FF"), true, "FF must be valid immediately before 600 seconds");
    clock += 2;
    assert.strictEqual(security.validateGrant(ff.grant, "FF"), false, "FF must expire beyond 600 seconds");

    // A fresh FF grant remains valid after more than the old 60-second TTL.
    clock = 10000;
    const delayedFf = await security.authorizePin("1357", "FF");
    clock += 60001;
    assert.strictEqual(security.validateGrant(delayedFf.grant, "FF"), true, "FF must outlive the generic TTL");

    // Representative generic purposes remain on the 60,000 ms default.
    for (const [purpose, pin] of [
        ["DAY_REOPEN", "1357"],
        ["GIFT_VOUCHER", "1357"],
        ["PAYMENT_CORRECTION", "2468"]
    ]) {
        const authorization = await security.authorizePin(pin, purpose);
        assert.strictEqual(authorization.success, true, `${purpose} authorization should succeed`);
        assert.strictEqual(security.validateGrant(authorization.grant, purpose), true);
        clock += 60001;
        assert.strictEqual(security.validateGrant(authorization.grant, purpose), false, `${purpose} must use 60-second TTL`);
    }

    // Successful FF reservation/commit consumes the grant and prevents reuse.
    clock = 50000;
    const consumed = await security.authorizePin("1357", "FF");
    const consumedRequirement = [{ token: consumed.grant, purpose: "FF" }];
    assert.strictEqual(security.reserveGrants(consumedRequirement), true);
    assert.strictEqual(security.commitGrants(consumedRequirement), true);
    assert.strictEqual(security.reserveGrants(consumedRequirement), false);

    // A still-valid reservation is released for retry; an expired one is not restored.
    const retry = await security.authorizePin("1357", "FF");
    const retryRequirement = [{ token: retry.grant, purpose: "FF" }];
    assert.strictEqual(security.reserveGrants(retryRequirement), true);
    clock += 1;
    security.releaseGrants(retryRequirement);
    assert.strictEqual(security.reserveGrants(retryRequirement), true);
    security.commitGrants(retryRequirement);

    const expired = await security.authorizePin("1357", "FF");
    const expiredRequirement = [{ token: expired.grant, purpose: "FF" }];
    assert.strictEqual(security.reserveGrants(expiredRequirement), true);
    clock += 600001;
    security.releaseGrants(expiredRequirement);
    assert.strictEqual(security.reserveGrants(expiredRequirement), false);

    // Concurrent/repeated reservation is rejected, including duplicate requirements.
    clock = 100000;
    const concurrent = await security.authorizePin("1357", "FF");
    const concurrentRequirement = [{ token: concurrent.grant, purpose: "FF" }];
    assert.strictEqual(security.reserveGrants(concurrentRequirement), true);
    assert.strictEqual(security.reserveGrants(concurrentRequirement), false);
    security.releaseGrants(concurrentRequirement);

    const duplicate = await security.authorizePin("1357", "FF");
    assert.strictEqual(security.reserveGrants([
        { token: duplicate.grant, purpose: "FF" },
        { token: duplicate.grant, purpose: "FF" }
    ]), false);
    assert.strictEqual(security.reserveGrants([{ token: duplicate.grant, purpose: "FF" }]), true);
    security.releaseGrants([{ token: duplicate.grant, purpose: "FF" }]);

    await close(db);
    console.log("V1 authorization TTL regression tests: PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
