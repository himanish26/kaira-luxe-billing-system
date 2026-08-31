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
        await run(db, CREATE_ACTIVE_INDEX_SQL);
        await run(db, CREATE_DATE_INDEX_SQL);

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

        await run(db, `
            UPDATE day_closing_snapshots
            SET email_status = 'FAILED',
                remarks = CASE
                    WHEN remarks IS NULL OR TRIM(remarks) = ''
                    THEN 'Email outcome was pending when the application restarted.'
                    ELSE remarks || ' | Email outcome was pending when the application restarted.'
                END,
                updated_at = ?
            WHERE snapshot_version = ?
              AND close_status = 'CLOSED'
              AND email_status = 'PENDING'
        `, [recoveryTime, SNAPSHOT_VERSION]);

        const table = await get(db, `
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name = 'day_closing_snapshots'
        `);
        const activeIndex = await get(db, `
            SELECT [unique] AS is_unique, partial
            FROM pragma_index_list('day_closing_snapshots')
            WHERE name = 'idx_day_closing_one_active'
        `);
        if (
            !table ||
            !activeIndex ||
            Number(activeIndex.is_unique) !== 1 ||
            Number(activeIndex.partial) !== 1
        ) {
            throw new Error("Day Closing snapshot migration verification failed.");
        }

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
    migrateDayClosingSnapshots
};
