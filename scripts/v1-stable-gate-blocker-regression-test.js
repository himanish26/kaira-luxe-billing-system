const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const sqlite3 = require("sqlite3").verbose();
const { validateResponse, createDsrSyncService } = require("../src/services/dsrSyncService");
const { createIntegrationOutboxService } = require("../src/services/integrationOutboxService");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
const close = db => new Promise(resolve => db.close(resolve));

function loadAppsScriptHelpers() {
    const source = fs.readFileSync("deployment/google-apps-script/KLBS_DSR_WebApp.gs", "utf8");
    const start = source.indexOf("function meaningfulRow_");
    const end = source.indexOf("function businessDateCell_", start);
    const context = {
        Utilities: { formatDate: () => "2026-09-02" },
        Session: { getScriptTimeZone: () => "Asia/Kolkata" }
    };
    vm.runInNewContext(`${source.slice(start, end)}; this.meaningful = meaningfulRow_; this.closedAtMs = closedAtMillis_; this.normalize = normalizeBusinessDate_;`, context);
    return { source, context };
}

function appsScriptRegressionTests() {
    const { source, context } = loadAppsScriptHelpers();
    const payload = {
        contractVersion: 1, businessDate: "2026-09-02", closingId: 4, closeSequence: 4,
        snapshotVersion: 1, closedAt: "2026-09-02T12:00:00.000Z", totalBills: 2, qtySold: 3,
        grossSalesPaise: 1000, totalDiscountPaise: 0, netBillingPaise: 1000, creditNoteCount: 0,
        qtyReturned: 0, returnCnValuePaise: 0, netSalesAfterReturnsPaise: 1000, cashPaise: 1000,
        upiPaise: 0, cardPaise: 0, storeCreditRedeemedPaise: 0, giftVoucherRedeemedPaise: 0,
        settlementTotalPaise: 1000, actualMoneyCollectionPaise: 1000, storeCreditIssuedPaise: 0,
        settlementDifferencePaise: 0, backupStatus: "SUCCESS", emailStatus: "SUCCESS", klbsVersion: "1.0.0"
    };
    const row = context.meaningful(payload);
    assert(Object.prototype.toString.call(row[5]) === "[object Date]", "Closed At row value must be a Date object");
    assert.strictEqual(context.closedAtMs(row[5]), Date.parse(payload.closedAt));
    assert.strictEqual(context.closedAtMs("2026-09-02T12:00:00.000Z"), row[5].getTime());
    assert.strictEqual(context.closedAtMs("not-a-timestamp"), null);
    assert.strictEqual(context.normalize("2026-09-02"), "2026-09-02");
    assert.strictEqual(context.normalize("02/09/2026"), "2026-09-02");
    assert.strictEqual(context.normalize("02 Sep, 2026"), "2026-09-02");
    assert.strictEqual(context.normalize(new Date("2026-09-02T12:00:00Z"), "Asia/Kolkata"), "2026-09-02");
    assert.notStrictEqual(context.closedAtMs("2026-09-02T12:00:01.000Z"), row[5].getTime());
    assert(source.includes("new Date(payload.closedAt)"));
    assert(source.includes("sheet.appendRow([\n    new Date(),"));
    assert(source.includes("setNumberFormat('dd-mmm-yyyy hh:mm:ss AM/PM')"));
}

function responseRegressionTests() {
    const payload = { businessDate: "2026-09-02", closingId: 4, closeSequence: 4 };
    assert.throws(() => validateResponse({ ok: false, error: "Equal-sequence integrity conflict." }, payload), /Equal-sequence integrity conflict/);
    assert.throws(() => validateResponse({ ok: false, error: "https://user:secret@example.test/hook token=abc" }, payload), error => {
        assert(!error.message.includes("https://"));
        assert(!error.message.includes("token=abc"));
        return true;
    });
    assert.throws(() => validateResponse({ ok: false }, payload), /unsuccessful response/);
}

async function outboxCooldownTests() {
    const db = new sqlite3.Database(":memory:");
    await run(db, "CREATE TABLE day_closing_snapshots (id INTEGER PRIMARY KEY, business_date TEXT, close_status TEXT, backup_reference TEXT, backup_status TEXT, email_status TEXT, dsr_sync_status TEXT, updated_at TEXT, dsr_synced_at TEXT, dsr_sync_error TEXT)");
    await run(db, "CREATE TABLE integration_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT, closing_id INTEGER, close_sequence INTEGER, delivery_type TEXT, status TEXT DEFAULT 'PENDING', attempt_count INTEGER DEFAULT 0, created_at TEXT, last_attempt_at TEXT, completed_at TEXT, last_error TEXT, UNIQUE(closing_id, delivery_type))");
    await run(db, "INSERT INTO day_closing_snapshots VALUES (1,'2026-09-02','CLOSED','backup.zip','SUCCESS','PENDING','NOT_ATTEMPTED',NULL,NULL,NULL)");
    let clock = new Date("2026-09-05T00:00:00.000Z");
    let attempts = 0;
    const service = createIntegrationOutboxService({
        database: db, now: () => clock, syncDsr: async () => { attempts += 1; return { success: true }; },
        readDsrPayload: async () => ({ businessDate: "2026-09-02" })
    });
    await service.enqueue(1, "2026-09-02", 4);
    await run(db, "DELETE FROM integration_outbox WHERE delivery_type='EMAIL_DAY_CLOSING'");
    await service.drain();
    const first = await get(db, "SELECT attempt_count,last_attempt_at,status FROM integration_outbox");
    assert.strictEqual(attempts, 1);
    assert.strictEqual(first.attempt_count, 1);
    assert.strictEqual(first.status, "SUCCESS");
    await service.drain();
    assert.strictEqual(attempts, 1, "successful delivery must never retry");

    await run(db, "UPDATE integration_outbox SET status='PENDING', last_error='forced failure', completed_at=NULL, last_attempt_at=NULL");
    const failService = createIntegrationOutboxService({
        database: db, now: () => clock, syncDsr: async () => { attempts += 1; return { success: false, error: "temporary" }; },
        readDsrPayload: async () => ({ businessDate: "2026-09-02" })
    });
    await failService.drain();
    const failed = await get(db, "SELECT attempt_count,last_attempt_at,status FROM integration_outbox");
    assert.strictEqual(attempts, 2);
    assert.strictEqual(failed.status, "PENDING");
    assert.strictEqual(failed.attempt_count, 2);
    const lastAttempt = failed.last_attempt_at;
    for (const seconds of [15, 30, 59]) {
        clock = new Date(new Date(lastAttempt).getTime() + seconds * 1000);
        await failService.drain();
        const cooling = await get(db, "SELECT attempt_count,last_attempt_at FROM integration_outbox");
        assert.strictEqual(attempts, 2, `must not retry at ${seconds}s`);
        assert.strictEqual(cooling.attempt_count, 2);
        assert.strictEqual(cooling.last_attempt_at, lastAttempt);
    }
    clock = new Date(new Date(lastAttempt).getTime() + 60000);
    await failService.drain();
    assert.strictEqual(attempts, 3, "retry must become eligible at 60s");
    const afterRetry = await get(db, "SELECT attempt_count FROM integration_outbox");
    assert.strictEqual(afterRetry.attempt_count, 3);
    await close(db);
}

(async () => {
    appsScriptRegressionTests();
    responseRegressionTests();
    await outboxCooldownTests();
    console.log("PASS blocker regression: Closed At/idempotency, Business Date normalization, safe DSR errors, KLBS_Test Date/format, and persisted retry cooldown");
})().catch(error => { console.error(error); process.exitCode = 1; });
