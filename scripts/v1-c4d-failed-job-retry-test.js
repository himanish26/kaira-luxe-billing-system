const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const {
    CREATE_CONSOLIDATED_REPORTING_JOBS_SQL,
    migrateConsolidatedReportingJobs
} = require("../src/database/dayClosingMigration");
const {
    canonicalizeSemanticPayload,
    buildConsolidatedPayload
} = require("../src/shared/consolidatedDsrBuilder");
const { sha256Utf8 } = require("../src/services/consolidatedReportingTransport");
const { createConsolidatedSheetDeliveryWorker } = require("../src/services/consolidatedSheetDeliveryWorker");

const NOW = "2026-09-22T11:00:00.000Z";
const NEXT = "2026-09-22T11:00:01.000Z";
const ENDPOINT = "https://placeholder.invalid/consolidated";
const SECRET = "c4d-retry-test-secret";

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        if (error) reject(error); else resolve({ changes: this.changes, lastID: this.lastID });
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
async function setup() {
    const db = new sqlite3.Database(":memory:");
    await migrateConsolidatedReportingJobs(db);
    return db;
}
function payloadFor(closingId, closeSequence) {
    return buildConsolidatedPayload({
        metadata: {
            businessDate: "2026-09-21", closingId: String(closingId), closeSequence: String(closeSequence),
            closedAt: "2026-09-21T18:00:00.000Z", klbsVersion: "1.1.0"
        },
        overall: {
            totalBills: 0, cashPaise: "0", upiPaise: "0", cardPaise: "0",
            storeCreditRedeemedPaise: "0", giftVoucherRedeemedPaise: "0"
        },
        bills: []
    });
}
async function insertJob(db, id, options = {}) {
    const payload = options.payload || payloadFor(options.closingId || id, options.closeSequence || id);
    const payloadJson = canonicalizeSemanticPayload(payload);
    await run(db, `INSERT INTO consolidated_reporting_jobs
        (id,closing_id,business_date,close_sequence,contract_version,snapshot_version,payload_json,payload_hash,
         report_status,data_quality_status,created_at,sheet_status,sheet_attempt_count,sheet_last_attempt_at,
         sheet_processing_started_at,sheet_last_error,sheet_delivered_at,email_status,email_attempt_count)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        id, options.closingId || id, payload.businessDate, options.closeSequence || id,
        payload.contractVersion, payload.snapshotVersion, payloadJson, sha256Utf8(payloadJson),
        "FINAL", "COMPLETE", "2026-09-21T18:00:00.000Z", options.sheetStatus || "FAILED",
        options.attemptCount === undefined ? 1 : options.attemptCount,
        options.lastAttemptAt || "2026-09-22T10:00:00.000Z", options.processingStartedAt || null,
        options.lastError === undefined ? "historical terminal error" : options.lastError,
        options.deliveredAt || null, "PENDING", 0
    ]);
}
function workerFor(db, httpClient, now = () => new Date(NOW)) {
    return createConsolidatedSheetDeliveryWorker({
        database: db, httpClient, now,
        configProvider: () => ({ endpoint: ENDPOINT, secret: SECRET })
    });
}
async function row(db, id) {
    return get(db, "SELECT * FROM consolidated_reporting_jobs WHERE id=?", [id]);
}
async function testExplicitRequeueAndFrozenJobDelivery() {
    const db = await setup();
    await insertJob(db, 1, { closingId: 6, closeSequence: 1 });
    await insertJob(db, 2, { closingId: 7, closeSequence: 2 });
    const before = await row(db, 2);
    const worker = workerFor(db, {
        post: async (_, envelope) => {
            assert.strictEqual(envelope.payloadHash, before.payload_hash);
            assert.strictEqual(canonicalizeSemanticPayload(envelope.payload), before.payload_json);
            assert.deepStrictEqual(Object.keys(envelope.payload.segments), ["KL", "MENS", "KIDS"]);
            return {
                status: 200,
                data: {
                    ok: true, transportVersion: 1, action: "UPDATED",
                    businessDate: "2026-09-21", closingId: "7", closeSequence: "2",
                    payloadHash: before.payload_hash, receivedAt: NEXT
                }
            };
        }
    }, () => new Date(NEXT));
    const requeued = await worker.requeueFailedJob(2);
    assert.deepStrictEqual(requeued, { requeued: true, jobId: 2 });
    const afterRequeue = await row(db, 2);
    for (const field of ["payload_json", "payload_hash", "closing_id", "close_sequence", "contract_version", "snapshot_version", "sheet_attempt_count", "sheet_last_attempt_at", "sheet_last_error", "sheet_delivered_at"]) {
        assert.strictEqual(afterRequeue[field], before[field], `${field} changed during requeue`);
    }
    assert.strictEqual(afterRequeue.sheet_status, "PENDING");
    assert.strictEqual(afterRequeue.sheet_processing_started_at, null);
    const job1Before = await row(db, 1);
    const result = await worker.processNext();
    assert.strictEqual(result.jobId, 2);
    assert.strictEqual(result.status, "DELIVERED");
    const after = await row(db, 2);
    assert.strictEqual(after.sheet_status, "DELIVERED");
    assert.strictEqual(after.sheet_attempt_count, 2);
    assert.strictEqual(after.sheet_last_error, null);
    assert.strictEqual(after.sheet_processing_started_at, null);
    assert(after.sheet_delivered_at);
    assert.deepStrictEqual(await row(db, 1), job1Before);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM consolidated_reporting_jobs")).count, 2);
    await close(db);
}
async function testRejectedStates() {
    for (const [status, id] of [["PENDING", 10], ["PROCESSING", 11], ["DELIVERED", 12]]) {
        const db = await setup();
        await insertJob(db, id, { sheetStatus: status, processingStartedAt: status === "PROCESSING" ? NOW : null, deliveredAt: status === "DELIVERED" ? NOW : null });
        const before = await row(db, id);
        const result = await workerFor(db, { post: async () => { throw new Error("not called"); } }).requeueFailedJob(id);
        assert.deepStrictEqual(result, { requeued: false, jobId: id, code: "JOB_NOT_REQUEUEABLE" });
        assert.deepStrictEqual(await row(db, id), before);
        await close(db);
    }
    const db = await setup();
    const result = await workerFor(db, { post: async () => { throw new Error("not called"); } }).requeueFailedJob(9999);
    assert.deepStrictEqual(result, { requeued: false, jobId: 9999, code: "JOB_NOT_REQUEUEABLE" });
    assert.deepStrictEqual(await workerFor(db, { post: async () => { throw new Error("not called"); } }).requeueFailedJob("2"), { requeued: false, jobId: null, code: "INVALID_JOB_ID" });
    await close(db);
}
async function testOutcomeClassifications() {
    for (const [response, expectedStatus] of [
        [{ status: 200, data: { ok: true, transportVersion: 1, action: "UPDATED", businessDate: "2026-09-21", closingId: "20", closeSequence: "20", payloadHash: "wrong", receivedAt: NEXT } }, "FAILED"],
        [{ status: 500, data: {} }, "PENDING"]
    ]) {
        const db = await setup();
        await insertJob(db, 20, { closingId: 20, closeSequence: 20, sheetStatus: "PENDING", attemptCount: 0, lastError: null, lastAttemptAt: null });
        const worker = workerFor(db, { post: async () => response });
        const result = await worker.processNext();
        assert.strictEqual(result.status, expectedStatus);
        assert.strictEqual((await row(db, 20)).sheet_status, expectedStatus);
        await close(db);
    }
}
async function testStaleRecoveryAndSchema() {
    const db = await setup();
    await insertJob(db, 30, { sheetStatus: "PROCESSING", processingStartedAt: "2026-09-22T10:00:00.000Z" });
    const worker = workerFor(db, { post: async () => { throw new Error("not called"); } }, () => new Date("2026-09-22T11:00:00.000Z"));
    assert.strictEqual(await worker.recoverStaleProcessing(), 1);
    assert.strictEqual((await row(db, 30)).sheet_status, "PENDING");
    assert.strictEqual(CREATE_CONSOLIDATED_REPORTING_JOBS_SQL.includes("payload_hash TEXT NOT NULL"), true);
    await close(db);
}
(async () => {
    await testExplicitRequeueAndFrozenJobDelivery();
    await testRejectedStates();
    await testOutcomeClassifications();
    await testStaleRecoveryAndSchema();
    console.log("C4D controlled failed-job retry tests: PASS");
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
