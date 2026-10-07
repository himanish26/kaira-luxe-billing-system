"use strict";

function run(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, error => error ? reject(error) : resolve());
    });
}

async function migrateExpenseTracker(database) {
    const table = await new Promise((resolve, reject) => database.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='expenses'",
        [], (error, row) => error ? reject(error) : resolve(row || null)
    ));
    if (!table) throw new Error("V7 Expense Tracker migration requires the V5 expenses table.");

    const stores = await new Promise((resolve, reject) => database.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stores'",
        [], (error, row) => error ? reject(error) : resolve(row || null)
    ));
    if (!stores) throw new Error("V7 Expense Tracker migration requires V6 Store Identity tables.");

    await run(database, `
        CREATE TABLE expense_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_code TEXT NOT NULL UNIQUE
                CHECK (length(batch_code) = 12 AND batch_code GLOB 'KLEXPB[0-9][0-9][0-9][0-9][0-9][0-9]'),
            store_id INTEGER NOT NULL,
            status TEXT NOT NULL CHECK (status = 'POSTED'),
            expense_count INTEGER NOT NULL CHECK (expense_count > 0),
            total_amount_paise INTEGER NOT NULL CHECK (total_amount_paise > 0),
            posted_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            posted_at TEXT NOT NULL,
            FOREIGN KEY (store_id) REFERENCES stores(id)
        )
    `);

    await run(database, `ALTER TABLE expenses ADD COLUMN expense_code TEXT
        CHECK (expense_code IS NULL OR
            (length(expense_code) = 11 AND expense_code GLOB 'KLEXP[0-9][0-9][0-9][0-9][0-9][0-9]'))`);
    await run(database, "CREATE UNIQUE INDEX idx_expenses_expense_code ON expenses(expense_code) WHERE expense_code IS NOT NULL");
    await run(database, "ALTER TABLE expenses ADD COLUMN batch_id INTEGER REFERENCES expense_batches(id)");
    await run(database, "ALTER TABLE expenses ADD COLUMN store_id INTEGER REFERENCES stores(id)");
    await run(database, "ALTER TABLE expenses ADD COLUMN posted_at TEXT");

    await run(database, `
        CREATE TABLE expense_identity_sequences (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            next_batch_sequence INTEGER NOT NULL CHECK (next_batch_sequence BETWEEN 1 AND 1000000),
            next_expense_sequence INTEGER NOT NULL CHECK (next_expense_sequence BETWEEN 1 AND 1000000)
        )
    `);
    await run(database, `
        INSERT INTO expense_identity_sequences (id, next_batch_sequence, next_expense_sequence)
        VALUES (1, 1, 1)
    `);
    await run(database, `
        CREATE TRIGGER trg_expense_identity_sequences_monotonic
        BEFORE UPDATE ON expense_identity_sequences
        FOR EACH ROW
        WHEN NEW.id <> OLD.id
          OR NEW.next_batch_sequence < OLD.next_batch_sequence
          OR NEW.next_expense_sequence < OLD.next_expense_sequence
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_EXPENSE_ID_SEQUENCE_CANNOT_REWIND');
        END
    `);
    await run(database, `
        CREATE TRIGGER trg_expense_identity_sequences_prevent_delete
        BEFORE DELETE ON expense_identity_sequences
        FOR EACH ROW
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_EXPENSE_ID_SEQUENCE_DELETE_PROHIBITED');
        END
    `);

    await run(database, `
        CREATE INDEX idx_expenses_posted_date_code
        ON expenses(expense_date DESC, expense_code DESC)
        WHERE expense_code IS NOT NULL AND batch_id IS NOT NULL
    `);
    await run(database, `
        CREATE INDEX idx_expenses_batch
        ON expenses(batch_id, expense_date DESC, expense_code DESC)
    `);

    await run(database, `
        CREATE TRIGGER trg_expenses_posted_immutable
        BEFORE UPDATE ON expenses
        FOR EACH ROW
        WHEN OLD.expense_code IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_POSTED_EXPENSE_IMMUTABLE');
        END
    `);
    await run(database, `
        CREATE TRIGGER trg_expenses_posted_store_attribution
        BEFORE INSERT ON expenses
        FOR EACH ROW
        WHEN NEW.expense_code IS NOT NULL
          AND (NEW.batch_id IS NULL OR NEW.store_id IS NULL OR NEW.posted_at IS NULL
               OR NOT EXISTS (
                   SELECT 1 FROM expense_batches b
                   WHERE b.id = NEW.batch_id AND b.store_id = NEW.store_id AND b.status = 'POSTED'
               ))
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_POSTED_EXPENSE_STORE_ATTRIBUTION_REQUIRED');
        END
    `);
    await run(database, `
        CREATE TRIGGER trg_expense_batches_immutable
        BEFORE UPDATE ON expense_batches
        FOR EACH ROW
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_POSTED_EXPENSE_BATCH_IMMUTABLE');
        END
    `);
    await run(database, `
        CREATE TRIGGER trg_expense_batches_prevent_delete
        BEFORE DELETE ON expense_batches
        FOR EACH ROW
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_EXPENSE_BATCH_DELETE_PROHIBITED');
        END
    `);
}

module.exports = { migrateExpenseTracker };
