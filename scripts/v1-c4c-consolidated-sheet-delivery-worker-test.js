const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const {
    CREATE_CONSOLIDATED_REPORTING_JOBS_SQL,
    migrateConsolidatedReportingJobs
} = require("../src/database/dayClosingMigration");
const { sha256Utf8 } = require("../src/services/consolidatedReportingTransport");
const {
    STALE_PROCESSING_TIMEOUT_MS,
    MAX_REDIRECTS,
    createConsolidatedSheetDeliveryWorker
} = require("../src/services/consolidatedSheetDeliveryWorker");

const ATTEMPT_AT = "2026-09-21T13:42:18.527Z";
const RECEIVED_AT = "2026-09-21T13:42:20.000Z";
const SECRET = "c4c-placeholder-secret";
const ENDPOINT = "https://placeholder.invalid/consolidated";
const MODES = ["cash", "upi", "card", "storeCreditRedeemed", "giftVoucherRedeemed"];

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
function payloadFor({ closingId = "8101", closeSequence = "1", businessDate = "2026-09-21" } = {}) {
    return {
        contractVersion: 2,
        snapshotVersion: 2,
        businessDate,
        closingId,
        closeSequence,
        closedAt: "2026-09-21T13:00:00.000Z",
        klbsVersion: "1.1.0",
        reportStatus: "FINAL",
        dataQuality: { status: "COMPLETE", diagnostics: [], affectedBills: [] },
        overall: { totalBills: 0, cashPaise: "0" },
        segments: {
            KL: { bills: 0, qtySold: null, netContributionPaise: null, cashPaise: "0", upiPaise: "0", cardPaise: "0", storeCreditRedeemedPaise: "0", giftVoucherRedeemedPaise: "0" },
            MENS: { bills: 0, qtySold: null, netContributionPaise: null, cashPaise: "0", upiPaise: "0", cardPaise: "0", storeCreditRedeemedPaise: "0", giftVoucherRedeemedPaise: "0" },
            KIDS: { bills: 0, qtySold: null, netContributionPaise: null, cashPaise: "0", upiPaise: "0", cardPaise: "0", storeCreditRedeemedPaise: "0", giftVoucherRedeemedPaise: "0" }
        },
        paymentReconciliation: Object.fromEntries(MODES.map(mode => [mode, { overallPaise: "0", segmentSumPaise: "0", deltaPaise: "0", status: "PASS" }])),
        sourceAudit: { billPopulation: "C4C synthetic placeholder" }
    };
}
async function insertJob(db, options = {}) {
    const payload = options.payload || payloadFor(options);
    const payloadJson = JSON.stringify(payload);
    const values = {
        closing_id: Number(payload.closingId), business_date: payload.businessDate, close_sequence: Number(payload.closeSequence),
        payload_json: payloadJson, payload_hash: sha256Utf8(payloadJson),
        sheet_status: "PENDING", sheet_attempt_count: 0, sheet_last_error: null, sheet_delivered_at: null,
        email_status: "PENDING", email_attempt_count: 0, email_last_error: null, email_delivered_at: null,
        sheet_last_attempt_at: null, sheet_processing_started_at: null, email_last_attempt_at: null, email_processing_started_at: null,
        ...options
    };
    await run(db, `INSERT INTO consolidated_reporting_jobs
        (closing_id,business_date,close_sequence,contract_version,snapshot_version,payload_json,payload_hash,
         report_status,data_quality_status,created_at,sheet_status,sheet_attempt_count,sheet_last_error,
         sheet_delivered_at,email_status,email_attempt_count,email_last_error,email_delivered_at,
         sheet_last_attempt_at,sheet_processing_started_at,email_last_attempt_at,email_processing_started_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        values.closing_id, values.business_date, values.close_sequence, 2, 2, values.payload_json, values.payload_hash,
        options.report_status || "FINAL", options.data_quality_status || "COMPLETE", "2026-09-21T13:00:00.000Z",
        values.sheet_status, values.sheet_attempt_count, values.sheet_last_error, values.sheet_delivered_at,
        values.email_status, values.email_attempt_count, values.email_last_error, values.email_delivered_at,
        values.sheet_last_attempt_at, values.sheet_processing_started_at, values.email_last_attempt_at, values.email_processing_started_at
    ]);
}
function responseFor(action, envelope, receivedAt = RECEIVED_AT) {
    return { status: action === "INSERTED" ? 201 : 200, data: {
        ok: true, transportVersion: 1, action,
        businessDate: envelope.payload.businessDate, closingId: envelope.payload.closingId,
        closeSequence: envelope.payload.closeSequence, payloadHash: envelope.payloadHash, receivedAt
    }};
}
function workerFor(db, httpClient, now = () => new Date(ATTEMPT_AT)) {
    return createConsolidatedSheetDeliveryWorker({
        database: db, httpClient, now,
        configProvider: () => ({ endpoint: ENDPOINT, secret: SECRET })
    });
}
async function row(db, id = 8101) {
    return get(db, "SELECT * FROM consolidated_reporting_jobs WHERE closing_id=?", [id]);
}
function assertEmailUnchanged(before, after) {
    for (const field of ["email_status", "email_attempt_count", "email_last_error", "email_delivered_at", "email_last_attempt_at", "email_processing_started_at"]) {
        assert.strictEqual(after[field], before[field], `${field} changed`);
    }
}

async function testClaimAndInsertedEnvelope() {
    const db = await setup(); await insertJob(db);
    const before = await row(db);
    let request;
    const worker = workerFor(db, { post: async (url, envelope, config) => { request = { url, envelope, config }; return responseFor("INSERTED", envelope); } });
    const result = await worker.processNext();
    const after = await row(db);
    assert.strictEqual(result.status, "DELIVERED");
    assert.strictEqual(after.sheet_status, "DELIVERED");
    assert.strictEqual(after.sheet_attempt_count, 1);
    assert.strictEqual(after.sheet_last_attempt_at, ATTEMPT_AT);
    assert.strictEqual(after.sheet_processing_started_at, null);
    assert.match(after.sheet_delivered_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.strictEqual(after.sheet_last_error, null);
    assert.strictEqual(request.url, ENDPOINT);
    assert.strictEqual(request.config.timeout, 30000);
    assert.strictEqual(request.config.maxRedirects, MAX_REDIRECTS);
    assert.doesNotThrow(() => request.config.beforeRedirect({ protocol: "https:" }));
    assert.throws(() => request.config.beforeRedirect({ protocol: "http:" }), /must use HTTPS/);
    assert.strictEqual(request.config.headers["Content-Type"], "application/json");
    assert.deepStrictEqual(Object.keys(request.envelope), ["transportVersion", "timestamp", "payload", "payloadHash", "signature"]);
    assert.strictEqual(request.envelope.timestamp, ATTEMPT_AT);
    assert.strictEqual(request.envelope.payload.businessDate, "2026-09-21");
    assert.match(request.envelope.signature, /^[0-9a-f]{64}$/);
    assert.strictEqual(after.payload_json, before.payload_json);
    assert.strictEqual(after.payload_hash, before.payload_hash);
    assertEmailUnchanged(before, after);
    await close(db);
}

async function testActions() {
    for (const action of ["UPDATED", "UNCHANGED"]) {
        const db = await setup(); await insertJob(db);
        const worker = workerFor(db, { post: async (_, envelope) => responseFor(action, envelope) });
        assert.strictEqual((await worker.processNext()).status, "DELIVERED");
        assert.strictEqual((await row(db)).sheet_status, "DELIVERED"); await close(db);
    }
    const db = await setup(); await insertJob(db);
    const worker = workerFor(db, { post: async (_, envelope) => responseFor("STALE", envelope) });
    const result = await worker.processNext(); const stored = await row(db);
    assert.strictEqual(result.status, "FAILED"); assert.strictEqual(result.code, "STALE_SUPERSEDED"); assert.strictEqual(stored.sheet_delivered_at, null); await close(db);
}

async function testHttp200CompatibilityAndIdentityValidation() {
    const db = await setup(); await insertJob(db);
    const worker = workerFor(db, { post: async (_, envelope) => ({ ...responseFor("INSERTED", envelope), status: 200 }) });
    const result = await worker.processNext(); const stored = await row(db);
    assert.strictEqual(result.status, "DELIVERED");
    assert.strictEqual(stored.sheet_status, "DELIVERED");
    await close(db);

    for (const mutate of [
        response => ({ ...response, businessDate: "2026-09-20" }),
        response => ({ ...response, closingId: "9999" }),
        response => ({ ...response, closeSequence: "99" }),
        response => ({ ...response, payloadHash: "0".repeat(64) }),
        response => ({ ...response, transportVersion: 2 }),
        response => ({ ...response, action: "UNKNOWN" }),
        () => ({})
    ]) {
        const invalidDb = await setup(); await insertJob(invalidDb);
        const invalidWorker = workerFor(invalidDb, { post: async (_, envelope) => ({
            status: 200,
            data: mutate(responseFor("INSERTED", envelope).data)
        }) });
        const invalidResult = await invalidWorker.processNext();
        assert.strictEqual(invalidResult.code, "INVALID_RESPONSE");
        assert.strictEqual((await row(invalidDb)).sheet_status, "FAILED");
        await close(invalidDb);
    }

    for (const action of ["AUTHENTICATION_FAILED", "CONFLICT", "REJECTED"]) {
        const errorDb = await setup(); await insertJob(errorDb);
        const errorWorker = workerFor(errorDb, { post: async () => ({
            status: 200,
            data: { ok: false, transportVersion: 1, action, errorCode: action, message: "safe placeholder" }
        }) });
        const errorResult = await errorWorker.processNext();
        assert.strictEqual(errorResult.code, "INVALID_RESPONSE");
        assert.strictEqual((await row(errorDb)).sheet_status, "FAILED");
        await close(errorDb);
    }
}

async function testTerminalResponses() {
    for (const [status, expectedCode, data] of [
        [409, "CONFLICT", { ok: false, transportVersion: 1, action: "CONFLICT", errorCode: "CONFLICT", message: "placeholder" }],
        [401, "AUTHENTICATION_FAILED", { ok: false, transportVersion: 1, action: "AUTHENTICATION_FAILED", errorCode: "AUTHENTICATION_FAILED", message: "placeholder" }],
        [422, "REJECTED", { ok: false, transportVersion: 1, action: "REJECTED", errorCode: "REJECTED", message: "placeholder" }]
    ]) {
        const db = await setup(); await insertJob(db);
        const worker = workerFor(db, { post: async () => ({ status, data }) });
        const result = await worker.processNext(); const stored = await row(db);
        assert.strictEqual(result.status, "FAILED"); assert.strictEqual(result.code, expectedCode); assert.strictEqual(stored.sheet_status, "FAILED"); await close(db);
    }
    for (const response of [{ status: 200, data: {} }, { status: 200, data: { ok: true, transportVersion: 1, action: "INSERTED" } }]) {
        const db = await setup(); await insertJob(db);
        const worker = workerFor(db, { post: async () => response });
        const result = await worker.processNext(); assert.strictEqual(result.code, "INVALID_RESPONSE"); assert.strictEqual((await row(db)).sheet_status, "FAILED"); await close(db);
    }
}

async function testForbiddenAuthenticationResponse() {
    const db = await setup(); await insertJob(db);
    const before = await row(db);
    const worker = workerFor(db, { post: async () => ({ status: 403, data: {} }) });
    const result = await worker.processNext(); const after = await row(db);
    assert.strictEqual(result.status, "FAILED");
    assert.strictEqual(result.code, "AUTHENTICATION_FAILED");
    assert.strictEqual(result.retryable, false);
    assert.strictEqual(after.sheet_status, "FAILED");
    assert.strictEqual(after.sheet_last_error.startsWith("AUTHENTICATION_FAILED:"), true);
    assert.strictEqual(after.sheet_delivered_at, null);
    assert.strictEqual(after.payload_json, before.payload_json);
    assert.strictEqual(after.payload_hash, before.payload_hash);
    assertEmailUnchanged(before, after);
    await close(db);
}

async function testRetryableFailures() {
    for (const response of [
        { status: 408, data: {} }, { status: 429, data: {} }, { status: 500, data: {} },
        { error: { code: "ETIMEDOUT", message: "timeout" } }, { error: { code: "ECONNRESET", message: "network" } }
    ]) {
        const db = await setup(); await insertJob(db);
        const worker = workerFor(db, { post: async () => { if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code }); return response; } });
        const result = await worker.processNext(); const stored = await row(db);
        assert.strictEqual(result.status, "PENDING"); assert.strictEqual(result.retryable, true); assert.strictEqual(stored.sheet_status, "PENDING"); assert(stored.sheet_last_error.includes("RETRYABLE_TRANSPORT_FAILURE")); await close(db);
    }
}

async function testClaimConcurrencyAndRecovery() {
    const db = await setup(); await insertJob(db, { payload: payloadFor({ closingId: "8102" }) });
    const workerA = workerFor(db, { post: async () => { throw new Error("not called"); } });
    const workerB = workerFor(db, { post: async () => { throw new Error("not called"); } });
    const claims = await Promise.all([workerA.claimNext(), workerB.claimNext()]);
    assert.strictEqual(claims.filter(Boolean).length, 1);
    assert.strictEqual((await row(db, 8102)).sheet_attempt_count, 1);
    await close(db);

    const recoveryDb = await setup();
    await insertJob(recoveryDb, { payload: payloadFor({ closingId: "8103" }), sheet_status: "PROCESSING", sheet_attempt_count: 1, sheet_processing_started_at: "2026-09-21T13:30:00.000Z" });
    const now = new Date(Date.parse("2026-09-21T13:30:00.000Z") + STALE_PROCESSING_TIMEOUT_MS + 1);
    const worker = workerFor(recoveryDb, { post: async () => { throw new Error("not called"); } }, () => now);
    assert.strictEqual(await worker.recoverStaleProcessing(), 1);
    const recovered = await row(recoveryDb, 8103); assert.strictEqual(recovered.sheet_status, "PENDING"); assert.strictEqual(recovered.sheet_processing_started_at, null);
    await close(recoveryDb);
}

async function testNoAccountingOrLiveEndpoint() {
    const db = await setup(); await insertJob(db);
    let calls = 0;
    const worker = workerFor(db, { post: async () => { calls += 1; throw new Error("mock only"); } });
    await worker.processNext();
    assert.strictEqual(calls, 1);
    assert.strictEqual(ENDPOINT, "https://placeholder.invalid/consolidated");
    await close(db);
}

(async () => {
    await testClaimAndInsertedEnvelope();
    await testActions();
    await testHttp200CompatibilityAndIdentityValidation();
    await testTerminalResponses();
    await testForbiddenAuthenticationResponse();
    await testRetryableFailures();
    await testClaimConcurrencyAndRecovery();
    await testNoAccountingOrLiveEndpoint();
    assert.strictEqual(CREATE_CONSOLIDATED_REPORTING_JOBS_SQL.includes("email_status"), true);
    console.log("C4C consolidated Sheet delivery worker tests: PASS");
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
