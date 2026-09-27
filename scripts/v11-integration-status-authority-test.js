const assert = require("assert");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { createIntegrationStatusService } = require("../src/services/integrationStatusService");

const run = (db, sql) => new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));

async function createDb(sheetState = "PENDING") {
    const db = new sqlite3.Database(":memory:");
    await run(db, "CREATE TABLE consolidated_reporting_jobs (id INTEGER,closing_id INTEGER,business_date TEXT,sheet_status TEXT,email_status TEXT,sheet_delivered_at TEXT,email_delivered_at TEXT)");
    await run(db, "CREATE TABLE day_closing_snapshots (id INTEGER,business_date TEXT,close_sequence INTEGER,close_status TEXT,dsr_sync_status TEXT,dsr_synced_at TEXT)");
    await run(db, "INSERT INTO day_closing_snapshots VALUES (14,'2026-09-27',3,'CLOSED','SYNCED','2026-09-27T10:00:00.000Z'),(13,'2026-09-26',2,'REOPENED','FAILED',NULL)");
    await new Promise((resolve, reject) => db.run("INSERT INTO consolidated_reporting_jobs VALUES (3,14,'2026-09-27',?,'DELIVERED',?,NULL),(2,13,'2026-09-26','FAILED','FAILED',NULL,NULL)", [sheetState, sheetState === "DELIVERED" ? "2026-09-27T12:13:04.589Z" : null], error => error ? reject(error) : resolve()));
    let writes = 0;
    db.run = () => { writes += 1; throw new Error("status query must be read-only"); };
    const legacyOutbox = { getStatusView: async () => ({ pendingCount: 1, deliveries: [{ businessDate: "2026-09-27", emailStatus: "SUCCESS", dsrStatus: "PENDING" }] }) };
    return { db, legacyOutbox, getWrites: () => writes };
}

(async () => {
    const fixture = await createDb();
    const service = createIntegrationStatusService({ database: fixture.db, legacyOutbox: fixture.legacyOutbox });
    let status = await service.getStatusView();
    assert.strictEqual(status.upToDate, false);
    assert.strictEqual(status.pendingCount, 2); // one legacy, one current V1.1
    assert.strictEqual(status.failedCount, 0);
    assert.strictEqual(status.deliveries.find(row => row.businessDate === "2026-09-26"), undefined); // reopened history excluded

    const failedFixture = await createDb("FAILED");
    failedFixture.legacyOutbox.getStatusView = async () => ({ pendingCount: 0, deliveries: [] });
    status = await createIntegrationStatusService({ database: failedFixture.db, legacyOutbox: failedFixture.legacyOutbox }).getStatusView();
    assert.strictEqual(status.failedCount, 1);
    assert.strictEqual(status.upToDate, false);
    failedFixture.db.close();

    const healthyFixture = await createDb("DELIVERED");
    healthyFixture.legacyOutbox.getStatusView = async () => ({ pendingCount: 0, deliveries: [] });
    const healthyService = createIntegrationStatusService({ database: healthyFixture.db, legacyOutbox: healthyFixture.legacyOutbox });
    status = await healthyService.getStatusView();
    assert.strictEqual(status.failedCount, 0);
    assert.strictEqual(status.pendingCount, 0);
    assert.strictEqual(status.upToDate, true);
    assert.strictEqual(status.lastDsrSync.at, "2026-09-27T12:13:04.589Z");
    assert.strictEqual(fixture.getWrites(), 0);
    assert.strictEqual(healthyFixture.getWrites(), 0);

    const main = fs.readFileSync(require.resolve("../src/main/main.js"), "utf8");
    const ui = fs.readFileSync(require.resolve("../src/renderer/modules/system/integrations.js"), "utf8");
    const dsr = fs.readFileSync(require.resolve("../src/services/dsrSyncService.js"), "utf8");
    assert(main.includes("integrations:get-outbox-status"));
    assert(main.includes("integrationStatus.getStatusView()"));
    assert(!main.includes("KLBS_C4D_ACCEPTANCE_PROBE"));
    assert(!main.includes("--c4d-v18-sequence3-acceptance"));
    assert(ui.includes("ACTION REQUIRED") && ui.includes("ALL REPORTS UP TO DATE"));
    assert(dsr.includes('action: "TEST_CONNECTION"'));
    console.log("Integration status authority tests: PASS");
    fixture.db.close();
    healthyFixture.db.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
