"use strict";

function run(database, sql, params = []) {
    return new Promise((resolve, reject) => database.run(sql, params, error => error ? reject(error) : resolve()));
}

async function migrateManagementAccountingEntries(database) {
    const prerequisites = await new Promise((resolve, reject) => database.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('stores','store_context')",
        [], (error, rows) => error ? reject(error) : resolve(new Set((rows || []).map(row => row.name)))
    ));
    if (!prerequisites.has("stores") || !prerequisites.has("store_context")) {
        throw new Error("V9 Management Accounting Entry migration requires V6 Store Identity tables.");
    }

    await run(database, `
        CREATE TABLE management_accounting_entry_sequences (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            next_sequence INTEGER NOT NULL CHECK (next_sequence BETWEEN 1 AND 1000000)
        )
    `);
    await run(database, `INSERT INTO management_accounting_entry_sequences (id, next_sequence) VALUES (1, 1)`);

    await run(database, `
        CREATE TABLE management_accounting_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_code TEXT NOT NULL UNIQUE CHECK (
                length(entry_code) = 11 AND entry_code GLOB 'KLPAE[0-9][0-9][0-9][0-9][0-9][0-9]'
            ),
            store_id INTEGER NOT NULL,
            accounting_date TEXT NOT NULL CHECK (
                length(accounting_date) = 10 AND accounting_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            ),
            accounting_head TEXT NOT NULL CHECK (accounting_head IN (
                'INTEREST_INCOME', 'OTHER_NON_OPERATING_INCOME', 'INTEREST_FINANCE_CHARGES',
                'DEPRECIATION', 'AMORTISATION', 'OTHER_NON_OPERATING_EXPENSE',
                'EXCEPTIONAL_ADJUSTMENT', 'INCOME_TAX_PROVISION'
            )),
            business_segment TEXT NOT NULL CHECK (business_segment IN ('KL', 'MENS', 'KIDS', 'COMMON')),
            amount_paise INTEGER NOT NULL CHECK (typeof(amount_paise) = 'integer' AND amount_paise > 0),
            adjustment_effect TEXT CHECK (adjustment_effect IS NULL OR adjustment_effect IN ('INCOME', 'EXPENSE')),
            reference_no TEXT CHECK (reference_no IS NULL OR (length(reference_no) <= 128 AND reference_no = trim(reference_no))),
            remarks TEXT CHECK (remarks IS NULL OR (length(remarks) <= 2000 AND remarks = trim(remarks))),
            status TEXT NOT NULL CHECK (status = 'POSTED'),
            created_at TEXT NOT NULL,
            created_by TEXT NOT NULL CHECK (created_by IN ('MANAGER')),
            posted_at TEXT NOT NULL,
            posted_by TEXT NOT NULL CHECK (posted_by IN ('MANAGER')),
            source TEXT NOT NULL CHECK (source = 'MANUAL'),
            reverses_entry_id INTEGER UNIQUE,
            reversal_reason TEXT CHECK (reversal_reason IS NULL OR (length(reversal_reason) <= 1000 AND reversal_reason = trim(reversal_reason))),
            FOREIGN KEY (store_id) REFERENCES stores(id),
            FOREIGN KEY (reverses_entry_id) REFERENCES management_accounting_entries(id),
            CHECK (
                (accounting_head = 'EXCEPTIONAL_ADJUSTMENT' AND adjustment_effect IN ('INCOME', 'EXPENSE'))
                OR (accounting_head <> 'EXCEPTIONAL_ADJUSTMENT' AND adjustment_effect IS NULL)
            ),
            CHECK (accounting_head <> 'EXCEPTIONAL_ADJUSTMENT' OR (remarks IS NOT NULL AND length(remarks) > 0)),
            CHECK (
                (reverses_entry_id IS NULL AND reversal_reason IS NULL)
                OR (reverses_entry_id IS NOT NULL AND reversal_reason IS NOT NULL AND length(reversal_reason) > 0)
            )
        )
    `);
    await run(database, `
        CREATE INDEX idx_management_accounting_entries_period
        ON management_accounting_entries(store_id, accounting_date, business_segment, accounting_head, entry_code)
    `);
    await run(database, `
        CREATE INDEX idx_management_accounting_entries_reversals
        ON management_accounting_entries(reverses_entry_id) WHERE reverses_entry_id IS NOT NULL
    `);
    await run(database, `
        CREATE TRIGGER trg_management_accounting_sequence_monotonic
        BEFORE UPDATE ON management_accounting_entry_sequences
        FOR EACH ROW
        WHEN NEW.id <> OLD.id OR NEW.next_sequence < OLD.next_sequence
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_MANAGEMENT_ACCOUNTING_SEQUENCE_CANNOT_REWIND');
        END
    `);
    await run(database, `
        CREATE TRIGGER trg_management_accounting_sequence_no_delete
        BEFORE DELETE ON management_accounting_entry_sequences
        FOR EACH ROW BEGIN
            SELECT RAISE(ABORT, 'KLBS_MANAGEMENT_ACCOUNTING_SEQUENCE_DELETE_PROHIBITED');
        END
    `);
    await run(database, `
        CREATE TRIGGER trg_management_accounting_entry_code_from_sequence
        BEFORE INSERT ON management_accounting_entries
        FOR EACH ROW WHEN NOT EXISTS (
            SELECT 1 FROM management_accounting_entry_sequences s
            WHERE s.id = 1 AND s.next_sequence > 1
              AND CAST(SUBSTR(NEW.entry_code, 6) AS INTEGER) = s.next_sequence - 1
        )
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_MANAGEMENT_ACCOUNTING_ID_SEQUENCE_REQUIRED');
        END
    `);
    await run(database, `
        CREATE TRIGGER trg_management_accounting_store_active
        BEFORE INSERT ON management_accounting_entries
        FOR EACH ROW WHEN NOT EXISTS (
            SELECT 1 FROM stores s JOIN store_context c ON c.current_store_id = s.id
            WHERE c.id = 1 AND s.id = NEW.store_id AND s.status = 'ACTIVE'
        )
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_MANAGEMENT_ACCOUNTING_CURRENT_STORE_REQUIRED');
        END
    `);
    await run(database, `
        CREATE TRIGGER trg_management_accounting_reversal_valid
        BEFORE INSERT ON management_accounting_entries
        FOR EACH ROW WHEN NEW.reverses_entry_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM management_accounting_entries original
            WHERE original.id = NEW.reverses_entry_id
              AND original.status = 'POSTED'
              AND original.reverses_entry_id IS NULL
              AND original.store_id = NEW.store_id
              AND original.accounting_head = NEW.accounting_head
              AND original.business_segment = NEW.business_segment
              AND original.amount_paise = NEW.amount_paise
              AND original.adjustment_effect IS NEW.adjustment_effect
        )
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_MANAGEMENT_ACCOUNTING_REVERSAL_INVALID');
        END
    `);
    await run(database, `
        CREATE TRIGGER trg_management_accounting_entries_immutable_update
        BEFORE UPDATE ON management_accounting_entries
        FOR EACH ROW BEGIN
            SELECT RAISE(ABORT, 'KLBS_MANAGEMENT_ACCOUNTING_ENTRY_IMMUTABLE');
        END
    `);
    await run(database, `
        CREATE TRIGGER trg_management_accounting_entries_immutable_delete
        BEFORE DELETE ON management_accounting_entries
        FOR EACH ROW BEGIN
            SELECT RAISE(ABORT, 'KLBS_MANAGEMENT_ACCOUNTING_ENTRY_DELETE_PROHIBITED');
        END
    `);
}

module.exports = { migrateManagementAccountingEntries };
