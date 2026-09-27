function createIntegrationStatusService({ database, legacyOutbox }) {
    if (!database || !legacyOutbox) throw new Error("Integration status dependencies are required.");
    const all = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    const get = (sql, params = []) => new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));

    async function getStatusView() {
        const [legacy, jobs, lastLegacy, lastConsolidated] = await Promise.all([
            legacyOutbox.getStatusView(),
            all(`SELECT j.id,j.business_date,j.sheet_status,j.email_status,j.sheet_delivered_at,j.email_delivered_at
                 FROM consolidated_reporting_jobs j
                 JOIN day_closing_snapshots s ON s.id=j.closing_id
                 WHERE s.close_status='CLOSED'
                   AND NOT EXISTS (
                     SELECT 1 FROM day_closing_snapshots newer
                     WHERE newer.business_date=s.business_date AND newer.close_status='CLOSED'
                       AND newer.close_sequence>s.close_sequence
                   )
                 ORDER BY j.business_date DESC,j.id DESC`),
            get(`SELECT dsr_synced_at AS at FROM day_closing_snapshots
                 WHERE close_status='CLOSED' AND dsr_sync_status='SYNCED' AND dsr_synced_at IS NOT NULL
                 ORDER BY dsr_synced_at DESC LIMIT 1`),
            get(`SELECT sheet_delivered_at AS at FROM consolidated_reporting_jobs
                 WHERE sheet_status='DELIVERED' AND sheet_delivered_at IS NOT NULL
                 ORDER BY sheet_delivered_at DESC LIMIT 1`)
        ]);
        const byDate = new Map((legacy.deliveries || []).map(item => [item.businessDate, { ...item }]));
        let consolidatedPending = 0;
        let consolidatedFailed = 0;
        for (const job of jobs) {
            const delivery = byDate.get(job.business_date) || {
                businessDate: job.business_date, emailStatus: "SUCCESS", dsrStatus: "SUCCESS"
            };
            delivery.consolidatedJobId = job.id;
            delivery.consolidatedSheetStatus = job.sheet_status;
            delivery.consolidatedEmailStatus = job.email_status;
            delivery.consolidatedSheetDeliveredAt = job.sheet_delivered_at;
            delivery.consolidatedEmailDeliveredAt = job.email_delivered_at;
            for (const status of [job.sheet_status, job.email_status]) {
                if (status === "PENDING" || status === "PROCESSING") consolidatedPending += 1;
                else if (status === "FAILED") consolidatedFailed += 1;
            }
            byDate.set(job.business_date, delivery);
        }
        const pendingCount = Number(legacy.pendingCount || 0) + consolidatedPending;
        const failedCount = consolidatedFailed;
        const last = [lastLegacy && lastLegacy.at, lastConsolidated && lastConsolidated.at]
            .filter(value => value && Number.isFinite(Date.parse(value)))
            .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
        return {
            ...legacy,
            pendingCount,
            failedCount,
            upToDate: pendingCount === 0 && failedCount === 0,
            deliveries: [...byDate.values()].sort((a, b) => b.businessDate.localeCompare(a.businessDate)),
            lastDsrSync: last
                ? { at: last, status: last === (lastConsolidated && lastConsolidated.at) ? "DELIVERED" : "SYNCED" }
                : null
        };
    }
    return { getStatusView };
}

module.exports = { createIntegrationStatusService };
