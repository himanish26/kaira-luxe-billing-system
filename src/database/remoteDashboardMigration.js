const CREATE_REMOTE_DASHBOARD_OUTBOX_SQL = `
    CREATE TABLE IF NOT EXISTS remote_dashboard_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL CHECK (event_type IN ('BILL_SAVED', 'KLBS_STARTED', 'DAY_CLOSED')),
        idempotency_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
            CHECK (status IN ('PENDING', 'RETRYABLE_FAILURE', 'ACCEPTED', 'PERMANENT_FAILURE')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_attempt_at TEXT,
        next_attempt_at TEXT,
        accepted_at TEXT,
        last_error TEXT
    )
`;

function run(database, sql, params = []) {
    return new Promise((resolve, reject) => database.run(sql, params, error => error ? reject(error) : resolve()));
}

async function migrateRemoteDashboardOutbox(database) {
    await run(database, CREATE_REMOTE_DASHBOARD_OUTBOX_SQL);
    await run(database, `CREATE INDEX IF NOT EXISTS idx_remote_dashboard_outbox_due
        ON remote_dashboard_outbox(status, next_attempt_at, id)`);
}

module.exports = { migrateRemoteDashboardOutbox, CREATE_REMOTE_DASHBOARD_OUTBOX_SQL };
