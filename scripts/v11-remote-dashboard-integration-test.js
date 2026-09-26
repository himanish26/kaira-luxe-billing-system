const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const { migrateRemoteDashboardOutbox } = require("../src/database/remoteDashboardMigration");
const { buildRemoteDashboardSnapshot } = require("../src/services/remoteDashboardSnapshot");
const { createRemoteDashboardService } = require("../src/services/remoteDashboardService");
const fs = require("fs");
const crypto = require("crypto");

function run(db, sql, params = []) { return new Promise((resolve, reject) => db.run(sql, params, function (error) { error ? reject(error) : resolve(this); })); }
function all(db, sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))); }
function makeDb() { return new Promise((resolve, reject) => { const db = new sqlite3.Database(":memory:", error => error ? reject(error) : resolve(db)); }); }

(async () => {
    const db = await makeDb();
    await run(db, "CREATE TABLE bills (id INTEGER PRIMARY KEY, bill_no TEXT, bill_date TEXT, bill_time TEXT, net_amount REAL, total_qty INTEGER, cash_amount REAL, upi_amount REAL, card_amount REAL, customer_name TEXT, customer_mobile TEXT, created_at TEXT)");
    await run(db, "CREATE TABLE bill_items (bill_no TEXT, business_segment TEXT, qty INTEGER, net_amount REAL)");
    await run(db, "CREATE TABLE day_closing_snapshots (business_date TEXT, close_status TEXT, close_sequence INTEGER, closed_at TEXT, dsr_sync_status TEXT, dsr_synced_at TEXT)");
    await run(db, "CREATE TABLE settings (id INTEGER PRIMARY KEY, auto_backup_last_success_at TEXT)");
    await run(db, "INSERT INTO settings VALUES (1, '2026-09-26T10:00:00+05:30')");
    await run(db, "INSERT INTO bills VALUES (1,'KL260926001','2026-09-26','10:00:00',100,2,50,50,0,'Private','9876543210','2026-09-26T10:00:00+05:30')");
    await run(db, "INSERT INTO bills VALUES (2,'KL260926002','2026-09-26','11:00:00',200,4,0,100,100,'Another','9123456789','2026-09-26T11:00:00+05:30')");
    await run(db, "INSERT INTO bills VALUES (3,'KL260925001','2026-09-25','12:00:00',999,1,999,0,0,'Old','9000000000','2026-09-25T12:00:00+05:30')");
    await run(db, "INSERT INTO bill_items VALUES ('KL260926001','KL',1,60),('KL260926001','MENS',1,40),('KL260926002','KIDS',3,200),('KL260926002','KL',1,10.005),('KL260926002','KL',1,10.005),('KL260926002','MENS',1,20.005)");
    const snapshot = await buildRemoteDashboardSnapshot({ database: db, businessDate: "2026-09-26", now: () => new Date("2026-09-26T10:00:00+05:30"), getStatus: async () => ({ session_started_at: "2026-09-26T09:00:00+05:30", day_closing: { status: "OPEN" }, last_backup: { status: "SUCCESS" }, dsr_reporting: null }) });
    assert.deepStrictEqual(Object.keys(snapshot).sort(), ["backup", "business_date", "contract_id", "day_closing", "dsr", "generated_at", "merchant_id", "merchant_name", "mtd", "payments", "recent_bills", "request_id", "segments", "session_started_at", "snapshot_id", "store_code", "store_name", "terminal_id", "terminal_name", "today"].sort());
    assert.strictEqual(snapshot.contract_id, "klbs.remote-dashboard.snapshot.v1");
    assert.deepStrictEqual({ merchant_id: snapshot.merchant_id, store_code: snapshot.store_code, terminal_id: snapshot.terminal_id }, { merchant_id: "KAIRA_LUXE", store_code: "KL001", terminal_id: "POS01" });
    assert.strictEqual(snapshot.today.net_sales_paise, 30000);
    assert.strictEqual(snapshot.today.bills, 2);
    assert.strictEqual(snapshot.today.qty, 6);
    assert.deepStrictEqual(snapshot.today, { net_sales_paise: 30000, bills: 2, qty: 6 });
    assert.deepStrictEqual(snapshot.payments, { cash_paise: 5000, upi_paise: 15000, card_paise: 10000 });
    assert.deepStrictEqual(snapshot.segments, { KL: { net_sales_paise: 8002, bills: 2 }, MENS: { net_sales_paise: 6000, bills: 2 }, KIDS: { net_sales_paise: 20000, bills: 1 } });
    const naiveSegments = await all(db, "SELECT business_segment AS segment, SUM(net_amount) AS sales FROM bill_items WHERE bill_no = 'KL260926002' GROUP BY business_segment");
    const naiveMixedSegments = Object.fromEntries(naiveSegments.map(row => [row.segment, Math.round(row.sales * 100)]));
    assert.deepStrictEqual(naiveMixedSegments, { KL: 2001, MENS: 2001, KIDS: 20000 });
    assert.notStrictEqual(naiveMixedSegments.KL, snapshot.segments.KL.net_sales_paise - 6000);
    assert.strictEqual(snapshot.segments.KL.net_sales_paise + snapshot.segments.MENS.net_sales_paise + snapshot.segments.KIDS.net_sales_paise, 34002);
    assert.notStrictEqual(snapshot.segments.KL.net_sales_paise + snapshot.segments.MENS.net_sales_paise + snapshot.segments.KIDS.net_sales_paise, snapshot.today.net_sales_paise);
    assert.strictEqual(snapshot.mtd.net_sales_paise, 129900);
    assert.strictEqual(snapshot.recent_bills.length, 3);
    assert(!JSON.stringify(snapshot).includes("9876543210") && !JSON.stringify(snapshot).includes("Private"));
    assert(!JSON.stringify(snapshot).includes("billing.db"));
    assert(!JSON.stringify(snapshot).includes("secret"));
    assert(/^2026-09-26T.*\+05:30$/.test(snapshot.generated_at));
    const emptyDb = await makeDb();
    await run(emptyDb, "CREATE TABLE bills (id INTEGER PRIMARY KEY, bill_no TEXT, bill_date TEXT, bill_time TEXT, net_amount REAL, total_qty INTEGER, cash_amount REAL, upi_amount REAL, card_amount REAL, created_at TEXT)");
    await run(emptyDb, "CREATE TABLE bill_items (bill_no TEXT, business_segment TEXT, qty INTEGER, net_amount REAL)");
    const emptySnapshot = await buildRemoteDashboardSnapshot({ database: emptyDb, businessDate: "2026-09-26", now: () => new Date("2026-09-26T10:00:00+05:30") });
    assert.deepStrictEqual(emptySnapshot.today, { net_sales_paise: 0, bills: 0, qty: 0 });
    await emptyDb.close();
    assert(!/remoteDashboard|REMOTE_DASHBOARD|secret/i.test(fs.readFileSync("src/main/preload.js", "utf8")));

    await migrateRemoteDashboardOutbox(db);
    await migrateRemoteDashboardOutbox(db);
    let calls = 0;
    const requests = [];
    const service = createRemoteDashboardService({ database: db, now: () => new Date("2026-09-26T10:00:00+05:30"), configProvider: () => ({ webAppBase: "https://script.example.test/exec", gatewayBase: "https://gateway.example.test", secret: "fictional-installation-secret", enabled: true }), post: async (endpoint, envelope) => { calls += 1; requests.push({ endpoint, envelope }); return { status: 200, data: { ok: true, code: "ACCEPTED" } }; } });
    await service.queueBillSaved({ bill_no: "KL260926001", bill_date: "1900-01-01", net_amount: 999999 });
    await service.queueBillSaved({ bill_no: "KL260926001", bill_date: "1900-01-01", net_amount: 999999 });
    await service.queueStarted();
    await service.queueDayClosed({ snapshot: { businessDate: "2026-09-26", closeSequence: 1, closedAt: snapshot.generated_at, netSalesAfterReturns: 300 } });
    assert.strictEqual((await all(db, "SELECT * FROM remote_dashboard_outbox")).length, 3);
    await service.drain();
    assert.strictEqual(calls, 3);
    assert((await all(db, "SELECT * FROM remote_dashboard_outbox WHERE status='ACCEPTED'")).length === 3);
    assert.strictEqual(requests[0].endpoint, "https://gateway.example.test/api/events");
    assert.strictEqual(requests[0].envelope.context, "/notification-events");
    assert.strictEqual(requests[0].envelope.method, "POST");
    assert.strictEqual(requests[0].envelope.body.contract_id, "klbs.remote-dashboard.notification-event.v1");
    assert.deepStrictEqual({
        bill_no: requests[0].envelope.body.bill_no,
        business_date: requests[0].envelope.body.business_date,
        net_amount_paise: requests[0].envelope.body.net_amount_paise,
        bill_time: requests[0].envelope.body.bill_time
    }, {
        bill_no: "KL260926001",
        business_date: "2026-09-26",
        net_amount_paise: 10000,
        bill_time: "2026-09-26T10:00:00+05:30"
    });
    assert.deepStrictEqual(Object.keys(requests[0].envelope.body).sort(), ["bill_no", "bill_time", "business_date", "contract_id", "event_at", "event_id", "event_type", "merchant_id", "net_amount_paise", "store_code", "terminal_id"].sort());
    assert.strictEqual(requests[1].envelope.body.event_type, "KLBS_STARTED");
    assert.strictEqual(requests[2].envelope.body.event_type, "DAY_CLOSED");
    await service.syncSnapshot();
    assert.strictEqual(calls, 4);
    assert.strictEqual(requests[3].endpoint, "https://script.example.test/exec");
    assert.strictEqual(requests[3].envelope.context, "/snapshot");
    assert.strictEqual(requests[3].envelope.body.contract_id, "klbs.remote-dashboard.snapshot.v1");
    const snapshotEnvelope = requests[3].envelope;
    const canonical = service._test.stableJson(snapshotEnvelope.body);
    const digest = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
    const signingMaterial = ["KLBS-SIGNATURE-v1", "POST", "/snapshot", snapshotEnvelope.body.contract_id, snapshotEnvelope.body.merchant_id, snapshotEnvelope.body.store_code, snapshotEnvelope.body.terminal_id, snapshotEnvelope.request_timestamp, snapshotEnvelope.request_id, digest].join("\n");
    assert.strictEqual(snapshotEnvelope.signature, crypto.createHmac("sha256", "fictional-installation-secret").update(signingMaterial, "utf8").digest("hex"));
    assert.strictEqual(service._test.classify({ status: 200, data: { code: "DUPLICATE" } }), "ACCEPTED");
    assert.strictEqual(service._test.classify({ status: 503, data: { code: "SERVER_BUSY" } }), "RETRYABLE_FAILURE");
    assert.strictEqual(service._test.classify({ status: 400, data: { code: "INVALID_EVENT" } }), "PERMANENT_FAILURE");
    const eventPayload = JSON.stringify((await all(db, "SELECT payload_json FROM remote_dashboard_outbox"))).toLowerCase();
    assert(!eventPayload.includes("customer") && !eventPayload.includes("mobile"));

    const failureDb = await makeDb();
    await migrateRemoteDashboardOutbox(failureDb);
    await run(failureDb, "CREATE TABLE bills (bill_no TEXT, bill_date TEXT, net_amount REAL, created_at TEXT)");
    await run(failureDb, "INSERT INTO bills VALUES ('B1','2026-09-26',10,'2026-09-26T10:00:00+05:30')");
    let failureCalls = 0;
    const failureService = createRemoteDashboardService({ database: failureDb, now: () => new Date("2026-09-26T10:00:00+05:30"), configProvider: () => ({ webAppBase: "https://script.example.test/exec", gatewayBase: "https://gateway.example.test", secret: "fictional-installation-secret", enabled: true }), post: async () => { failureCalls += 1; throw new Error("network down"); } });
    await failureService.queueBillSaved({ bill_no: "B1", bill_date: "2026-09-26", net_amount: 10 });
    await failureService.drain();
    const failed = (await all(failureDb, "SELECT * FROM remote_dashboard_outbox"))[0];
    assert.strictEqual(failed.status, "RETRYABLE_FAILURE");
    assert(failureCalls === 1 && failed.next_attempt_at);
    for (let attempt = 0; attempt < 8; attempt++) {
        await run(failureDb, "UPDATE remote_dashboard_outbox SET next_attempt_at=?", ["2026-09-26T09:00:00+05:30"]);
        await failureService.drain();
    }
    const stillRetryable = (await all(failureDb, "SELECT * FROM remote_dashboard_outbox"))[0];
    assert.strictEqual(stillRetryable.status, "RETRYABLE_FAILURE");
    assert(stillRetryable.attempt_count > 8);
    await db.close(); await failureDb.close();
    console.log("Remote Dashboard KLBS integration tests: PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
