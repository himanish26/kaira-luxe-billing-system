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
    let drainInFlight = null;
    let lastDate = null;
    let lastDateCompletedAt = 0;
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
    async function enqueue(snapshotId, businessDate, closeSequence) {
        const created = now().toISOString();
        for (const type of ["EMAIL_DAY_CLOSING", "DSR_DAY_CLOSING"]) {
            const inserted = await run(`INSERT OR IGNORE INTO integration_outbox (business_date, closing_id, close_sequence, delivery_type, created_at) VALUES (?, ?, ?, ?, ?)`, [businessDate, snapshotId, closeSequence, type, created]);
            if (inserted.changes > 0) await recordActivity(type, "PENDING", businessDate);
        }
    }
    function snapshotToEmailSummary(row) { const money = key => row[key] == null ? null : Number(row[key]) / 100; return { businessDate: formatBusinessDateDisplay(row.business_date), totalBills: row.total_bills, qtySold: row.qty_sold, grossSales: money("gross_sales_paise"), totalDiscount: money("total_discount_paise"), netBilling: money("net_billing_paise"), creditNoteCount: row.credit_note_count, qtyReturned: row.qty_returned, returnCnValue: money("return_cn_value_paise"), netSalesAfterReturns: money("net_sales_after_returns_paise"), cash: money("cash_paise"), upi: money("upi_paise"), card: money("card_paise"), storeCreditRedeemed: money("store_credit_redeemed_paise"), giftVoucherRedeemed: money("gift_voucher_redeemed_paise"), actualMoneyCollection: money("actual_money_collection_paise"), storeCreditIssued: money("store_credit_issued_paise"), settlementDifference: money("settlement_difference_paise"), backupStatus: row.backup_status, backupReference: row.backup_reference }; }
    async function processOne(item) {
        await run("UPDATE integration_outbox SET status='PROCESSING', attempt_count=attempt_count+1, last_attempt_at=? WHERE id=? AND status='PENDING'", [now().toISOString(), item.id]);
        try {
            const snapshot = await get("SELECT * FROM day_closing_snapshots WHERE id=? AND close_status='CLOSED'", [item.closing_id]); if (!snapshot) throw new Error("Closing snapshot is unavailable.");
            if (item.delivery_type === "EMAIL_DAY_CLOSING") { const config = await getEmailConfiguration(); if (!config.automaticEmailBackup || !config.recipients?.length) throw new Error("Automatic email delivery is not configured."); await sendEmail({ to: config.recipients, subject: `KAIRA LUXE - Day Closing - ${formatBusinessDateDisplay(snapshot.business_date)}`, text: (options.buildEmailText || buildDayClosingEmailText)(snapshotToEmailSummary(snapshot)), attachments: [{ filename: snapshot.backup_reference, path: await getBackupPath(snapshot.backup_reference) }] }); }
            else { const result = await syncDsr(await options.readDsrPayload(snapshot.id)); if (!result.success) throw new Error(result.error || "DSR delivery failed."); }
            await run("UPDATE integration_outbox SET status='SUCCESS', completed_at=?, last_error=NULL WHERE id=?", [now().toISOString(), item.id]);
            if (item.delivery_type === "EMAIL_DAY_CLOSING") await run("UPDATE day_closing_snapshots SET email_status='SUCCESS', updated_at=? WHERE id=?", [now().toISOString(), item.closing_id]); else await run("UPDATE day_closing_snapshots SET dsr_sync_status='SYNCED', dsr_synced_at=?, dsr_sync_error=NULL, updated_at=? WHERE id=?", [now().toISOString(), now().toISOString(), item.closing_id]);
            await recordActivity(item.delivery_type, "SUCCEEDED", snapshot.business_date);
            return true;
        } catch (error) { await run("UPDATE integration_outbox SET status='PENDING', last_error=? WHERE id=?", [String(error.message || "Delivery failed").replace(/https?:\/\/\S+/gi, "[ENDPOINT]").slice(0, 500), item.id]); return false; }
    }
    async function drain() { if (drainInFlight) return drainInFlight; drainInFlight = (async () => { const blockedIds = new Set(); const blockedBusinessDates = new Set(); while (true) { const excluded = [...blockedIds].map(() => "?").join(","); const item = await get(`SELECT * FROM integration_outbox WHERE status='PENDING' ${excluded ? `AND id NOT IN (${excluded})` : ""} ORDER BY business_date, id LIMIT 1`, [...blockedIds]); if (!item) break; if ([...blockedBusinessDates].some(businessDate => businessDate !== item.business_date)) break; const currentTime = now().getTime(); const lastAttemptTime = item.last_attempt_at ? Date.parse(item.last_attempt_at) : NaN; if (Number.isFinite(lastAttemptTime) && currentTime - lastAttemptTime < RETRY_COOLDOWN_MS) { blockedIds.add(item.id); blockedBusinessDates.add(item.business_date); continue; } if (lastDate && item.business_date !== lastDate && currentTime - lastDateCompletedAt < RETRY_COOLDOWN_MS) break; if (!(await processOne(item))) { blockedIds.add(item.id); blockedBusinessDates.add(item.business_date); } const next = await get("SELECT business_date FROM integration_outbox WHERE status='PENDING' ORDER BY business_date, id LIMIT 1"); if (next && next.business_date !== item.business_date) { lastDate = item.business_date; lastDateCompletedAt = now().getTime(); } else if (!next) break; } })().finally(() => { drainInFlight = null; }); return drainInFlight; }
    async function getStatusView() { const rows = await all("SELECT business_date, delivery_type, status FROM integration_outbox ORDER BY business_date, delivery_type"); const byDate = new Map(); for (const row of rows) { if (!byDate.has(row.business_date)) byDate.set(row.business_date, { businessDate: row.business_date, emailStatus: "PENDING", dsrStatus: "PENDING" }); const group = byDate.get(row.business_date); const status = row.status === "SUCCESS" ? "SUCCESS" : "PENDING"; if (row.delivery_type === "EMAIL_DAY_CLOSING") group.emailStatus = status; else if (row.delivery_type === "DSR_DAY_CLOSING") group.dsrStatus = status; } const deliveries = [...byDate.values()].filter(item => item.emailStatus !== "SUCCESS" || item.dsrStatus !== "SUCCESS"); return { pendingCount: rows.filter(row => row.status !== "SUCCESS").length, deliveries }; }
    return { enqueue, drain, list: () => all("SELECT * FROM integration_outbox ORDER BY business_date, id"), getStatusView };
}
module.exports = { createIntegrationOutboxService };
