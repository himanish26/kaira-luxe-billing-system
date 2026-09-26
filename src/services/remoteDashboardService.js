const crypto = require("crypto");
const axios = require("axios");
const { getBusinessDate } = require("../database/businessDate");
const { buildRemoteDashboardSnapshot, CONTRACT_ID, isoWithBusinessOffset, paise } = require("./remoteDashboardSnapshot");

const EVENT_CONTRACT_ID = "klbs.remote-dashboard.notification-event.v1";
const IDENTITY = { merchant_id: "KAIRA_LUXE", store_code: "KL001", terminal_id: "POS01" };
const EVENT_TYPES = new Set(["BILL_SAVED", "KLBS_STARTED", "DAY_CLOSED"]);
const RETRYABLE_CODES = new Set(["SERVER_BUSY", "UPSTREAM_UNAVAILABLE"]);
const ACCEPTED_CODES = new Set(["ACCEPTED", "DUPLICATE"]);
const EVENT_TIMEOUT_MS = 8000;
const SNAPSHOT_TIMEOUT_MS = 20000;

function stableJson(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function createRemoteDashboardService(options = {}) {
    const database = options.database;
    if (!database) throw new Error("Remote Dashboard database dependency is required.");
    const now = options.now || (() => new Date());
    const sessionStartedAt = options.sessionStartedAt || isoWithBusinessOffset(now());
    const sessionId = options.sessionId || `session-${crypto.randomUUID()}`;
    const configProvider = options.configProvider || (() => ({
        webAppBase: process.env.KLBS_REMOTE_DASHBOARD_WEB_APP_BASE,
        gatewayBase: process.env.KLBS_REMOTE_DASHBOARD_GATEWAY_BASE,
        secret: process.env.KLBS_INSTALLATION_SECRET,
        enabled: process.env.KLBS_REMOTE_DASHBOARD_ENABLED !== "false"
    }));
    const post = options.post || (async (endpoint, body, headers, timeout) => axios.post(endpoint, body, { headers, timeout, validateStatus: () => true }));
    const log = options.log || (() => {});
    const run = (sql, params = []) => new Promise((resolve, reject) => database.run(sql, params, function (error) { error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes }); }));
    const get = (sql, params = []) => new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    let drainInFlight = null;
    let snapshotInFlight = null;
    let timer = null;

    function config() {
        const value = configProvider() || {};
        return {
            webAppBase: String(value.webAppBase || "").trim(),
            gatewayBase: String(value.gatewayBase || "").trim(),
            secret: String(value.secret || ""),
            enabled: value.enabled !== false
        };
    }
    function eventKey(type, identity) { return `${type}:${identity}`; }
    function eventPayload(type, data, key) {
        if (!EVENT_TYPES.has(type)) throw new Error("Unsupported Remote Dashboard event type.");
        return { contract_id: EVENT_CONTRACT_ID, event_id: key, event_type: type, ...IDENTITY, ...data };
    }
    async function enqueue(type, data, key) {
        const idempotencyKey = eventKey(type, key);
        const payload = eventPayload(type, data, idempotencyKey);
        const timestamp = isoWithBusinessOffset(now());
        const result = await run(`INSERT OR IGNORE INTO remote_dashboard_outbox
            (event_type, idempotency_key, payload_json, created_at, updated_at, next_attempt_at)
            VALUES (?, ?, ?, ?, ?, ?)`, [type, idempotencyKey, JSON.stringify(payload), timestamp, timestamp, timestamp]);
        if (result.changes) log("queued", { eventType: type });
        return { created: result.changes > 0, idempotencyKey };
    }
    async function queueBillSaved(bill) {
        const row = await get("SELECT bill_no, bill_date, net_amount, created_at FROM bills WHERE bill_no = ?", [bill.bill_no]);
        if (!row) throw new Error("Saved bill is unavailable for Remote Dashboard event.");
        return enqueue("BILL_SAVED", {
            business_date: row.bill_date,
            event_at: row.created_at || isoWithBusinessOffset(now()),
            bill_no: String(row.bill_no),
            bill_time: row.created_at || isoWithBusinessOffset(now()),
            net_amount_paise: paise(row.net_amount)
        }, `bill:${row.bill_no}`);
    }
    async function queueStarted() {
        return enqueue("KLBS_STARTED", {
            business_date: getBusinessDate(now()),
            event_at: sessionStartedAt,
            session_id: sessionId,
            started_at: sessionStartedAt
        }, `session:${sessionId}`);
    }
    async function queueDayClosed(result) {
        const snapshot = result && result.snapshot;
        if (!snapshot) throw new Error("Closed Day Closing snapshot is unavailable.");
        return enqueue("DAY_CLOSED", {
            business_date: snapshot.businessDate,
            event_at: snapshot.closedAt || isoWithBusinessOffset(now()),
            net_sales_paise: paise(snapshot.netSalesAfterReturns),
            closed_at: snapshot.closedAt || isoWithBusinessOffset(now())
        }, `day:${snapshot.businessDate}:${snapshot.closeSequence}`);
    }
    function signedEnvelope(body, context, secret, requestId, requestTimestamp) {
        const digest = crypto.createHash("sha256").update(stableJson(body), "utf8").digest("hex");
        const material = ["KLBS-SIGNATURE-v1", "POST", context, body.contract_id, body.merchant_id, body.store_code, body.terminal_id, requestTimestamp, requestId, digest].join("\n");
        return {
            body,
            request_timestamp: requestTimestamp,
            request_id: requestId,
            method: "POST",
            context,
            signature: crypto.createHmac("sha256", secret).update(material, "utf8").digest("hex")
        };
    }
    function classify(response, kind) {
        const status = Number(response && response.status);
        const code = response && response.data && response.data.code;
        if (ACCEPTED_CODES.has(code)) return "ACCEPTED";
        if (status === 408 || status === 429 || status >= 500 || RETRYABLE_CODES.has(code)) return "RETRYABLE_FAILURE";
        return "PERMANENT_FAILURE";
    }
    function endpointFor(type, settings) {
        return type === "BILL_SAVED" || type === "KLBS_STARTED" || type === "DAY_CLOSED"
            ? `${settings.gatewayBase.replace(/\/$/, "")}/api/events`
            : settings.webAppBase;
    }
    async function processOne(row) {
        const settings = config();
        if (!settings.enabled || !settings.gatewayBase || !settings.secret) return false;
        const attempt = Number(row.attempt_count || 0) + 1;
        const started = isoWithBusinessOffset(now());
        await run("UPDATE remote_dashboard_outbox SET attempt_count=?, last_attempt_at=?, updated_at=? WHERE id=? AND status IN ('PENDING','RETRYABLE_FAILURE')", [attempt, started, started, row.id]);
        let classification = "RETRYABLE_FAILURE";
        let errorText = null;
        try {
            const payload = JSON.parse(row.payload_json);
            const requestTimestamp = isoWithBusinessOffset(now());
            const requestId = `delivery-${crypto.randomUUID()}`;
            const envelope = signedEnvelope(payload, "/notification-events", settings.secret, requestId, requestTimestamp);
            const response = await post(endpointFor(row.event_type, settings), envelope, { "content-type": "application/json" }, EVENT_TIMEOUT_MS);
            classification = classify(response, "event");
            if (classification !== "ACCEPTED") errorText = `Remote Dashboard HTTP ${Number(response && response.status) || "failure"} ${String(response && response.data && response.data.code || "").slice(0, 80)}.`;
        }
        catch (error) {
            errorText = String(error && error.message || "Remote Dashboard transport failed.").replace(/https?:\/\/\S+/gi, "[ENDPOINT]").slice(0, 500);
        }
        return persistOutcome(row, classification, errorText, attempt);
    }
    async function persistOutcome(row, classification, errorText, attempt) {
        if (classification === "ACCEPTED") {
            await run("UPDATE remote_dashboard_outbox SET status='ACCEPTED', accepted_at=?, updated_at=?, last_error=NULL WHERE id=?", [isoWithBusinessOffset(now()), isoWithBusinessOffset(now()), row.id]);
            log("accepted", { eventType: row.event_type });
            return true;
        }
        if (classification === "PERMANENT_FAILURE") {
            await run("UPDATE remote_dashboard_outbox SET status='PERMANENT_FAILURE', updated_at=?, last_error=? WHERE id=?", [isoWithBusinessOffset(now()), errorText || "Remote Dashboard payload rejected.", row.id]);
            return false;
        }
        const delaySeconds = Math.min(3600, 30 * (2 ** Math.min(attempt - 1, 6)));
        const retryAt = isoWithBusinessOffset(new Date(now().getTime() + delaySeconds * 1000));
        await run("UPDATE remote_dashboard_outbox SET status='RETRYABLE_FAILURE', next_attempt_at=?, updated_at=?, last_error=? WHERE id=?", [retryAt, isoWithBusinessOffset(now()), errorText, row.id]);
        log("retry", { eventType: row.event_type, delaySeconds });
        return false;
    }
    async function drain() {
        if (drainInFlight) return drainInFlight;
        drainInFlight = (async () => {
            const settings = config();
            if (!settings.enabled || !settings.gatewayBase || !settings.secret) return;
            await run("DELETE FROM remote_dashboard_outbox WHERE status='ACCEPTED' AND accepted_at < ?", [isoWithBusinessOffset(new Date(now().getTime() - 30 * 24 * 60 * 60 * 1000))]);
            const current = isoWithBusinessOffset(now());
            const rows = await all(`SELECT * FROM remote_dashboard_outbox
                WHERE status IN ('PENDING','RETRYABLE_FAILURE') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                ORDER BY id LIMIT 10`, [current]);
            for (const row of rows) await processOne(row);
        })().catch(error => log("failed", { classification: String(error.message || "").slice(0, 200) })).finally(() => { drainInFlight = null; });
        return drainInFlight;
    }
    async function syncSnapshot() {
        if (snapshotInFlight) return snapshotInFlight;
        snapshotInFlight = (async () => {
            const settings = config();
            if (!settings.enabled || !settings.webAppBase || !settings.secret) return { skipped: true };
            const timestamp = isoWithBusinessOffset(now());
            const requestId = `snapshot-request-${crypto.randomUUID()}`;
            const payload = await buildRemoteDashboardSnapshot({ database, now, sessionStartedAt, snapshotId: `snapshot-${sessionId}-${timestamp}`, requestId, getStatus: options.getStatus });
            const envelope = signedEnvelope(payload, "/snapshot", settings.secret, requestId, timestamp);
            const response = await post(settings.webAppBase, envelope, { "content-type": "application/json" }, SNAPSHOT_TIMEOUT_MS);
            const classification = classify(response, "snapshot");
            if (classification !== "ACCEPTED") throw new Error(`Remote Dashboard snapshot ${String(response && response.data && response.data.code || "failed")}.`);
            log("snapshot-accepted", {});
            return { accepted: true, code: response.data.code };
        })().catch(error => { log("snapshot-failed", { classification: String(error.message || "").slice(0, 200) }); return { accepted: false }; }).finally(() => { snapshotInFlight = null; });
        return snapshotInFlight;
    }
    function start() {
        if (timer) return;
        void queueStarted().catch(() => log("failed", { classification: "START_EVENT_QUEUE_FAILED" }));
        void drain();
        void syncSnapshot();
        timer = setInterval(() => { void syncSnapshot(); void drain(); }, 30000);
        timer.unref?.();
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    return { buildSnapshot: () => buildRemoteDashboardSnapshot({ database, now, sessionStartedAt, getStatus: options.getStatus }), queueBillSaved, queueStarted, queueDayClosed, start, stop, drain, syncSnapshot, listOutbox: () => all("SELECT * FROM remote_dashboard_outbox ORDER BY id"), _test: { signedEnvelope, classify, sessionStartedAt, sessionId, stableJson } };
}

module.exports = { createRemoteDashboardService, EVENT_CONTRACT_ID, IDENTITY, EVENT_TIMEOUT_MS, SNAPSHOT_TIMEOUT_MS, stableJson };
