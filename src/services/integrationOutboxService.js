const { formatBusinessDateDisplay } = require("../database/businessDate");
const { buildDayClosingEmailText } = require("./dayClosingEmail");

function createIntegrationOutboxService(options = {}) {
    const RETRY_COOLDOWN_MS = 60000;
    const database = options.database;
    if (!database) throw new Error("Integration outbox database dependency is required.");
    const now = options.now || (() => new Date());
    const sendEmail = options.sendEmail;
    const syncDsr = options.syncDsr;
    const getEmailConfiguration = options.getEmailConfiguration || (async () => ({}));
    const getBackupPath = options.getBackupPath || (async () => null);
    const logActivity = options.logActivity;
    const activityExists = options.activityExists || (async () => false);
    const reportingMode = String(options.reportingMode || "LEGACY").trim().toUpperCase();
    let drainInFlight = null;
    const run = (sql, params = []) => new Promise((resolve, reject) => database.run(sql, params, function (error) { error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes }); }));
    const get = (sql, params = []) => new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    async function recordActivity(type, phase, businessDate) {
        if (typeof logActivity !== "function") return;
        const isEmail = type === "EMAIL_DAY_CLOSING";
        const action = `${isEmail ? "EMAIL" : "DSR"}_SYNC_${phase}`;
        const displayDate = formatBusinessDateDisplay(businessDate);
        const details = `${isEmail ? "Email" : "DSR"} ${phase === "PENDING" ? "queued" : isEmail ? "delivered" : "synced"} for Business Date: ${displayDate}`;
        const event = {
            category: "DAY CLOSING",
            action,
            details,
            user_name: "SYSTEM",
            status: phase === "PENDING" ? "WARNING" : "SUCCESS",
            entity_type: "BUSINESS_DAY",
            reference_no: displayDate
        };
        try {
            if (!(await activityExists(event))) await logActivity(event);
        }
        catch (error) {
            console.error("Integration Activity Log write failed:", error.message);
        }
    }
    async function recordSupersededActivity(item, reason) {
        if (typeof logActivity !== "function") return;
        const displayDate = formatBusinessDateDisplay(item.business_date);
        const event = {
            category: "DAY CLOSING",
            action: "OUTBOX_DELIVERY_SUPERSEDED",
            details: `${item.delivery_type === "EMAIL_DAY_CLOSING" ? "Email" : "DSR"} delivery not sent: ${reason} Business Date: ${displayDate}`,
            user_name: "SYSTEM",
            status: "WARNING",
            entity_type: "BUSINESS_DAY",
            reference_no: displayDate
        };
        try {
            if (!(await activityExists(event))) await logActivity(event);
        }
        catch (error) {
            console.error("Superseded Integration Activity Log write failed:", error.message);
        }
    }
    async function enqueue(snapshotId, businessDate, closeSequence) {
        const created = now().toISOString();
        for (const type of ["EMAIL_DAY_CLOSING", "DSR_DAY_CLOSING"]) {
            const inserted = await run(`INSERT OR IGNORE INTO integration_outbox (business_date, closing_id, close_sequence, delivery_type, created_at) VALUES (?, ?, ?, ?, ?)`, [businessDate, snapshotId, closeSequence, type, created]);
            if (inserted.changes > 0) await recordActivity(type, "PENDING", businessDate);
        }
    }
    async function recoverStaleProcessing() {
        const cutoff = now().getTime() - RETRY_COOLDOWN_MS;
        const processingRows = await all(`
            SELECT id, last_attempt_at
            FROM integration_outbox
            WHERE status = 'PROCESSING' AND last_attempt_at IS NOT NULL
        `);
        for (const row of processingRows) {
            const lastAttemptAt = Date.parse(row.last_attempt_at);
            if (!Number.isFinite(lastAttemptAt) || lastAttemptAt >= cutoff) continue;
            await run(`
                UPDATE integration_outbox
                SET status = 'PENDING', completed_at = NULL
                WHERE id = ? AND status = 'PROCESSING' AND last_attempt_at = ?
            `, [row.id, row.last_attempt_at]);
        }
    }
    function snapshotToEmailSummary(row) { const money = key => row[key] == null ? null : Number(row[key]) / 100; return { businessDate: formatBusinessDateDisplay(row.business_date), totalBills: row.total_bills, qtySold: row.qty_sold, grossSales: money("gross_sales_paise"), totalDiscount: money("total_discount_paise"), netBilling: money("net_billing_paise"), creditNoteCount: row.credit_note_count, qtyReturned: row.qty_returned, returnCnValue: money("return_cn_value_paise"), netSalesAfterReturns: money("net_sales_after_returns_paise"), cash: money("cash_paise"), upi: money("upi_paise"), card: money("card_paise"), storeCreditRedeemed: money("store_credit_redeemed_paise"), giftVoucherRedeemed: money("gift_voucher_redeemed_paise"), actualMoneyCollection: money("actual_money_collection_paise"), storeCreditIssued: money("store_credit_issued_paise"), settlementDifference: money("settlement_difference_paise"), backupStatus: row.backup_status, backupReference: row.backup_reference }; }
    async function getStaleReason(item) {
        const snapshot = await get("SELECT * FROM day_closing_snapshots WHERE id=?", [item.closing_id]);
        if (!snapshot) return "referenced closing snapshot is unavailable.";
        if (snapshot.business_date !== item.business_date || (Object.prototype.hasOwnProperty.call(snapshot, "close_sequence") && Number(snapshot.close_sequence) !== Number(item.close_sequence))) return "outbox closing identity no longer matches the snapshot.";
        if (snapshot.close_status !== "CLOSED") return `closing snapshot is ${String(snapshot.close_status || "invalid").toLowerCase()}.`;
        if (!Object.prototype.hasOwnProperty.call(snapshot, "close_sequence")) return null;
        const latest = await get("SELECT id, close_sequence FROM day_closing_snapshots WHERE business_date=? AND close_status='CLOSED' ORDER BY close_sequence DESC LIMIT 1", [snapshot.business_date]);
        if (!latest || Number(latest.id) !== Number(snapshot.id) || Number(latest.close_sequence) !== Number(snapshot.close_sequence)) return "closing was superseded by a newer CLOSED snapshot.";
        return null;
    }
    async function markStale(item, reason) {
        const message = `Delivery not sent: ${reason}`;
        await run("UPDATE integration_outbox SET status='SUCCESS', completed_at=?, last_error=? WHERE id=? AND status IN ('PENDING','PROCESSING')", [now().toISOString(), message, item.id]);
        await recordSupersededActivity(item, reason);
        return true;
    }
    async function retireLegacyDsrBacklog() {
        if (reportingMode !== "CONSOLIDATED_V2") return { retiredCount: 0 };

        await run("BEGIN IMMEDIATE");
        let retired = [];
        try {
            const openDay = await get(`SELECT business_date, opened_at FROM business_day_state
                WHERE state='OPEN' ORDER BY business_date DESC LIMIT 1`);
            if (!openDay) {
                await run("COMMIT");
                return { retiredCount: 0 };
            }
            const consolidatedTable = await get("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='consolidated_reporting_jobs'");
            const consolidatedGuard = consolidatedTable ? `AND NOT EXISTS (
                SELECT 1 FROM consolidated_reporting_jobs j
                WHERE j.closing_id=o.closing_id AND j.business_date=o.business_date AND j.close_sequence=o.close_sequence
                  AND (j.sheet_status IN ('PENDING','PROCESSING') OR j.email_status IN ('PENDING','PROCESSING'))
            )` : "";
            retired = await all(`SELECT o.id,o.business_date,o.closing_id,o.close_sequence,o.delivery_type
                FROM integration_outbox o
                JOIN day_closing_snapshots s ON s.id=o.closing_id
                WHERE o.delivery_type='DSR_DAY_CLOSING'
                  AND o.status IN ('PENDING','PROCESSING')
                  AND o.business_date < ? AND o.created_at < ?
                  AND s.business_date=o.business_date AND s.close_sequence=o.close_sequence
                  AND s.close_status='CLOSED'
                  ${consolidatedGuard}
                ORDER BY o.id`, [openDay.business_date, openDay.opened_at]);
            const reason = "legacy DSR pipeline retired because CONSOLIDATED_V2 replaced the legacy DSR pipeline.";
            const completedAt = now().toISOString();
            for (const item of retired) {
                await run(`UPDATE integration_outbox
                    SET status='SUCCESS', completed_at=?, last_error=?
                    WHERE id=? AND delivery_type='DSR_DAY_CLOSING' AND status IN ('PENDING','PROCESSING')`,
                [completedAt, `Delivery not sent: ${reason}`, item.id]);
            }
            await run("COMMIT");
            for (const item of retired) await recordSupersededActivity(item, reason);
            return { retiredCount: retired.length };
        } catch (error) {
            try { await run("ROLLBACK"); } catch (_) {}
            throw error;
        }
    }
    async function processOne(item) {
        await run("UPDATE integration_outbox SET status='PROCESSING', attempt_count=attempt_count+1, last_attempt_at=? WHERE id=? AND status='PENDING'", [now().toISOString(), item.id]);
        try {
            const staleReason = await getStaleReason(item);
            if (staleReason) return await markStale(item, staleReason);
            const snapshot = await get("SELECT * FROM day_closing_snapshots WHERE id=? AND close_status='CLOSED'", [item.closing_id]); if (!snapshot) throw new Error("Closing snapshot is unavailable.");
            if (item.delivery_type === "EMAIL_DAY_CLOSING") { const config = await getEmailConfiguration(); if (!config.automaticEmailBackup || !config.recipients?.length) throw new Error("Automatic email delivery is not configured."); await sendEmail({ to: config.recipients, subject: `KAIRA LUXE - Day Closing - ${formatBusinessDateDisplay(snapshot.business_date)}`, text: (options.buildEmailText || buildDayClosingEmailText)(snapshotToEmailSummary(snapshot)), attachments: [{ filename: snapshot.backup_reference, path: await getBackupPath(snapshot.backup_reference) }] }); }
            else { const result = await syncDsr(await options.readDsrPayload(snapshot.id)); if (!result.success) throw new Error(result.error || "DSR delivery failed."); }
            await run("UPDATE integration_outbox SET status='SUCCESS', completed_at=?, last_error=NULL WHERE id=?", [now().toISOString(), item.id]);
            if (item.delivery_type === "EMAIL_DAY_CLOSING") await run("UPDATE day_closing_snapshots SET email_status='SUCCESS', updated_at=? WHERE id=?", [now().toISOString(), item.closing_id]); else await run("UPDATE day_closing_snapshots SET dsr_sync_status='SYNCED', dsr_synced_at=?, dsr_sync_error=NULL, updated_at=? WHERE id=?", [now().toISOString(), now().toISOString(), item.closing_id]);
            await recordActivity(item.delivery_type, "SUCCEEDED", snapshot.business_date);
            return true;
        } catch (error) { await run("UPDATE integration_outbox SET status='PENDING', last_error=? WHERE id=?", [String(error.message || "Delivery failed").replace(/https?:\/\/\S+/gi, "[ENDPOINT]").slice(0, 500), item.id]); return false; }
    }
    async function drain() { if (drainInFlight) return drainInFlight; drainInFlight = (async () => { await recoverStaleProcessing(); const blockedIds = new Set(); while (true) { const excluded = [...blockedIds].map(() => "?").join(","); const item = await get(`SELECT * FROM integration_outbox WHERE status='PENDING' ${excluded ? `AND id NOT IN (${excluded})` : ""} ORDER BY business_date, id LIMIT 1`, [...blockedIds]); if (!item) break; const staleReason = await getStaleReason(item); if (staleReason) { await markStale(item, staleReason); continue; } const currentTime = now().getTime(); const lastAttemptTime = item.last_attempt_at ? Date.parse(item.last_attempt_at) : NaN; if (Number.isFinite(lastAttemptTime) && currentTime - lastAttemptTime < RETRY_COOLDOWN_MS) { blockedIds.add(item.id); continue; } if (!(await processOne(item))) blockedIds.add(item.id); } })().finally(() => { drainInFlight = null; }); return drainInFlight; }
    async function getStatusView() {
        const rows = await all("SELECT business_date, delivery_type, status, last_error FROM integration_outbox ORDER BY business_date, delivery_type, id");
        const byDate = new Map();
        for (const row of rows) {
            if (!byDate.has(row.business_date)) byDate.set(row.business_date, { businessDate: row.business_date, emailStatus: "PENDING", dsrStatus: null });
            const group = byDate.get(row.business_date);
            const status = row.status === "SUCCESS" ? "SUCCESS" : "PENDING";
            if (row.delivery_type === "EMAIL_DAY_CLOSING") group.emailStatus = status;
            else if (row.delivery_type === "DSR_DAY_CLOSING") {
                const retired = status === "SUCCESS" && String(row.last_error || "").startsWith("Delivery not sent: legacy DSR pipeline retired because CONSOLIDATED_V2");
                if (status !== "SUCCESS") {
                    group.dsrStatus = "PENDING";
                    delete group.dsrRetired;
                } else if (group.dsrStatus !== "PENDING") {
                    group.dsrStatus = "SUCCESS";
                    if (retired) group.dsrRetired = true;
                    else delete group.dsrRetired;
                }
            }
        }
        for (const item of byDate.values()) if (!item.dsrStatus) item.dsrStatus = "PENDING";
        const deliveries = [...byDate.values()].filter(item => item.emailStatus !== "SUCCESS" || item.dsrStatus !== "SUCCESS" || item.dsrRetired);
        return { pendingCount: rows.filter(row => row.status !== "SUCCESS").length, deliveries };
    }
    return { enqueue, drain, list: () => all("SELECT * FROM integration_outbox ORDER BY business_date, id"), getStatusView, retireLegacyDsrBacklog };
}
module.exports = { createIntegrationOutboxService };
