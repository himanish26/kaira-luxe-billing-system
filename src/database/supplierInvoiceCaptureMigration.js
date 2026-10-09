"use strict";

function run(db, sql) {
    return new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
}
function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function migrateSupplierInvoiceCapture(db) {
    const columns = await all(db, "PRAGMA table_info(supplier_invoices)");
    if (!columns.length) throw new Error("V13 Supplier invoice capture migration requires the V10 Supplier invoice table.");
    if (columns.some(column => column.name === "capture_mode")) throw new Error("V13 Supplier invoice capture fields already exist; refusing to rebuild the invoice table.");

    // The numbered migration runner disables FK enforcement before opening
    // this transaction. The runner checks every FK before committing after
    // the replacement table has its canonical name again.
    await run(db, `CREATE TABLE supplier_invoices_v13 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_code TEXT NOT NULL UNIQUE CHECK(length(invoice_code)=12 AND invoice_code GLOB 'KLSINV[0-9][0-9][0-9][0-9][0-9][0-9]'),
        store_id INTEGER NOT NULL REFERENCES stores(id), supplier_id INTEGER NOT NULL REFERENCES supplier_master(id),
        supplier_code_snapshot TEXT NOT NULL, supplier_name_snapshot TEXT NOT NULL, legal_name_snapshot TEXT, gstin_snapshot TEXT,
        supplier_invoice_number TEXT NOT NULL, supplier_invoice_number_normalized TEXT NOT NULL,
        supplier_invoice_date TEXT NOT NULL, posting_date TEXT NOT NULL,
        business_segment TEXT NOT NULL CHECK(business_segment IN ('KL','MENS','KIDS')),
        capture_mode TEXT NOT NULL CHECK(capture_mode IN ('DETAILED','SUMMARY')),
        total_quantity INTEGER CHECK(total_quantity IS NULL OR (typeof(total_quantity)='integer' AND total_quantity>0)),
        taxable_paise INTEGER CHECK(taxable_paise IS NULL OR (typeof(taxable_paise)='integer' AND taxable_paise>=0)),
        discount_paise INTEGER CHECK(discount_paise IS NULL OR (typeof(discount_paise)='integer' AND discount_paise>=0)),
        cgst_paise INTEGER CHECK(cgst_paise IS NULL OR (typeof(cgst_paise)='integer' AND cgst_paise>=0)),
        sgst_paise INTEGER CHECK(sgst_paise IS NULL OR (typeof(sgst_paise)='integer' AND sgst_paise>=0)),
        igst_paise INTEGER CHECK(igst_paise IS NULL OR (typeof(igst_paise)='integer' AND igst_paise>=0)),
        other_charges_paise INTEGER CHECK(other_charges_paise IS NULL OR (typeof(other_charges_paise)='integer' AND other_charges_paise>=0)),
        rounding_adjustment_paise INTEGER CHECK(rounding_adjustment_paise IS NULL OR (typeof(rounding_adjustment_paise)='integer' AND rounding_adjustment_paise BETWEEN -500 AND 500)),
        invoice_total_paise INTEGER NOT NULL CHECK(typeof(invoice_total_paise)='integer' AND invoice_total_paise>0),
        due_date TEXT NOT NULL, reference TEXT, notes TEXT, status TEXT NOT NULL CHECK(status IN ('POSTING','POSTED')),
        created_at TEXT NOT NULL, posted_at TEXT NOT NULL,
        UNIQUE(supplier_id,supplier_invoice_number_normalized),
        CHECK((capture_mode='DETAILED' AND taxable_paise IS NOT NULL AND discount_paise IS NOT NULL
            AND cgst_paise IS NOT NULL AND sgst_paise IS NOT NULL AND igst_paise IS NOT NULL
            AND other_charges_paise IS NOT NULL AND rounding_adjustment_paise IS NOT NULL
            AND invoice_total_paise=taxable_paise-discount_paise+cgst_paise+sgst_paise+igst_paise+other_charges_paise+rounding_adjustment_paise)
          OR (capture_mode='SUMMARY' AND total_quantity IS NOT NULL
            AND taxable_paise IS NULL AND discount_paise IS NULL AND cgst_paise IS NULL
            AND sgst_paise IS NULL AND igst_paise IS NULL AND other_charges_paise IS NULL
            AND rounding_adjustment_paise IS NULL))
    )`);

    await run(db, `INSERT INTO supplier_invoices_v13(
        id,invoice_code,store_id,supplier_id,supplier_code_snapshot,supplier_name_snapshot,legal_name_snapshot,gstin_snapshot,
        supplier_invoice_number,supplier_invoice_number_normalized,supplier_invoice_date,posting_date,business_segment,
        capture_mode,total_quantity,taxable_paise,discount_paise,cgst_paise,sgst_paise,igst_paise,other_charges_paise,
        rounding_adjustment_paise,invoice_total_paise,due_date,reference,notes,status,created_at,posted_at)
      SELECT i.id,i.invoice_code,i.store_id,i.supplier_id,i.supplier_code_snapshot,i.supplier_name_snapshot,i.legal_name_snapshot,i.gstin_snapshot,
        i.supplier_invoice_number,i.supplier_invoice_number_normalized,i.supplier_invoice_date,i.posting_date,i.business_segment,
        'DETAILED',CASE WHEN COALESCE(q.total_milli,0)>0 AND q.total_milli%1000=0 THEN q.total_milli/1000 ELSE NULL END,
        i.taxable_paise,i.discount_paise,i.cgst_paise,i.sgst_paise,i.igst_paise,i.other_charges_paise,i.rounding_adjustment_paise,
        i.invoice_total_paise,i.due_date,i.reference,i.notes,i.status,i.created_at,i.posted_at
      FROM supplier_invoices i LEFT JOIN (
        SELECT invoice_id,SUM(quantity_milli) AS total_milli FROM supplier_invoice_lines GROUP BY invoice_id
      ) q ON q.invoice_id=i.id`);

    await run(db, "DROP TRIGGER IF EXISTS trg_supplier_invoice_lines_only_during_posting");
    await run(db, "DROP TRIGGER IF EXISTS trg_supplier_invoice_allocations_valid_v11");
    await run(db, "DROP TRIGGER IF EXISTS trg_supplier_credit_invoice_allocation_valid");
    await run(db, "DROP TABLE supplier_invoices");
    await run(db, "ALTER TABLE supplier_invoices_v13 RENAME TO supplier_invoices");

    await run(db, "CREATE INDEX idx_supplier_invoices_account ON supplier_invoices(store_id,supplier_id,posting_date,invoice_code)");
    await run(db, `CREATE TRIGGER trg_supplier_invoice_code_from_sequence BEFORE INSERT ON supplier_invoices
        WHEN NOT EXISTS(SELECT 1 FROM supplier_sequences WHERE id=1 AND next_invoice_sequence>1 AND CAST(SUBSTR(NEW.invoice_code,7) AS INTEGER)=next_invoice_sequence-1)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_SEQUENCE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_current_store BEFORE INSERT ON supplier_invoices
        WHEN NOT EXISTS(SELECT 1 FROM store_context c JOIN stores s ON s.id=c.current_store_id WHERE c.id=1 AND s.id=NEW.store_id AND s.status='ACTIVE')
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CURRENT_STORE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_components_valid BEFORE INSERT ON supplier_invoices
        WHEN (NEW.capture_mode='DETAILED' AND (NEW.discount_paise>NEW.taxable_paise OR NEW.invoice_total_paise<>NEW.taxable_paise-NEW.discount_paise+NEW.cgst_paise+NEW.sgst_paise+NEW.igst_paise+NEW.other_charges_paise+NEW.rounding_adjustment_paise))
          OR (NEW.capture_mode='SUMMARY' AND (NEW.total_quantity IS NULL OR NEW.taxable_paise IS NOT NULL OR NEW.discount_paise IS NOT NULL OR NEW.cgst_paise IS NOT NULL OR NEW.sgst_paise IS NOT NULL OR NEW.igst_paise IS NOT NULL OR NEW.other_charges_paise IS NOT NULL OR NEW.rounding_adjustment_paise IS NOT NULL))
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_COMPONENTS_INVALID'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_new_components_immutable BEFORE UPDATE OF discount_paise,rounding_adjustment_paise ON supplier_invoices
        WHEN OLD.status='POSTED' AND (NEW.discount_paise IS NOT OLD.discount_paise OR NEW.rounding_adjustment_paise IS NOT OLD.rounding_adjustment_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_IMMUTABLE'); END`);
    await run(db, "DROP TRIGGER IF EXISTS trg_supplier_invoice_post_transition");
    await run(db, `CREATE TRIGGER trg_supplier_invoice_post_transition BEFORE UPDATE ON supplier_invoices
        WHEN NOT (OLD.status='POSTING' AND NEW.status='POSTED' AND NEW.id=OLD.id
          AND NEW.invoice_code=OLD.invoice_code AND NEW.store_id=OLD.store_id AND NEW.supplier_id=OLD.supplier_id
          AND NEW.supplier_code_snapshot=OLD.supplier_code_snapshot AND NEW.supplier_name_snapshot=OLD.supplier_name_snapshot
          AND NEW.legal_name_snapshot IS OLD.legal_name_snapshot AND NEW.gstin_snapshot IS OLD.gstin_snapshot
          AND NEW.supplier_invoice_number=OLD.supplier_invoice_number AND NEW.supplier_invoice_number_normalized=OLD.supplier_invoice_number_normalized
          AND NEW.supplier_invoice_date=OLD.supplier_invoice_date AND NEW.posting_date=OLD.posting_date
          AND NEW.business_segment=OLD.business_segment AND NEW.capture_mode=OLD.capture_mode AND NEW.total_quantity IS OLD.total_quantity
          AND NEW.taxable_paise IS OLD.taxable_paise AND NEW.discount_paise IS OLD.discount_paise
          AND NEW.cgst_paise IS OLD.cgst_paise AND NEW.sgst_paise IS OLD.sgst_paise AND NEW.igst_paise IS OLD.igst_paise
          AND NEW.other_charges_paise IS OLD.other_charges_paise AND NEW.rounding_adjustment_paise IS OLD.rounding_adjustment_paise
          AND NEW.invoice_total_paise=OLD.invoice_total_paise AND NEW.due_date=OLD.due_date
          AND NEW.reference IS OLD.reference AND NEW.notes IS OLD.notes AND NEW.created_at=OLD.created_at AND NEW.posted_at=OLD.posted_at
          AND ((OLD.capture_mode='DETAILED' AND EXISTS(SELECT 1 FROM supplier_invoice_lines WHERE invoice_id=OLD.id))
            OR (OLD.capture_mode='SUMMARY' AND NOT EXISTS(SELECT 1 FROM supplier_invoice_lines WHERE invoice_id=OLD.id))))
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_immutable_delete BEFORE DELETE ON supplier_invoices
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_DELETE_PROHIBITED'); END`);
    await run(db, "DROP TRIGGER IF EXISTS trg_supplier_invoice_lines_only_during_posting");
    await run(db, `CREATE TRIGGER trg_supplier_invoice_lines_only_during_posting BEFORE INSERT ON supplier_invoice_lines
        WHEN NOT EXISTS(SELECT 1 FROM supplier_invoices WHERE id=NEW.invoice_id AND status='POSTING' AND capture_mode='DETAILED')
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_LINE_POSTING_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_allocations_valid_v11 BEFORE INSERT ON supplier_payment_allocations
        WHEN NOT EXISTS(SELECT 1 FROM supplier_payments p JOIN supplier_invoices i ON i.id=NEW.invoice_id
            WHERE p.id=NEW.payment_id AND p.supplier_id=i.supplier_id AND p.status='POSTING' AND i.status='POSTED'
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_allocations WHERE payment_id=p.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_opening_allocations WHERE payment_id=p.id)+NEW.amount_paise<=p.amount_paise
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_allocations WHERE invoice_id=i.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_invoice_allocations WHERE invoice_id=i.id)+NEW.amount_paise<=i.invoice_total_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_ALLOCATION_INVALID'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_credit_invoice_allocation_valid BEFORE INSERT ON supplier_credit_note_invoice_allocations
        WHEN NOT EXISTS(SELECT 1 FROM supplier_credit_notes c JOIN supplier_invoices i ON i.id=NEW.invoice_id
            WHERE c.id=NEW.credit_note_id AND c.supplier_id=i.supplier_id AND c.status='POSTING' AND i.status='POSTED'
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_invoice_allocations WHERE credit_note_id=c.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_opening_allocations WHERE credit_note_id=c.id)+NEW.amount_paise<=c.amount_paise
              AND (SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payment_allocations WHERE invoice_id=i.id)
                +(SELECT COALESCE(SUM(amount_paise),0) FROM supplier_credit_note_invoice_allocations WHERE invoice_id=i.id)+NEW.amount_paise<=i.invoice_total_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CREDIT_ALLOCATION_INVALID'); END`);

    const verify = await all(db, "PRAGMA table_info(supplier_invoices)");
    if (!verify.some(column => column.name === "capture_mode") || !verify.some(column => column.name === "total_quantity")) {
        throw new Error("V13 Supplier invoice capture schema verification failed.");
    }
    const foreignKeyIssues=await all(db,"PRAGMA foreign_key_check");
    if(foreignKeyIssues.length)throw new Error("V13 Supplier invoice capture migration would break historical foreign keys: "+JSON.stringify(foreignKeyIssues));
}

module.exports = { migrateSupplierInvoiceCapture };
