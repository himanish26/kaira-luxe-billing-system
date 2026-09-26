const assert = require("assert");
const { canonicalizeSemanticPayload, buildConsolidatedPayload } = require("../src/shared/consolidatedDsrBuilder");
const { sha256Utf8 } = require("../src/services/consolidatedReportingTransport");
const {
    APPROVED_DATABASE_PATH, EXPECTED, assertApprovedPath, postExactlyOnce, runVerifier
} = require("./c4d-v16-job2-idempotency-verifier");
const { runElectronVerifier, parseArgs } = require("./c4d-v16-job2-idempotency-verifier-electron");

const ENDPOINT = "https://example.invalid/c4d-v16";
const SECRET = "offline-v16-secret";
const NOW = new Date("2026-09-22T07:00:00.000Z");
const RECEIVED = "2026-09-22T07:00:01.000Z";

function payload() {
    return buildConsolidatedPayload({
        metadata: { businessDate: EXPECTED.businessDate, closingId: "7", closeSequence: "2", closedAt: "2026-09-22T05:22:15.613Z", klbsVersion: "1.1.0" },
        overall: { totalBills: 2, cashPaise: "117600", upiPaise: "35900", cardPaise: "0", storeCreditRedeemedPaise: "0", giftVoucherRedeemedPaise: "0" },
        bills: []
    });
}
function row(overrides = {}) {
    const p = payload();
    const json = canonicalizeSemanticPayload(p);
    return {
        id: 2, closing_id: 7, business_date: EXPECTED.businessDate, close_sequence: 2,
        contract_version: 2, snapshot_version: 2, payload_json: json, payload_hash: EXPECTED.payloadHash,
        report_status: "FINAL", data_quality_status: "COMPLETE", created_at: "2026-09-22T05:22:15.613Z",
        sheet_status: "DELIVERED", sheet_attempt_count: 2, sheet_last_attempt_at: "2026-09-22T06:39:21.466Z",
        sheet_processing_started_at: null, sheet_last_error: null, sheet_delivered_at: "2026-09-22T06:39:21.466Z",
        email_status: "PENDING", email_attempt_count: 0, email_last_attempt_at: null,
        email_processing_started_at: null, email_last_error: null, email_delivered_at: null, ...overrides
    };
}
function fakeDb(job = row()) {
    const fixed = { job, counts: { job_count: 2, max_id: 2 }, unexpected: [], pending: [] };
    return {
        get(sql, params, callback) {
            if (sql.includes("COUNT(*)")) return callback(null, fixed.counts);
            callback(null, fixed.job);
        },
        all(sql, params, callback) { callback(null, sql.includes("id >= 3") ? fixed.unexpected : fixed.pending); }
    };
}
function env() { return {}; }
function validator(job) {
    return { payloadJson: job.payload_json, payloadHash: EXPECTED.payloadHash, payload: JSON.parse(job.payload_json), businessDate: EXPECTED.businessDate, closingId: "7", closeSequence: "2" };
}
const base = { dbPath: APPROVED_DATABASE_PATH, db: fakeDb(), env: env(), validateFrozenJobFn: validator, integrationConfigProvider: () => ({ endpoint: ENDPOINT, secret: SECRET }), now: () => NOW };
function successResponse(action = "UNCHANGED") {
    return { status: 200, data: { ok: true, transportVersion: 1, action, businessDate: EXPECTED.businessDate, closingId: "7", closeSequence: "2", payloadHash: EXPECTED.payloadHash, receivedAt: RECEIVED } };
}
function errorResponse(action, errorCode = "CONFLICT") {
    return { status: 200, data: { ok: false, transportVersion: 1, action, errorCode, message: "rejected" } };
}

async function main() {
    let posts = 0;
    const dry = await runVerifier({ ...base, httpClient: { post: async () => { posts += 1; } } });
    assert.strictEqual(dry.summary.verdict, "READY_TO_EXECUTE");
    assert.strictEqual(dry.summary.httpSent, false);
    assert.strictEqual(posts, 0);

    const valid = await runVerifier({ ...base, execute: true, httpClient: { post: async () => { posts += 1; return successResponse(); } } });
    assert.strictEqual(valid.summary.verdict, "PASS");
    assert.strictEqual(valid.summary.receiverAction, "UNCHANGED");
    assert.strictEqual(valid.summary.httpPosts, 1);
    assert.strictEqual(posts, 1);

    for (const response of [
        successResponse("INSERTED"), successResponse("UPDATED"), successResponse("STALE"),
        errorResponse("CONFLICT"), errorResponse("REJECTED", "REJECTED"),
        errorResponse("AUTHENTICATION_FAILED", "AUTHENTICATION_FAILED"),
        errorResponse("CONFLICT", "DUPLICATE_BUSINESS_DATE")
    ]) {
        let calls = 0;
        await assert.rejects(postExactlyOnce({ endpoint: ENDPOINT, secret: SECRET, validated: validator(row()), httpClient: { post: async () => { calls += 1; return response; } }, now: () => NOW }));
        assert.strictEqual(calls, 1);
    }
    let networkCalls = 0;
    await assert.rejects(postExactlyOnce({ endpoint: ENDPOINT, secret: SECRET, validated: validator(row()), httpClient: { post: async () => { networkCalls += 1; throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); } }, now: () => NOW }), /RETRYABLE_TRANSPORT_FAILURE/);
    assert.strictEqual(networkCalls, 1);
    await assert.rejects(runVerifier({ ...base, execute: true, db: fakeDb(row({ business_date: "2026-09-20" })), httpClient: { post: async () => { throw new Error("must not post"); } } }), /Business Date/);
    await assert.rejects(runVerifier({ ...base, execute: true, dbPath: "C:\\Users\\USER\\AppData\\Roaming\\KAIRA LUXE BILLING SYSTEM\\billing.db", httpClient: { post: async () => { throw new Error("must not post"); } } }), /approved training/);
    await assert.rejects(runVerifier({ ...base, execute: true, db: fakeDb(row({ payload_hash: "0".repeat(64) })), httpClient: { post: async () => { throw new Error("must not post"); } } }), /Payload hash/);
    const before = JSON.stringify(row());
    await runVerifier({ ...base, execute: true, httpClient: { post: async () => successResponse() } });
    assert.strictEqual(JSON.stringify(row()), before);

    assert.deepStrictEqual(parseArgs(["scripts\\c4d-v16-job2-idempotency-verifier-electron.js", "--execute"]), ["--execute"]);
    const events = [];
    let exitCode = null;
    const app = { commandLine: { appendSwitch: value => events.push(value) }, disableHardwareAcceleration() {}, whenReady: async () => {}, quit() {} };
    await runElectronVerifier({ app, args: [], runVerifier: async options => { assert.strictEqual(options.execute, false); return { summary: { mode: "DRY_RUN", verdict: "READY_TO_EXECUTE" } }; }, printSummary: () => {}, log: message => events.push(message), errorLog: () => {}, scheduleExit: callback => callback(), exit: code => { exitCode = code; } });
    assert.strictEqual(exitCode, 0);
    assert(events.includes("C4D V16 Electron ready"));
    console.log("C4D V16 Job 2 idempotency verifier tests: PASS");
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
