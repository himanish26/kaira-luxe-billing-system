const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { hashCredential } = require("../src/services/credentialCrypto");
const { createAdministratorSecurityService } = require("../src/services/administratorSecurityService");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
const close = db => new Promise(resolve => db.close(resolve));

function billAuthorizationRequirements(billData) {
    const requirements = [];
    if ((billData.items || []).some(item => item.ff_discount !== null && item.ff_discount !== undefined)) {
        requirements.push({ token: billData.authorization && billData.authorization.ff, purpose: "FF" });
    }
    if (Number(billData.gift_voucher_amount || 0) > 0) {
        requirements.push({ token: billData.authorization && billData.authorization.giftVoucher, purpose: "GIFT_VOUCHER" });
    }
    return requirements;
}

// Focused injected equivalent of the save-bill authorization boundary.
async function executeProtectedSave({ security, billData, saveBill }) {
    const requirements = billAuthorizationRequirements(billData);
    let authorizationReserved = false;
    if (requirements.length && !security.reserveGrants(requirements)) return { success: false };
    authorizationReserved = requirements.length > 0;
    try {
        await saveBill(billData);
        if (authorizationReserved) {
            authorizationReserved = false;
            security.commitGrants(requirements);
        }
        return { success: true };
    }
    catch (error) {
        if (authorizationReserved) security.releaseGrants(requirements);
        return { success: false, error: error.message };
    }
}

async function main() {
    const db = new sqlite3.Database(":memory:");
    await run(db, `CREATE TABLE settings (
        id INTEGER PRIMARY KEY, admin_pin_hash TEXT, admin_security_initialized INTEGER,
        manager_pin_hash TEXT, manager_security_initialized INTEGER
    )`);
    await run(db, "INSERT INTO settings VALUES (1, ?, 1, ?, 1)", [await hashCredential("2468"), await hashCredential("1357")]);
    let clock = 1000;
    const security = createAdministratorSecurityService(db, { now: () => clock, grantTtlMs: 100, ffGrantTtlMs: 100 });
    const source = fs.readFileSync(path.join(__dirname, "../src/main/main.js"), "utf8").replace(/\r\n/g, "\n");
    const saveIndex = source.indexOf('ipcMain.handle(\n    "save-bill"');
    const reserveIndex = source.indexOf("reserveGrants(authorizationRequirements)", saveIndex);
    const saveBillIndex = source.indexOf("await saveBill(billData)", reserveIndex);
    const flagClearIndex = source.indexOf("authorizationReserved = false", saveBillIndex);
    const commitIndex = source.indexOf("commitGrants(authorizationRequirements)", saveBillIndex);
    assert(saveIndex >= 0 && reserveIndex < saveBillIndex && saveBillIndex < flagClearIndex && flagClearIndex < commitIndex);

    assert.deepStrictEqual(billAuthorizationRequirements({ items: [], gift_voucher_amount: 0, store_credit: { store_credit_no: "SC-1", amount: 100 } }), []);

    // A: pre-commit failure releases and permits retry.
    const retry = await security.authorizePin("1357", "FF");
    const retryBill = { items: [{ ff_discount: 10 }], authorization: { ff: retry.grant }, gift_voucher_amount: 0 };
    let shouldFail = true;
    assert.strictEqual((await executeProtectedSave({ security, billData: retryBill, saveBill: async () => { if (shouldFail) throw new Error("downstream failure"); } })).success, false);
    shouldFail = false;
    assert.strictEqual((await executeProtectedSave({ security, billData: retryBill, saveBill: async () => {} })).success, true);
    assert.strictEqual(security.reserveGrants([{ token: retry.grant, purpose: "FF" }]), false);

    // B: successful save consumes the token.
    const consumed = await security.authorizePin("1357", "FF");
    assert.strictEqual((await executeProtectedSave({ security, billData: { items: [{ ff_discount: 10 }], authorization: { ff: consumed.grant } }, saveBill: async () => {} })).success, true);
    assert.strictEqual(security.reserveGrants([{ token: consumed.grant, purpose: "FF" }]), false);

    // C: unexpected finalization failure cannot restore a post-save token.
    const finalizationFailure = await security.authorizePin("1357", "FF");
    const originalCommit = security.commitGrants;
    security.commitGrants = () => { throw new Error("unexpected finalization failure"); };
    assert.strictEqual((await executeProtectedSave({ security, billData: { items: [{ ff_discount: 10 }], authorization: { ff: finalizationFailure.grant } }, saveBill: async () => {} })).success, false);
    security.commitGrants = originalCommit;
    assert.strictEqual(security.reserveGrants([{ token: finalizationFailure.grant, purpose: "FF" }]), false);

    // D: a reserved token cannot be used concurrently.
    const concurrent = await security.authorizePin("1357", "FF");
    const concurrentReq = [{ token: concurrent.grant, purpose: "FF" }];
    assert.strictEqual(security.reserveGrants(concurrentReq), true);
    assert.strictEqual(security.reserveGrants(concurrentReq), false);
    security.releaseGrants(concurrentReq);

    // E: expired reservations are discarded, not returned to availability.
    const expired = await security.authorizePin("1357", "FF");
    assert.strictEqual(security.reserveGrants([{ token: expired.grant, purpose: "FF" }]), true);
    clock += 101;
    security.releaseGrants([{ token: expired.grant, purpose: "FF" }]);
    assert.strictEqual(security.reserveGrants([{ token: expired.grant, purpose: "FF" }]), false);

    // F: Store Credit remains settlement-only when combined with F&F.
    assert.deepStrictEqual(billAuthorizationRequirements({ items: [{ ff_discount: 10 }], gift_voucher_amount: 0, store_credit: { store_credit_no: "SC-2", amount: 100 }, authorization: { ff: "ff-token" } }), [{ token: "ff-token", purpose: "FF" }]);

    // G: Gift Voucher has the same retry/one-time lifecycle.
    const gift = await security.authorizePin("1357", "GIFT_VOUCHER");
    const giftBill = { items: [], gift_voucher_amount: 10, authorization: { giftVoucher: gift.grant } };
    assert.strictEqual((await executeProtectedSave({ security, billData: giftBill, saveBill: async () => { throw new Error("downstream failure"); } })).success, false);
    assert.strictEqual((await executeProtectedSave({ security, billData: giftBill, saveBill: async () => {} })).success, true);
    assert.strictEqual(security.reserveGrants([{ token: gift.grant, purpose: "GIFT_VOUCHER" }]), false);

    // Duplicate requirements fail atomically without reserving the grant.
    const duplicate = await security.authorizePin("1357", "FF");
    assert.strictEqual(security.reserveGrants([{ token: duplicate.grant, purpose: "FF" }, { token: duplicate.grant, purpose: "FF" }]), false);
    assert.strictEqual(security.reserveGrants([{ token: duplicate.grant, purpose: "FF" }]), true);
    security.releaseGrants([{ token: duplicate.grant, purpose: "FF" }]);

    await close(db);
    console.log("V1 authorization grant retry-safety regression tests: PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
