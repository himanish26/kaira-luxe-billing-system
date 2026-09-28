const fs = require("fs");
const path = require("path");
const { formatPaise } = require("../shared/consolidatedDsrBuilder");
const { validateFrozenJob } = require("./consolidatedReportingTransport");

const STALE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const RETRY_COOLDOWN_MS = 60 * 1000;
const BUSINESS_TIME_ZONE = "Asia/Kolkata";
const BUSINESS_DATE_MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

function formatBusinessDateForEmail(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) throw new Error("Business date is not a canonical YYYY-MM-DD value.");
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
        throw new Error("Business date is invalid.");
    }
    return `${String(day).padStart(2, "0")} ${BUSINESS_DATE_MONTHS[month - 1]} ${year}`;
}

function formatClosedAtForEmail(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("Closed At is not a valid UTC timestamp.");
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: BUSINESS_TIME_ZONE,
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return `${values.day} ${values.month} ${values.year}, ${values.hour}:${values.minute}:${values.second} ${values.dayPeriod}`;
}

function buildConsolidatedEmailSubject(businessDate, closeSequence, revised = false) {
    return `KAIRA LUXE - Daily DSR${revised ? " - Revised" : ""} - ${formatBusinessDateForEmail(businessDate)} - Close ${closeSequence}`;
}

function createConsolidatedReportingEmailWorker(options = {}) {
    const database = options.database;
    if (!database) throw new Error("Consolidated email worker database dependency is required.");
    const now = options.now || (() => new Date());
    const sendEmail = options.sendEmail;
    const getEmailConfiguration = options.getEmailConfiguration || (async () => ({}));
    const getBackupPath = options.getBackupPath;
    const validateBackup = options.validateBackup;
    const logActivity = options.logActivity || (async () => {});
    const onOutcome = typeof options.onOutcome === "function" ? options.onOutcome : () => {};
    const technicalLogger = options.technicalLogger || { warn: () => {}, error: () => {} };
    if (typeof sendEmail !== "function") throw new Error("Consolidated email worker sendEmail dependency is required.");
    if (typeof getBackupPath !== "function") throw new Error("Consolidated email worker backup path dependency is required.");
    if (typeof validateBackup !== "function") throw new Error("Consolidated email worker backup validation dependency is required.");

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

    function safeMessage(code, message) {
        return `${code}: ${String(message || "Consolidated email delivery failed.")}`
            .replace(/https?:\/\/\S+/gi, "[ENDPOINT]")
            .slice(0, 500);
    }

    function terminal(code, message) {
        return { code, message: safeMessage(code, message), retryable: false, delivered: false };
    }

    function retryable(code, message) {
        return { code, message: safeMessage(code, message), retryable: true, delivered: false };
    }

    function classifyFailure(error) {
        const code = String(error && error.code || "").toUpperCase();
        const message = String(error && error.message || "Consolidated email delivery failed.");
        if (code === "EAUTH" || code === "EENVELOPE" || code === "INVALID_RECIPIENT" || code === "MISSING_CONFIGURATION") {
            return terminal(code || "EMAIL_CONFIGURATION", message);
        }
        if (/recipient|smtp configuration|automatic email|backup|attachment|payload|snapshot|closing|not found|not configured|invalid/i.test(message)) {
            return terminal("EMAIL_DATA_OR_CONFIGURATION", message);
        }
        return retryable("RETRYABLE_EMAIL_FAILURE", message);
    }

    async function recordTechnical(level, message, metadata = {}) {
        try {
            if (typeof technicalLogger[level] === "function") technicalLogger[level]("CONSOLIDATED_EMAIL", message, metadata);
        }
        catch (_) {}
    }

    async function recordActivity(snapshot, action, status, details) {
        try {
            await logActivity({
                category: "DAY CLOSING",
                action,
                details: String(details || "").slice(0, 2000),
                user_name: "SYSTEM",
                status,
                entity_type: "BUSINESS_DAY",
                reference_no: snapshot && snapshot.business_date
            });
        }
        catch (error) {
            await recordTechnical("warn", "Consolidated email Activity Log write failed", { classification: String(error.message || "").slice(0, 200) });
        }
    }

    function isSafeBackupReference(reference) {
        const value = String(reference || "").trim();
        return Boolean(value) && value === path.basename(value) && value === path.win32.basename(value) && value !== "." && value !== "..";
    }

    async function resolveAttachment(snapshot) {
        if (!snapshot || snapshot.close_status !== "CLOSED") throw new Error("The closing snapshot is not CLOSED.");
        if (snapshot.backup_status !== "SUCCESS") throw new Error("The closing backup is not verified SUCCESS.");
        if (!isSafeBackupReference(snapshot.backup_reference)) throw new Error("The closing backup reference is invalid.");
        const attachmentPath = await getBackupPath(snapshot.backup_reference);
        const stat = await fs.promises.stat(attachmentPath).catch(() => null);
        if (!stat || !stat.isFile() || stat.size <= 0) throw new Error("The exact closing backup attachment is missing or empty.");
        const verification = await validateBackup(attachmentPath);
        if (!verification || verification.success !== true) throw new Error(verification && verification.message || "The exact closing backup failed validation.");
        return { filename: snapshot.backup_reference, path: attachmentPath };
    }

    function money(value) {
        return formatPaise(value == null ? "0" : value);
    }

    function display(value) {
        return value == null ? "-" : String(value);
    }

    function buildEmailText(payload, revised = false) {
        const overall = payload.overall || {};
        const lines = [
            "KAIRA LUXE - DAILY DSR",
            revised ? "REVISED CLOSE SEQUENCE" : "",
            "",
            `Business Date: ${formatBusinessDateForEmail(payload.businessDate)}`,
            `Closing ID: ${payload.closingId}`,
            `Closing Sequence: ${payload.closeSequence}`,
            `Closed At: ${formatClosedAtForEmail(payload.closedAt)}`,
            `KLBS Version: ${payload.klbsVersion || "-"}`,
            "",
            "OVERALL",
            `Bills: ${display(overall.totalBills)}`,
            `Qty: ${display(overall.qtySold)}`,
            `Gross Sales: ${money(overall.grossSalesPaise)}`,
            `Discount: ${money(overall.totalDiscountPaise)}`,
            `Net Billing: ${money(overall.netBillingPaise)}`,
            `Credit Notes: ${display(overall.creditNoteCount)}`,
            `Qty Returned: ${display(overall.qtyReturned)}`,
            `Return Value: ${money(overall.returnCnValuePaise)}`,
            `Net Sales After Returns: ${money(overall.netSalesAfterReturnsPaise)}`,
            `Cash: ${money(overall.cashPaise)}`,
            `UPI: ${money(overall.upiPaise)}`,
            `Card: ${money(overall.cardPaise)}`,
            `Store Credit Redeemed: ${money(overall.storeCreditRedeemedPaise)}`,
            `Gift Voucher Redeemed: ${money(overall.giftVoucherRedeemedPaise)}`,
            `Total Settlement: ${money(overall.settlementTotalPaise)}`,
            `Actual Money Collection: ${money(overall.actualMoneyCollectionPaise)}`,
            `Store Credit Issued: ${money(overall.storeCreditIssuedPaise)}`,
            `Settlement Difference: ${money(overall.settlementDifferencePaise)}`,
            `Store Credit Ledger Redeemed: ${money(overall.storeCreditLedgerRedeemedPaise)}`,
            `Store Credit Ledger Difference: ${money(overall.storeCreditLedgerDifferencePaise)}`,
            ""
        ];
        for (const code of ["KL", "MENS", "KIDS"]) {
            const segment = payload.segments && payload.segments[code] || {};
            lines.push(
                code,
                `Net Sales / Net Contribution: ${money(segment.netContributionPaise)}`,
                `Qty: ${display(segment.qtySold)}`,
                `Bills: ${display(segment.bills)}`,
                `Cash: ${money(segment.cashPaise)}`,
                `UPI: ${money(segment.upiPaise)}`,
                `Card: ${money(segment.cardPaise)}`,
                `Store Credit Redeemed: ${money(segment.storeCreditRedeemedPaise)}`,
                `Gift Voucher Redeemed: ${money(segment.giftVoucherRedeemedPaise)}`,
                ""
            );
        }
        const reconciliation = payload.paymentReconciliation || {};
        lines.push("STATUS / RECONCILIATION", `Report Status: ${payload.reportStatus}`, `Data Quality Status: ${payload.dataQuality && payload.dataQuality.status || "-"}`);
        for (const mode of ["cash", "upi", "card", "storeCreditRedeemed", "giftVoucherRedeemed"]) {
            lines.push(`Reconciliation ${mode}: ${reconciliation[mode] && reconciliation[mode].status || "-"}`);
        }
        lines.push(`Backup Status: ${overall.backupStatus || "-"}`);
        return lines.join("\n");
    }

    async function latestSnapshotFor(snapshot) {
        return get(`SELECT id, close_sequence FROM day_closing_snapshots WHERE business_date = ? AND close_status = 'CLOSED' ORDER BY close_sequence DESC LIMIT 1`, [snapshot.business_date]);
    }

    async function markSuperseded(job, snapshot, reason = "A newer CLOSED sequence is authoritative.") {
        const message = safeMessage("STALE_SUPERSEDED", reason);
        const result = await run(`
            UPDATE consolidated_reporting_jobs
            SET email_status = 'FAILED', email_processing_started_at = NULL,
                email_last_error = ?
            WHERE id = ? AND email_status IN ('PENDING', 'PROCESSING')
        `, [message, job.id]);
        if (result.changes) {
            await recordTechnical("warn", "Consolidated email superseded", { closingId: job.closing_id, closeSequence: job.close_sequence });
        }
        return result.changes === 1;
    }

    async function recoverStaleProcessing() {
        const cutoff = now().getTime() - STALE_PROCESSING_TIMEOUT_MS;
        const rows = await all("SELECT id, email_processing_started_at FROM consolidated_reporting_jobs WHERE email_status='PROCESSING'");
        let recovered = 0;
        for (const row of rows) {
            if (!row.email_processing_started_at || Date.parse(row.email_processing_started_at) > cutoff) continue;
            const result = await run(`UPDATE consolidated_reporting_jobs SET email_status='PENDING', email_processing_started_at=NULL, email_last_error=? WHERE id=? AND email_status='PROCESSING'`, [safeMessage("RETRYABLE_EMAIL_FAILURE", "Recovered stale email processing claim."), row.id]);
            recovered += result.changes;
        }
        return recovered;
    }

    async function claimNext(jobId = null) {
        let transactionStarted = false;
        try {
            await run("BEGIN IMMEDIATE TRANSACTION");
            transactionStarted = true;
            const rows = await all(`SELECT * FROM consolidated_reporting_jobs WHERE email_status='PENDING' ${jobId === null ? "" : "AND id=?"} ORDER BY business_date, close_sequence, id`, jobId === null ? [] : [jobId]);
            for (const row of rows) {
                if (row.email_last_attempt_at && now().getTime() - Date.parse(row.email_last_attempt_at) < RETRY_COOLDOWN_MS) continue;
                const snapshot = await get("SELECT * FROM day_closing_snapshots WHERE id = ?", [row.closing_id]);
                const latest = snapshot && await latestSnapshotFor(snapshot);
                if (!snapshot || !latest || Number(latest.id) !== Number(snapshot.id) || Number(latest.close_sequence) !== Number(snapshot.close_sequence)) {
                    await markSuperseded(row, snapshot || { business_date: row.business_date, close_sequence: row.close_sequence });
                    continue;
                }
                const started = now().toISOString();
                const claimed = await run(`UPDATE consolidated_reporting_jobs SET email_status='PROCESSING', email_attempt_count=email_attempt_count+1, email_last_attempt_at=?, email_processing_started_at=? WHERE id=? AND email_status='PENDING'`, [started, started, row.id]);
                if (claimed.changes !== 1) continue;
                await run("COMMIT");
                transactionStarted = false;
                return { ...row, snapshot, email_status: "PROCESSING", email_processing_started_at: started, email_last_attempt_at: started, email_attempt_count: Number(row.email_attempt_count || 0) + 1 };
            }
            await run("COMMIT");
            transactionStarted = false;
            return null;
        }
        catch (error) {
            if (transactionStarted) await run("ROLLBACK").catch(() => {});
            throw error;
        }
    }

    async function persistOutcome(claimed, outcome) {
        const status = outcome.delivered ? "DELIVERED" : outcome.retryable ? "PENDING" : "FAILED";
        const completedAt = outcome.delivered ? now().toISOString() : null;
        const result = await run(`UPDATE consolidated_reporting_jobs SET email_status=?, email_delivered_at=CASE WHEN ?='DELIVERED' THEN ? ELSE email_delivered_at END, email_last_error=?, email_processing_started_at=NULL WHERE id=? AND email_status='PROCESSING' AND email_processing_started_at=?`, [status, status, completedAt, outcome.delivered ? null : outcome.message, claimed.id, claimed.email_processing_started_at]);
        if (result.changes !== 1) return terminal("INVALID_RESPONSE", "Consolidated email outcome could not be persisted because the claim changed.");
        if (outcome.delivered) {
            await run("UPDATE day_closing_snapshots SET email_status='SUCCESS', updated_at=? WHERE id=? AND close_status='CLOSED'", [now().toISOString(), claimed.closing_id]);
            await recordActivity(claimed.snapshot, "DSR_SYNC_SUCCEEDED", "SUCCESS", `Consolidated Daily DSR email delivered; Close sequence: ${claimed.close_sequence}.`);
        }
        else if (!outcome.retryable) await recordActivity(claimed.snapshot, "DSR_SYNC_FAILED", "FAILED", `Consolidated Daily DSR email failed; Close sequence: ${claimed.close_sequence}. ${outcome.message}`);
        try { onOutcome({ jobId: claimed.id, status }); } catch (_) {}
        return { ...outcome, status, jobId: claimed.id, attemptCount: claimed.email_attempt_count, deliveredAt: completedAt };
    }

    async function processClaimed(claimed) {
        try {
            const validated = validateFrozenJob(claimed);
            const configuration = await getEmailConfiguration();
            if (!configuration || configuration.automaticEmailBackup !== true || !Array.isArray(configuration.recipients) || !configuration.recipients.length) {
                return persistOutcome(claimed, terminal("MISSING_CONFIGURATION", "Automatic consolidated email recipients are not configured."));
            }
            await recordTechnical("info", "Consolidated email claimed", { closingId: claimed.closing_id, closeSequence: claimed.close_sequence });
            const latest = await latestSnapshotFor(claimed.snapshot);
            if (!latest || Number(latest.id) !== Number(claimed.snapshot.id) || Number(latest.close_sequence) !== Number(claimed.snapshot.close_sequence)) {
                await markSuperseded(claimed, claimed.snapshot, "A newer CLOSED sequence became authoritative before email send.");
                return { code: "STALE_SUPERSEDED", retryable: false, delivered: false, status: "FAILED", jobId: claimed.id };
            }
            const attachment = await resolveAttachment(claimed.snapshot);
            await sendEmail({
                to: configuration.recipients,
                subject: buildConsolidatedEmailSubject(validated.payload.businessDate, validated.payload.closeSequence, Number(claimed.close_sequence) > 1),
                text: buildEmailText(validated.payload, Number(claimed.close_sequence) > 1),
                attachments: [attachment],
                messageId: `<klbs-dsr-${validated.payload.businessDate}-${validated.payload.closeSequence}-${claimed.payload_hash}@kaira-luxe>`
            });
            return persistOutcome(claimed, { code: "DELIVERED", message: "Consolidated Daily DSR email delivered.", retryable: false, delivered: true });
        }
        catch (error) {
            return persistOutcome(claimed, classifyFailure(error));
        }
    }

    async function processNext() {
        await recoverStaleProcessing();
        const claimed = await claimNext();
        if (!claimed) return { processed: false, jobId: null };
        return processClaimed(claimed);
    }

    async function processForJob(jobId) {
        if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new Error("Consolidated email job identifier is invalid.");
        await recoverStaleProcessing();
        const claimed = await claimNext(jobId);
        if (!claimed) return { processed: false, jobId };
        return processClaimed(claimed);
    }

    async function retryForClosing(closingId) {
        const result = await run(`UPDATE consolidated_reporting_jobs SET email_status='PENDING', email_processing_started_at=NULL, email_last_error=NULL WHERE closing_id=? AND email_status='FAILED' AND email_delivered_at IS NULL AND email_last_error NOT LIKE 'STALE_SUPERSEDED:%'`, [closingId]);
        return { requeued: result.changes === 1, closingId, code: result.changes === 1 ? null : "EMAIL_JOB_NOT_REQUEUEABLE" };
    }

    return { recoverStaleProcessing, claimNext, processClaimed, processNext, processForJob, retryForClosing, buildEmailText, resolveAttachment };
}

module.exports = {
    createConsolidatedReportingEmailWorker,
    STALE_PROCESSING_TIMEOUT_MS,
    RETRY_COOLDOWN_MS,
    BUSINESS_TIME_ZONE,
    formatBusinessDateForEmail,
    formatClosedAtForEmail,
    buildConsolidatedEmailSubject
};
