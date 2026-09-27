const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { createConsolidatedJobReconciliation } = require("../src/services/consolidatedJobReconciliation");

if (process.argv[2] !== "--execute-development-db" || process.argv.length !== 3) {
    console.error("Usage: node scripts/reconcile-c4d-sequence3-accepted.js --execute-development-db");
    process.exitCode = 2;
} else {
    const db = new sqlite3.Database(path.resolve(__dirname, "../billing.db"), sqlite3.OPEN_READWRITE);
    createConsolidatedJobReconciliation(db).reconcile()
        .then(result => {
            console.log(JSON.stringify({ status: result.status, jobId: result.job.id,
                sheetStatus: result.job.sheet_status, sheetDeliveredAt: result.job.sheet_delivered_at,
                sheetAttemptCount: result.job.sheet_attempt_count, sheetLastError: result.job.sheet_last_error,
                emailStatus: result.job.email_status }));
        })
        .catch(error => { console.error(`RECONCILIATION_REFUSED: ${error.message}`); process.exitCode = 1; })
        .finally(() => db.close());
}
