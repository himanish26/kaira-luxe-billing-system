const axios = require("axios");
const { getIntegrationConfigService } = require("./emailService");
const {
    buildEnvelope,
    classifyTransportFailure,
    isValidUtcIsoTimestamp,
    validateFrozenJob,
    validateReceiverResponse
} = require("./consolidatedReportingTransport");

const STALE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const HTTP_TIMEOUT_MS = 30 * 1000;
const MAX_REDIRECTS = 1;
const RETRY_COOLDOWN_MS = 60 * 1000;
async function resolveConsolidatedDsrConfiguration({ integrationConfigProvider } = {}) {
    const integrationConfig = integrationConfigProvider || getIntegrationConfigService();
    const configured = integrationConfig
        ? (typeof integrationConfig.resolveDsrRuntime === "function"
            ? await integrationConfig.resolveDsrRuntime()
            : await integrationConfig())
        : {};
    return {
        endpoint: String(configured.endpoint || "").trim(),
        secret: String(configured.secret || "")
    };
}

function createConsolidatedSheetDeliveryWorker(options = {}) {
    const database = options.database;
    if (!database) throw new Error("Consolidated Sheet worker database dependency is required.");
    const now = options.now || (() => new Date());
    const httpClient = options.httpClient || axios;
    const logActivity = options.logActivity || (async () => {});
    const technicalLogger = options.technicalLogger || { info: () => {}, warn: () => {} };
    const configProvider = options.configProvider || (() => resolveConsolidatedDsrConfiguration({
        integrationConfigProvider: options.integrationConfigProvider
    }));

    const run = (sql, params = []) => new Promise((resolve, reject) => {
        database.run(sql, params, function(error) {
            if (error) reject(error);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
    const get = (sql, params = []) => new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
    });
    const all = (sql, params = []) => new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
    });
    let dayClosingSnapshotsAvailable = null;

    async function hasDayClosingSnapshotsTable() {
        if (dayClosingSnapshotsAvailable !== null) return dayClosingSnapshotsAvailable;
        dayClosingSnapshotsAvailable = Boolean(await get("SELECT name FROM sqlite_master WHERE type='table' AND name='day_closing_snapshots'"));
        return dayClosingSnapshotsAvailable;
    }

    function safeMessage(code, fallback) {
        return `${code}: ${fallback}`.replace(/https?:\/\/\S+/gi, "[ENDPOINT]").slice(0, 500);
    }

    function terminal(code, message) {
        return { code, message: safeMessage(code, message), retryable: false, delivered: false };
    }

    function retryable(code, message) {
        return { code, message: safeMessage(code, message), retryable: true, delivered: false };
    }

    function normalizeClassification(outcome) {
        if (!outcome || outcome.delivered === true) return outcome;
        return {
            ...outcome,
            message: safeMessage(outcome.code || "RETRYABLE_TRANSPORT_FAILURE", outcome.message || "Consolidated transport failure.")
        };
    }

    function isTransactionContention(error) {
        const code = String(error && error.code || "").toUpperCase();
        const message = String(error && error.message || "").toLowerCase();
        return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || message.includes("cannot start a transaction within a transaction");
    }

    async function recoverStaleProcessing() {
        const referenceTime = now().getTime();
        if (!Number.isFinite(referenceTime)) throw new Error("Consolidated Sheet worker clock is invalid.");
        let transactionStarted = false;
        try {
            await run("BEGIN IMMEDIATE TRANSACTION");
            transactionStarted = true;
            const rows = await all(`
                SELECT id, sheet_processing_started_at
                FROM consolidated_reporting_jobs
                WHERE sheet_status = 'PROCESSING'
            `);
            let recovered = 0;
            for (const row of rows) {
                if (!isValidUtcIsoTimestamp(row.sheet_processing_started_at)) continue;
                const startedAt = Date.parse(row.sheet_processing_started_at);
                if (referenceTime - startedAt < STALE_PROCESSING_TIMEOUT_MS) continue;
                const result = await run(`
                    UPDATE consolidated_reporting_jobs
                    SET sheet_status = 'PENDING',
                        sheet_processing_started_at = NULL,
                        sheet_last_error = ?
                    WHERE id = ? AND sheet_status = 'PROCESSING'
                      AND sheet_processing_started_at = ?
                `, [safeMessage("RETRYABLE_TRANSPORT_FAILURE", "Recovered stale processing claim."), row.id, row.sheet_processing_started_at]);
                recovered += result.changes;
            }
            await run("COMMIT");
            return recovered;
        }
        catch (error) {
            if (transactionStarted) await run("ROLLBACK").catch(() => {});
            if (isTransactionContention(error)) return 0;
            throw error;
        }
    }

    async function claimNext() {
        let transactionStarted = false;
        try {
            await run("BEGIN IMMEDIATE TRANSACTION");
            transactionStarted = true;
            const rows = await all(`
                SELECT * FROM consolidated_reporting_jobs
                WHERE sheet_status = 'PENDING'
                ORDER BY business_date ASC, close_sequence ASC, id ASC
            `);
            for (const row of rows) {
                if (row.sheet_last_attempt_at && now().getTime() - Date.parse(row.sheet_last_attempt_at) < RETRY_COOLDOWN_MS) continue;
                if (await hasDayClosingSnapshotsTable()) {
                    const snapshot = await get("SELECT id, business_date, close_sequence, close_status FROM day_closing_snapshots WHERE id = ?", [row.closing_id]);
                    const latest = snapshot && await get("SELECT id, close_sequence FROM day_closing_snapshots WHERE business_date = ? AND close_status = 'CLOSED' ORDER BY close_sequence DESC LIMIT 1", [row.business_date]);
                    if (!snapshot || snapshot.close_status !== "CLOSED" || !latest || Number(latest.id) !== Number(row.closing_id) || Number(latest.close_sequence) !== Number(row.close_sequence)) {
                        const message = safeMessage("STALE_SUPERSEDED", "A newer CLOSED sequence is authoritative; Sheet delivery was suppressed locally.");
                        await run("UPDATE consolidated_reporting_jobs SET sheet_status='FAILED', sheet_processing_started_at=NULL, sheet_last_error=? WHERE id=? AND sheet_status='PENDING'", [message, row.id]);
                        continue;
                    }
                }
                const attemptTimestamp = now().toISOString();
                const claimed = await run(`
                    UPDATE consolidated_reporting_jobs
                    SET sheet_status = 'PROCESSING',
                        sheet_attempt_count = sheet_attempt_count + 1,
                        sheet_last_attempt_at = ?,
                        sheet_processing_started_at = ?
                    WHERE id = ? AND sheet_status = 'PENDING'
                `, [attemptTimestamp, attemptTimestamp, row.id]);
                if (claimed.changes !== 1) continue;
                await run("COMMIT");
                transactionStarted = false;
                return {
                    ...row,
                    sheet_status: "PROCESSING",
                    sheet_attempt_count: Number(row.sheet_attempt_count || 0) + 1,
                    sheet_last_attempt_at: attemptTimestamp,
                    sheet_processing_started_at: attemptTimestamp
                };
            }
            await run("COMMIT");
            transactionStarted = false;
            return null;
        }
        catch (error) {
            if (transactionStarted) await run("ROLLBACK").catch(() => {});
            if (isTransactionContention(error)) return null;
            throw error;
        }
    }

    async function requeueFailedJob(jobId) {
        if (!Number.isInteger(jobId) || jobId <= 0) {
            return { requeued: false, jobId: null, code: "INVALID_JOB_ID" };
        }
        const result = await run(`
            UPDATE consolidated_reporting_jobs
            SET sheet_status = 'PENDING',
                sheet_processing_started_at = NULL
            WHERE id = ?
              AND sheet_status = 'FAILED'
              AND sheet_delivered_at IS NULL
              AND (sheet_last_error IS NULL OR sheet_last_error NOT LIKE 'STALE_SUPERSEDED:%')
        `, [jobId]);
        return result.changes === 1
            ? { requeued: true, jobId }
            : { requeued: false, jobId, code: "JOB_NOT_REQUEUEABLE" };
    }

    async function persistOutcome(claimed, outcome) {
        const delivered = outcome.delivered === true;
        const nextStatus = delivered ? "DELIVERED" : outcome.retryable ? "PENDING" : "FAILED";
        const deliveredAt = delivered ? now().toISOString() : null;
        const lastError = delivered ? null : outcome.message;
        const result = await run(`
            UPDATE consolidated_reporting_jobs
            SET sheet_status = ?,
                sheet_delivered_at = CASE WHEN ? = 'DELIVERED' THEN ? ELSE sheet_delivered_at END,
                sheet_last_error = ?,
                sheet_processing_started_at = NULL
            WHERE id = ? AND sheet_status = 'PROCESSING'
              AND sheet_processing_started_at = ?
        `, [nextStatus, nextStatus, deliveredAt, lastError, claimed.id, claimed.sheet_processing_started_at]);
        if (result.changes !== 1) {
            return terminal("INVALID_RESPONSE", "Consolidated Sheet job outcome could not be persisted because the claim changed.");
        }
        try {
            technicalLogger.info("CONSOLIDATED_SHEET", "Consolidated Sheet job outcome persisted", {
                jobId: claimed.id,
                closingId: claimed.closing_id,
                closeSequence: claimed.close_sequence,
                classification: outcome.code,
                status: nextStatus
            });
            await logActivity({
                category: "DAY CLOSING",
                action: outcome.delivered ? "DSR_SYNC_SUCCEEDED" : "DSR_SYNC_FAILED",
                details: `Consolidated Sheet ${outcome.delivered ? "delivered" : "failed"}; Close sequence: ${Number(claimed.close_sequence)} | ${String(outcome.code || "UNKNOWN")}`,
                user_name: "SYSTEM",
                status: outcome.delivered ? "SUCCESS" : "FAILED",
                entity_type: "BUSINESS_DAY",
                reference_no: claimed.business_date
            });
        }
        catch (_) {}
        return {
            ...outcome,
            status: nextStatus,
            jobId: claimed.id,
            attemptCount: Number(claimed.sheet_attempt_count),
            deliveredAt
        };
    }

    async function resolveConfiguration() {
        const configuration = await configProvider();
        const endpoint = String(configuration && configuration.endpoint || "").trim();
        const secret = String(configuration && configuration.secret || "");
        if (!/^https:\/\//i.test(endpoint)) return terminal("REJECTED", "Consolidated receiver HTTPS endpoint is not configured.");
        if (!secret) return terminal("MISSING_SECRET", "Consolidated receiver secret is not configured.");
        return { endpoint, secret };
    }

    function expectedHttpStatus(action) {
        return action === "INSERTED" ? 201 : 200;
    }

    function acceptsSuccessHttpStatus(action, status) {
        // Google Apps Script ContentService may surface every response as HTTP
        // 200. The structured response is still validated first; HTTP 200 is
        // accepted only for a recognized, identity/hash-bound success action.
        return status === 200 || status === expectedHttpStatus(action);
    }

    async function sendClaimed(claimed) {
        let validated;
        try {
            validated = validateFrozenJob(claimed);
        }
        catch (error) {
            return terminal(error.code || "INVALID_PAYLOAD_JSON", error.message || "Frozen reporting job validation failed.");
        }

        const configuration = await resolveConfiguration();
        if (configuration.code) return configuration;

        let envelope;
        try {
            envelope = buildEnvelope(validated, claimed.sheet_last_attempt_at, configuration.secret);
        }
        catch (error) {
            return terminal(error.code || "INVALID_PAYLOAD_JSON", error.message || "Consolidated envelope construction failed.");
        }

        try {
            const response = await httpClient.post(configuration.endpoint, envelope, {
                timeout: HTTP_TIMEOUT_MS,
                maxRedirects: MAX_REDIRECTS,
                beforeRedirect: redirectOptions => {
                    if (!redirectOptions || redirectOptions.protocol !== "https:") {
                        throw new Error("Consolidated receiver redirect destination must use HTTPS.");
                    }
                },
                maxContentLength: 128 * 1024,
                maxBodyLength: 128 * 1024,
                headers: { "Content-Type": "application/json" },
                responseType: "json",
                validateStatus: status => status >= 200 && status < 600
            });
            if (response.status >= 200 && response.status < 300) {
                const result = validateReceiverResponse(response.data, validated);
                if (response.status === 200 && result.code !== "DELIVERED" && result.code !== "STALE_SUPERSEDED") {
                    // Current terminal error bodies do not echo submitted
                    // identity/hash, so accepting them over HTTP 200 would
                    // allow an unbound body to terminate a delivery attempt.
                    return terminal("INVALID_RESPONSE", "HTTP 200 response is not a valid identity-bound success response.");
                }
                if ((result.code === "DELIVERED" || result.code === "STALE_SUPERSEDED") &&
                    result.action && !acceptsSuccessHttpStatus(result.action, response.status)) {
                    return terminal("INVALID_RESPONSE", "Receiver HTTP status does not match the accepted action.");
                }
                return result.code === "STALE_SUPERSEDED"
                    ? terminal("STALE_SUPERSEDED", result.message)
                    : result.code === "DELIVERED"
                        ? { code: "DELIVERED", message: result.message, retryable: false, delivered: true, action: result.action }
                        : terminal(result.code, result.message);
            }
            return normalizeClassification(classifyTransportFailure({ status: response.status }));
        }
        catch (error) {
            return normalizeClassification(classifyTransportFailure({ status: error && error.response && error.response.status, error }));
        }
    }

    async function processNext() {
        await recoverStaleProcessing();
        const claimed = await claimNext();
        if (!claimed) return { processed: false, jobId: null };
        const outcome = await sendClaimed(claimed);
        return persistOutcome(claimed, outcome);
    }

    async function drain() {
        return processNext();
    }

    async function retryForClosing(closingId) {
        const result = await run(`
            UPDATE consolidated_reporting_jobs
            SET sheet_status='PENDING', sheet_processing_started_at=NULL, sheet_last_error=NULL
            WHERE closing_id=? AND sheet_status='FAILED' AND sheet_delivered_at IS NULL
              AND (sheet_last_error IS NULL OR sheet_last_error NOT LIKE 'STALE_SUPERSEDED:%')
        `, [closingId]);
        return { requeued: result.changes === 1, closingId, code: result.changes === 1 ? null : "SHEET_JOB_NOT_REQUEUEABLE" };
    }

    return {
        claimNext,
        requeueFailedJob,
        recoverStaleProcessing,
        processNext,
        drain,
        retryForClosing,
        processClaimed: async claimed => persistOutcome(claimed, await sendClaimed(claimed)),
        constants: Object.freeze({
            STALE_PROCESSING_TIMEOUT_MS,
            HTTP_TIMEOUT_MS,
            MAX_REDIRECTS,
            RETRY_COOLDOWN_MS
        })
    };
}

module.exports = {
    STALE_PROCESSING_TIMEOUT_MS,
    HTTP_TIMEOUT_MS,
    MAX_REDIRECTS,
    resolveConsolidatedDsrConfiguration,
    createConsolidatedSheetDeliveryWorker
};
