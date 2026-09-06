const SNAPSHOT_VERSION = 1;

const CREATE_DAY_CLOSING_SNAPSHOTS_SQL = `
    CREATE TABLE IF NOT EXISTS day_closing_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_date TEXT NOT NULL,
        close_sequence INTEGER NOT NULL,
        snapshot_version INTEGER NOT NULL,
        close_status TEXT NOT NULL
            CHECK (close_status IN ('PREPARING', 'CLOSED', 'FAILED', 'REOPENED')),
        closed_at TEXT,
        closed_by TEXT NOT NULL DEFAULT 'Administrator',
        total_bills INTEGER,
        qty_sold INTEGER,
        gross_sales_paise INTEGER,
        total_discount_paise INTEGER,
        net_billing_paise INTEGER,
        credit_note_count INTEGER,
        qty_returned INTEGER,
        return_cn_value_paise INTEGER,
        net_sales_after_returns_paise INTEGER,
        cash_paise INTEGER,
        upi_paise INTEGER,
        card_paise INTEGER,
        store_credit_redeemed_paise INTEGER,
        gift_voucher_redeemed_paise INTEGER,
        settlement_total_paise INTEGER,
        actual_money_collection_paise INTEGER,
        store_credit_issued_paise INTEGER,
        settlement_difference_paise INTEGER,
        store_credit_ledger_redeemed_paise INTEGER,
        store_credit_ledger_difference_paise INTEGER,
        backup_status TEXT NOT NULL DEFAULT 'PENDING'
            CHECK (backup_status IN ('PENDING', 'SUCCESS', 'FAILED', 'UNKNOWN')),
        backup_reference TEXT,
        email_status TEXT NOT NULL DEFAULT 'PENDING'
            CHECK (email_status IN ('PENDING', 'SUCCESS', 'FAILED', 'UNKNOWN')),
        dsr_sync_status TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
        dsr_synced_at TEXT,
        dsr_sync_error TEXT,
        dsr_sync_attempts INTEGER NOT NULL DEFAULT 0,
        remarks TEXT,
        reopened_at TEXT,
        reopened_by TEXT,
        reopen_reason TEXT,
        legacy_source_id INTEGER UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (business_date, close_sequence)
    )
`;

const CREATE_ACTIVE_INDEX_SQL = `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_day_closing_one_active
    ON day_closing_snapshots (business_date)
    WHERE close_status IN ('PREPARING', 'CLOSED')
`;

const CREATE_DATE_INDEX_SQL = `
    CREATE INDEX IF NOT EXISTS idx_day_closing_date_sequence
    ON day_closing_snapshots (business_date, close_sequence DESC)
`;

const CREATE_INTEGRATION_OUTBOX_SQL = `
    CREATE TABLE IF NOT EXISTS integration_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_date TEXT NOT NULL,
        closing_id INTEGER NOT NULL,
        close_sequence INTEGER NOT NULL,
        delivery_type TEXT NOT NULL CHECK (delivery_type IN ('EMAIL_DAY_CLOSING', 'DSR_DAY_CLOSING')),
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_attempt_at TEXT,
        completed_at TEXT,
        last_error TEXT,
        UNIQUE (closing_id, delivery_type)
    )
`;

const CREATE_BUSINESS_DAY_STATE_SQL = `
    CREATE TABLE IF NOT EXISTS business_day_state (
        business_date TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('OPEN', 'CLOSED')),
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        updated_at TEXT NOT NULL
    )
`;

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) reject(error);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) reject(error);
            else resolve(row || null);
        });
    });
}

async function migrateDayClosingSnapshots(db) {
    let transactionStarted = false;
    try {
        await run(db, "BEGIN IMMEDIATE TRANSACTION");
        transactionStarted = true;
        await run(db, CREATE_DAY_CLOSING_SNAPSHOTS_SQL);
        const columns = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info(day_closing_snapshots)", [], (error, rows) => {
                if (error) reject(error);
                else resolve(rows || []);
            });
        });
        const existing = new Set(columns.map(column => column.name));
        for (const [name, definition] of [
            ["dsr_sync_status", "TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED'"],
            ["dsr_synced_at", "TEXT"],
            ["dsr_sync_error", "TEXT"],
            ["dsr_sync_attempts", "INTEGER NOT NULL DEFAULT 0"]
        ]) {
            if (!existing.has(name)) {
                await run(db, `ALTER TABLE day_closing_snapshots ADD COLUMN ${name} ${definition}`);
            }
        }
        await run(db, CREATE_ACTIVE_INDEX_SQL);
        await run(db, CREATE_DATE_INDEX_SQL);
        await run(db, CREATE_INTEGRATION_OUTBOX_SQL);
        await run(db, CREATE_BUSINESS_DAY_STATE_SQL);
        await run(db, "CREATE INDEX IF NOT EXISTS idx_business_day_state_open ON business_day_state(state, business_date)");
        await run(db, "CREATE INDEX IF NOT EXISTS idx_integration_outbox_pending ON integration_outbox(status, business_date, id)");

        const legacyTable = await get(
            db,
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'day_closing'`
        );
        if (legacyTable) {
            await run(db, `
                INSERT OR IGNORE INTO day_closing_snapshots (
                    business_date,
                    close_sequence,
                    snapshot_version,
                    close_status,
                    closed_at,
                    closed_by,
                    backup_status,
                    email_status,
                    remarks,
                    legacy_source_id,
                    created_at,
                    updated_at
                )
                SELECT
                    business_date,
                    1,
                    0,
                    'CLOSED',
                    closed_at,
                    COALESCE(closed_by, 'Administrator'),
                    'UNKNOWN',
                    'UNKNOWN',
                    CASE
                        WHEN remarks IS NULL OR TRIM(remarks) = ''
                        THEN 'Legacy pre-R09.7F-B closing marker; accounting values are not authoritative.'
                        ELSE remarks || ' | Legacy pre-R09.7F-B closing marker; accounting values are not authoritative.'
                    END,
                    id,
                    closed_at,
                    closed_at
                FROM day_closing
            `);
        }

        // Existing transactional/closing evidence proves that KLBS was operational
        // on those dates; dates without evidence are intentionally not invented.
        await run(db, `
            INSERT OR IGNORE INTO business_day_state (business_date, state, opened_at, closed_at, updated_at)
            SELECT candidate.business_date,
                   CASE WHEN latest.close_status = 'CLOSED' THEN 'CLOSED' ELSE 'OPEN' END,
                   COALESCE(latest.created_at, datetime('now')),
                   CASE WHEN latest.close_status = 'CLOSED' THEN latest.closed_at ELSE NULL END,
                   COALESCE(latest.updated_at, datetime('now'))
            FROM (
                SELECT bill_date AS business_date FROM bills
                UNION SELECT business_date FROM returns
                UNION SELECT business_date FROM day_closing_snapshots
            ) candidate
            LEFT JOIN day_closing_snapshots latest ON latest.id = (
                SELECT s.id FROM day_closing_snapshots s
                WHERE s.business_date = candidate.business_date
                ORDER BY s.close_sequence DESC LIMIT 1
            )
        `);

        // Email FAILED is excluded because legacy versions also used it for disabled or unconfigured email.
        await run(db, `INSERT OR IGNORE INTO integration_outbox
            (business_date, closing_id, close_sequence, delivery_type, created_at)
            SELECT business_date, id, close_sequence, 'EMAIL_DAY_CLOSING', COALESCE(updated_at, closed_at, created_at)
            FROM day_closing_snapshots
            WHERE close_status = 'CLOSED' AND backup_status = 'SUCCESS'
              AND email_status IN ('PENDING', 'UNKNOWN')`);
        await run(db, `INSERT OR IGNORE INTO integration_outbox
            (business_date, closing_id, close_sequence, delivery_type, created_at)
            SELECT business_date, id, close_sequence, 'DSR_DAY_CLOSING', COALESCE(updated_at, closed_at, created_at)
            FROM day_closing_snapshots
            WHERE close_status = 'CLOSED' AND backup_status = 'SUCCESS'
              AND dsr_sync_status IN ('NOT_ATTEMPTED', 'PENDING', 'FAILED')`);

        const recoveryTime = new Date().toISOString();
        await run(db, `
            UPDATE day_closing_snapshots
            SET close_status = 'FAILED',
                backup_status = CASE
                    WHEN backup_status = 'SUCCESS' THEN 'SUCCESS'
                    ELSE 'FAILED'
                END,
                email_status = CASE
                    WHEN email_status = 'SUCCESS' THEN 'SUCCESS'
                    ELSE 'FAILED'
                END,
                remarks = CASE
                    WHEN remarks IS NULL OR TRIM(remarks) = ''
                    THEN 'Interrupted close recovered during database initialization.'
                    ELSE remarks || ' | Interrupted close recovered during database initialization.'
                END,
                updated_at = ?
            WHERE snapshot_version = ?
              AND close_status = 'PREPARING'
        `, [recoveryTime, SNAPSHOT_VERSION]);

        await run(db, `UPDATE integration_outbox SET status = 'PENDING', last_error = 'Application restarted during delivery.' WHERE status = 'PROCESSING'`);

        const table = await get(db, `
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name = 'day_closing_snapshots'
        `);
        const activeIndex = await get(db, `
            SELECT [unique] AS is_unique, partial
            FROM pragma_index_list('day_closing_snapshots')
            WHERE name = 'idx_day_closing_one_active'
        `);
        const dsrColumns = await new Promise((resolve, reject) => {
            db.all("PRAGMA table_info(day_closing_snapshots)", [], (error, rows) => {
                if (error) reject(error);
                else resolve(new Set((rows || []).map(column => column.name)));
            });
        });
        if (
            !table ||
            !activeIndex ||
            Number(activeIndex.is_unique) !== 1 ||
            Number(activeIndex.partial) !== 1 ||
            !["dsr_sync_status", "dsr_synced_at", "dsr_sync_error", "dsr_sync_attempts"]
                .every(name => dsrColumns.has(name))
        ) {
            throw new Error("Day Closing snapshot migration verification failed.");
        }
        const businessDayState = await get(db, `
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'business_day_state'
        `);
        if (!businessDayState) throw new Error("Business-day state migration verification failed.");

        await run(db, "COMMIT");
        transactionStarted = false;
        console.log("✓ Day Closing snapshot schema ready.");
    }
    catch (error) {
        if (transactionStarted) {
            await run(db, "ROLLBACK").catch(() => {});
        }
        throw error;
    }
}

module.exports = {
    SNAPSHOT_VERSION,
    CREATE_DAY_CLOSING_SNAPSHOTS_SQL,
    CREATE_ACTIVE_INDEX_SQL,
    CREATE_DATE_INDEX_SQL,
    CREATE_INTEGRATION_OUTBOX_SQL,
    migrateDayClosingSnapshots
};
