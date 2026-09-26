const path = require("path");
const crypto = require("crypto");
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

function normalizePath(value) {
    return path.resolve(String(value || "")).toLowerCase();
}

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

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function closeDatabase(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

function safeSecretFingerprint(secret) {
    return crypto.createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

async function readSnapshot(db) {
    const job1 = await dbGet(db, `SELECT ${JOB_COLUMNS.join(", ")} FROM consolidated_reporting_jobs WHERE id = 1`);
    const job2 = await dbGet(db, `SELECT ${JOB_COLUMNS.join(", ")} FROM consolidated_reporting_jobs WHERE id = 2`);
    const counts = await dbGet(db, "SELECT COUNT(*) AS job_count, COALESCE(MAX(id), 0) AS max_id FROM consolidated_reporting_jobs");
    const unexpected = await dbAll(db, "SELECT id FROM consolidated_reporting_jobs WHERE id >= 3 ORDER BY id");
    const pending = await dbAll(db, "SELECT id, sheet_status FROM consolidated_reporting_jobs WHERE sheet_status IN ('PENDING', 'PROCESSING') ORDER BY id");
    return { job1, job2, counts, unexpected, pending };
}

function assertJobGuards(snapshot) {
    if (!snapshot.job2) throw new Error("Job 2 is missing.");
    const job = snapshot.job2;
    if (Number(job.id) !== EXPECTED.jobId) throw new Error("Job identity mismatch: expected Job 2.");
    if (job.business_date !== EXPECTED.businessDate) throw new Error("Job 2 business date mismatch.");
    if (String(job.closing_id) !== EXPECTED.closingId) throw new Error("Job 2 closing ID mismatch.");
    if (String(job.close_sequence) !== EXPECTED.closeSequence) throw new Error("Job 2 closing sequence mismatch.");
    if (job.payload_hash !== EXPECTED.payloadHash) throw new Error("Job 2 payload hash mismatch.");
    if (job.sheet_status !== EXPECTED.sheetStatus) throw new Error("Job 2 sheet status is not DELIVERED.");
    if (Number(job.sheet_attempt_count) !== EXPECTED.attemptCount) throw new Error("Job 2 sheet attempt count is not 2.");
    if (!job.sheet_delivered_at) throw new Error("Job 2 sheet_delivered_at is missing.");
    if (job.sheet_last_error !== null) throw new Error("Job 2 sheet_last_error is not NULL.");
    if (!snapshot.job1 || snapshot.job1.sheet_status !== "FAILED") throw new Error("Job 1 is missing or is not in its expected FAILED state.");
    if (snapshot.unexpected.length) throw new Error("Unexpected consolidated reporting job with id >= 3 exists.");
    if (snapshot.pending.length) throw new Error("A PENDING or PROCESSING consolidated reporting job exists.");
}

function validateEnvelope(envelope, validated, timestamp) {
    if (envelope.payloadHash !== EXPECTED.payloadHash) throw new Error("Envelope payload hash changed.");
    if (JSON.stringify(envelope.payload) !== JSON.stringify(validated.payload)) throw new Error("Envelope payload changed.");
    if (validated.payload.closedAt !== undefined && envelope.payload.closedAt !== validated.payload.closedAt) throw new Error("Envelope closedAt changed.");
    if (envelope.timestamp !== timestamp || !isValidUtcIsoTimestamp(envelope.timestamp)) throw new Error("Envelope timestamp is invalid.");
    if (typeof envelope.signature !== "string" || !/^[0-9a-f]{64}$/.test(envelope.signature)) throw new Error("Envelope signature was not generated.");
}

async function preflight({ db, env, validateFrozenJobFn = validateFrozenJob, integrationConfigProvider, onStage = () => {} }) {
    const snapshot = await readSnapshot(db);
    assertJobGuards(snapshot);
    onStage("guards passed");
    let validated;
    try { validated = validateFrozenJobFn(snapshot.job2); }
    catch (error) { throw new Error(`${error.code || "INVALID_PAYLOAD"}: ${error.message}`); }
    if (validated.businessDate !== EXPECTED.businessDate || validated.closingId !== EXPECTED.closingId ||
        validated.closeSequence !== EXPECTED.closeSequence || validated.payloadHash !== EXPECTED.payloadHash) {
        throw new Error("Validated frozen Job 2 identity/hash does not match the locked values.");
    }
    const configuration = await resolveConsolidatedDsrConfiguration({
        environment: env || {},
        integrationConfigProvider: integrationConfigProvider || defaultIntegrationConfigProvider
    });
    const endpoint = configuration.endpoint;
    const secret = configuration.secret;
    onStage("integration config resolved");
    if (!/^https:\/\//i.test(endpoint)) throw new Error("Configured receiver endpoint must use HTTPS.");
    if (!secret) throw new Error("Configured receiver secret is missing.");
    return { snapshot, validated, endpoint, secret };
}

async function defaultIntegrationConfigProvider() {
    if (!process.versions.electron) {
        throw new Error("Existing KLBS DSR configuration requires Electron runtime; no secret was supplied.");
    }
    const { app, safeStorage } = require("electron");
    await app.whenReady();
    const service = createIntegrationConfigService({
        safeStorage,
        storagePath: path.join(app.getPath("userData"), "integration-config.json")
    });
    return service.resolveDsrRuntime();
}

async function postOnce({ endpoint, secret, validated, httpClient, now }) {
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
        const classified = classifyTransportFailure({ status: error && error.response && error.response.status, error });
        throw new Error(`${classified.code}: ${classified.message}`);
    }
    if (!response || response.status < 200 || response.status >= 300) {
        const classified = classifyTransportFailure({ status: response && response.status });
        throw new Error(`${classified.code}: ${classified.message}`);
    }
    const result = validateReceiverResponse(response.data, validated);
    if (response.status !== 200) throw new Error("INVALID_RESPONSE: UNCHANGED must be returned over HTTP 200.");
    if (result.code !== "DELIVERED" || result.action !== "UNCHANGED") {
        throw new Error(`${result.code || "INVALID_RESPONSE"}: repair requires receiver action UNCHANGED.`);
    }
    return { envelope, response, result };
}

function assertUnchanged(before, after) {
    if (JSON.stringify(before.job1) !== JSON.stringify(after.job1)) throw new Error("CRITICAL FAILURE: Job 1 changed.");
    if (JSON.stringify(before.job2) !== JSON.stringify(after.job2)) throw new Error("CRITICAL FAILURE: Job 2 changed.");
    if (JSON.stringify(before.counts) !== JSON.stringify(after.counts)) throw new Error("CRITICAL FAILURE: consolidated job count changed.");
    if (after.unexpected.length) throw new Error("CRITICAL FAILURE: Job 3 or another unexpected job exists.");
}

async function runRepair(options = {}) {
    const dbPath = assertApprovedPath(options.dbPath || APPROVED_DATABASE_PATH);
    const execute = options.execute === true;
    const env = options.env || process.env;
    const db = options.db || openReadonlyDatabase(dbPath);
    const onStage = options.onStage || (() => {});
    onStage(execute ? "execute mode enabled" : "dry-run mode");
    onStage("training DB opened read-only");
    try {
        const first = await preflight({ db, env, validateFrozenJobFn: options.validateFrozenJobFn, integrationConfigProvider: options.integrationConfigProvider, onStage });
        const timestamp = (options.now || (() => new Date()))().toISOString();
        const dryEnvelope = buildEnvelope(first.validated, timestamp, first.secret);
        validateEnvelope(dryEnvelope, first.validated, timestamp);
        const summary = {
            mode: execute ? "EXECUTE" : "DRY_RUN",
            database: "approved training DB",
            jobId: EXPECTED.jobId,
            businessDate: EXPECTED.businessDate,
            closingId: Number(EXPECTED.closingId),
            closeSequence: Number(EXPECTED.closeSequence),
            payloadHash: EXPECTED.payloadHash,
            sheetStatus: first.snapshot.job2.sheet_status,
            attemptCount: Number(first.snapshot.job2.sheet_attempt_count),
            endpointConfigured: true,
            secretConfigured: true,
            envelopeValidated: true,
            httpSent: false,
            databaseMutated: false
        };
        if (!execute) return { summary: { ...summary, verdict: "READY_TO_EXECUTE" }, snapshot: first.snapshot };
        const second = await preflight({ db, env, validateFrozenJobFn: options.validateFrozenJobFn, integrationConfigProvider: options.integrationConfigProvider, onStage });
        onStage("sending exactly one HTTP POST");
        const sent = await postOnce({ endpoint: second.endpoint, secret: second.secret, validated: second.validated, httpClient: options.httpClient || axios, now: options.now || (() => new Date()) });
        onStage("receiver response validated");
        const after = await readSnapshot(db);
        assertUnchanged(second.snapshot, after);
        onStage("database immutability verified");
        return { summary: { ...summary, httpSent: true, verdict: "PASS", receiverAction: sent.result.action, httpPosts: 1 }, snapshot: after };
    }
    finally {
        if (!options.db) await closeDatabase(db);
    }
}

function printSummary(result) {
    const s = result.summary;
    if (s.mode === "DRY_RUN") {
        for (const [key, value] of Object.entries(s)) console.log(`${key}: ${value}`);
        return;
    }
    console.log("C4D JOB 2 REPAIR: PASS");
    console.log(`Receiver action: ${s.receiverAction}`);
    console.log(`HTTP posts: ${s.httpPosts}`);
    console.log("Database mutations: 0");
    console.log(`Identity: ${s.businessDate} / closing ${s.closingId} / sequence ${s.closeSequence}`);
    console.log(`Payload hash: ${s.payloadHash}`);
    console.log("Verify the repaired row in Google Sheets manually.");
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const execute = args.length === 1 && args[0] === "--execute";
    if (args.length > 1 || (args.length === 1 && !execute)) {
        console.error("Usage: node scripts/c4d-job2-unchanged-repair.js [--execute]");
        process.exitCode = 2;
    }
    else {
        console.log("C4D repair tool starting");
        runRepair({ execute, onStage: stage => console.log(`C4D ${stage}`) }).then(result => {
            console.log("C4D dry-run completed");
            printSummary(result);
            if (process.versions.electron) require("electron").app.quit();
        }).catch(error => {
            console.error(`C4D JOB 2 REPAIR: ${execute ? "FAILURE/STOP" : "ABORTED"}`);
            console.error(String(error.message || error).replace(/secret|signature/gi, "[REDACTED]"));
            process.exitCode = 1;
            if (process.versions.electron) require("electron").app.quit();
        });
    }
}

module.exports = {
    APPROVED_DATABASE_PATH,
    EXPECTED,
    JOB_COLUMNS,
    assertApprovedPath,
    openReadonlyDatabase,
    readSnapshot,
    assertJobGuards,
    preflight,
    defaultIntegrationConfigProvider,
    validateEnvelope,
    postOnce,
    assertUnchanged,
    runRepair,
    printSummary,
    safeSecretFingerprint
};
