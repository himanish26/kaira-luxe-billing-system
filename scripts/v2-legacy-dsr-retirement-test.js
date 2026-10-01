"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { createIntegrationOutboxService } = require("../src/services/integrationOutboxService");
const { createIntegrationStatusService } = require("../src/services/integrationStatusService");

const dbPath = path.join(os.tmpdir(), `klbs-legacy-dsr-retirement-${process.pid}-${Date.now()}.db`);
const db = new sqlite3.Database(dbPath);
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) { error ? reject(error) : resolve({ changes: this.changes }); }));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const close = () => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

async function main() {
    try {
        await run(`CREATE TABLE business_day_state (business_date TEXT PRIMARY KEY,state TEXT,opened_at TEXT)`);
        await run(`INSERT INTO business_day_state VALUES ('2026-10-01','OPEN','2026-10-01T00:00:00.000Z')`);
        await run(`CREATE TABLE day_closing_snapshots (id INTEGER PRIMARY KEY,business_date TEXT,close_sequence INTEGER,close_status TEXT,dsr_sync_status TEXT,dsr_synced_at TEXT)`);
        await run(`CREATE TABLE integration_outbox (
            id INTEGER PRIMARY KEY,business_date TEXT,closing_id INTEGER,close_sequence INTEGER,
            delivery_type TEXT CHECK(delivery_type IN ('EMAIL_DAY_CLOSING','DSR_DAY_CLOSING')),
            status TEXT CHECK(status IN ('PENDING','PROCESSING','SUCCESS')),
            attempt_count INTEGER,created_at TEXT,last_attempt_at TEXT,completed_at TEXT,last_error TEXT,
            UNIQUE(closing_id,delivery_type))`);
        await run(`CREATE TABLE segment_dsr_outbox (id INTEGER PRIMARY KEY,status TEXT,attempt_count INTEGER,last_error TEXT)`);
        await run(`CREATE TABLE consolidated_reporting_jobs (
            id INTEGER PRIMARY KEY,closing_id INTEGER,business_date TEXT,close_sequence INTEGER,
            sheet_status TEXT,email_status TEXT,sheet_delivered_at TEXT,email_delivered_at TEXT)`);
        await run(`CREATE TABLE bills (id INTEGER PRIMARY KEY,total INTEGER)`);
        await run(`CREATE TABLE inventory_transactions (id INTEGER PRIMARY KEY,quantity INTEGER)`);
        await run(`CREATE TABLE returns (id INTEGER PRIMARY KEY,total INTEGER)`);
        await run(`CREATE TABLE store_credits (id INTEGER PRIMARY KEY,balance INTEGER)`);
        await run(`CREATE TABLE activities (id INTEGER PRIMARY KEY)`);
        await run(`INSERT INTO day_closing_snapshots (id,business_date,close_sequence,close_status) VALUES
            (1,'2026-09-28',1,'CLOSED'),(2,'2026-09-29',1,'CLOSED'),(3,'2026-09-30',1,'CLOSED'),
            (4,'2026-10-02',1,'CLOSED'),(5,'2026-09-27',1,'CLOSED'),(6,'2026-09-26',1,'CLOSED'),
            (7,'2026-09-25',1,'CLOSED')`);
        const old = "2026-09-30T00:00:00.000Z";
        await run(`INSERT INTO integration_outbox VALUES
            (1,'2026-09-28',1,1,'DSR_DAY_CLOSING','PENDING',9,?,NULL,NULL,'legacy failure'),
            (2,'2026-09-29',2,1,'DSR_DAY_CLOSING','PROCESSING',4,?,'2026-09-30T02:00:00Z',NULL,'stale claim'),
            (3,'2026-09-30',3,1,'EMAIL_DAY_CLOSING','PENDING',2,?,NULL,NULL,'email retry'),
            (4,'2026-10-02',4,1,'DSR_DAY_CLOSING','PENDING',0,'2026-10-02T01:00:00Z',NULL,NULL,NULL),
            (5,'2026-09-27',5,1,'DSR_DAY_CLOSING','SUCCESS',2,?,NULL,'2026-09-28T01:00:00Z',NULL),
            (6,'2026-09-26',6,1,'DSR_DAY_CLOSING','SUCCESS',3,?,NULL,'2026-09-27T01:00:00Z','Delivery not sent: closing was reopened.'),
            (7,'2026-09-25',7,1,'DSR_DAY_CLOSING','PENDING',1,?,NULL,NULL,'legacy failure'),
            (8,'2026-09-24',8,1,'DSR_DAY_CLOSING','PENDING',1,?,NULL,NULL,'legacy failure'),
            (9,'2026-09-28',1,1,'EMAIL_DAY_CLOSING','SUCCESS',1,?,NULL,'2026-09-29T01:00:00Z',NULL),
            (10,'2026-09-29',2,1,'EMAIL_DAY_CLOSING','SUCCESS',1,?,NULL,'2026-09-30T01:00:00Z',NULL),
            (11,'2026-09-28',11,2,'DSR_DAY_CLOSING','PENDING',1,?,NULL,NULL,'missing snapshot')`, [old, old, old, old, old, old, old, old, old, old]);
        await run(`INSERT INTO consolidated_reporting_jobs VALUES
            (1,7,'2026-09-25',1,'PENDING','DELIVERED',NULL,NULL),
            (2,4,'2026-10-02',1,'PENDING','PROCESSING',NULL,NULL)`);
        await run(`INSERT INTO segment_dsr_outbox VALUES (1,'SUCCESS',1,NULL),(2,'PENDING',4,'untouched')`);
        await run(`INSERT INTO bills VALUES (1,1200)`);
        await run(`INSERT INTO inventory_transactions VALUES (1,8)`);
        await run(`INSERT INTO returns VALUES (1,100)`);
        await run(`INSERT INTO store_credits VALUES (1,500)`);
        const auditEvents = [];
        let emailCalls = 0;
        let dsrCalls = 0;
        const service = createIntegrationOutboxService({
            database: db,
            reportingMode: "CONSOLIDATED_V2",
            now: () => new Date("2026-10-01T04:00:00.000Z"),
            sendEmail: async () => { emailCalls += 1; },
            syncDsr: async () => { dsrCalls += 1; return { success: true }; },
            logActivity: async event => { auditEvents.push(event); },
            activityExists: async () => false
        });

        const beforeOutbox = await all("SELECT * FROM integration_outbox ORDER BY id");
        const beforeBusiness = await Promise.all([
            get("SELECT COUNT(*) AS n FROM bills"), get("SELECT COUNT(*) AS n FROM inventory_transactions"),
            get("SELECT COUNT(*) AS n FROM returns"), get("SELECT COUNT(*) AS n FROM store_credits")
        ]);
        const beforeSegments = await all("SELECT * FROM segment_dsr_outbox ORDER BY id");
        const beforeJobs = await all("SELECT * FROM consolidated_reporting_jobs ORDER BY id");
        const result = await service.retireLegacyDsrBacklog();
        assert.strictEqual(result.retiredCount, 2, "only historical pending and processing legacy DSR items retire");

        const rows = await all("SELECT * FROM integration_outbox ORDER BY id");
        const byId = new Map(rows.map(row => [row.id, row]));
        for (const id of [1, 2]) {
            assert.strictEqual(byId.get(id).status, "SUCCESS");
            assert.match(byId.get(id).last_error, /^Delivery not sent: legacy DSR pipeline retired because CONSOLIDATED_V2/);
            assert.strictEqual(byId.get(id).completed_at, "2026-10-01T04:00:00.000Z");
        }
        assert.strictEqual(byId.get(2).attempt_count, 4, "PROCESSING attempt count is preserved");
        for (const id of [3, 4, 5, 6, 7, 8, 9, 10, 11]) assert.deepStrictEqual(byId.get(id), beforeOutbox.find(row => row.id === id));
        assert.strictEqual(byId.get(3).status, "PENDING", "email outbox is untouched");
        assert.strictEqual(byId.get(4).status, "PENDING", "future legacy DSR is untouched");
        assert.strictEqual(byId.get(5).last_error, null, "already successful legacy DSR is unchanged");
        assert.strictEqual(byId.get(6).last_error, "Delivery not sent: closing was reopened.", "prior retirement marker is unchanged");
        assert.strictEqual(byId.get(7).status, "PENDING", "active consolidated V2 work protects matching identity");
        assert.strictEqual(byId.get(8).status, "PENDING", "unmatched snapshot identity is not retired");
        assert.deepStrictEqual(await all("SELECT * FROM segment_dsr_outbox ORDER BY id"), beforeSegments);
        assert.deepStrictEqual(await all("SELECT * FROM consolidated_reporting_jobs ORDER BY id"), beforeJobs);
        assert.deepStrictEqual(await Promise.all([
            get("SELECT COUNT(*) AS n FROM bills"), get("SELECT COUNT(*) AS n FROM inventory_transactions"),
            get("SELECT COUNT(*) AS n FROM returns"), get("SELECT COUNT(*) AS n FROM store_credits")
        ]), beforeBusiness);
        assert.strictEqual(auditEvents.length, 2, "retirement is auditable without invoking a delivery sender");
        assert.strictEqual(emailCalls + dsrCalls, 0, "reconciliation does not invoke network sender callbacks");

        const afterFirst = await all("SELECT * FROM integration_outbox ORDER BY id");
        const second = await service.retireLegacyDsrBacklog();
        assert.strictEqual(second.retiredCount, 0, "second reconciliation is a no-op");
        assert.deepStrictEqual(await all("SELECT * FROM integration_outbox ORDER BY id"), afterFirst);
        assert.strictEqual(auditEvents.length, 2, "idempotent run creates no duplicate retirement audit events");

        const statusService = createIntegrationStatusService({ database: db, legacyOutbox: service });
        const status = await statusService.getStatusView();
        assert.strictEqual(status.pendingCount, 8, "retired items are excluded while email, future/matched legacy, and active V2 work remain countable");
        assert.strictEqual(status.failedCount, 0);
        const activeSameDate = status.deliveries.find(item => item.businessDate === "2026-09-28");
        assert.strictEqual(activeSameDate.dsrStatus, "PENDING", "a real pending row remains visible beside a retired same-date row");
        assert.strictEqual(activeSameDate.dsrRetired, undefined);
        assert.strictEqual(activeSameDate.emailStatus, "SUCCESS");
        assert.strictEqual(status.deliveries.find(item => item.businessDate === "2026-09-29").dsrRetired, true, "retired row is explicitly marked in status details");

        const integrationUiSource = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/system/integrations.js"), "utf8");
        assert(integrationUiSource.includes("item.dsrRetired ? \"RETIRED - NOT SENT\""), "retired status renders as NOT SENT rather than SYNCED/PENDING");

        const legacyMode = createIntegrationOutboxService({ database: db, reportingMode: "LEGACY" });
        assert.deepStrictEqual(await legacyMode.retireLegacyDsrBacklog(), { retiredCount: 0 }, "legacy reporting mode cannot retire work");
        console.log("PASS: pending and PROCESSING legacy DSR retirement, strict eligibility, no network, no unrelated state changes, idempotence, and Integration Status visibility");
        await close();
        fs.rmSync(dbPath, { force: true });
    } catch (error) {
        try { await close(); } catch (_) {}
        try { fs.rmSync(dbPath, { force: true }); } catch (_) {}
        throw error;
    }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
