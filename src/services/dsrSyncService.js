const crypto = require("crypto");
const axios = require("axios");
const technicalLogger = require("./technicalLogger");

const CONTRACT_VERSION = 1;
const ACCEPTED_ACTIONS = new Set(["INSERTED", "UPDATED", "UNCHANGED"]);
const PAYLOAD_FIELDS = Object.freeze([
    "contractVersion", "businessDate", "closingId", "closeSequence",
    "snapshotVersion", "closedAt", "totalBills", "qtySold",
    "grossSalesPaise", "totalDiscountPaise", "netBillingPaise",
    "creditNoteCount", "qtyReturned", "returnCnValuePaise",
    "netSalesAfterReturnsPaise", "cashPaise", "upiPaise", "cardPaise",
    "storeCreditRedeemedPaise", "giftVoucherRedeemedPaise",
    "settlementTotalPaise", "actualMoneyCollectionPaise",
    "storeCreditIssuedPaise", "settlementDifferencePaise",
    "backupStatus", "emailStatus", "klbsVersion"
]);
const INTEGER_FIELDS = new Set(PAYLOAD_FIELDS.filter(field =>
    field.endsWith("Paise") || [
        "contractVersion", "closingId", "closeSequence", "snapshotVersion",
        "totalBills", "qtySold", "creditNoteCount", "qtyReturned"
    ].includes(field)
));

function canonicalizePayload(input) {
    const payload = {};
    for (const field of PAYLOAD_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(input || {}, field)) {
            throw new Error(`DSR payload field is missing: ${field}.`);
        }
        payload[field] = input[field];
    }
    return JSON.stringify(payload);
}

function validatePayload(payload) {
    canonicalizePayload(payload);
    for (const field of INTEGER_FIELDS) {
        if (!Number.isSafeInteger(payload[field])) {
            throw new Error(`DSR payload field must be a safe integer: ${field}.`);
        }
    }
    if (payload.contractVersion !== CONTRACT_VERSION || payload.snapshotVersion !== 1) {
        throw new Error("DSR payload version is unsupported.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.businessDate)) {
        throw new Error("DSR payload Business Date is invalid.");
    }
    if (!payload.closedAt || !Number.isFinite(Date.parse(payload.closedAt))) {
        throw new Error("DSR payload Closed At is invalid.");
    }
    if (!["SUCCESS"].includes(payload.backupStatus) ||
        !["SUCCESS", "FAILED"].includes(payload.emailStatus)) {
        throw new Error("DSR payload operational status is invalid.");
    }
    if (!String(payload.klbsVersion || "").trim()) {
        throw new Error("DSR payload KLBS version is required.");
    }
    return payload;
}

function signPayload(payload, timestamp, secret) {
    validatePayload(payload);
    const normalizedTimestamp = String(timestamp || "");
    if (!normalizedTimestamp || !Number.isFinite(Date.parse(normalizedTimestamp))) {
        throw new Error("DSR request timestamp is invalid.");
    }
    if (!String(secret || "")) throw new Error("DSR sync secret is not configured.");
    const canonicalPayloadJson = canonicalizePayload(payload);
    const input = `${normalizedTimestamp}\n${payload.businessDate}\n${canonicalPayloadJson}`;
    return crypto.createHmac("sha256", secret).update(input, "utf8").digest("hex");
}

function safeFailure(error) {
    if (error && error.code === "ECONNABORTED") return "DSR sync timed out.";
    if (error && error.response) return `DSR service returned HTTP ${Number(error.response.status) || "error"}.`;
    return String(error && error.message || "DSR sync failed.")
        .replace(/https?:\/\/\S+/gi, "[ENDPOINT]")
        .slice(0, 500);
}

function classifyFailure(error) {
    if (error && error.code === "ECONNABORTED") return "TIMEOUT";
    if (error && error.response) {
        const status = Number(error.response.status);
        return status >= 500 ? "HTTP_5XX" : status >= 400 ? "HTTP_4XX" : "HTTP_ERROR";
    }
    if (/response/i.test(String(error && error.message || ""))) return "INVALID_RESPONSE";
    if (/configured/i.test(String(error && error.message || ""))) return "NOT_CONFIGURED";
    return "TRANSPORT_ERROR";
}

function validateResponse(data, payload) {
    if (!data || typeof data !== "object" || Array.isArray(data) || data.ok !== true) {
        throw new Error("DSR service returned an unsuccessful response.");
    }
    if (!ACCEPTED_ACTIONS.has(data.action)) {
        throw new Error("DSR service returned an unsupported action.");
    }
    if (data.businessDate !== payload.businessDate ||
        Number(data.closingId) !== payload.closingId ||
        Number(data.closeSequence) !== payload.closeSequence ||
        !data.syncedAt || !Number.isFinite(Date.parse(data.syncedAt))) {
        throw new Error("DSR service response identity is invalid.");
    }
    return {
        success: true,
        action: data.action,
        businessDate: data.businessDate,
        closingId: Number(data.closingId),
        closeSequence: Number(data.closeSequence),
        syncedAt: new Date(data.syncedAt).toISOString()
    };
}

function createDsrSyncService(options = {}) {
    const httpClient = options.httpClient || axios;
    const now = options.now || (() => new Date());
    const endpoint = options.endpoint === undefined
        ? process.env.KLBS_DSR_WEB_APP_URL : options.endpoint;
    const secret = options.secret === undefined
        ? process.env.KLBS_DSR_SYNC_SECRET : options.secret;
    const timeout = options.timeout || 9000;

    async function sync(payload) {
        try {
            validatePayload(payload);
            if (!endpoint || !/^https:\/\//i.test(endpoint)) {
                throw new Error("DSR HTTPS endpoint is not configured.");
            }
            if (!secret) throw new Error("DSR sync secret is not configured.");
            const timestamp = now().toISOString();
            const envelope = {
                timestamp,
                payload: JSON.parse(canonicalizePayload(payload)),
                signature: signPayload(payload, timestamp, secret)
            };
            const response = await httpClient.post(endpoint, envelope, {
                timeout,
                maxRedirects: 3,
                maxContentLength: 64 * 1024,
                maxBodyLength: 64 * 1024,
                headers: { "Content-Type": "application/json" },
                responseType: "json",
                validateStatus: status => status >= 200 && status < 300
            });
            const result = validateResponse(response.data, payload);
            technicalLogger.info("DSR_SYNC", "DSR synchronization accepted", {
                closingId: payload.closingId,
                closeSequence: payload.closeSequence,
                action: result.action
            });
            return result;
        }
        catch (error) {
            technicalLogger.warn("DSR_SYNC", "DSR transport attempt failed", {
                closingId: Number.isSafeInteger(payload && payload.closingId)
                    ? payload.closingId : null,
                closeSequence: Number.isSafeInteger(payload && payload.closeSequence)
                    ? payload.closeSequence : null,
                classification: classifyFailure(error),
                httpStatus: error && error.response ? Number(error.response.status) || null : null
            });
            return { success: false, error: safeFailure(error) };
        }
    }
    return { sync };
}

module.exports = {
    CONTRACT_VERSION,
    PAYLOAD_FIELDS,
    canonicalizePayload,
    validatePayload,
    signPayload,
    validateResponse,
    createDsrSyncService,
    classifyFailure
};
