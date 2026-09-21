const crypto = require("crypto");

const TRANSPORT_VERSION = 1;
const DOMAIN_LABEL = "KLBS-CONSOLIDATED-DSR-V1";
const SEMANTIC_CONTRACT_VERSION = 2;
const SEMANTIC_SNAPSHOT_VERSION = 2;
const PAYLOAD_HASH_PATTERN = /^[0-9a-f]{64}$/;
const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RECONCILIATION_MODES = Object.freeze([
    "cash",
    "upi",
    "card",
    "storeCreditRedeemed",
    "giftVoucherRedeemed"
]);
const SUCCESS_ACTIONS = new Set(["INSERTED", "UPDATED", "UNCHANGED", "STALE"]);
const ERROR_ACTIONS = new Set(["REJECTED", "AUTHENTICATION_FAILED", "CONFLICT"]);

class ConsolidatedTransportError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "ConsolidatedTransportError";
        this.code = code;
    }
}

function fail(code, message) {
    throw new ConsolidatedTransportError(code, message);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isValidUtcIsoTimestamp(value) {
    if (typeof value !== "string" || !ISO_UTC_TIMESTAMP_PATTERN.test(value)) return false;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function requireUtcIsoTimestamp(value) {
    if (!isValidUtcIsoTimestamp(value)) fail("INVALID_TIMESTAMP", "Timestamp must be a valid UTC ISO-8601 timestamp.");
    return value;
}

function requirePayloadHash(value) {
    if (typeof value !== "string" || !PAYLOAD_HASH_PATTERN.test(value)) {
        fail("INVALID_PAYLOAD_HASH", "Payload hash must be 64 lowercase hexadecimal characters.");
    }
    return value;
}

function sha256Utf8(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function payloadIdentity(payload) {
    if (!isPlainObject(payload)) fail("INVALID_RESPONSE", "Transport payload must be a plain object.");
    if (typeof payload.businessDate !== "string" || !payload.businessDate) fail("INVALID_RESPONSE", "Transport payload Business Date is invalid.");
    if (payload.closingId === undefined || payload.closingId === null || String(payload.closingId) === "") fail("INVALID_RESPONSE", "Transport payload Closing ID is invalid.");
    if (payload.closeSequence === undefined || payload.closeSequence === null || String(payload.closeSequence) === "") fail("INVALID_RESPONSE", "Transport payload Closing Sequence is invalid.");
    return {
        businessDate: payload.businessDate,
        closingId: String(payload.closingId),
        closeSequence: String(payload.closeSequence)
    };
}

function validateFrozenJob(job) {
    if (!isPlainObject(job)) fail("INVALID_PAYLOAD_JSON", "Frozen reporting job must be a plain object.");
    if (typeof job.payload_json !== "string" || job.payload_json.length === 0 || job.payload_json.trim() === "") {
        fail("INVALID_PAYLOAD_JSON", "Frozen payload JSON must be a non-empty string.");
    }

    let payload;
    try {
        payload = JSON.parse(job.payload_json);
    }
    catch (_) {
        fail("INVALID_PAYLOAD_JSON", "Frozen payload JSON is invalid.");
    }
    if (!isPlainObject(payload)) fail("INVALID_PAYLOAD_JSON", "Frozen payload JSON must contain a plain object.");

    const payloadHash = requirePayloadHash(job.payload_hash);
    if (sha256Utf8(job.payload_json) !== payloadHash) {
        fail("PAYLOAD_HASH_MISMATCH", "Frozen payload JSON does not match the stored payload hash.");
    }

    const identity = payloadIdentity(payload);
    if (identity.businessDate !== job.business_date ||
        identity.closingId !== String(job.closing_id) ||
        identity.closeSequence !== String(job.close_sequence)) {
        fail("IDENTITY_MISMATCH", "Frozen payload identity does not match the reporting job.");
    }
    if (payload.contractVersion !== SEMANTIC_CONTRACT_VERSION) {
        fail("UNSUPPORTED_CONTRACT_VERSION", "Frozen payload contract version is unsupported.");
    }
    if (payload.snapshotVersion !== SEMANTIC_SNAPSHOT_VERSION) {
        fail("UNSUPPORTED_SNAPSHOT_VERSION", "Frozen payload snapshot version is unsupported.");
    }
    if (payload.reportStatus !== "FINAL") fail("REPORT_NOT_FINAL", "Frozen reporting payload is not FINAL.");
    if (!isPlainObject(payload.dataQuality) || payload.dataQuality.status !== "COMPLETE") {
        fail("DATA_QUALITY_NOT_COMPLETE", "Frozen reporting payload data quality is not COMPLETE.");
    }
    if (!isPlainObject(payload.paymentReconciliation)) {
        fail("PAYMENT_RECONCILIATION_FAILED", "Frozen payment reconciliation is missing or malformed.");
    }
    for (const mode of RECONCILIATION_MODES) {
        if (!isPlainObject(payload.paymentReconciliation[mode]) ||
            payload.paymentReconciliation[mode].status !== "PASS") {
            fail("PAYMENT_RECONCILIATION_FAILED", `Frozen ${mode} payment reconciliation did not PASS.`);
        }
    }

    return {
        payloadJson: job.payload_json,
        payloadHash,
        payload,
        businessDate: identity.businessDate,
        closingId: identity.closingId,
        closeSequence: identity.closeSequence
    };
}

function signedMessage({ transportVersion = TRANSPORT_VERSION, timestamp, payload, payloadHash }) {
    if (transportVersion !== TRANSPORT_VERSION) fail("INVALID_RESPONSE", "Transport version is unsupported.");
    requireUtcIsoTimestamp(timestamp);
    const identity = payloadIdentity(payload);
    requirePayloadHash(payloadHash);
    return [
        DOMAIN_LABEL,
        String(transportVersion),
        timestamp,
        identity.businessDate,
        identity.closingId,
        identity.closeSequence,
        payloadHash
    ].join("\n");
}

function signMessage(message, secret) {
    if (typeof secret !== "string" || secret.length === 0) fail("MISSING_SECRET", "Consolidated transport secret is not configured.");
    return crypto.createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function buildEnvelope(validatedJob, timestamp, secret) {
    if (!isPlainObject(validatedJob) || !isPlainObject(validatedJob.payload)) {
        fail("INVALID_PAYLOAD_JSON", "A preflight-validated frozen job is required.");
    }
    const payloadHash = requirePayloadHash(validatedJob.payloadHash);
    const message = signedMessage({
        transportVersion: TRANSPORT_VERSION,
        timestamp,
        payload: validatedJob.payload,
        payloadHash
    });
    return {
        transportVersion: TRANSPORT_VERSION,
        timestamp,
        payload: validatedJob.payload,
        payloadHash,
        signature: signMessage(message, secret)
    };
}

function submittedIdentity(submitted) {
    if (!isPlainObject(submitted) || !isPlainObject(submitted.payload)) fail("INVALID_RESPONSE", "Submitted frozen job is invalid.");
    const identity = payloadIdentity(submitted.payload);
    return { ...identity, payloadHash: requirePayloadHash(submitted.payloadHash) };
}

function responseIdentityMatches(response, expected) {
    return response.businessDate === expected.businessDate &&
        String(response.closingId) === expected.closingId &&
        String(response.closeSequence) === expected.closeSequence &&
        response.payloadHash === expected.payloadHash;
}

function invalidResponse(message = "Receiver response is invalid.") {
    return {
        ok: false,
        code: "INVALID_RESPONSE",
        message,
        classification: "INVALID_RESPONSE",
        retryable: false,
        delivered: false
    };
}

function validateReceiverResponse(response, submitted) {
    let expected;
    try {
        expected = submittedIdentity(submitted);
    }
    catch (error) {
        return invalidResponse(error.message);
    }
    if (!isPlainObject(response) || response.transportVersion !== TRANSPORT_VERSION) return invalidResponse();

    if (response.ok === true && SUCCESS_ACTIONS.has(response.action)) {
        if (!responseIdentityMatches(response, expected) || !isValidUtcIsoTimestamp(response.receivedAt)) {
            return invalidResponse("Receiver response identity, hash, or timestamp is invalid.");
        }
        if (response.action === "STALE") {
            return {
                ok: false,
                code: "STALE_SUPERSEDED",
                message: "The frozen reporting job was superseded by a newer close sequence.",
                classification: "STALE_SUPERSEDED",
                action: "STALE",
                retryable: false,
                delivered: false,
                businessDate: expected.businessDate,
                closingId: expected.closingId,
                closeSequence: expected.closeSequence,
                payloadHash: expected.payloadHash,
                receivedAt: response.receivedAt
            };
        }
        return {
            ok: true,
            code: "DELIVERED",
            message: "Consolidated reporting payload accepted by receiver.",
            classification: "DELIVERED",
            action: response.action,
            retryable: false,
            delivered: true,
            businessDate: expected.businessDate,
            closingId: expected.closingId,
            closeSequence: expected.closeSequence,
            payloadHash: expected.payloadHash,
            receivedAt: response.receivedAt
        };
    }

    if (response.ok === false && ERROR_ACTIONS.has(response.action) &&
        typeof response.errorCode === "string" && /^[A-Z0-9_]+$/.test(response.errorCode) &&
        typeof response.message === "string") {
        const code = response.action === "CONFLICT"
            ? "CONFLICT"
            : response.action === "AUTHENTICATION_FAILED" ? "AUTHENTICATION_FAILED" : "REJECTED";
        const message = response.action === "CONFLICT"
            ? "Receiver reported a consolidated reporting conflict."
            : response.action === "AUTHENTICATION_FAILED"
                ? "Receiver rejected consolidated reporting authentication."
                : "Receiver rejected the consolidated reporting payload.";
        return {
            ok: false,
            code,
            message,
            classification: code,
            action: response.action,
            retryable: false,
            delivered: false
        };
    }
    return invalidResponse();
}

function classifyTransportFailure(input = {}) {
    const status = Number(input.status ?? (input.response && input.response.status));
    if (Number.isInteger(status)) {
        if (status === 408 || status === 429 || status >= 500 && status <= 599) {
            return { code: "RETRYABLE_TRANSPORT_FAILURE", message: "Consolidated transport failure is retryable.", classification: "RETRYABLE_TRANSPORT_FAILURE", retryable: true };
        }
        if (status === 409) return { code: "CONFLICT", message: "Receiver reported a consolidated reporting conflict.", classification: "CONFLICT", retryable: false };
        if (status === 401 || status === 403) return { code: "AUTHENTICATION_FAILED", message: "Consolidated transport authentication failed.", classification: "AUTHENTICATION_FAILED", retryable: false };
        if (status >= 400 && status <= 499) return { code: "REJECTED", message: "Receiver rejected the consolidated reporting request.", classification: "REJECTED", retryable: false };
        return { code: "INVALID_RESPONSE", message: "Unexpected consolidated transport HTTP status.", classification: "INVALID_RESPONSE", retryable: false };
    }

    const error = input.error || input;
    const errorCode = String(error && error.code || "").toUpperCase();
    const errorMessage = String(error && error.message || "");
    const retryableNetworkCode = new Set(["ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "EAI_AGAIN", "EHOSTUNREACH"]);
    if (retryableNetworkCode.has(errorCode) || /timeout|timed out|network|connection reset|connection refused|unreachable/i.test(errorMessage) ||
        /TLS|CERTIFICATE|SSL/i.test(errorCode) || /tls|certificate|ssl/i.test(errorMessage)) {
        return { code: "RETRYABLE_TRANSPORT_FAILURE", message: "Consolidated transport failure is retryable.", classification: "RETRYABLE_TRANSPORT_FAILURE", retryable: true };
    }
    return { code: "INVALID_RESPONSE", message: "Consolidated transport outcome is invalid.", classification: "INVALID_RESPONSE", retryable: false };
}

module.exports = {
    TRANSPORT_VERSION,
    DOMAIN_LABEL,
    SEMANTIC_CONTRACT_VERSION,
    SEMANTIC_SNAPSHOT_VERSION,
    RECONCILIATION_MODES,
    ConsolidatedTransportError,
    isValidUtcIsoTimestamp,
    sha256Utf8,
    validateFrozenJob,
    signedMessage,
    signMessage,
    buildEnvelope,
    validateReceiverResponse,
    classifyTransportFailure
};
