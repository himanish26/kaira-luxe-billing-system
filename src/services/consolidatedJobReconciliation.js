const EXPECTED = Object.freeze({
    id: 3,
    closing_id: 14,
    business_date: "2026-09-27",
    close_sequence: 3,
    payload_hash: "4277a6521806a768e0c0835bf46d4541c3d965f86c96b400856c3315107537c1",
    sheet_status: "FAILED",
    sheet_attempt_count: 1,
    email_status: "DELIVERED"
});
const ACCEPTED_AT = "2026-09-27T12:13:04.589Z";

function createConsolidatedJobReconciliation(database) {
    const run = (sql, params = []) => new Promise((resolve, reject) => database.run(sql, params, function(error) {
        if (error) reject(error);
        else resolve({ changes: this.changes });
    }));
    const get = (sql, params = []) => new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));

    async function reconcile() {
        await run("BEGIN IMMEDIATE");
        try {
            const job = await get("SELECT * FROM consolidated_reporting_jobs WHERE id=?", [EXPECTED.id]);
            if (!job) throw new Error("EXPECTED_JOB_MISSING");
            const acceptedAlready = job.sheet_status === "DELIVERED" &&
                job.sheet_delivered_at === ACCEPTED_AT && job.sheet_last_error === null &&
                job.sheet_processing_started_at === null && job.email_status === EXPECTED.email_status &&
                job.closing_id === EXPECTED.closing_id && job.business_date === EXPECTED.business_date &&
                job.close_sequence === EXPECTED.close_sequence && job.payload_hash === EXPECTED.payload_hash;
            if (acceptedAlready) {
                await run("COMMIT");
                return { status: "ALREADY_RECONCILED", job };
            }
            for (const key of ["id", "closing_id", "business_date", "close_sequence", "payload_hash", "sheet_status", "sheet_attempt_count", "email_status"]) {
                if (job[key] !== EXPECTED[key]) throw new Error(`JOB_GUARD_MISMATCH:${key}`);
            }
            if (job.sheet_delivered_at !== null || job.sheet_processing_started_at !== null) throw new Error("JOB_DELIVERY_FIELDS_MISMATCH");
            const day = await get("SELECT state FROM business_day_state WHERE business_date=?", [EXPECTED.business_date]);
            if (!day || day.state !== "OPEN") throw new Error("BUSINESS_DAY_GUARD_MISMATCH");
            const snapshots = await all("SELECT id,close_sequence,close_status,backup_status FROM day_closing_snapshots WHERE business_date=? ORDER BY id", [EXPECTED.business_date]);
            if (snapshots.length !== 3 || snapshots.some((row, index) =>
                row.id !== 12 + index || row.close_sequence !== 1 + index ||
                row.close_status !== "REOPENED" || row.backup_status !== "SUCCESS")) {
                throw new Error("SNAPSHOT_GUARD_MISMATCH");
            }
            const result = await run(`UPDATE consolidated_reporting_jobs
                SET sheet_status='DELIVERED', sheet_delivered_at=?, sheet_last_error=NULL,
                    sheet_processing_started_at=NULL
                WHERE id=? AND closing_id=? AND business_date=? AND close_sequence=? AND payload_hash=?
                  AND sheet_status='FAILED' AND sheet_attempt_count=1 AND email_status='DELIVERED'
                  AND sheet_delivered_at IS NULL AND sheet_processing_started_at IS NULL`,
            [ACCEPTED_AT, EXPECTED.id, EXPECTED.closing_id, EXPECTED.business_date, EXPECTED.close_sequence, EXPECTED.payload_hash]);
            if (result.changes !== 1) throw new Error("CONDITIONAL_UPDATE_FAILED");
            const updated = await get("SELECT * FROM consolidated_reporting_jobs WHERE id=?", [EXPECTED.id]);
            if (updated.id !== EXPECTED.id || updated.closing_id !== EXPECTED.closing_id ||
                updated.business_date !== EXPECTED.business_date || updated.close_sequence !== EXPECTED.close_sequence ||
                updated.payload_hash !== EXPECTED.payload_hash || updated.sheet_status !== "DELIVERED" || updated.sheet_delivered_at !== ACCEPTED_AT ||
                updated.sheet_last_error !== null || updated.sheet_processing_started_at !== null ||
                updated.sheet_attempt_count !== EXPECTED.sheet_attempt_count || updated.email_status !== EXPECTED.email_status ||
                updated.email_attempt_count !== job.email_attempt_count ||
                updated.email_last_attempt_at !== job.email_last_attempt_at ||
                updated.email_last_error !== job.email_last_error ||
                updated.email_delivered_at !== job.email_delivered_at) throw new Error("POST_WRITE_VERIFICATION_FAILED");
            const dayAfter = await get("SELECT state FROM business_day_state WHERE business_date=?", [EXPECTED.business_date]);
            const snapshotsAfter = await all("SELECT id,close_sequence,close_status,backup_status FROM day_closing_snapshots WHERE business_date=? ORDER BY id", [EXPECTED.business_date]);
            if (dayAfter.state !== "OPEN" || JSON.stringify(snapshotsAfter) !== JSON.stringify(snapshots)) throw new Error("SURROUNDING_STATE_CHANGED");
            await run("COMMIT");
            return { status: "RECONCILED", job: updated };
        } catch (error) {
            await run("ROLLBACK").catch(() => {});
            throw error;
        }
    }

    return { reconcile };
}

module.exports = { EXPECTED, ACCEPTED_AT, createConsolidatedJobReconciliation };
