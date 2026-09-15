const crypto = require("crypto");
const axios = require("axios");

const CONTRACT = "KLBS_SEGMENT_DSR_V1";
const ACTIONS = new Set(["INSERTED", "UNCHANGED", "RETAINED"]);

function canonicalizePayload(payload) {
    if (!payload || payload.contract !== CONTRACT) throw new Error("Segment DSR contract is unsupported.");
    const ordered = {
        contract: payload.contract,
        businessDate: payload.businessDate,
        closeSequence: payload.closeSequence,
        reportStatus: payload.reportStatus,
        segments: payload.segments,
        dataQuality: payload.dataQuality,
        reconciliation: payload.reconciliation,
        klbsVersion: payload.klbsVersion,
        generatedAt: payload.generatedAt
    };
    return JSON.stringify(ordered);
}

function signPayload(payload, timestamp, secret) {
    const normalizedTimestamp = String(timestamp || "");
    if (!normalizedTimestamp || !Number.isFinite(Date.parse(normalizedTimestamp))) throw new Error("Segment DSR request timestamp is invalid.");
    if (!String(secret || "")) throw new Error("Segment DSR sync secret is not configured.");
    return crypto.createHmac("sha256", secret)
        .update(`${normalizedTimestamp}\n${payload.businessDate}\n${canonicalizePayload(payload)}`, "utf8")
        .digest("hex");
}

function safeError(error) {
    if (error && error.code === "ECONNABORTED") return "Segment DSR Sheets sync timed out.";
    if (error && error.response) return `Segment DSR receiver returned HTTP ${Number(error.response.status) || "error"}.`;
    return String(error && error.message || "Segment DSR Sheets sync failed.")
        .replace(/https?:\/\/\S+/gi, "[ENDPOINT]")
        .replace(/\b(?:hmac|secret|token|password|credential|authorization|api[_ -]?key)\s*[:=]\s*\S+/gi, "[REDACTED]")
        .slice(0, 500);
}

function createBusinessSegmentDsrSyncService(options = {}) {
    const httpClient = options.httpClient || axios;
    const now = options.now || (() => new Date());
    const configProvider = options.configProvider || (() => ({
        endpoint: options.endpoint === undefined ? process.env.KLBS_DSR_WEB_APP_URL : options.endpoint,
        secret: options.secret === undefined ? process.env.KLBS_DSR_SYNC_SECRET : options.secret,
        automaticSync: true
    }));
    const timeout = options.timeout || 30000;

    async function sync(payload) {
        try {
            const { endpoint, secret, automaticSync } = await configProvider();
            if (automaticSync === false) throw new Error("Automatic Segment DSR Sheets sync is disabled.");
            if (!endpoint || !/^https:\/\//i.test(endpoint)) throw new Error("Segment DSR HTTPS endpoint is not configured.");
            const timestamp = now().toISOString();
            const envelope = { timestamp, payload: JSON.parse(canonicalizePayload(payload)), signature: signPayload(payload, timestamp, secret) };
            const response = await httpClient.post(endpoint, envelope, {
                timeout, maxRedirects: 3, maxContentLength: 128 * 1024, maxBodyLength: 128 * 1024,
                headers: { "Content-Type": "application/json" }, responseType: "json",
                validateStatus: status => status >= 200 && status < 300
            });
            const data = response.data;
            if (!data || data.ok !== true || !ACTIONS.has(data.action) || data.businessDate !== payload.businessDate || Number(data.closeSequence) !== Number(payload.closeSequence) || !data.receivedAt || !Number.isFinite(Date.parse(data.receivedAt))) throw new Error("Segment DSR receiver response is invalid.");
            return { success: true, action: data.action, businessDate: data.businessDate, closeSequence: Number(data.closeSequence), receivedAt: new Date(data.receivedAt).toISOString() };
        }
        catch (error) {
            return { success: false, error: safeError(error) };
        }
    }

    return { sync, canonicalizePayload, signPayload };
}

module.exports = { CONTRACT, canonicalizePayload, signPayload, createBusinessSegmentDsrSyncService };
