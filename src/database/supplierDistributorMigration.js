"use strict";

function run(db, sql) {
    return new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
}

async function migrateSupplierDistributor(db) {
    const table = await new Promise((resolve, reject) => db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stores'", [],
        (error, row) => error ? reject(error) : resolve(row || null)));
    if (!table) throw new Error("V10 Supplier migration requires Store Identity tables.");
    await run(db, `CREATE TABLE supplier_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_code TEXT NOT NULL UNIQUE CHECK(length(supplier_code)=11 AND supplier_code GLOB 'KLSUP[0-9][0-9][0-9][0-9][0-9][0-9]'),
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200), legal_name TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
        supplier_type TEXT NOT NULL CHECK(supplier_type IN ('DISTRIBUTOR','COMPANY','WHOLESALER','OTHER')),
        contact_person TEXT, mobile TEXT, alternate_mobile TEXT, email TEXT, gstin TEXT, pan TEXT,
        address_line_1 TEXT, address_line_2 TEXT, city TEXT, district TEXT, state TEXT, pin_code TEXT,
        default_credit_period_days INTEGER NOT NULL DEFAULT 0 CHECK(default_credit_period_days BETWEEN 0 AND 3650),
        notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    await run(db, `CREATE TABLE supplier_sequences (
        id INTEGER PRIMARY KEY CHECK(id=1), next_supplier_sequence INTEGER NOT NULL CHECK(next_supplier_sequence BETWEEN 1 AND 1000000),
        next_invoice_sequence INTEGER NOT NULL CHECK(next_invoice_sequence BETWEEN 1 AND 1000000),
        next_payment_sequence INTEGER NOT NULL CHECK(next_payment_sequence BETWEEN 1 AND 1000000)
    )`);
    await run(db, "INSERT INTO supplier_sequences VALUES (1,1,1,1)");
    await run(db, `CREATE TABLE supplier_brands (
        supplier_id INTEGER NOT NULL REFERENCES supplier_master(id), brand TEXT NOT NULL CHECK(length(trim(brand)) BETWEEN 1 AND 100),
        PRIMARY KEY(supplier_id,brand))`);
    await run(db, `CREATE TABLE supplier_product_segments (
        supplier_id INTEGER NOT NULL REFERENCES supplier_master(id), product_segment TEXT NOT NULL CHECK(length(trim(product_segment)) BETWEEN 1 AND 100),
        PRIMARY KEY(supplier_id,product_segment))`);
    await run(db, `CREATE TABLE supplier_business_segments (
        supplier_id INTEGER NOT NULL REFERENCES supplier_master(id), business_segment TEXT NOT NULL CHECK(business_segment IN ('KL','MENS','KIDS')),
        PRIMARY KEY(supplier_id,business_segment))`);
    await run(db, `CREATE TABLE supplier_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_code TEXT NOT NULL UNIQUE CHECK(length(invoice_code)=12 AND invoice_code GLOB 'KLSINV[0-9][0-9][0-9][0-9][0-9][0-9]'),
        store_id INTEGER NOT NULL REFERENCES stores(id), supplier_id INTEGER NOT NULL REFERENCES supplier_master(id),
        supplier_code_snapshot TEXT NOT NULL, supplier_name_snapshot TEXT NOT NULL, legal_name_snapshot TEXT, gstin_snapshot TEXT,
        supplier_invoice_number TEXT NOT NULL, supplier_invoice_number_normalized TEXT NOT NULL,
        supplier_invoice_date TEXT NOT NULL, posting_date TEXT NOT NULL,
        business_segment TEXT NOT NULL CHECK(business_segment IN ('KL','MENS','KIDS')),
        taxable_paise INTEGER NOT NULL CHECK(typeof(taxable_paise)='integer' AND taxable_paise>=0),
        cgst_paise INTEGER NOT NULL CHECK(typeof(cgst_paise)='integer' AND cgst_paise>=0),
        sgst_paise INTEGER NOT NULL CHECK(typeof(sgst_paise)='integer' AND sgst_paise>=0),
        igst_paise INTEGER NOT NULL CHECK(typeof(igst_paise)='integer' AND igst_paise>=0),
        other_charges_paise INTEGER NOT NULL DEFAULT 0 CHECK(typeof(other_charges_paise)='integer' AND other_charges_paise>=0),
        invoice_total_paise INTEGER NOT NULL CHECK(typeof(invoice_total_paise)='integer' AND invoice_total_paise>0),
        due_date TEXT NOT NULL, reference TEXT, notes TEXT, status TEXT NOT NULL CHECK(status IN ('POSTING','POSTED')),
        created_at TEXT NOT NULL, posted_at TEXT NOT NULL,
        UNIQUE(supplier_id,supplier_invoice_number_normalized)
    )`);
    await run(db, `CREATE TABLE supplier_invoice_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES supplier_invoices(id), line_number INTEGER NOT NULL CHECK(line_number>0),
        product_id INTEGER REFERENCES products(id), barcode_snapshot TEXT, sku_snapshot TEXT,
        description_snapshot TEXT NOT NULL CHECK(length(trim(description_snapshot))>0), brand_snapshot TEXT, product_segment_snapshot TEXT,
        business_segment TEXT NOT NULL CHECK(business_segment IN ('KL','MENS','KIDS')),
        quantity_milli INTEGER NOT NULL CHECK(typeof(quantity_milli)='integer' AND quantity_milli>0),
        unit_cost_paise INTEGER NOT NULL CHECK(typeof(unit_cost_paise)='integer' AND unit_cost_paise>=0),
        taxable_paise INTEGER NOT NULL CHECK(typeof(taxable_paise)='integer' AND taxable_paise>=0),
        cgst_paise INTEGER NOT NULL DEFAULT 0 CHECK(typeof(cgst_paise)='integer' AND cgst_paise>=0),
        sgst_paise INTEGER NOT NULL DEFAULT 0 CHECK(typeof(sgst_paise)='integer' AND sgst_paise>=0),
        igst_paise INTEGER NOT NULL DEFAULT 0 CHECK(typeof(igst_paise)='integer' AND igst_paise>=0),
        line_total_paise INTEGER NOT NULL CHECK(typeof(line_total_paise)='integer' AND line_total_paise>=0),
        cost_provenance_status TEXT NOT NULL DEFAULT 'SUPPLIER_INVOICE' CHECK(cost_provenance_status IN ('SUPPLIER_INVOICE','PENDING_MATCH')),
        UNIQUE(invoice_id,line_number)
    )`);
    await run(db, `CREATE TABLE supplier_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_code TEXT NOT NULL UNIQUE CHECK(length(payment_code)=12 AND payment_code GLOB 'KLSPAY[0-9][0-9][0-9][0-9][0-9][0-9]'),
        store_id INTEGER NOT NULL REFERENCES stores(id), supplier_id INTEGER NOT NULL REFERENCES supplier_master(id),
        supplier_code_snapshot TEXT NOT NULL, supplier_name_snapshot TEXT NOT NULL,
        payment_date TEXT NOT NULL, posting_date TEXT NOT NULL,
        amount_paise INTEGER NOT NULL CHECK(typeof(amount_paise)='integer' AND amount_paise>0),
        payment_mode TEXT NOT NULL CHECK(payment_mode IN ('Cash','UPI','Card','Bank Transfer','Other')),
        reference TEXT, remarks TEXT, status TEXT NOT NULL CHECK(status IN ('POSTING','POSTED')), created_at TEXT NOT NULL, posted_at TEXT NOT NULL
    )`);
    await run(db, `CREATE TABLE supplier_payment_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER NOT NULL REFERENCES supplier_payments(id),
        invoice_id INTEGER NOT NULL REFERENCES supplier_invoices(id),
        amount_paise INTEGER NOT NULL CHECK(typeof(amount_paise)='integer' AND amount_paise>0), UNIQUE(payment_id,invoice_id)
    )`);
    await run(db, `CREATE TABLE supplier_cost_provenance_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_item_id INTEGER NOT NULL UNIQUE REFERENCES bill_items(id),
        supplier_invoice_line_id INTEGER NOT NULL REFERENCES supplier_invoice_lines(id),
        linked_at TEXT NOT NULL,
        linked_by TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'MANUAL_REVIEW' CHECK(source IN ('MANUAL_REVIEW','FUTURE_RECEIVING_MATCH'))
    )`);
    await run(db, "CREATE INDEX idx_supplier_master_directory ON supplier_master(status,name,supplier_code)");
    await run(db, "CREATE INDEX idx_supplier_invoices_account ON supplier_invoices(store_id,supplier_id,posting_date,invoice_code)");
    await run(db, "CREATE INDEX idx_supplier_payments_account ON supplier_payments(store_id,supplier_id,payment_date,payment_code)");
    await run(db, `CREATE TRIGGER trg_supplier_sequences_monotonic BEFORE UPDATE ON supplier_sequences
        WHEN NEW.id<>OLD.id OR NEW.next_supplier_sequence<OLD.next_supplier_sequence
          OR NEW.next_invoice_sequence<OLD.next_invoice_sequence OR NEW.next_payment_sequence<OLD.next_payment_sequence
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_SEQUENCE_CANNOT_REWIND'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_sequences_no_delete BEFORE DELETE ON supplier_sequences
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_SEQUENCE_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_code_from_sequence BEFORE INSERT ON supplier_master
        WHEN NOT EXISTS(SELECT 1 FROM supplier_sequences WHERE id=1 AND next_supplier_sequence>1 AND CAST(SUBSTR(NEW.supplier_code,6) AS INTEGER)=next_supplier_sequence-1)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_ID_SEQUENCE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_code_from_sequence BEFORE INSERT ON supplier_invoices
        WHEN NOT EXISTS(SELECT 1 FROM supplier_sequences WHERE id=1 AND next_invoice_sequence>1 AND CAST(SUBSTR(NEW.invoice_code,7) AS INTEGER)=next_invoice_sequence-1)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_SEQUENCE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_payment_code_from_sequence BEFORE INSERT ON supplier_payments
        WHEN NOT EXISTS(SELECT 1 FROM supplier_sequences WHERE id=1 AND next_payment_sequence>1 AND CAST(SUBSTR(NEW.payment_code,7) AS INTEGER)=next_payment_sequence-1)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_PAYMENT_SEQUENCE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_current_store BEFORE INSERT ON supplier_invoices
        WHEN NOT EXISTS(SELECT 1 FROM store_context c JOIN stores s ON s.id=c.current_store_id WHERE c.id=1 AND s.id=NEW.store_id AND s.status='ACTIVE')
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CURRENT_STORE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_payment_current_store BEFORE INSERT ON supplier_payments
        WHEN NOT EXISTS(SELECT 1 FROM store_context c JOIN stores s ON s.id=c.current_store_id WHERE c.id=1 AND s.id=NEW.store_id AND s.status='ACTIVE')
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CURRENT_STORE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_financial_fact_prevent_delete BEFORE DELETE ON supplier_master
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_ID_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_allocation_valid BEFORE INSERT ON supplier_payment_allocations
        WHEN NOT EXISTS(SELECT 1 FROM supplier_payments p JOIN supplier_invoices i ON i.id=NEW.invoice_id
            WHERE p.id=NEW.payment_id AND p.supplier_id=i.supplier_id AND p.status='POSTING' AND i.status='POSTED'
              AND COALESCE((SELECT SUM(amount_paise) FROM supplier_payment_allocations WHERE payment_id=p.id),0)+NEW.amount_paise<=p.amount_paise
              AND COALESCE((SELECT SUM(amount_paise) FROM supplier_payment_allocations WHERE invoice_id=i.id),0)+NEW.amount_paise<=i.invoice_total_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_ALLOCATION_INVALID'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_profile_code_immutable BEFORE UPDATE OF supplier_code ON supplier_master
        WHEN NEW.supplier_code<>OLD.supplier_code BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_CODE_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_post_transition BEFORE UPDATE ON supplier_invoices
        WHEN NOT (OLD.status='POSTING' AND NEW.status='POSTED' AND NEW.id=OLD.id
          AND NEW.invoice_code=OLD.invoice_code AND NEW.store_id=OLD.store_id AND NEW.supplier_id=OLD.supplier_id
          AND NEW.supplier_code_snapshot=OLD.supplier_code_snapshot AND NEW.supplier_name_snapshot=OLD.supplier_name_snapshot
          AND NEW.legal_name_snapshot IS OLD.legal_name_snapshot AND NEW.gstin_snapshot IS OLD.gstin_snapshot
          AND NEW.supplier_invoice_number=OLD.supplier_invoice_number AND NEW.supplier_invoice_number_normalized=OLD.supplier_invoice_number_normalized
          AND NEW.supplier_invoice_date=OLD.supplier_invoice_date AND NEW.posting_date=OLD.posting_date
          AND NEW.business_segment=OLD.business_segment AND NEW.taxable_paise=OLD.taxable_paise
          AND NEW.cgst_paise=OLD.cgst_paise AND NEW.sgst_paise=OLD.sgst_paise AND NEW.igst_paise=OLD.igst_paise
          AND NEW.other_charges_paise=OLD.other_charges_paise AND NEW.invoice_total_paise=OLD.invoice_total_paise
          AND NEW.due_date=OLD.due_date AND NEW.reference IS OLD.reference AND NEW.notes IS OLD.notes
          AND NEW.created_at=OLD.created_at AND NEW.posted_at=OLD.posted_at
          AND EXISTS(SELECT 1 FROM supplier_invoice_lines WHERE invoice_id=OLD.id))
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_immutable_delete BEFORE DELETE ON supplier_invoices
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_payment_post_transition BEFORE UPDATE ON supplier_payments
        WHEN NOT (OLD.status='POSTING' AND NEW.status='POSTED' AND NEW.id=OLD.id
          AND NEW.payment_code=OLD.payment_code AND NEW.store_id=OLD.store_id AND NEW.supplier_id=OLD.supplier_id
          AND NEW.supplier_code_snapshot=OLD.supplier_code_snapshot AND NEW.supplier_name_snapshot=OLD.supplier_name_snapshot
          AND NEW.payment_date=OLD.payment_date AND NEW.posting_date=OLD.posting_date
          AND NEW.amount_paise=OLD.amount_paise AND NEW.payment_mode=OLD.payment_mode
          AND NEW.reference IS OLD.reference AND NEW.remarks IS OLD.remarks
          AND NEW.created_at=OLD.created_at AND NEW.posted_at=OLD.posted_at
          AND COALESCE((SELECT SUM(amount_paise) FROM supplier_payment_allocations WHERE payment_id=OLD.id),0)=OLD.amount_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_PAYMENT_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_payment_immutable_delete BEFORE DELETE ON supplier_payments
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_PAYMENT_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_line_immutable_update BEFORE UPDATE ON supplier_invoice_lines
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_LINE_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_lines_only_during_posting BEFORE INSERT ON supplier_invoice_lines
        WHEN NOT EXISTS(SELECT 1 FROM supplier_invoices WHERE id=NEW.invoice_id AND status='POSTING')
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_LINE_POSTING_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_invoice_line_immutable_delete BEFORE DELETE ON supplier_invoice_lines
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_INVOICE_LINE_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_allocation_immutable_update BEFORE UPDATE ON supplier_payment_allocations
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_ALLOCATION_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_allocation_immutable_delete BEFORE DELETE ON supplier_payment_allocations
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_ALLOCATION_DELETE_PROHIBITED'); END`);
}

module.exports = { migrateSupplierDistributor };
