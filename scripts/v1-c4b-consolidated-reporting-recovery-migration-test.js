const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const {
    CREATE_CONSOLIDATED_REPORTING_JOBS_SQL,
    migrateConsolidatedReportingJobs
} = require("../src/database/dayClosingMigration");

const RECOVERY_COLUMNS = [
    "sheet_last_attempt_at",
    "sheet_processing_started_at",
    "email_last_attempt_at",
    "email_processing_started_at"
];

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        if (error) reject(error);
        else resolve({ changes: this.changes, lastID: this.lastID });
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function tableInfo(db) {
    return all(db, "PRAGMA table_info(consolidated_reporting_jobs)");
}

function assertRecoveryColumns(columns) {
    for (const name of RECOVERY_COLUMNS) {
        const column = columns.find(value => value.name === name);
        assert(column, `missing ${name}`);
        assert.strictEqual(column.type.toUpperCase(), "TEXT", `${name} type`);
        assert.strictEqual(Number(column.notnull), 0, `${name} nullable`);
        assert.strictEqual(column.dflt_value, null, `${name} default`);
    }
}

async function createOldFormTable(db) {
    await run(db, `
        CREATE TABLE consolidated_reporting_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            closing_id INTEGER NOT NULL,
            business_date TEXT NOT NULL,
            close_sequence INTEGER NOT NULL,
            contract_version INTEGER NOT NULL,
            snapshot_version INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            report_status TEXT NOT NULL CHECK (report_status IN ('FINAL', 'INCOMPLETE', 'UNAVAILABLE')),
            data_quality_status TEXT NOT NULL CHECK (data_quality_status IN ('COMPLETE', 'INCOMPLETE', 'UNAVAILABLE')),
            created_at TEXT NOT NULL,
            sheet_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (sheet_status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED')),
            sheet_attempt_count INTEGER NOT NULL DEFAULT 0,
            sheet_last_error TEXT,
            sheet_delivered_at TEXT,
            email_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (email_status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED')),
            email_attempt_count INTEGER NOT NULL DEFAULT 0,
            email_last_error TEXT,
            email_delivered_at TEXT,
            UNIQUE (closing_id),
            UNIQUE (business_date, close_sequence)
        )
    `);
}

async function insertRepresentativeRow(db) {
    const payload = '{"placeholder":"C4B synthetic payload"}';
    await run(db, `
        INSERT INTO consolidated_reporting_jobs (
            closing_id, business_date, close_sequence, contract_version,
            snapshot_version, payload_json, payload_hash, report_status,
            data_quality_status, created_at, sheet_status, sheet_attempt_count,
            sheet_last_error, sheet_delivered_at, email_status, email_attempt_count,
            email_last_error, email_delivered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        9001, "2026-09-21", 7, 2, 2, payload, "synthetic-hash",
        "FINAL", "COMPLETE", "2026-09-21T12:00:00.000Z", "DELIVERED", 4,
        "old sheet error", "2026-09-21T12:01:00.000Z", "FAILED", 5,
        "old email error", "2026-09-21T12:02:00.000Z"
    ]);
    return payload;
}

async function testFreshDatabase() {
    const db = new sqlite3.Database(":memory:");
    await migrateConsolidatedReportingJobs(db);
    const columns = await tableInfo(db);
    assertRecoveryColumns(columns);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM consolidated_reporting_jobs")).count, 0);
    await close(db);
}

async function testUpgradePreservationAndIdempotency() {
    const db = new sqlite3.Database(":memory:");
    await createOldFormTable(db);
    const payload = await insertRepresentativeRow(db);
    const before = await get(db, "SELECT * FROM consolidated_reporting_jobs WHERE closing_id=9001");
    await migrateConsolidatedReportingJobs(db);
    const after = await get(db, "SELECT * FROM consolidated_reporting_jobs WHERE closing_id=9001");
    assertRecoveryColumns(await tableInfo(db));
    for (const field of [
        "closing_id", "business_date", "close_sequence", "contract_version", "snapshot_version",
        "payload_json", "payload_hash", "report_status", "data_quality_status", "created_at",
        "sheet_status", "sheet_attempt_count", "sheet_last_error", "sheet_delivered_at",
        "email_status", "email_attempt_count", "email_last_error", "email_delivered_at"
    ]) assert.strictEqual(after[field], before[field], `${field} changed during upgrade`);
    assert.strictEqual(after.payload_json, payload);
    for (const field of RECOVERY_COLUMNS) assert.strictEqual(after[field], null, `${field} must start NULL`);

    const afterFirstMigration = { ...after };
    await migrateConsolidatedReportingJobs(db);
    const afterSecondMigration = await get(db, "SELECT * FROM consolidated_reporting_jobs WHERE closing_id=9001");
    assert.deepStrictEqual(afterSecondMigration, afterFirstMigration);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM consolidated_reporting_jobs")).count, 1);

    await assert.rejects(() => run(db, `
        INSERT INTO consolidated_reporting_jobs (
            closing_id, business_date, close_sequence, contract_version,
            snapshot_version, payload_json, payload_hash, report_status,
            data_quality_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [9001, "2026-09-22", 1, 2, 2, payload, "other", "FINAL", "COMPLETE", "now"]));
    await assert.rejects(() => run(db, `
        INSERT INTO consolidated_reporting_jobs (
            closing_id, business_date, close_sequence, contract_version,
            snapshot_version, payload_json, payload_hash, report_status,
            data_quality_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [9002, "2026-09-21", 7, 2, 2, payload, "other", "FINAL", "COMPLETE", "now"]));
    await close(db);
}

(async () => {
    await testFreshDatabase();
    await testUpgradePreservationAndIdempotency();
    assert(CREATE_CONSOLIDATED_REPORTING_JOBS_SQL.includes("sheet_last_attempt_at TEXT"));
    assert(CREATE_CONSOLIDATED_REPORTING_JOBS_SQL.includes("sheet_processing_started_at TEXT"));
    assert(CREATE_CONSOLIDATED_REPORTING_JOBS_SQL.includes("email_last_attempt_at TEXT"));
    assert(CREATE_CONSOLIDATED_REPORTING_JOBS_SQL.includes("email_processing_started_at TEXT"));
    console.log("C4B consolidated reporting recovery migration tests: PASS");
})().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
