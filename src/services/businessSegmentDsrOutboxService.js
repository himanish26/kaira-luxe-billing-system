const { createBusinessSegmentReportService } = require("../database/businessSegmentReportService");
const { buildBusinessSegmentDsrEmailText } = require("./businessSegmentDsrEmailService");

const CONTRACT = "KLBS_SEGMENT_DSR_V1";
const RETRY_COOLDOWN_MS = 60000;

function createBusinessSegmentDsrOutboxService(options = {}) {
    const database = options.database;
    if (!database) throw new Error("Segment DSR outbox database dependency is required.");
    const now = options.now || (() => new Date());
    const calculateReport = options.calculateReport || createBusinessSegmentReportService({ database }).calculateBusinessSegmentReport;
    const sendEmail = options.sendEmail;
    const getEmailConfiguration = options.getEmailConfiguration || (async () => ({}));
    const klbsVersion = String(options.klbsVersion || "").trim();
    const run = (sql, params = []) => new Promise((resolve, reject) => database.run(sql, params, function (error) { error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes }); }));
    const get = (sql, params = []) => new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));

    function buildPayload(report, snapshot, revised) {
        const segment = source => ({
            label: source.label,
            sales: source.netSalesAfterReturns,
            qty: source.netQty,
            bills: source.bills,
            atv: source.atv,
            upt: source.upt,
            detail: {
                grossSales: source.grossSales,
                discountAmount: source.discountAmount,
                taxableValue: source.taxableValue,
                gstAmount: source.gstAmount,
                netBilling: source.netBilling,
                qtySold: source.qtySold,
                creditNotes: source.creditNotes,
                returnValue: source.returnValue,
                qtyReturned: source.qtyReturned
            }
        });
        return {
            contract: CONTRACT,
            businessDate: snapshot.business_date,
            closeSequence: Number(snapshot.close_sequence),
            reportStatus: revised ? "REVISED" : "FINAL",
            segments: {
                KL: segment(report.kairaLuxe),
                MENS: segment(report.mensWear),
                KIDS: segment(report.kidsWear)
            },
            dataQuality: {
                complete: Boolean(report.dataQuality.complete),
                reconciliationClassified: Boolean(report.reconciliation.classified),
                diagnostics: report.dataQuality.complete ? null : report.dataQuality.unclassified
            },
            reconciliation: report.reconciliation,
            klbsVersion,
            generatedAt: now().toISOString()
        };
    }

    async function isRevised(snapshot) {
        const row = await get(`SELECT COUNT(*) AS count FROM day_closing_snapshots WHERE business_date = ? AND close_sequence < ? AND close_status IN ('CLOSED', 'REOPENED')`, [snapshot.business_date, snapshot.close_sequence]);
        return Number(row?.count || 0) > 0;
    }

    async function enqueue(closingId) {
        const snapshot = await get("SELECT id, business_date, close_sequence, close_status FROM day_closing_snapshots WHERE id=?", [closingId]);
        if (!snapshot || snapshot.close_status !== "CLOSED") throw new Error("Segment DSR requires a CLOSED Day Closing snapshot.");
        const existing = await get("SELECT id FROM segment_dsr_outbox WHERE closing_id=?", [closingId]);
        if (existing) return { created: false, id: existing.id };
        const revised = await isRevised(snapshot);
        let payload = null;
        let status = "PENDING";
        let lastError = null;
        try {
            const report = await calculateReport(snapshot.business_date);
            payload = buildPayload(report, snapshot, revised);
            if (!payload.dataQuality.complete || !payload.dataQuality.reconciliationClassified) {
                status = "FAILED";
                lastError = "Segment report classification/reconciliation is incomplete; delivery requires attention.";
            }
        }
        catch (error) {
            lastError = String(error.message || "Segment report calculation failed").slice(0, 500);
        }
        const timestamp = now().toISOString();
        const inserted = await run(`INSERT OR IGNORE INTO segment_dsr_outbox (business_date, closing_id, close_sequence, report_status, payload_json, status, created_at, updated_at, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [snapshot.business_date, closingId, snapshot.close_sequence, revised ? "REVISED" : "FINAL", payload && JSON.stringify(payload), status, timestamp, timestamp, lastError]);
        return { created: inserted.changes > 0, id: inserted.lastID || (await get("SELECT id FROM segment_dsr_outbox WHERE closing_id=?", [closingId])).id, status };
    }

    async function recoverStaleProcessing() {
        const cutoff = now().getTime() - RETRY_COOLDOWN_MS;
        const rows = await all("SELECT id, processing_started_at FROM segment_dsr_outbox WHERE status='PROCESSING'");
        for (const row of rows) {
            if (Number.isFinite(Date.parse(row.processing_started_at)) && Date.parse(row.processing_started_at) >= cutoff) continue;
            await run("UPDATE segment_dsr_outbox SET status='PENDING', processing_started_at=NULL, updated_at=?, last_error=? WHERE id=? AND status='PROCESSING'", [now().toISOString(), "Application restarted during Segment DSR delivery.", row.id]);
        }
    }

    async function processOne(item) {
        const started = now().toISOString();
        const claimed = await run("UPDATE segment_dsr_outbox SET status='PROCESSING', attempt_count=attempt_count+1, last_attempt_at=?, processing_started_at=?, updated_at=? WHERE id=? AND status='PENDING'", [started, started, started, item.id]);
        if (claimed.changes !== 1) return false;
        try {
            if (!item.payload_json) throw new Error(item.last_error || "Segment DSR payload is unavailable.");
            const payload = JSON.parse(item.payload_json);
            if (!payload.dataQuality.complete || !payload.dataQuality.reconciliationClassified) throw new Error("Segment DSR data quality is incomplete; delivery remains blocked.");
            const configuration = await getEmailConfiguration();
            if (!configuration.automaticEmailBackup || !configuration.recipients?.length) throw new Error("Segment DSR email delivery is not configured.");
            await sendEmail({ to: configuration.recipients, subject: `KAIRA LUXE - Segment DSR - ${payload.businessDate} - Close ${payload.closeSequence}`, text: buildBusinessSegmentDsrEmailText(payload) });
            await run("UPDATE segment_dsr_outbox SET status='SUCCESS', completed_at=?, processing_started_at=NULL, updated_at=?, last_error=NULL WHERE id=? AND status='PROCESSING'", [now().toISOString(), now().toISOString(), item.id]);
            return true;
        }
        catch (error) {
            const message = String(error.message || "Segment DSR delivery failed").slice(0, 500);
            const permanent = message.includes("data quality is incomplete") || message.includes("payload is unavailable");
            await run("UPDATE segment_dsr_outbox SET status=?, processing_started_at=NULL, updated_at=?, last_error=? WHERE id=? AND status='PROCESSING'", [permanent ? "FAILED" : "PENDING", now().toISOString(), message, item.id]);
            return false;
        }
    }

    async function drain() {
        await recoverStaleProcessing();
        const rows = await all("SELECT * FROM segment_dsr_outbox WHERE status='PENDING' ORDER BY business_date, id");
        for (const item of rows) {
            const last = Date.parse(item.last_attempt_at);
            if (Number.isFinite(last) && now().getTime() - last < RETRY_COOLDOWN_MS) continue;
            await processOne(item);
        }
    }

    return { enqueue, drain, recoverStaleProcessing, list: () => all("SELECT * FROM segment_dsr_outbox ORDER BY business_date, id"), CONTRACT };
}

module.exports = { createBusinessSegmentDsrOutboxService, CONTRACT };
