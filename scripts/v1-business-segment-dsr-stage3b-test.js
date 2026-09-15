const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const { migrateSegmentDsrOutbox } = require("../src/database/dayClosingMigration");
const { CREATE_DAY_CLOSING_SNAPSHOTS_SQL } = require("../src/database/dayClosingMigration");
const { createDayClosingService } = require("../src/database/dayClosingService");
const { createBusinessSegmentDsrOutboxService, CONTRACT } = require("../src/services/businessSegmentDsrOutboxService");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) { error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID }); }));
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

function report(quality = true, returnOnly = false) {
    const item = (label, sales, qty, bills, atv, upt, netBilling, qtySold, returnValue, qtyReturned) => ({
        label, netSalesAfterReturns: sales, netQty: qty, bills, atv, upt,
        grossSales: netBilling, discountAmount: 0, taxableValue: netBilling,
        gstAmount: 0, netBilling, qtySold, creditNotes: returnValue ? 1 : 0,
        returnValue, qtyReturned
    });
    return {
        kairaLuxe: item("Kaira Luxe", returnOnly ? 0 : 100, returnOnly ? 0 : 1, returnOnly ? 0 : 1, returnOnly ? 0 : 100, returnOnly ? 0 : 1, returnOnly ? 0 : 100, returnOnly ? 0 : 1, 0, 0),
        mensWear: item("Mens Wear", returnOnly ? -100 : 200, returnOnly ? -2 : 2, returnOnly ? 0 : 1, returnOnly ? 0 : 200, returnOnly ? 0 : 2, returnOnly ? 0 : 200, returnOnly ? 0 : 2, returnOnly ? 100 : 0, returnOnly ? 2 : 0),
        kidsWear: item("Kids Wear", returnOnly ? 0 : 300, returnOnly ? 0 : 3, returnOnly ? 0 : 1, returnOnly ? 0 : 300, returnOnly ? 0 : 3, returnOnly ? 0 : 300, returnOnly ? 0 : 3, 0, 0),
        reconciliation: { classified: quality },
        dataQuality: { complete: quality, unclassified: quality ? { saleItems: [], returnItems: [] } : { saleItems: [{ billItemId: 9 }], returnItems: [] } }
    };
}

async function setup() {
    const db = new sqlite3.Database(":memory:");
    await migrateSegmentDsrOutbox(db);
    await migrateSegmentDsrOutbox(db);
    await run(db, `CREATE TABLE day_closing_snapshots (id INTEGER PRIMARY KEY, business_date TEXT, close_sequence INTEGER, close_status TEXT)`);
    await run(db, "INSERT INTO day_closing_snapshots VALUES (1,'2026-09-15',1,'CLOSED'),(2,'2026-09-15',2,'CLOSED'),(3,'2026-09-18',1,'CLOSED')");
    return db;
}

async function main() {
    const db = await setup();
    let nowValue = new Date("2026-09-15T12:00:00.000Z");
    const sent = [];
    let failEmail = false;
    const service = createBusinessSegmentDsrOutboxService({
        database: db,
        now: () => nowValue,
        klbsVersion: "1.0.0",
        calculateReport: async date => date === "2026-09-18" ? report(true, true) : report(),
        getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["test@example.invalid"] }),
        sendEmail: async message => { if (failEmail) throw new Error("temporary email failure"); sent.push(message); }
    });

    const first = await service.enqueue(1);
    assert.strictEqual(first.created, true);
    assert.strictEqual((await service.enqueue(1)).created, false);
    const firstRow = (await all(db, "SELECT * FROM segment_dsr_outbox WHERE closing_id=1"))[0];
    const payload = JSON.parse(firstRow.payload_json);
    assert.strictEqual(payload.contract, CONTRACT);
    assert.strictEqual(payload.reportStatus, "FINAL");
    assert.deepStrictEqual(Object.keys(payload.segments).sort(), ["KIDS", "KL", "MENS"]);
    assert.strictEqual(payload.segments.KL.sales, 100);
    assert.strictEqual(payload.segments.MENS.qty, 2);
    assert.strictEqual(payload.segments.MENS.bills, 1);
    assert.strictEqual(payload.segments.MENS.atv, 200);
    assert.strictEqual(payload.segments.MENS.upt, 2);
    assert.strictEqual(payload.segments.MENS.detail.netBilling, 200);
    assert.strictEqual(payload.businessDate, "2026-09-15");
    assert.strictEqual(await service.drain(), undefined);
    assert.strictEqual(sent.length, 1);
    assert(sent[0].text.includes("Kaira Luxe") && sent[0].text.includes("Mens Wear") && sent[0].text.includes("Kids Wear"));
    await service.drain();
    assert.strictEqual(sent.length, 1, "SUCCESS must not resend");

    const revised = await service.enqueue(2);
    assert.strictEqual(revised.created, true);
    const revisedRow = (await all(db, "SELECT * FROM segment_dsr_outbox WHERE closing_id=2"))[0];
    assert.strictEqual(revisedRow.report_status, "REVISED");
    assert.strictEqual(JSON.parse(revisedRow.payload_json).reportStatus, "REVISED");
    await service.drain();
    assert.strictEqual(sent.length, 2, "reclose sends only its own email");
    assert.strictEqual((await all(db, "SELECT status FROM segment_dsr_outbox WHERE closing_id=1"))[0].status, "SUCCESS");

    failEmail = true;
    const retryJob = await service.enqueue(3);
    assert.strictEqual(retryJob.created, true);
    await service.drain();
    let retryRow = (await all(db, "SELECT status,attempt_count FROM segment_dsr_outbox WHERE closing_id=3"))[0];
    assert.deepStrictEqual(retryRow, { status: "PENDING", attempt_count: 1 });
    await service.drain();
    assert.strictEqual((await all(db, "SELECT attempt_count FROM segment_dsr_outbox WHERE closing_id=3"))[0].attempt_count, 1, "cooldown must defer retry");
    failEmail = false;
    nowValue = new Date(nowValue.getTime() + 60001);
    await service.drain();
    assert.strictEqual((await all(db, "SELECT status FROM segment_dsr_outbox WHERE closing_id=3"))[0].status, "SUCCESS");

    await run(db, "INSERT INTO day_closing_snapshots VALUES (4,'2026-09-19',1,'CLOSED')");
    const blocked = createBusinessSegmentDsrOutboxService({ database: db, calculateReport: async () => report(false), sendEmail: async () => { throw new Error("must not send"); }, getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["test@example.invalid"] }) });
    const blockedJob = await blocked.enqueue(4);
    assert.strictEqual(blockedJob.status, "FAILED");
    assert.strictEqual((await all(db, "SELECT status,last_error FROM segment_dsr_outbox WHERE closing_id=4"))[0].status, "FAILED");

    await run(db, "INSERT INTO day_closing_snapshots VALUES (5,'2026-09-20',1,'CLOSED')");
    const recovery = createBusinessSegmentDsrOutboxService({ database: db, now: () => new Date("2026-09-20T12:00:00.000Z"), calculateReport: async () => report(), sendEmail: async () => {}, getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["test@example.invalid"] }) });
    await recovery.enqueue(5);
    await run(db, "UPDATE segment_dsr_outbox SET status='PROCESSING', processing_started_at='2026-09-20T10:00:00.000Z' WHERE closing_id=5");
    await recovery.drain();
    assert.strictEqual((await all(db, "SELECT status FROM segment_dsr_outbox WHERE closing_id=5"))[0].status, "SUCCESS");

    const returnOnlyPayload = JSON.parse((await all(db, "SELECT payload_json FROM segment_dsr_outbox WHERE closing_id=3"))[0].payload_json);
    assert.strictEqual(returnOnlyPayload.segments.MENS.sales, -100);
    assert.strictEqual(returnOnlyPayload.segments.MENS.qty, -2);
    assert.strictEqual(returnOnlyPayload.segments.MENS.bills, 0);
    assert.strictEqual(returnOnlyPayload.segments.MENS.atv, 0);
    assert.strictEqual(returnOnlyPayload.segments.MENS.upt, 0);
    assert(!/NaN|Infinity/.test(JSON.stringify(returnOnlyPayload)));

    const closeDb = new sqlite3.Database(":memory:");
    await run(closeDb, CREATE_DAY_CLOSING_SNAPSHOTS_SQL);
    await run(closeDb, "CREATE TABLE business_day_state (business_date TEXT PRIMARY KEY, state TEXT, opened_at TEXT, closed_at TEXT, updated_at TEXT)");
    await run(closeDb, "CREATE TABLE bills (id INTEGER, total_qty INTEGER, gross_amount REAL, discount_amount REAL, net_amount REAL, cash_amount REAL, upi_amount REAL, card_amount REAL, store_credit_amount REAL, gift_voucher_amount REAL, bill_date TEXT)");
    await run(closeDb, "CREATE TABLE returns (id INTEGER, net_reversal REAL, accounting_status TEXT, credit_note_no TEXT, accounting_snapshot_version INTEGER, business_date TEXT)");
    await run(closeDb, "CREATE TABLE return_items (return_id INTEGER, quantity INTEGER)");
    await run(closeDb, "CREATE TABLE customer_credit_transactions (id INTEGER, transaction_type TEXT, amount REAL, created_at TEXT)");
    const closeService = createDayClosingService({
        database: closeDb,
        now: () => new Date("2026-09-21T12:00:00.000Z"),
        getBusinessDate: () => "2026-09-21",
        createBackup: async () => ({ backupFileName: "test.zip", backupFilePath: "test.zip" }),
        validateBackup: async () => ({ success: true }),
        integrationOutbox: { enqueue: async () => {} },
        segmentDsrOutbox: { enqueue: async () => { throw new Error("segment queue unavailable"); } }
    });
    const closeResult = await closeService.closeBusinessDay("2026-09-21");
    assert.strictEqual(closeResult.success, true, "Segment enqueue failure must not fail Day Closing");
    assert.strictEqual((await all(closeDb, "SELECT close_status FROM day_closing_snapshots WHERE business_date='2026-09-21'"))[0].close_status, "CLOSED");
    await close(closeDb);

    await close(db);
    console.log("Business Segment Stage 3B outbox/email tests: PASS");
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
