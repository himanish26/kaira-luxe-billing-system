const crypto = require("crypto");
const axios = require("axios");

const CONTRACT = "KLBS_CUSTOMER_CRM_V1";
const REDIRECT_HOST = "script.googleusercontent.com";
function createCustomerCrmSyncService({ database, configProvider, now = () => new Date(), httpClient = axios } = {}) {
    let running = false, stopped = false, timer = null;
    const query = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows || [])));
    const get = (sql, params = []) => new Promise((resolve, reject) => database.get(sql, params, (e, row) => e ? reject(e) : resolve(row || null)));
    const run = (sql, params = []) => new Promise((resolve, reject) => database.run(sql, params, function(e) { e ? reject(e) : resolve(this); }));
    const sign = (timestamp, action, payload, secret) => crypto.createHmac("sha256", secret).update(`${timestamp}\n${action}\n${JSON.stringify(payload || {})}`, "utf8").digest("hex");
    function protocolError(code, retryable = false) {
        const error = new Error(code);
        error.crmErrorCode = code;
        error.crmRetryable = retryable;
        return error;
    }
    function validateAck(data, action, expected = {}) {
        if (!data || typeof data !== "object" || Array.isArray(data) || data.contract !== CONTRACT || data.action !== action) {
            throw protocolError("INVALID_RESPONSE");
        }
        if (data.result === "RETRYABLE_FAILURE") {
            const code = /^[A-Z0-9_]{1,60}$/.test(String(data.errorCode || "")) ? data.errorCode : "RECEIVER_RETRYABLE_FAILURE";
            throw protocolError(code, true);
        }
        if (data.result === "PERMANENT_REJECTION") {
            const code = /^[A-Z0-9_]{1,60}$/.test(String(data.errorCode || "")) ? data.errorCode : "RECEIVER_PERMANENT_REJECTION";
            throw protocolError(code, false);
        }
        if (data.result !== "SUCCESS") throw protocolError("INVALID_RESPONSE");
        for (const key of Object.keys(expected)) if (data[key] !== expected[key]) throw protocolError("INVALID_RESPONSE");
        return true;
    }
    function crmPost(endpoint, envelope) {
        return httpClient.post(endpoint, envelope, {
            timeout: 30000,
            maxRedirects: 1,
            beforeRedirect(options) {
                const hostname = String(options.hostname || options.host || "").toLowerCase();
                if (options.protocol !== "https:" || hostname !== REDIRECT_HOST) {
                    throw protocolError("REDIRECT_REJECTED");
                }
            },
            headers: { "Content-Type": "application/json" },
            responseType: "json",
            validateStatus: status => status >= 200 && status < 300
        });
    }
    function transportError(error) {
        if (error && error.crmErrorCode) return error;
        if (error && error.response) {
            const status = Number(error.response.status);
            return protocolError(status >= 500 ? "HTTP_5XX" : status >= 400 ? "HTTP_4XX" : "HTTP_ERROR", status >= 500);
        }
        if (error && error.code === "ECONNABORTED") return protocolError("TIMEOUT", true);
        return protocolError("TRANSPORT_ERROR", true);
    }
    async function deliver(row, config) {
        const customer = await get(`SELECT customer_code,name,mobile,email,birthday_ddmm,marriage_anniversary_ddmm,created_at,updated_at FROM customers WHERE customer_code=? AND active=1`, [row.customer_id]);
        if (!customer) { await run("UPDATE customer_crm_outbox SET status='FAILED',last_error='CUSTOMER_UNAVAILABLE',updated_at=? WHERE store_code=? AND customer_id=? AND revision=?", [now().toISOString(), row.store_code, row.customer_id, row.revision]); return false; }
        const payload = { contract: CONTRACT, storeCode: row.store_code, customerId: customer.customer_code, customerName: customer.name,
            mobile: customer.mobile || null, email: customer.email || null, birthdayDDMM: customer.birthday_ddmm || null,
            anniversaryDDMM: customer.marriage_anniversary_ddmm || null, customerCreatedAt: customer.created_at,
            customerUpdatedAt: customer.updated_at, customerRevision: row.revision, spreadsheetId: config.spreadsheetId, worksheet: "Customer_Master" };
        const timestamp = now().toISOString(), action = "CUSTOMER_UPSERT";
        const response = await crmPost(config.endpoint, { contract: CONTRACT, timestamp, action, payload, signature: sign(timestamp, action, payload, config.secret) });
        validateAck(response.data, action, { storeCode: row.store_code, customerId: customer.customer_code, customerRevision: row.revision });
        await run(`UPDATE customer_crm_outbox SET status='SYNCED',synced_at=?,last_error=NULL,updated_at=? WHERE store_code=? AND customer_id=? AND revision=?`, [now().toISOString(), now().toISOString(), row.store_code, row.customer_id, row.revision]);
        return true;
    }
    async function syncNow() {
        if (running) return { success: true, alreadyRunning: true };
        const config = await configProvider();
        if (!config || !config.endpoint || !config.secret) return { success: false, error: "NOT_CONFIGURED" };
        if (!config.enabled || config.destinationPendingApproval || config.lastTestResult !== "SUCCESS") return { success: false, error: "CONNECTION_TEST_REQUIRED" };
        running = true; let successCount = 0, failures = 0;
        const errorCodes = [];
        try {
            const rows = await query(`SELECT * FROM customer_crm_outbox WHERE status='PENDING' AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY updated_at LIMIT 50`, [now().toISOString()]);
            for (const row of rows) {
                if (stopped) break;
                try { if (await deliver(row, config)) successCount++; }
                catch (error) {
                    failures++;
                    const failure = transportError(error);
                    errorCodes.push(failure.crmErrorCode);
                    const attempts = Number(row.attempt_count || 0) + 1;
                    const delay = failure.crmRetryable ? Math.min(86400000, 30000 * (2 ** Math.min(attempts - 1, 10))) : null;
                    await run(`UPDATE customer_crm_outbox SET status=?,attempt_count=?,next_retry_at=?,last_error=?,updated_at=? WHERE store_code=? AND customer_id=? AND revision=?`, [failure.crmRetryable ? "PENDING" : "FAILED", attempts, delay === null ? null : new Date(now().getTime() + delay).toISOString(), failure.crmErrorCode, now().toISOString(), row.store_code, row.customer_id, row.revision]);
                }
            }
            const pending = await get("SELECT COUNT(*) AS count FROM customer_crm_outbox WHERE status='PENDING'");
            return { success: failures === 0, successCount, failures, errorCodes: [...new Set(errorCodes)], pendingCount: Number(pending && pending.count || 0) };
        } finally { running = false; }
    }
    async function testConnection() {
        const config = await configProvider();
        if (!config || !config.endpoint || !config.secret) return { success: false, error: "NOT_CONFIGURED" };
        try {
            const timestamp = now().toISOString(), payload = { contract: CONTRACT, spreadsheetId: config.spreadsheetId, worksheet: config.worksheet };
            const response = await crmPost(config.endpoint, { contract: CONTRACT, timestamp, action: "TEST_CONNECTION", payload, signature: sign(timestamp, "TEST_CONNECTION", payload, config.secret) });
            validateAck(response.data, "TEST_CONNECTION", { spreadsheetId: config.spreadsheetId, worksheet: config.worksheet });
            return { success: true };
        } catch (_) { return { success: false, error: "CONNECTION_FAILED" }; }
    }
    async function syncExisting() {
        const inserted = await run(`INSERT INTO customer_crm_outbox(store_code,customer_id,revision,status,attempt_count,created_at,updated_at)
            SELECT s.store_code,c.customer_code,1,'PENDING',0,?,? FROM customers c JOIN store_context x ON x.id=1 JOIN stores s ON s.id=x.current_store_id WHERE c.active=1 AND c.customer_code IS NOT NULL
            ON CONFLICT(store_code,customer_id) DO UPDATE SET revision=customer_crm_outbox.revision+1,status='PENDING',attempt_count=0,next_retry_at=NULL,last_error=NULL,updated_at=excluded.updated_at`, [now().toISOString(), now().toISOString()]);
        return { queued: inserted.changes || 0, ...(await syncNow()) };
    }
    function start() { if (timer) return; stopped = false; syncNow().catch(() => {}); timer = setInterval(() => syncNow().catch(() => {}), 30000); }
    function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }
    async function getStatus() {
        const row = await get(`SELECT COUNT(*) AS pending_count,MAX(synced_at) AS last_success_at FROM customer_crm_outbox WHERE status='PENDING' OR status='SYNCED'`);
        const pending = await get("SELECT COUNT(*) AS count FROM customer_crm_outbox WHERE status='PENDING'");
        const last = await get("SELECT MAX(synced_at) AS last_success_at FROM customer_crm_outbox WHERE status='SYNCED'");
        return { pendingCount: Number(pending && pending.count || 0), lastSuccessAt: last && last.last_success_at || null, running };
    }
    return { syncNow, testConnection, syncExisting, start, stop, getStatus };
}
module.exports = { CONTRACT, createCustomerCrmSyncService };
