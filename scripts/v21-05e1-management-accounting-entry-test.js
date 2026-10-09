"use strict";

const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const { prepareDatabaseSchema, readSchemaVersion, CURRENT_DB_SCHEMA_VERSION, runForwardMigrations } = require("../src/database/schemaVersion");
const { migrateManagementAccountingEntries } = require("../src/database/managementAccountingEntryMigration");
const { createManagementAccountingEntryService, HEADS, SEGMENTS, POST_PURPOSE, REVERSE_PURPOSE } = require("../src/database/managementAccountingEntryService");
const { createAdministratorSecurityService, AUTHORIZATION_POLICY } = require("../src/services/administratorSecurityService");
const { hashCredential } = require("../src/services/credentialCrypto");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) {
    error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes });
}));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

async function v8Fixture() {
    const db = new sqlite3.Database(":memory:");
    await run(db, "PRAGMA foreign_keys=ON");
    await exec(db, `
        CREATE TABLE products(id INTEGER PRIMARY KEY);
        CREATE TABLE bills(id INTEGER PRIMARY KEY, bill_no TEXT);
        CREATE TABLE customers(id INTEGER PRIMARY KEY);
        CREATE TABLE stock_movements(id INTEGER PRIMARY KEY);
        CREATE TABLE stock_movement_lines(id INTEGER PRIMARY KEY);
        CREATE TABLE expenses(id INTEGER PRIMARY KEY);
        CREATE TABLE settings(id INTEGER PRIMARY KEY, manager_pin_hash TEXT, manager_security_initialized INTEGER DEFAULT 0, admin_pin_hash TEXT, admin_security_initialized INTEGER DEFAULT 0);
        CREATE TABLE inventory_transactions(id INTEGER PRIMARY KEY);
        CREATE TABLE day_closing(id INTEGER PRIMARY KEY);
        CREATE TABLE returns(id INTEGER PRIMARY KEY);
        CREATE TABLE return_items(id INTEGER PRIMARY KEY);
        CREATE TABLE stores(id INTEGER PRIMARY KEY, store_code TEXT UNIQUE, store_name TEXT, status TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE store_context(id INTEGER PRIMARY KEY CHECK(id=1), current_store_id INTEGER NOT NULL REFERENCES stores(id));
        CREATE TABLE klbs_schema_metadata(id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL);
        CREATE TABLE v8_sentinel(id INTEGER PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO klbs_schema_metadata VALUES(1,8);
        INSERT INTO stores VALUES(1,'KL001','Kaira Luxe','ACTIVE','old','old');
        INSERT INTO store_context VALUES(1,1);
        INSERT INTO v8_sentinel VALUES(1,'preserve-v8-data');
    `);
    return db;
}

function securityAdapter() {
    const grants = new Map();
    const reserved = new Map();
    return {
        grants,
        reserveGrants(requirements) {
            if (!Array.isArray(requirements) || requirements.length !== 1) return false;
            const item = requirements[0];
            if (!grants.has(item.token) || grants.get(item.token) !== item.purpose) return false;
            grants.delete(item.token); reserved.set(item.token, item.purpose); return true;
        },
        commitGrants(requirements) {
            const item = requirements[0];
            if (reserved.get(item.token) !== item.purpose) return false;
            reserved.delete(item.token); return true;
        },
        releaseGrants(requirements) {
            const item = requirements[0];
            if (reserved.get(item.token) !== item.purpose) return;
            reserved.delete(item.token); grants.set(item.token, item.purpose);
        }
    };
}

async function main() {
    assert.strictEqual(CURRENT_DB_SCHEMA_VERSION, 13, "Supplier V13 invoice capture extends the V12 Supplier authority sequentially");
    assert.deepStrictEqual(HEADS.map(head => head.code), [
        "INTEREST_INCOME", "OTHER_NON_OPERATING_INCOME", "INTEREST_FINANCE_CHARGES",
        "DEPRECIATION", "AMORTISATION", "OTHER_NON_OPERATING_EXPENSE",
        "EXCEPTIONAL_ADJUSTMENT", "INCOME_TAX_PROVISION"
    ]);
    assert.deepStrictEqual(SEGMENTS, ["KL", "MENS", "KIDS", "COMMON"]);
    assert.strictEqual(AUTHORIZATION_POLICY[POST_PURPOSE], "MANAGER");
    assert.strictEqual(AUTHORIZATION_POLICY[REVERSE_PURPOSE], "MANAGER");

    const db = await v8Fixture();
    try {
        await prepareDatabaseSchema({ database: db, currentVersion: 9, runCurrentMigrations: async () => {} });
        assert.strictEqual(await readSchemaVersion(db), 9, "V8 upgrades to V9");
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('management_accounting_entries','management_accounting_entry_sequences')")).count, 2,
            "V9 physical accounting structures exist after the upgrade");
        assert.deepStrictEqual(await get(db, "SELECT * FROM v8_sentinel WHERE id=1"), { id: 1, value: "preserve-v8-data" });
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM management_accounting_entries")).count, 0,
            "migration creates no historical or monthly nil accounting rows");
        assert.strictEqual(await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='management_accounting_period_status'"), null,
            "period certification table is not created");
        assert.strictEqual((await get(db, "PRAGMA integrity_check")).integrity_check, "ok");
        assert.deepStrictEqual(await all(db, "PRAGMA foreign_key_check"), []);
        const sequenceBeforeRepeat = await get(db, "SELECT next_sequence FROM management_accounting_entry_sequences WHERE id=1");
        await prepareDatabaseSchema({ database: db, currentVersion: 9, runCurrentMigrations: async () => {} });
        assert.strictEqual(await readSchemaVersion(db), 9, "repeated V9 startup remains at V9");
        assert.deepStrictEqual(await get(db, "SELECT next_sequence FROM management_accounting_entry_sequences WHERE id=1"), sequenceBeforeRepeat,
            "repeated V9 startup does not mutate identity sequence state");
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM management_accounting_entries")).count, 0,
            "repeated startup does not fabricate accounting entries");
    } finally { await close(db); }

    const rollbackDb = await v8Fixture();
    try {
        await assert.rejects(() => runForwardMigrations(rollbackDb, 8, 9, [{
            from: 8, to: 9, up: async database => { await migrateManagementAccountingEntries(database); throw new Error("injected migration failure"); }
        }]), /injected migration failure/);
        assert.strictEqual(await readSchemaVersion(rollbackDb), 8, "failed migration leaves schema metadata unchanged");
        assert.strictEqual(await get(rollbackDb, "SELECT name FROM sqlite_master WHERE type='table' AND name='management_accounting_entries'"), null,
            "failed migration rolls back new structures");
    } finally { await close(rollbackDb); }

    const runtime = new sqlite3.Database(":memory:");
    await run(runtime, "PRAGMA foreign_keys=ON");
    await exec(runtime, `
        CREATE TABLE stores(id INTEGER PRIMARY KEY, store_code TEXT NOT NULL UNIQUE, store_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT, updated_at TEXT);
        CREATE TABLE store_context(id INTEGER PRIMARY KEY CHECK(id=1), current_store_id INTEGER NOT NULL REFERENCES stores(id));
        CREATE TABLE activities(id INTEGER PRIMARY KEY AUTOINCREMENT, activity_date TEXT, activity_time TEXT, category TEXT, action TEXT, details TEXT, user_name TEXT, status TEXT, entity_type TEXT, reference_no TEXT, change_data TEXT, created_at TEXT);
        CREATE TABLE settings(id INTEGER PRIMARY KEY, manager_pin_hash TEXT, manager_security_initialized INTEGER, admin_pin_hash TEXT, admin_security_initialized INTEGER);
        INSERT INTO stores VALUES(1,'KL001','Kaira Luxe','ACTIVE','test','test');
        INSERT INTO store_context VALUES(1,1);
        INSERT INTO settings VALUES(1,NULL,0,NULL,0);
    `);
    const v8 = await v8Fixture();
    try {
        await migrateManagementAccountingEntries(runtime);
        const fixedNow = () => new Date("2026-10-12T06:30:00.000Z");
        const getCurrentStore = async () => ({ id: 1, storeCode: "KL001", storeName: "Kaira Luxe", status: "ACTIVE" });
        let securityClock = fixedNow().getTime();
        const realSecurity = createAdministratorSecurityService(runtime, { now: () => securityClock, logEvent: async () => {} });
        await run(runtime, "UPDATE settings SET manager_pin_hash=?, manager_security_initialized=1 WHERE id=1", [await hashCredential("1234")]);
        const security = realSecurity;
        const appendTestActivity = async (db, event, instant) => run(db, `INSERT INTO activities
            (activity_date,activity_time,category,action,details,user_name,status,entity_type,reference_no,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)`, ["12 Oct 2026", "12:00:00 PM", event.category, event.action,
            event.details, event.user_name, event.status, event.entity_type, event.reference_no, instant.toISOString()]);
        const service = createManagementAccountingEntryService(runtime, {
            security, getCurrentStore, now: fixedNow, appendActivityInTransaction: appendTestActivity
        });
        const today = "2026-10-12";

        await assert.rejects(() => service.postEntry({ accountingDate: today, accountingHead: "INTEREST_INCOME", businessSegment: "KL", amount: "12.34" }),
            error => error.code === "ACCOUNTING_MANAGER_AUTH_REQUIRED");
        assert.strictEqual((await get(runtime, "SELECT COUNT(*) AS count FROM management_accounting_entries")).count, 0);

        await assert.rejects(() => service.validateEntry({ accountingDate: "2026-02-30", accountingHead: "INTEREST_INCOME", businessSegment: "KL", amount: "1.00" }),
            error => error.code === "ACCOUNTING_DATE_INVALID");
        await assert.rejects(() => service.validateEntry({ accountingDate: "2026-10-13", accountingHead: "INTEREST_INCOME", businessSegment: "KL", amount: "1.00" }),
            error => error.code === "ACCOUNTING_DATE_FUTURE");
        await assert.rejects(() => service.validateEntry({ accountingDate: today, accountingHead: "CUSTOM", businessSegment: "KL", amount: "1.00" }),
            error => error.code === "ACCOUNTING_HEAD_INVALID");
        await assert.rejects(() => service.validateEntry({ accountingDate: today, accountingHead: "INTEREST_INCOME", businessSegment: "ALL", amount: "1.00" }),
            error => error.code === "ACCOUNTING_SEGMENT_INVALID");
        await assert.rejects(() => service.validateEntry({ accountingDate: today, accountingHead: "INTEREST_INCOME", businessSegment: "KL", amount: "0" }),
            error => error.code === "ACCOUNTING_AMOUNT_INVALID");
        await assert.rejects(() => service.validateEntry({ accountingDate: today, accountingHead: "INTEREST_INCOME", businessSegment: "KL", amount: "1.001" }),
            error => error.code === "ACCOUNTING_AMOUNT_INVALID");
        await assert.rejects(() => service.validateEntry({ accountingDate: today, accountingHead: "EXCEPTIONAL_ADJUSTMENT", businessSegment: "KL", amount: "1.00" }),
            error => error.code === "ACCOUNTING_ADJUSTMENT_EFFECT_REQUIRED");
        await assert.rejects(() => service.validateEntry({ accountingDate: today, accountingHead: "INTEREST_INCOME", businessSegment: "KL", amount: "1.00", adjustmentEffect: "INCOME" }),
            error => error.code === "ACCOUNTING_ADJUSTMENT_EFFECT_NOT_ALLOWED");
        await assert.rejects(() => service.validateEntry({ accountingDate: today, accountingHead: "EXCEPTIONAL_ADJUSTMENT", businessSegment: "KL", amount: "1.00", adjustmentEffect: "INCOME" }),
            error => error.code === "ACCOUNTING_REMARKS_REQUIRED");
        const normalized = await service.validateEntry({ accountingDate: today, accountingHead: "INTEREST_INCOME", businessSegment: "COMMON", amount: "123.45", referenceNo: "  BANK-1  " });
        assert.strictEqual(normalized.amountPaise, 12345, "decimal string is stored as exact integer paise");
        assert.strictEqual(normalized.referenceNo, "BANK-1");

        const expiredGrant = await security.authorizePin("1234", POST_PURPOSE);
        securityClock += 60001;
        await assert.rejects(() => service.postEntry({ accountingDate: today, accountingHead: "INTEREST_INCOME", businessSegment: "KL", amount: "1.00" }, expiredGrant.grant),
            error => error.code === "ACCOUNTING_MANAGER_AUTH_REQUIRED");

        const unauthorized = await security.authorizePin("1234", POST_PURPOSE);
        assert.strictEqual(unauthorized.success, true);
        const posted = await service.postEntry({ accountingDate: "2026-10-05", accountingHead: "EXCEPTIONAL_ADJUSTMENT", businessSegment: "KL", amountPaise: 12345, adjustmentEffect: "EXPENSE", remarks: "one-off correction" }, unauthorized.grant);
        assert.strictEqual(posted.entry_code, "KLPAE000001");
        assert.strictEqual(posted.store_code, "KL001");
        assert.strictEqual(posted.amount_paise, 12345);
        assert.strictEqual(posted.status, "POSTED");
        assert.strictEqual(posted.adjustment_effect, "EXPENSE");
        assert.strictEqual((await get(runtime, "SELECT COUNT(*) AS count FROM activities WHERE action='MANAGEMENT_ACCOUNTING_ENTRY_POSTED'")).count, 1,
            "posting Activity Log event committed with entry");

        await assert.rejects(() => run(runtime, "UPDATE management_accounting_entries SET amount_paise=1 WHERE entry_code=?", [posted.entry_code]), /KLBS_MANAGEMENT_ACCOUNTING_ENTRY_IMMUTABLE/);
        await assert.rejects(() => run(runtime, "DELETE FROM management_accounting_entries WHERE entry_code=?", [posted.entry_code]), /KLBS_MANAGEMENT_ACCOUNTING_ENTRY_DELETE_PROHIBITED/);

        await assert.rejects(() => service.reverseEntry(posted.entry_code, { reason: "Correction" }),
            error => error.code === "ACCOUNTING_MANAGER_AUTH_REQUIRED");
        await assert.rejects(() => service.reverseEntry(posted.entry_code, { reason: "  " }, "unused"),
            error => error.code === "ACCOUNTING_REVERSAL_REASON_REQUIRED");
        const failService = createManagementAccountingEntryService(runtime, {
            security, getCurrentStore, now: fixedNow,
            appendActivityInTransaction: async () => { throw new Error("injected activity failure"); }
        });
        const failedReverseGrant = await security.authorizePin("1234", REVERSE_PURPOSE);
        await assert.rejects(() => failService.reverseEntry(posted.entry_code, { reason: "Atomic reversal failure" }, failedReverseGrant.grant), /injected activity failure/);
        assert.strictEqual((await get(runtime, "SELECT COUNT(*) AS count FROM management_accounting_entries")).count, 1,
            "failed reversal leaves original and no partial compensating record");
        assert.strictEqual((await get(runtime, "SELECT next_sequence FROM management_accounting_entry_sequences WHERE id=1")).next_sequence, 2,
            "failed reversal rolls back identity allocation");
        const reverseGrant = await security.authorizePin("1234", REVERSE_PURPOSE);
        const reversal = await service.reverseEntry(posted.entry_code, { reason: "Entered against wrong source document" }, reverseGrant.grant);
        assert.strictEqual(reversal.entry_code, "KLPAE000002");
        assert.strictEqual(reversal.reverses_entry_code, posted.entry_code);
        assert.strictEqual(reversal.accounting_date, today, "reversal uses current business accounting date");
        assert.strictEqual(reversal.store_code, posted.store_code);
        assert.strictEqual(reversal.accounting_head, posted.accounting_head);
        assert.strictEqual(reversal.business_segment, posted.business_segment);
        assert.strictEqual(reversal.amount_paise, posted.amount_paise);
        assert.strictEqual(reversal.adjustment_effect, posted.adjustment_effect);
        assert.strictEqual(reversal.reversal_reason, "Entered against wrong source document");
        const originalAfterReversal = await service.getEntryByCode(posted.entry_code);
        assert.strictEqual(originalAfterReversal.reversed_by_entry_code, reversal.entry_code,
            "entry detail exposes the immutable reversal relationship");
        await assert.rejects(() => service.reverseEntry(posted.entry_code, { reason: "Again" }, "unused"),
            error => error.code === "ACCOUNTING_MANAGER_AUTH_REQUIRED");
        const duplicateGrant = await security.authorizePin("1234", REVERSE_PURPOSE);
        await assert.rejects(() => service.reverseEntry(posted.entry_code, { reason: "Again" }, duplicateGrant.grant),
            error => error.code === "ACCOUNTING_ENTRY_ALREADY_REVERSED");
        const reversalOfReversalGrant = await security.authorizePin("1234", REVERSE_PURPOSE);
        await assert.rejects(() => service.reverseEntry(reversal.entry_code, { reason: "No" }, reversalOfReversalGrant.grant),
            error => error.code === "ACCOUNTING_REVERSAL_NOT_ALLOWED");
        const effective = await service.getEffectivePostedEntries({ fromDate: "2026-10-01", toDate: "2026-10-31", businessSegment: "KL" });
        assert.deepStrictEqual(effective.map(row => [row.entry_code, row.accounting_sign]), [[posted.entry_code, 1], [reversal.entry_code, -1]]);
        const searched = await service.listEntries({ fromDate: "2026-10-01", toDate: "2026-10-31", search: posted.entry_code });
        assert.deepStrictEqual(searched.map(row => row.entry_code), [posted.entry_code, reversal.entry_code], "history search matches the original ID and reversal narration by original business ID");
        assert.strictEqual(searched[1].reverses_entry_code, posted.entry_code);
        await assert.rejects(() => service.getEffectivePostedEntries(), error => error.code === "ACCOUNTING_DATE_RANGE_REQUIRED");
        assert.strictEqual((await service.getEffectivePostedEntries({ fromDate: "2026-09-01", toDate: "2026-09-30" })).length, 0,
            "no entries yields an empty result, not synthetic zero rows");
        assert.deepStrictEqual((await service.getEntryDataQuality({ fromDate: "2026-10-01", toDate: "2026-10-31" })).warnings, []);
        assert.strictEqual(await get(runtime, "SELECT COUNT(*) AS count FROM management_accounting_entries WHERE status='DRAFT'").then(row => row.count), 0,
            "drafts are not persisted in the financial authority");

        // A failed in-transaction audit append must roll back the fact and sequence.
        const failureGrant = await security.authorizePin("1234", POST_PURPOSE);
        await assert.rejects(() => failService.postEntry({ accountingDate: today, accountingHead: "DEPRECIATION", businessSegment: "MENS", amount: "9.00" }, failureGrant.grant), /injected activity failure/);
        assert.strictEqual((await get(runtime, "SELECT next_sequence FROM management_accounting_entry_sequences WHERE id=1")).next_sequence, 3,
            "failed post rolls back identity allocation");
        assert.strictEqual((await get(runtime, "SELECT COUNT(*) AS count FROM management_accounting_entries")).count, 2,
            "failed post leaves no partial fact");

        // Exhaustion is terminal and cannot wrap to a reused identity.
        await run(runtime, "UPDATE management_accounting_entry_sequences SET next_sequence=999999 WHERE id=1");
        const lastGrant = await security.authorizePin("1234", POST_PURPOSE);
        const lastEntry = await service.postEntry({ accountingDate: today, accountingHead: "INTEREST_INCOME", businessSegment: "KIDS", amount: "1.00" }, lastGrant.grant);
        assert.strictEqual(lastEntry.entry_code, "KLPAE999999");
        const exhaustedGrant = await security.authorizePin("1234", POST_PURPOSE);
        await assert.rejects(() => service.postEntry({ accountingDate: today, accountingHead: "INTEREST_INCOME", businessSegment: "KIDS", amount: "1.00" }, exhaustedGrant.grant),
            error => error.code === "ACCOUNTING_ID_SEQUENCE_EXHAUSTED");
        assert.strictEqual((await get(runtime, "PRAGMA integrity_check")).integrity_check, "ok");
        assert.deepStrictEqual(await all(runtime, "PRAGMA foreign_key_check"), []);
    } finally {
        await close(runtime);
        await close(v8);
    }

    console.log("V21-05E1 Management Accounting Entry tests passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
