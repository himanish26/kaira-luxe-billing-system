"use strict";

function run(db, sql) {
    return new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
}

async function migrateSupplierSubledger(db) {
    const supplier = await new Promise((resolve, reject) => db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_master'",
        [], (error, row) => error ? reject(error) : resolve(row || null)));
    if (!supplier) throw new Error("V11 Supplier subledger migration requires V10 Supplier tables.");

    await run(db, "ALTER TABLE supplier_invoices ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0 CHECK(typeof(discount_paise)='integer' AND discount_paise>=0)");
    await run(db, "ALTER TABLE supplier_invoices ADD COLUMN rounding_adjustment_paise INTEGER NOT NULL DEFAULT 0 CHECK(typeof(rounding_adjustment_paise)='integer' AND rounding_adjustment_paise BETWEEN -500 AND 500)");
    await run(db, `CREATE TABLE supplier_subledger_sequences (
        id INTEGER PRIMARY KEY CHECK(id=1),
        next_opening_sequence INTEGER NOT NULL CHECK(next_opening_sequence BETWEEN 1 AND 1000000),
        next_credit_note_sequence INTEGER NOT NULL CHECK(next_credit_note_sequence BETWEEN 1 AND 1000000)
    )`);
    await run(db, "INSERT INTO supplier_subledger_sequences VALUES(1,1,1)");
    await run(db, `CREATE TABLE supplier_opening_balances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opening_code TEXT NOT NULL UNIQUE CHECK(length(opening_code)=11 AND opening_code GLOB 'KLSOB[0-9][0-9][0-9][0-9][0-9][0-9]'),
        store_id INTEGER NOT NULL REFERENCES stores(id), supplier_id INTEGER NOT NULL REFERENCES supplier_master(id),
        supplier_code_snapshot TEXT NOT NULL, supplier_name_snapshot TEXT NOT NULL,
        as_on_date TEXT NOT NULL, reference TEXT, amount_paise INTEGER NOT NULL CHECK(typeof(amount_paise)='integer' AND amount_paise>0),
        due_date TEXT, remarks TEXT, status TEXT NOT NULL CHECK(status IN ('POSTING','POSTED')),
        created_at TEXT NOT NULL, posted_at TEXT NOT NULL
    )`);
    await run(db, `CREATE TABLE supplier_credit_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_note_code TEXT NOT NULL UNIQUE CHECK(length(credit_note_code)=11 AND credit_note_code GLOB 'KLSCN[0-9][0-9][0-9][0-9][0-9][0-9]'),
        store_id INTEGER NOT NULL REFERENCES stores(id), supplier_id INTEGER NOT NULL REFERENCES supplier_master(id),
        supplier_code_snapshot TEXT NOT NULL, supplier_name_snapshot TEXT NOT NULL,
        external_number TEXT, external_number_normalized TEXT,
        credit_note_date TEXT NOT NULL, posting_date TEXT NOT NULL, amount_paise INTEGER NOT NULL CHECK(typeof(amount_paise)='integer' AND amount_paise>0),
        reason TEXT NOT NULL CHECK(reason IN ('PURCHASE RETURN','RATE DIFFERENCE','DAMAGED GOODS','COMMERCIAL DISCOUNT','OTHER')),
        reference_invoice_id INTEGER REFERENCES supplier_invoices(id), reference TEXT, remarks TEXT,
        status TEXT NOT NULL CHECK(status IN ('POSTING','POSTED')), created_at TEXT NOT NULL, posted_at TEXT NOT NULL,
        CHECK(reason<>'OTHER' OR length(trim(COALESCE(remarks,'')))>0)
    )`);
    await run(db, `CREATE UNIQUE INDEX idx_supplier_credit_note_external_unique
        ON supplier_credit_notes(supplier_id,external_number_normalized) WHERE external_number_normalized IS NOT NULL`);
    await run(db, `CREATE TABLE supplier_payment_opening_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER NOT NULL REFERENCES supplier_payments(id),
        opening_balance_id INTEGER NOT NULL REFERENCES supplier_opening_balances(id),
        amount_paise INTEGER NOT NULL CHECK(typeof(amount_paise)='integer' AND amount_paise>0), UNIQUE(payment_id,opening_balance_id)
    )`);
    await run(db, `CREATE TABLE supplier_credit_note_invoice_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, credit_note_id INTEGER NOT NULL REFERENCES supplier_credit_notes(id),
        invoice_id INTEGER NOT NULL REFERENCES supplier_invoices(id),
        amount_paise INTEGER NOT NULL CHECK(typeof(amount_paise)='integer' AND amount_paise>0), UNIQUE(credit_note_id,invoice_id)
    )`);
    await run(db, `CREATE TABLE supplier_credit_note_opening_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, credit_note_id INTEGER NOT NULL REFERENCES supplier_credit_notes(id),
        opening_balance_id INTEGER NOT NULL REFERENCES supplier_opening_balances(id),
        amount_paise INTEGER NOT NULL CHECK(typeof(amount_paise)='integer' AND amount_paise>0), UNIQUE(credit_note_id,opening_balance_id)
    )`);
    await run(db, "CREATE INDEX idx_supplier_opening_account ON supplier_opening_balances(store_id,supplier_id,as_on_date,opening_code)");
    await run(db, "CREATE INDEX idx_supplier_credit_account ON supplier_credit_notes(store_id,supplier_id,posting_date,credit_note_code)");

    await run(db, `CREATE TRIGGER trg_supplier_subledger_sequences_monotonic BEFORE UPDATE ON supplier_subledger_sequences
        WHEN NEW.id<>OLD.id OR NEW.next_opening_sequence<OLD.next_opening_sequence OR NEW.next_credit_note_sequence<OLD.next_credit_note_sequence
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_SUBLEDGER_SEQUENCE_CANNOT_REWIND'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_subledger_sequences_no_delete BEFORE DELETE ON supplier_subledger_sequences
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_SUBLEDGER_SEQUENCE_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_opening_sequence BEFORE INSERT ON supplier_opening_balances
        WHEN NOT EXISTS(SELECT 1 FROM supplier_subledger_sequences WHERE id=1 AND next_opening_sequence>1 AND CAST(SUBSTR(NEW.opening_code,6) AS INTEGER)=next_opening_sequence-1)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_OPENING_SEQUENCE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_credit_sequence BEFORE INSERT ON supplier_credit_notes
        WHEN NOT EXISTS(SELECT 1 FROM supplier_subledger_sequences WHERE id=1 AND next_credit_note_sequence>1 AND CAST(SUBSTR(NEW.credit_note_code,6) AS INTEGER)=next_credit_note_sequence-1)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CREDIT_NOTE_SEQUENCE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_opening_store BEFORE INSERT ON supplier_opening_balances
        WHEN NOT EXISTS(SELECT 1 FROM store_context c JOIN stores s ON s.id=c.current_store_id WHERE c.id=1 AND s.id=NEW.store_id AND s.status='ACTIVE')
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CURRENT_STORE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_credit_store BEFORE INSERT ON supplier_credit_notes
        WHEN NOT EXISTS(SELECT 1 FROM store_context c JOIN stores s ON s.id=c.current_store_id WHERE c.id=1 AND s.id=NEW.store_id AND s.status='ACTIVE')
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CURRENT_STORE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_components_valid BEFORE INSERT ON supplier_invoices
        WHEN NEW.discount_paise>NEW.taxable_paise OR NEW.invoice_total_paise<>NEW.taxable_paise-NEW.discount_paise+NEW.cgst_paise+NEW.sgst_paise+NEW.igst_paise+NEW.other_charges_paise+NEW.rounding_adjustment_paise
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_COMPONENTS_INVALID'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_new_components_immutable BEFORE UPDATE OF discount_paise,rounding_adjustment_paise ON supplier_invoices
        WHEN OLD.status='POSTED' AND (NEW.discount_paise<>OLD.discount_paise OR NEW.rounding_adjustment_paise<>OLD.rounding_adjustment_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_allocations_valid_v11 BEFORE INSERT ON supplier_payment_allocations
        WHEN NOT EXISTS(SELECT 1 FROM supplier_payments p JOIN supplier_invoices i ON i.id=NEW.invoice_id
            WHERE p.id=NEW.payment_id AND p.supplier_id=i.supplier_id AND p.status='POSTING' AND i.status='POSTED'
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_allocations WHERE payment_id=p.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_opening_allocations WHERE payment_id=p.id)+NEW.amount_paise<=p.amount_paise
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_allocations WHERE invoice_id=i.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_invoice_allocations WHERE invoice_id=i.id)+NEW.amount_paise<=i.invoice_total_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_ALLOCATION_INVALID'); END`);
    await run(db, "DROP TRIGGER trg_supplier_allocation_valid");
    await run(db, `CREATE TRIGGER trg_supplier_payment_opening_allocation_valid BEFORE INSERT ON supplier_payment_opening_allocations
        WHEN NOT EXISTS(SELECT 1 FROM supplier_payments p JOIN supplier_opening_balances o ON o.id=NEW.opening_balance_id
            WHERE p.id=NEW.payment_id AND p.supplier_id=o.supplier_id AND p.status='POSTING' AND o.status='POSTED'
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_allocations WHERE payment_id=p.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_opening_allocations WHERE payment_id=p.id)+NEW.amount_paise<=p.amount_paise
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_opening_allocations WHERE opening_balance_id=o.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_opening_allocations WHERE opening_balance_id=o.id)+NEW.amount_paise<=o.amount_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_OPENING_ALLOCATION_INVALID'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_credit_invoice_allocation_valid BEFORE INSERT ON supplier_credit_note_invoice_allocations
        WHEN NOT EXISTS(SELECT 1 FROM supplier_credit_notes c JOIN supplier_invoices i ON i.id=NEW.invoice_id
            WHERE c.id=NEW.credit_note_id AND c.supplier_id=i.supplier_id AND c.status='POSTING' AND i.status='POSTED'
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_invoice_allocations WHERE credit_note_id=c.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_opening_allocations WHERE credit_note_id=c.id)+NEW.amount_paise<=c.amount_paise
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_allocations WHERE invoice_id=i.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_invoice_allocations WHERE invoice_id=i.id)+NEW.amount_paise<=i.invoice_total_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CREDIT_ALLOCATION_INVALID'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_credit_opening_allocation_valid BEFORE INSERT ON supplier_credit_note_opening_allocations
        WHEN NOT EXISTS(SELECT 1 FROM supplier_credit_notes c JOIN supplier_opening_balances o ON o.id=NEW.opening_balance_id
            WHERE c.id=NEW.credit_note_id AND c.supplier_id=o.supplier_id AND c.status='POSTING' AND o.status='POSTED'
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_invoice_allocations WHERE credit_note_id=c.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_opening_allocations WHERE credit_note_id=c.id)+NEW.amount_paise<=c.amount_paise
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_opening_allocations WHERE opening_balance_id=o.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_opening_allocations WHERE opening_balance_id=o.id)+NEW.amount_paise<=o.amount_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CREDIT_ALLOCATION_INVALID'); END`);

    await run(db, "DROP TRIGGER trg_supplier_payment_post_transition");
    await run(db, `CREATE TRIGGER trg_supplier_payment_post_transition BEFORE UPDATE ON supplier_payments
        WHEN NOT (OLD.status='POSTING' AND NEW.status='POSTED' AND NEW.id=OLD.id AND NEW.payment_code=OLD.payment_code
          AND NEW.store_id=OLD.store_id AND NEW.supplier_id=OLD.supplier_id AND NEW.supplier_code_snapshot=OLD.supplier_code_snapshot
          AND NEW.supplier_name_snapshot=OLD.supplier_name_snapshot AND NEW.payment_date=OLD.payment_date AND NEW.posting_date=OLD.posting_date
          AND NEW.amount_paise=OLD.amount_paise AND NEW.payment_mode=OLD.payment_mode AND NEW.reference IS OLD.reference
          AND NEW.remarks IS OLD.remarks AND NEW.created_at=OLD.created_at AND NEW.posted_at=OLD.posted_at
          AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_allocations WHERE payment_id=OLD.id)
            +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_opening_allocations WHERE payment_id=OLD.id)=OLD.amount_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_PAYMENT_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_opening_post_transition BEFORE UPDATE ON supplier_opening_balances
        WHEN NOT (OLD.status='POSTING' AND NEW.status='POSTED' AND NEW.id=OLD.id AND NEW.opening_code=OLD.opening_code
          AND NEW.store_id=OLD.store_id AND NEW.supplier_id=OLD.supplier_id AND NEW.supplier_code_snapshot=OLD.supplier_code_snapshot
          AND NEW.supplier_name_snapshot=OLD.supplier_name_snapshot AND NEW.as_on_date=OLD.as_on_date AND NEW.reference IS OLD.reference
          AND NEW.amount_paise=OLD.amount_paise AND NEW.due_date IS OLD.due_date AND NEW.remarks IS OLD.remarks
          AND NEW.created_at=OLD.created_at AND NEW.posted_at=OLD.posted_at)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_OPENING_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_credit_post_transition BEFORE UPDATE ON supplier_credit_notes
        WHEN NOT (OLD.status='POSTING' AND NEW.status='POSTED' AND NEW.id=OLD.id AND NEW.credit_note_code=OLD.credit_note_code
          AND NEW.store_id=OLD.store_id AND NEW.supplier_id=OLD.supplier_id AND NEW.supplier_code_snapshot=OLD.supplier_code_snapshot
          AND NEW.supplier_name_snapshot=OLD.supplier_name_snapshot AND NEW.external_number IS OLD.external_number
          AND NEW.external_number_normalized IS OLD.external_number_normalized AND NEW.credit_note_date=OLD.credit_note_date
          AND NEW.posting_date=OLD.posting_date AND NEW.amount_paise=OLD.amount_paise AND NEW.reason=OLD.reason
          AND NEW.reference_invoice_id IS OLD.reference_invoice_id AND NEW.reference IS OLD.reference AND NEW.remarks IS OLD.remarks
          AND NEW.created_at=OLD.created_at AND NEW.posted_at=OLD.posted_at
          AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_invoice_allocations WHERE credit_note_id=OLD.id)
            +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_opening_allocations WHERE credit_note_id=OLD.id)=OLD.amount_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CREDIT_NOTE_IMMUTABLE'); END`);
    for (const [table, trigger, identity] of [
        ["supplier_opening_balances","trg_supplier_opening_no_delete","OPENING"],
        ["supplier_credit_notes","trg_supplier_credit_note_no_delete","CREDIT_NOTE"],
        ["supplier_payment_opening_allocations","trg_supplier_payment_opening_alloc_immutable","OPENING_ALLOCATION"],
        ["supplier_credit_note_invoice_allocations","trg_supplier_credit_invoice_alloc_immutable","CREDIT_ALLOCATION"],
        ["supplier_credit_note_opening_allocations","trg_supplier_credit_opening_alloc_immutable","CREDIT_ALLOCATION"]
    ]) {
        const updateGuard=table==="supplier_opening_balances"||table==="supplier_credit_notes"?" WHEN OLD.status='POSTED'":"";
        await run(db, `CREATE TRIGGER ${trigger}_update BEFORE UPDATE ON ${table}${updateGuard} BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_${identity}_IMMUTABLE'); END`);
        await run(db, `CREATE TRIGGER ${trigger}_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_${identity}_DELETE_PROHIBITED'); END`);
    }
    await run(db, `CREATE TRIGGER trg_supplier_opening_immutable_delete BEFORE DELETE ON supplier_opening_balances
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_OPENING_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_credit_note_immutable_delete BEFORE DELETE ON supplier_credit_notes
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CREDIT_NOTE_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_credit_invoice_alloc_posting_only BEFORE INSERT ON supplier_credit_note_invoice_allocations
        WHEN NOT EXISTS(SELECT 1 FROM supplier_credit_notes WHERE id=NEW.credit_note_id AND status='POSTING')
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CREDIT_POSTING_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_credit_opening_alloc_posting_only BEFORE INSERT ON supplier_credit_note_opening_allocations
        WHEN NOT EXISTS(SELECT 1 FROM supplier_credit_notes WHERE id=NEW.credit_note_id AND status='POSTING')
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CREDIT_POSTING_REQUIRED'); END`);
}

module.exports = { migrateSupplierSubledger };
