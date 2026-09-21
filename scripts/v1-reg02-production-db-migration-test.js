const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const sqlite3 = require("sqlite3").verbose();

const RESULT_PREFIX = "REG02_RESULT=";

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        error ? reject(error) : resolve(this);
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => {
        error ? reject(error) : resolve(row || null);
    }));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => {
        error ? reject(error) : resolve(rows || []);
    }));
}

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function createLegacyFixture(databasePath) {
    const db = new sqlite3.Database(databasePath);
    await exec(db, fs.readFileSync(path.join(__dirname, "..", "database_schema.sql"), "utf8"));
    await run(db, "INSERT INTO klbs_schema_metadata (id, schema_version) VALUES (1, 3)");
    await run(db, `INSERT INTO products
        (barcode, sku, brand, segment, category, product_name, mrp, selling_price, gst_rate, active, business_segment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["REG02-LEGACY", "KL-LEGACY-001", "Legacy Brand", "L'Oréal Men", "Legacy", "Legacy Product", 100, 100, 5, 1, "KL"]);
    await run(db, "INSERT INTO business_day_state (business_date, state, opened_at, updated_at) VALUES (?, 'OPEN', ?, ?)", [
        "2026-09-21", "2026-09-21T09:00:00.000Z", "2026-09-21T09:00:00.000Z"
    ]);
    await close(db);
}

async function childMain(tempRoot, phase) {
    const { app } = require("electron");
    app.setPath("userData", path.join(tempRoot, "user data"));
    const database = require("../src/database/database");
    await database.databaseReady;

    const db = database;
    const table = await get(db, "SELECT name, sql FROM sqlite_master WHERE type='table' AND name='consolidated_reporting_jobs'");
    assert(table, "startup migration did not create consolidated_reporting_jobs");
    for (const column of [
        "id", "closing_id", "business_date", "close_sequence", "contract_version", "snapshot_version",
        "payload_json", "payload_hash", "report_status", "data_quality_status", "created_at",
        "sheet_status", "sheet_attempt_count", "sheet_last_error", "sheet_delivered_at",
        "email_status", "email_attempt_count", "email_last_error", "email_delivered_at"
    ]) {
        assert((await all(db, "PRAGMA table_info(consolidated_reporting_jobs)")).some(value => value.name === column), column);
    }
    assert(/UNIQUE\s*\(closing_id\)/i.test(table.sql));
    assert(/UNIQUE\s*\(business_date,\s*close_sequence\)/i.test(table.sql));
    assert(await get(db, "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_consolidated_reporting_jobs_pending'"));
    assert.strictEqual((await get(db, "SELECT product_name FROM products WHERE barcode='REG02-LEGACY'")).product_name, "Legacy Product");
    assert.strictEqual((await get(db, "SELECT schema_version FROM klbs_schema_metadata WHERE id=1")).schema_version, 3);

    if (phase === "verify-only") {
        await database.closeDatabase();
        process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({ table: true, idempotent: true })}\n`);
        app.exit(0);
        return;
    }

    const { createConsolidatedReportingPersistenceService } = require("../src/services/consolidatedReportingPersistenceService");
    const { createDayClosingService } = require("../src/database/dayClosingService");
    const persistence = createConsolidatedReportingPersistenceService({ database: db });
    const service = createDayClosingService({
        database: db,
        consolidatedReportingPersistence: persistence,
        now: () => new Date("2026-09-21T18:00:00.000Z"),
        getBusinessDate: () => "2026-09-21",
        createBackup: async () => ({ backupFileName: "reg02-backup.zip", backupFilePath: "reg02-backup.zip" }),
        validateBackup: async () => ({ success: true }),
        integrationOutbox: { enqueue: async () => {} },
        segmentDsrOutbox: { enqueue: async () => {} },
        logBusinessDayClosed: async () => {},
        logBusinessDayReopened: async () => {},
        klbsVersion: "1.1.0"
    });
    const closeResult = await service.closeBusinessDay("2026-09-21");
    assert.strictEqual(closeResult.success, true);
    assert.strictEqual(closeResult.snapshot.closeStatus, "CLOSED");
    const job = await get(db, "SELECT * FROM consolidated_reporting_jobs WHERE closing_id=?", [closeResult.snapshotId]);
    assert(job);
    assert.strictEqual(job.business_date, "2026-09-21");
    assert(Number.isInteger(job.close_sequence));
    assert(job.close_sequence >= 1);
    assert.strictEqual(job.payload_hash.length, 64);
    assert.strictEqual((await get(db, "SELECT state FROM business_day_state WHERE business_date='2026-09-21'")).state, "CLOSED");

    await service.reopenBusinessDay("REG02 migration regression");
    const oldPayload = await get(db, "SELECT payload_json, payload_hash FROM consolidated_reporting_jobs WHERE closing_id=?", [closeResult.snapshotId]);
    assert(oldPayload);

    const failingPersistence = { createFrozenJobWithinTransaction: async () => { throw new Error("REG02 injected persistence failure"); } };
    const failingService = createDayClosingService({
        database: db,
        consolidatedReportingPersistence: failingPersistence,
        now: () => new Date("2026-09-21T18:00:00.000Z"),
        getBusinessDate: () => "2026-09-21",
        createBackup: async () => ({ backupFileName: "reg02-failure.zip", backupFilePath: "reg02-failure.zip" }),
        validateBackup: async () => ({ success: true }),
        integrationOutbox: { enqueue: async () => {} },
        segmentDsrOutbox: { enqueue: async () => {} }
    });
    await assert.rejects(() => failingService.closeBusinessDay("2026-09-21"), /REG02 injected persistence failure/);
    assert.strictEqual((await get(db, "SELECT state FROM business_day_state WHERE business_date='2026-09-21'")).state, "OPEN");
    assert.strictEqual((await get(db, "SELECT close_status FROM day_closing_snapshots WHERE id=?", [closeResult.snapshotId])).close_status, "REOPENED");
    const jobRowsAfterFailure = await all(db, "SELECT closing_id, close_sequence FROM consolidated_reporting_jobs ORDER BY id");
    assert.strictEqual(jobRowsAfterFailure.length, 1);
    const unchangedPayload = await get(db, "SELECT payload_json, payload_hash FROM consolidated_reporting_jobs WHERE closing_id=?", [closeResult.snapshotId]);
    assert.deepStrictEqual(unchangedPayload, oldPayload);

    await database.closeDatabase();
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({ table: true, close: true, rollback: true })}\n`);
    app.exit(0);
}

function runChild(tempRoot, phase) {
    const electronBinary = path.resolve(path.dirname(require.resolve("electron")), "dist", "electron.exe");
    const result = spawnSync(electronBinary, ["--disable-gpu", "--in-process-gpu", __filename, "--child", tempRoot, phase], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "billing.db") },
        encoding: "utf8",
        timeout: 120000,
        windowsHide: true
    });
    assert.strictEqual(result.status, 0, `${result.error ? result.error.stack || result.error.message : ""}\n${result.stdout || ""}\n${result.stderr || ""}`);
    assert(result.stdout.split(/\r?\n/).some(value => value.startsWith(RESULT_PREFIX)), `${result.stdout}\n${result.stderr}`);
}

(async () => {
    if (process.argv.includes("--child")) {
        const childIndex = process.argv.indexOf("--child");
        await childMain(process.argv[childIndex + 1], process.argv[childIndex + 2] || "full");
        return;
    }
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-reg02-upgrade-"));
    try {
        await createLegacyFixture(path.join(tempRoot, "billing.db"));
        runChild(tempRoot, "full");
        runChild(tempRoot, "verify-only");
        console.log("REG-02 V1.0-to-V1.1 production bootstrap migration test: PASS (upgrade, idempotency, preservation, close, rollback)");
    }
    finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
})().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
    if (process.versions.electron) {
        try { require("electron").app.exit(1); } catch (_) {}
    }
});
