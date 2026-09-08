const assert = require("assert");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { createDayClosingService } = require("../src/database/dayClosingService");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (e) {
    e ? reject(e) : resolve({ changes: this.changes, lastID: this.lastID });
}));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (e, row) => e ? reject(e) : resolve(row || null)));
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows || [])));

async function sequenceContinuityTests() {
    const db = new sqlite3.Database(":memory:");
    await run(db, "CREATE TABLE day_closing_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT, close_sequence INTEGER, close_status TEXT)");
    for (let i = 1; i <= 3; i++) {
        const next = await get(db, "SELECT COALESCE(MAX(close_sequence), 0) + 1 AS next_sequence FROM day_closing_snapshots WHERE business_date = ?", ["2026-09-03"]);
        await run(db, "INSERT INTO day_closing_snapshots (business_date,close_sequence,close_status) VALUES (?,?,?)", ["2026-09-03", next.next_sequence, "REOPENED"]);
        const latest = await get(db, "SELECT close_sequence FROM day_closing_snapshots WHERE business_date=? ORDER BY close_sequence DESC LIMIT 1", ["2026-09-03"]);
        assert.strictEqual(latest.close_sequence, i);
    }
    await run(db, "INSERT INTO day_closing_snapshots (business_date,close_sequence,close_status) VALUES ('2026-09-04',1,'CLOSED')");
    assert.strictEqual((await get(db, "SELECT MAX(close_sequence) AS value FROM day_closing_snapshots WHERE business_date='2026-09-03'")).value, 3);
    await new Promise(resolve => db.close(resolve));
}

async function businessDayStateTests() {
    const db = new sqlite3.Database(":memory:");
    await run(db, "CREATE TABLE bills (bill_date TEXT)");
    await run(db, "CREATE TABLE returns (business_date TEXT)");
    await run(db, "CREATE TABLE customer_credit_transactions (transaction_type TEXT, amount REAL, created_at TEXT, id INTEGER)");
    await run(db, "CREATE TABLE return_items (return_id INTEGER, quantity INTEGER)");
    await run(db, "CREATE TABLE day_closing_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT, close_sequence INTEGER, close_status TEXT)");
    await run(db, "CREATE TABLE business_day_state (business_date TEXT PRIMARY KEY, state TEXT, opened_at TEXT, closed_at TEXT, updated_at TEXT)");
    const service = createDayClosingService({ database: db, now: () => new Date("2026-09-05T04:30:00Z"), getBusinessDate: () => "2026-09-05", createBackup: async () => ({}), validateBackup: async () => ({ success: true }) });
    await service.ensureOperationalBusinessDay();
    await service.ensureOperationalBusinessDay();
    assert.deepStrictEqual(await all(db, "SELECT business_date,state FROM business_day_state"), [{ business_date: "2026-09-05", state: "OPEN" }]);
    await run(db, "INSERT INTO business_day_state VALUES ('2026-09-04','OPEN','2026-09-04T04:00:00Z',NULL,'2026-09-04T04:00:00Z')");
    assert.strictEqual((await service.getBusinessDayState()).pendingPreviousBusinessDate, "2026-09-04");
    await run(db, "UPDATE business_day_state SET state='CLOSED',closed_at='2026-09-05T05:00:00Z' WHERE business_date='2026-09-04'");
    assert.strictEqual((await service.getBusinessDayState()).pendingPreviousBusinessDate, null);
    await new Promise(resolve => db.close(resolve));
}

function sourceAssertions() {
    const service = fs.readFileSync("src/database/dayClosingService.js", "utf8");
    const migration = fs.readFileSync("src/database/dayClosingMigration.js", "utf8");
    const main = fs.readFileSync("src/main/main.js", "utf8");
    const apps = fs.readFileSync("deployment/google-apps-script/KLBS_DSR_WebApp.gs", "utf8");
    assert(service.includes('MAX(close_sequence), 0) + 1 AS next_sequence'));
    assert(service.includes("WHERE business_date = ?") && service.includes("ensureOperationalBusinessDay"));
    assert(migration.includes("CREATE TABLE IF NOT EXISTS business_day_state"));
    assert(main.indexOf("await dashboardReady") < main.indexOf("await ensureOperationalBusinessDay()"));
    assert(apps.includes("function applyDsrRowFormats_") && apps.includes("var businessDateFormat = sheet.getRange('B3').getNumberFormat();"));
    assert(apps.includes("applyDsrRowFormats_(sheet, sheet.getLastRow())") && apps.includes("applyDsrRowFormats_(sheet, rowNumber)"));
    assert(apps.includes("var syncedAtFormat = sheet.getRange('AB3').getNumberFormat();"));
    assert(apps.includes("function businessDateCell_") && apps.includes("new Date(Date.UTC"));
    assert(apps.includes("action = 'UNCHANGED'") && apps.includes("action = 'UPDATED'"));
    assert(apps.includes("throw new Error('STALE_IGNORED')") && apps.includes("Duplicate Business Date integrity conflict."));
}

(async () => {
    sourceAssertions();
    await sequenceContinuityTests();
    await businessDayStateTests();
    console.log("PASS final targeted gate: sequence continuity, persistent zero-sales OPEN state, readiness boundary, typed DSR date, INSERT/UPDATE formats, and Closed At format");
})().catch(error => { console.error(error); process.exitCode = 1; });
