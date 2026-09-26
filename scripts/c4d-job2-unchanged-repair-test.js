const assert = require("assert");
const {
    canonicalizeSemanticPayload,
    buildConsolidatedPayload
} = require("../src/shared/consolidatedDsrBuilder");
const {
    APPROVED_DATABASE_PATH,
    EXPECTED,
    assertApprovedPath,
    assertJobGuards,
    postOnce,
    runRepair
} = require("./c4d-job2-unchanged-repair");
const { resolveConsolidatedDsrConfiguration } = require("../src/services/consolidatedSheetDeliveryWorker");
const { setIntegrationConfigService } = require("../src/services/emailService");
const { runElectronDryRun, redact, parseRepairArguments } = require("./c4d-job2-unchanged-repair-electron");
const { sha256Utf8 } = require("../src/services/consolidatedReportingTransport");

const SECRET = "offline-c4d-repair-test-secret";
const ENDPOINT = "https://example.invalid/c4d";
const NOW = new Date("2026-09-22T09:00:00.000Z");
const RECEIVED = "2026-09-22T09:00:01.000Z";

function payload() {
    return buildConsolidatedPayload({
        metadata: { businessDate: EXPECTED.businessDate, closingId: EXPECTED.closingId, closeSequence: EXPECTED.closeSequence, closedAt: "2026-09-21T18:00:00.000Z", klbsVersion: "1.1.0" },
        overall: { totalBills: 0, cashPaise: "0", upiPaise: "0", cardPaise: "0", storeCreditRedeemedPaise: "0", giftVoucherRedeemedPaise: "0" },
        bills: []
    });
}

function row(id, overrides = {}) {
    const p = payload();
    const payloadJson = canonicalizeSemanticPayload(p);
    return {
        id, closing_id: id === 2 ? 7 : 6, business_date: EXPECTED.businessDate, close_sequence: id === 2 ? 2 : 1,
        contract_version: p.contractVersion, snapshot_version: p.snapshotVersion, payload_json: payloadJson,
        payload_hash: id === 2 ? EXPECTED.payloadHash : sha256Utf8(payloadJson), report_status: "FINAL", data_quality_status: "COMPLETE",
        created_at: "2026-09-21T18:00:00.000Z", sheet_status: id === 2 ? "DELIVERED" : "FAILED",
        sheet_attempt_count: id === 2 ? 2 : 1, sheet_last_attempt_at: "2026-09-22T08:00:00.000Z",
        sheet_processing_started_at: null, sheet_last_error: id === 2 ? null : "historical failure",
        sheet_delivered_at: id === 2 ? "2026-09-22T08:30:00.000Z" : null, email_status: "PENDING", email_attempt_count: 0,
        email_last_attempt_at: null, email_processing_started_at: null, email_last_error: null, email_delivered_at: null,
        ...overrides
    };
}

function fakeDb(rows = { 1: row(1), 2: row(2) }, extras = []) {
    return {
        get(sql, params, callback) {
            if (sql.includes("COUNT(*)")) return callback(null, { job_count: 2 + extras.length, max_id: extras.length ? extras[extras.length - 1].id : 2 });
            const id = Number(params && params[0]) || Number((sql.match(/id\s*=\s*(\d+)/i) || [])[1]);
            callback(null, rows[id] || null);
        },
        all(sql, params, callback) {
            if (sql.includes("id >= 3")) return callback(null, extras);
            if (sql.includes("sheet_status IN")) return callback(null, extras.filter(item => ["PENDING", "PROCESSING"].includes(item.sheet_status)));
            callback(null, []);
        }
    };
}

function env(overrides = {}) {
    return { ...overrides };
}

function testValidator(job) {
    const p = JSON.parse(job.payload_json);
    return { payloadJson: job.payload_json, payloadHash: EXPECTED.payloadHash, payload: p, businessDate: EXPECTED.businessDate, closingId: EXPECTED.closingId, closeSequence: EXPECTED.closeSequence };
}

const validOptions = { validateFrozenJobFn: testValidator };

async function testGuards() {
    assert.throws(() => assertApprovedPath("C:\\Users\\USER\\AppData\\Roaming\\KAIRA LUXE BILLING SYSTEM\\billing.db"), /approved training database/);
    for (const [name, overrides] of [
        ["wrong job id", { 2: row(9) }], ["wrong date", { 2: row(2, { business_date: "2026-09-20" }) }],
        ["wrong closing id", { 2: row(2, { closing_id: 8 }) }], ["wrong sequence", { 2: row(2, { close_sequence: 3 }) }],
        ["wrong hash", { 2: row(2, { payload_hash: "0".repeat(64) }) }], ["wrong status", { 2: row(2, { sheet_status: "FAILED" }) }],
        ["wrong attempts", { 2: row(2, { sheet_attempt_count: 1 }) }], ["missing delivered", { 2: row(2, { sheet_delivered_at: null }) }],
        ["last error", { 2: row(2, { sheet_last_error: "error" }) }], ["job 1 not failed", { 1: row(1, { sheet_status: "DELIVERED" }) }]
    ]) {
        assert.throws(() => assertJobGuards({ job1: overrides[1] || row(1), job2: overrides[2] || row(2), counts: {}, unexpected: [], pending: [] }), /./, name);
    }
    assert.throws(() => assertJobGuards({ job1: row(1), job2: row(2), counts: {}, unexpected: [row(3)], pending: [] }), /id >= 3/);
    assert.throws(() => assertJobGuards({ job1: row(1), job2: row(2), counts: {}, unexpected: [], pending: [row(3, { sheet_status: "PENDING" })] }), /PENDING/);
}

async function testConfigAndDryRun() {
    const db = fakeDb();
    const emptyProvider = () => ({});
    await assert.rejects(runRepair({ ...validOptions, dbPath: APPROVED_DATABASE_PATH, db, env: {}, integrationConfigProvider: emptyProvider }), /HTTPS/);
    await assert.rejects(runRepair({ ...validOptions, dbPath: APPROVED_DATABASE_PATH, db, env: {}, integrationConfigProvider: () => ({ endpoint: ENDPOINT }) }), /secret/);
    await assert.rejects(runRepair({ ...validOptions, dbPath: APPROVED_DATABASE_PATH, db, env: {}, integrationConfigProvider: () => ({ secret: SECRET }) }), /HTTPS/);
    const configuredRuntime = { endpoint: ENDPOINT, secret: SECRET };
    const resolved = await resolveConsolidatedDsrConfiguration({
        environment: { KLBS_CONSOLIDATED_DSR_WEB_APP_URL: "https://wrong.invalid", KLBS_CONSOLIDATED_DSR_SYNC_SECRET: "wrong-fixture-secret" },
        integrationConfigProvider: () => configuredRuntime
    });
    assert.deepStrictEqual(resolved, configuredRuntime);
    const missing = await resolveConsolidatedDsrConfiguration({ environment: {}, integrationConfigProvider: () => ({}) });
    assert.deepStrictEqual(missing, { endpoint: "", secret: "" });
    setIntegrationConfigService({ resolveDsrRuntime: () => configuredRuntime });
    const globalFallback = await resolveConsolidatedDsrConfiguration({ environment: {} });
    assert.deepStrictEqual(globalFallback, configuredRuntime);
    let posts = 0;
    const result = await runRepair({ ...validOptions, dbPath: APPROVED_DATABASE_PATH, db, env: {}, integrationConfigProvider: () => configuredRuntime, httpClient: { post: async () => { posts += 1; } }, now: () => NOW });
    assert.strictEqual(result.summary.mode, "DRY_RUN");
    assert.strictEqual(result.summary.verdict, "READY_TO_EXECUTE");
    assert.strictEqual(posts, 0);
}

async function testExecuteAndResponseActions() {
    let posts = 0;
    let sent;
    const httpClient = { post: async (endpoint, envelope, config) => {
        posts += 1; sent = { endpoint, envelope, config };
        return { status: 200, data: { ok: true, transportVersion: 1, action: "UNCHANGED", businessDate: EXPECTED.businessDate, closingId: "7", closeSequence: "2", payloadHash: EXPECTED.payloadHash, receivedAt: RECEIVED } };
    } };
    const result = await runRepair({ ...validOptions, dbPath: APPROVED_DATABASE_PATH, db: fakeDb(), env: env(), integrationConfigProvider: () => ({ endpoint: ENDPOINT, secret: SECRET }), httpClient, now: () => NOW, execute: true });
    assert.strictEqual(posts, 1);
    assert.strictEqual(result.summary.receiverAction, "UNCHANGED");
    assert.strictEqual(sent.envelope.timestamp, NOW.toISOString());
    assert.strictEqual(sent.envelope.payloadHash, EXPECTED.payloadHash);
    assert.strictEqual(sent.config.timeout, 30000);
    assert.strictEqual(sent.config.maxRedirects, 1);
    assert.strictEqual(sent.config.maxContentLength, 128 * 1024);
    assert.strictEqual(sent.config.maxBodyLength, 128 * 1024);
    assert.strictEqual(sent.config.headers["Content-Type"], "application/json");
    for (const action of ["INSERTED", "UPDATED", "STALE"]) {
        const client = { post: async () => ({ status: 200, data: { ok: true, transportVersion: 1, action, businessDate: EXPECTED.businessDate, closingId: "7", closeSequence: "2", payloadHash: EXPECTED.payloadHash, receivedAt: RECEIVED } }) };
        await assert.rejects(postOnce({ endpoint: ENDPOINT, secret: SECRET, validated: { payload: payload(), payloadHash: EXPECTED.payloadHash }, httpClient: client, now: () => NOW }), /UNCHANGED|INVALID_RESPONSE/);
    }
    await assert.rejects(postOnce({ endpoint: ENDPOINT, secret: SECRET, validated: { payload: payload(), payloadHash: EXPECTED.payloadHash }, httpClient: { post: async () => ({ status: 200, data: {} }) }, now: () => NOW }), /INVALID_RESPONSE/);
    let failures = 0;
    await assert.rejects(postOnce({ endpoint: ENDPOINT, secret: SECRET, validated: { payload: payload(), payloadHash: EXPECTED.payloadHash }, httpClient: { post: async () => { failures += 1; throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); } }, now: () => NOW }), /RETRYABLE_TRANSPORT_FAILURE/);
    assert.strictEqual(failures, 1);
}

async function testReadOnlyAndNoSecretOutput() {
    const source = require("fs").readFileSync(require.resolve("./c4d-job2-unchanged-repair"), "utf8");
    assert(source.includes("sqlite3.OPEN_READONLY"));
    assert(!source.includes("console.log(secret"));
    assert(!source.includes("console.log(signature"));
    const before = JSON.stringify({ job1: row(1), job2: row(2) });
    const db = fakeDb();
    await runRepair({ ...validOptions, dbPath: APPROVED_DATABASE_PATH, db, env: env(), integrationConfigProvider: () => ({ endpoint: ENDPOINT, secret: SECRET }), execute: true, httpClient: { post: async () => ({ status: 200, data: { ok: true, transportVersion: 1, action: "UNCHANGED", businessDate: EXPECTED.businessDate, closingId: "7", closeSequence: "2", payloadHash: EXPECTED.payloadHash, receivedAt: RECEIVED } }) }, now: () => NOW });
    assert.strictEqual(JSON.stringify({ job1: row(1), job2: row(2) }), before);
}

async function testStandaloneElectronLifecycle() {
    assert.deepStrictEqual(parseRepairArguments(["scripts\\c4d-job2-unchanged-repair-electron.js", "--execute"]), ["--execute"]);
    const events = [];
    let quitCount = 0;
    let exitCode = null;
    const app = {
        commandLine: { appendSwitch: value => events.push(`switch:${value}`) },
        disableHardwareAcceleration: () => events.push("gpu-disabled"),
        whenReady: async () => events.push("ready"),
        quit: () => { quitCount += 1; events.push("quit"); }
    };
    const code = await runElectronDryRun({
        app,
        runRepair: async options => { options.onStage("training DB opened read-only"); options.onStage("guards passed"); options.onStage("integration config resolved"); return { summary: { mode: "DRY_RUN", verdict: "READY_TO_EXECUTE" } }; },
        printSummary: result => events.push(`summary:${result.summary.verdict}`),
        log: message => events.push(message),
        errorLog: message => events.push(`error:${message}`),
        scheduleExit: callback => callback(),
        exit: value => { exitCode = value; }
    });
    assert.strictEqual(code, 0);
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(quitCount, 1);
    assert(events.includes("C4D Electron ready"));
    assert(events.includes("summary:READY_TO_EXECUTE"));
    assert.strictEqual(redact("secret=do-not-print https://private.example"), "[REDACTED]=do-not-print [ENDPOINT]");

    let executeFlag;
    let executeExit = null;
    await runElectronDryRun({
        args: ["--execute"], app,
        runRepair: async options => { executeFlag = options.execute; return { summary: { mode: "EXECUTE", verdict: "PASS", receiverAction: "UNCHANGED", httpPosts: 1 } }; },
        printSummary: () => {}, log: () => {}, errorLog: () => {}, scheduleExit: callback => callback(), exit: value => { executeExit = value; }
    });
    assert.strictEqual(executeFlag, true);
    assert.strictEqual(executeExit, 0);

    let invalidExit = null;
    const invalidErrors = [];
    await runElectronDryRun({
        args: ["--unexpected"], app, runRepair: async () => { throw new Error("must not run"); },
        log: () => {}, errorLog: message => invalidErrors.push(String(message)), scheduleExit: callback => callback(), exit: value => { invalidExit = value; }
    });
    assert.strictEqual(invalidExit, 1);
    assert(invalidErrors.some(message => message.includes("Usage")));

    let failureExit = null;
    await runElectronDryRun({
        app,
        runRepair: async () => { throw new Error("missing secret configuration"); },
        log: () => {}, errorLog: message => assert(!String(message).includes("missing secret")),
        scheduleExit: callback => callback(), exit: value => { failureExit = value; }
    });
    assert.strictEqual(failureExit, 1);
}

(async () => {
    await testGuards();
    await testConfigAndDryRun();
    await testExecuteAndResponseActions();
    await testReadOnlyAndNoSecretOutput();
    await testStandaloneElectronLifecycle();
    console.log("C4D Job 2 one-shot unchanged repair tests: PASS");
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
