const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const axios = require("axios");
const {
    HTTP_TIMEOUT_MS,
    MAX_REDIRECTS,
    resolveConsolidatedDsrConfiguration
} = require("../src/services/consolidatedSheetDeliveryWorker");
const {
    buildEnvelope,
    classifyTransportFailure,
    isValidUtcIsoTimestamp,
    validateFrozenJob,
    validateReceiverResponse
} = require("../src/services/consolidatedReportingTransport");
const { createIntegrationConfigService } = require("../src/services/integrationConfigService");

const APPROVED_DATABASE_PATH = "D:\\KLBS\\KLBS_TRAINING_2026-09-21_REG02_RETEST.db";
const EXPECTED = Object.freeze({
    jobId: 2,
    businessDate: "2026-09-21",
    closingId: "7",
    closeSequence: "2",
    contractVersion: 2,
    snapshotVersion: 2,
    payloadHash: "cbf633069926ebd3baa512416d55f2f846e2973c1a576f1c11c5265f9a0c31fc",
    sheetStatus: "DELIVERED",
    attemptCount: 2
});
const JOB_COLUMNS = [
    "id", "closing_id", "business_date", "close_sequence", "contract_version", "snapshot_version",
    "payload_json", "payload_hash", "report_status", "data_quality_status", "created_at",
    "sheet_status", "sheet_attempt_count", "sheet_last_attempt_at", "sheet_processing_started_at",
    "sheet_last_error", "sheet_delivered_at", "email_status", "email_attempt_count",
    "email_last_attempt_at", "email_processing_started_at", "email_last_error", "email_delivered_at"
];

function normalizePath(value) { return path.resolve(String(value || "")).toLowerCase(); }
function assertApprovedPath(dbPath) {
    const resolved = path.resolve(String(dbPath || ""));
    if (normalizePath(resolved) !== normalizePath(APPROVED_DATABASE_PATH)) {
        throw new Error("Refusing database path: only the approved training database is allowed.");
    }
    return resolved;
}
function openReadonlyDatabase(dbPath) {
    assertApprovedPath(dbPath);
    return new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
}
function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}
function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}
function close(db) { return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())); }

async function readSnapshot(db) {
    return {
        job: await get(db, `SELECT ${JOB_COLUMNS.join(", ")} FROM consolidated_reporting_jobs WHERE id = 2`),
        counts: await get(db, "SELECT COUNT(*) AS job_count, COALESCE(MAX(id), 0) AS max_id FROM consolidated_reporting_jobs"),
        unexpected: await all(db, "SELECT id FROM consolidated_reporting_jobs WHERE id >= 3 ORDER BY id"),
        pending: await all(db, "SELECT id, sheet_status FROM consolidated_reporting_jobs WHERE sheet_status IN ('PENDING','PROCESSING') ORDER BY id")
    };
}

function assertGuards(snapshot) {
    const job = snapshot.job;
    if (!job) throw new Error("Job 2 is missing.");
    if (Number(job.id) !== EXPECTED.jobId) throw new Error("Job ID mismatch.");
    if (job.business_date !== EXPECTED.businessDate) throw new Error("Business Date mismatch.");
    if (String(job.closing_id) !== EXPECTED.closingId) throw new Error("Closing ID mismatch.");
    if (String(job.close_sequence) !== EXPECTED.closeSequence) throw new Error("Close Sequence mismatch.");
    if (Number(job.contract_version) !== EXPECTED.contractVersion) throw new Error("Contract Version mismatch.");
    if (Number(job.snapshot_version) !== EXPECTED.snapshotVersion) throw new Error("Snapshot Version mismatch.");
    if (job.payload_hash !== EXPECTED.payloadHash) throw new Error("Payload hash mismatch.");
    if (job.sheet_status !== EXPECTED.sheetStatus) throw new Error("Job 2 is not DELIVERED.");
    if (Number(job.sheet_attempt_count) !== EXPECTED.attemptCount) throw new Error("Job 2 attempt count mismatch.");
    if (!job.sheet_delivered_at) throw new Error("Job 2 delivered timestamp is missing.");
    if (job.sheet_last_error !== null) throw new Error("Job 2 last error is not NULL.");
    if (snapshot.unexpected.length) throw new Error("Unexpected consolidated job ID >= 3 exists.");
    if (snapshot.pending.length) throw new Error("A PENDING or PROCESSING consolidated job exists.");
}

async function defaultIntegrationConfigProvider() {
    if (!process.versions.electron) throw new Error("Existing KLBS DSR configuration requires Electron runtime.");
    const { app, safeStorage } = require("electron");
    await app.whenReady();
    return createIntegrationConfigService({
        safeStorage,
        storagePath: path.join(app.getPath("userData"), "integration-config.json")
    }).resolveDsrRuntime();
}

async function preflight({ db, env, integrationConfigProvider, validateFrozenJobFn = validateFrozenJob }) {
    const snapshot = await readSnapshot(db);
    assertGuards(snapshot);
    const validated = validateFrozenJobFn(snapshot.job);
    if (validated.businessDate !== EXPECTED.businessDate || validated.closingId !== EXPECTED.closingId ||
        validated.closeSequence !== EXPECTED.closeSequence || validated.payloadHash !== EXPECTED.payloadHash) {
        throw new Error("Frozen payload identity/hash mismatch.");
    }
    const configuration = await resolveConsolidatedDsrConfiguration({
        environment: env || process.env,
        integrationConfigProvider: integrationConfigProvider || defaultIntegrationConfigProvider
    });
    if (!/^https:\/\//i.test(configuration.endpoint)) throw new Error("Configured receiver endpoint must use HTTPS.");
    if (!configuration.secret) throw new Error("Configured receiver secret is missing.");
    return { snapshot, validated, endpoint: configuration.endpoint, secret: configuration.secret };
}

function validateEnvelope(envelope, validated, timestamp) {
    if (envelope.payloadHash !== EXPECTED.payloadHash) throw new Error("Envelope hash changed.");
    if (JSON.stringify(envelope.payload) !== JSON.stringify(validated.payload)) throw new Error("Envelope payload changed.");
    if (envelope.timestamp !== timestamp || !isValidUtcIsoTimestamp(timestamp)) throw new Error("Envelope timestamp is invalid.");
    if (typeof envelope.signature !== "string" || !/^[0-9a-f]{64}$/.test(envelope.signature)) throw new Error("Envelope signature was not generated.");
}

async function postExactlyOnce({ endpoint, secret, validated, httpClient, now }) {
    const timestamp = now().toISOString();
    const envelope = buildEnvelope(validated, timestamp, secret);
    validateEnvelope(envelope, validated, timestamp);
    let response;
    try {
        response = await httpClient.post(endpoint, envelope, {
            timeout: HTTP_TIMEOUT_MS,
            maxRedirects: MAX_REDIRECTS,
            beforeRedirect: options => {
                if (!options || options.protocol !== "https:") throw new Error("Receiver redirect destination must use HTTPS.");
            },
            maxContentLength: 128 * 1024,
            maxBodyLength: 128 * 1024,
            headers: { "Content-Type": "application/json" },
            responseType: "json",
            validateStatus: status => status >= 200 && status < 600
        });
    }
    catch (error) {
        const failure = classifyTransportFailure({ status: error && error.response && error.response.status, error });
        throw new Error(`${failure.code}: ${failure.message}`);
    }
    if (!response || response.status !== 200) {
        const failure = classifyTransportFailure({ status: response && response.status });
        throw new Error(`${failure.code}: ${failure.message}`);
    }
    const result = validateReceiverResponse(response.data, validated);
    if (result.code !== "DELIVERED" || result.action !== "UNCHANGED" || result.delivered !== true) {
        throw new Error(`${result.code || "INVALID_RESPONSE"}: verification requires DELIVERED/UNCHANGED.`);
    }
    return { result, envelope };
}

function assertDatabaseUnchanged(before, after) {
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("CRITICAL FAILURE: local database snapshot changed.");
}

async function runVerifier(options = {}) {
    const dbPath = assertApprovedPath(options.dbPath || APPROVED_DATABASE_PATH);
    const execute = options.execute === true;
    const onStage = options.onStage || (() => {});
    const db = options.db || openReadonlyDatabase(dbPath);
    onStage(execute ? "execute mode enabled" : "dry-run mode");
    onStage("training DB opened read-only");
    try {
        const first = await preflight({ db, env: options.env, integrationConfigProvider: options.integrationConfigProvider, validateFrozenJobFn: options.validateFrozenJobFn });
        onStage("Job 2 guards passed");
        const timestamp = (options.now || (() => new Date()))().toISOString();
        const envelope = buildEnvelope(first.validated, timestamp, first.secret);
        validateEnvelope(envelope, first.validated, timestamp);
        onStage("frozen payload and envelope validated");
        const summary = { mode: execute ? "EXECUTE" : "DRY_RUN", jobId: 2, businessDate: EXPECTED.businessDate, closingId: 7, closeSequence: 2, payloadHash: EXPECTED.payloadHash, endpointConfigured: true, secretConfigured: true, envelopeValidated: true, httpSent: false, databaseMutated: false };
        if (!execute) return { summary: { ...summary, verdict: "READY_TO_EXECUTE" }, snapshot: first.snapshot };
        const second = await preflight({ db, env: options.env, integrationConfigProvider: options.integrationConfigProvider, validateFrozenJobFn: options.validateFrozenJobFn });
        onStage("sending exactly one HTTP POST");
        const sent = await postExactlyOnce({ endpoint: second.endpoint, secret: second.secret, validated: second.validated, httpClient: options.httpClient || axios, now: options.now || (() => new Date()) });
        onStage("receiver response validated: UNCHANGED");
        const after = await readSnapshot(db);
        assertDatabaseUnchanged(second.snapshot, after);
        onStage("database immutability verified");
        return { summary: { ...summary, verdict: "PASS", receiverAction: sent.result.action, httpPosts: 1, httpSent: true }, snapshot: after };
    }
    finally {
        if (!options.db) await close(db);
    }
}

function printSummary(result) {
    const s = result.summary;
    if (s.mode === "DRY_RUN") {
        Object.entries(s).forEach(([key, value]) => console.log(`${key}: ${value}`));
        return;
    }
    console.log("C4D V16 IDEMPOTENCY VERIFICATION: PASS");
    console.log(`Receiver action: ${s.receiverAction}`);
    console.log(`HTTP posts: ${s.httpPosts}`);
    console.log(`Database mutations: ${s.databaseMutated ? "UNKNOWN" : 0}`);
}

module.exports = { APPROVED_DATABASE_PATH, EXPECTED, JOB_COLUMNS, assertApprovedPath, openReadonlyDatabase, readSnapshot, assertGuards, preflight, validateEnvelope, postExactlyOnce, assertDatabaseUnchanged, runVerifier, printSummary, defaultIntegrationConfigProvider };
