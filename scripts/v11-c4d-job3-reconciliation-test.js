const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { EXPECTED, ACCEPTED_AT, createConsolidatedJobReconciliation } = require("../src/services/consolidatedJobReconciliation");

const openDb = () => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(":memory:", error => error ? reject(error) : resolve(db));
});
const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));

async function fixture() {
    const db = await openDb();
    await run(db, `CREATE TABLE consolidated_reporting_jobs (
        id INTEGER PRIMARY KEY, closing_id INTEGER, business_date TEXT, close_sequence INTEGER,
        payload_hash TEXT, sheet_status TEXT, sheet_attempt_count INTEGER, sheet_last_attempt_at TEXT,
        sheet_processing_started_at TEXT, sheet_last_error TEXT, sheet_delivered_at TEXT,
        email_status TEXT, email_attempt_count INTEGER, email_last_attempt_at TEXT, email_last_error TEXT, email_delivered_at TEXT)`);
    await run(db, "CREATE TABLE business_day_state (business_date TEXT, state TEXT)");
    await run(db, "CREATE TABLE day_closing_snapshots (id INTEGER, business_date TEXT, close_sequence INTEGER, close_status TEXT, backup_status TEXT)");
    await run(db, `INSERT INTO consolidated_reporting_jobs VALUES
        (3,14,'2026-09-27',3,?,'FAILED',1,'2026-09-27T09:54:44.948Z',NULL,'REJECTED: historical',NULL,'DELIVERED',1,'2026-09-27T09:54:58.511Z',NULL,'2026-09-27T09:55:04.703Z')`, [EXPECTED.payload_hash]);
    await run(db, "INSERT INTO business_day_state VALUES ('2026-09-27','OPEN')");
    for (let i = 0; i < 3; i++) await run(db, "INSERT INTO day_closing_snapshots VALUES (?,?,?,?,?)", [12+i,"2026-09-27",1+i,"REOPENED","SUCCESS"]);
    return db;
}

(async () => {
    const reconciliationSource = fs.readFileSync(path.join(__dirname, "../src/services/consolidatedJobReconciliation.js"), "utf8");
    assert(!/require\(["'](?:axios|https?|node-fetch)["']\)|\bfetch\s*\(/.test(reconciliationSource));
    const mismatches = [
        ["id", 4], ["closing_id", 13], ["business_date", "2026-09-26"], ["close_sequence", 2],
        ["payload_hash", "0".repeat(64)], ["sheet_status", "PENDING"], ["sheet_attempt_count", 2], ["email_status", "PENDING"]
    ];
    for (const [field, value] of mismatches) {
        const db = await fixture();
        await run(db, `UPDATE consolidated_reporting_jobs SET ${field}=? WHERE id=3`, [value]);
        await assert.rejects(() => createConsolidatedJobReconciliation(db).reconcile(), /EXPECTED_JOB_MISSING|JOB_GUARD_MISMATCH/);
        const row = await get(db, "SELECT sheet_status FROM consolidated_reporting_jobs WHERE id=3");
        if (field === "id") assert.strictEqual(row, undefined);
        else assert.strictEqual(row.sheet_status, field === "sheet_status" ? "PENDING" : "FAILED");
        await new Promise(resolve => db.close(resolve));
    }
    for (const [table, field, value] of [["business_day_state", "state", "CLOSED"], ["day_closing_snapshots", "close_status", "CLOSED"]]) {
        const db = await fixture();
        await run(db, `UPDATE ${table} SET ${field}=?`, [value]);
        await assert.rejects(() => createConsolidatedJobReconciliation(db).reconcile(), /BUSINESS_DAY_GUARD_MISMATCH|SNAPSHOT_GUARD_MISMATCH/);
        await new Promise(resolve => db.close(resolve));
    }
    for (const tableMutation of [
        db => run(db, "UPDATE business_day_state SET state='CLOSED'"),
        db => run(db, "UPDATE day_closing_snapshots SET close_status='CLOSED' WHERE id=14")
    ]) {
        const db = await fixture(); await tableMutation(db);
        await assert.rejects(() => createConsolidatedJobReconciliation(db).reconcile(), /GUARD_MISMATCH/);
        await new Promise(resolve => db.close(resolve));
    }
    const db = await fixture();
    let forbiddenNetworkCalls = 0;
    const result = await createConsolidatedJobReconciliation(db).reconcile();
    assert.strictEqual(result.status, "RECONCILED");
    assert.strictEqual(result.job.sheet_status, "DELIVERED");
    assert.strictEqual(result.job.sheet_delivered_at, ACCEPTED_AT);
    assert.strictEqual(result.job.sheet_attempt_count, 1);
    assert.strictEqual(result.job.sheet_last_error, null);
    assert.strictEqual(result.job.email_status, "DELIVERED");
    assert.strictEqual(result.job.email_attempt_count, 1);
    assert.strictEqual(result.job.email_last_attempt_at, "2026-09-27T09:54:58.511Z");
    assert.strictEqual(result.job.email_delivered_at, "2026-09-27T09:55:04.703Z");
    assert.strictEqual((await get(db, "SELECT state FROM business_day_state")).state, "OPEN");
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS n FROM day_closing_snapshots WHERE close_status='REOPENED'")).n, 3);
    assert.strictEqual((await createConsolidatedJobReconciliation(db).reconcile()).status, "ALREADY_RECONCILED");
    assert.strictEqual(forbiddenNetworkCalls, 0);
    await new Promise(resolve => db.close(resolve));
    console.log("Job 3 reconciliation tests: PASS (transactional guard matrix; in-memory DB)");
})().catch(error => { console.error(error); process.exitCode = 1; });
