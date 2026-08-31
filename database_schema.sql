CREATE TABLE products (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    barcode TEXT UNIQUE,

    sku TEXT,

    brand TEXT,

    segment TEXT DEFAULT 'Women',

    category TEXT,

    season TEXT DEFAULT 'All Season',

    collection TEXT DEFAULT '',

    product_name TEXT,

    style_code TEXT,

    size TEXT,

    colour TEXT,

    mrp REAL,

    selling_price REAL,

    cost_price REAL,

    gst_rate REAL,

    hsn_code TEXT,

    opening_stock INTEGER,

    reorder_level INTEGER,

    supplier TEXT,

    active INTEGER DEFAULT 1

);
CREATE TABLE day_closing (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                business_date TEXT NOT NULL UNIQUE,

                closed_at TEXT NOT NULL,

                total_bills INTEGER NOT NULL,

                total_items INTEGER NOT NULL,

                net_sales REAL NOT NULL,

                cash_sales REAL NOT NULL,

                upi_sales REAL NOT NULL,

                card_sales REAL NOT NULL,

                backup_status TEXT NOT NULL DEFAULT 'PENDING',

                email_status TEXT NOT NULL DEFAULT 'PENDING',

                closed_by TEXT NOT NULL DEFAULT 'Administrator',

                remarks TEXT

            );
CREATE TABLE day_closing_snapshots (
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
);
CREATE UNIQUE INDEX idx_day_closing_one_active
ON day_closing_snapshots (business_date)
WHERE close_status IN ('PREPARING', 'CLOSED');
CREATE INDEX idx_day_closing_date_sequence
ON day_closing_snapshots (business_date, close_sequence DESC);
CREATE TABLE payment_corrections (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        bill_no TEXT NOT NULL,

        old_cash REAL NOT NULL,
        old_upi REAL NOT NULL,
        old_card REAL NOT NULL,

        new_cash REAL NOT NULL,
        new_upi REAL NOT NULL,
        new_card REAL NOT NULL,

        remarks TEXT NOT NULL,

        corrected_by TEXT DEFAULT 'Administrator',

        corrected_at TEXT NOT NULL,

        FOREIGN KEY (bill_no)
            REFERENCES bills(bill_no)

    );
CREATE TABLE inventory_transactions (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            product_id INTEGER,

            barcode TEXT,

            transaction_type TEXT NOT NULL,

            quantity INTEGER NOT NULL,

            reference_type TEXT,

            reference_id TEXT,

            supplier_id INTEGER,

            invoice_no TEXT,

            remarks TEXT,

            created_by TEXT DEFAULT 'Administrator',

            created_at TEXT NOT NULL,

            CHECK (
                transaction_type IN (
                    'OPENING',
                    'INWARD',
                    'SALE',
                    'RETURN',
                    'DAMAGE',
                    'ADJUSTMENT',
                    'SUPPLIER_RETURN'
                )
            )

        );
CREATE TABLE inventory_initialization (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            initialization_type TEXT NOT NULL UNIQUE,

            status TEXT NOT NULL,

            initialized_at TEXT,

            initialized_by TEXT,

            remarks TEXT

        );
CREATE TABLE customers (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            customer_code TEXT UNIQUE,

            name TEXT NOT NULL,

            mobile TEXT UNIQUE,

            email TEXT,

            address TEXT,

            remarks TEXT,

            active INTEGER DEFAULT 1,

            created_at TEXT NOT NULL,

            updated_at TEXT NOT NULL

        );
CREATE TABLE returns (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            return_no TEXT UNIQUE NOT NULL,

            credit_note_no TEXT,

            original_bill_no TEXT NOT NULL,

            business_date TEXT,

            original_bill_date TEXT,

            customer_id INTEGER,

            customer_name TEXT NOT NULL,

            customer_mobile TEXT NOT NULL,

            return_reason TEXT NOT NULL,

            remarks TEXT,

            return_amount REAL NOT NULL DEFAULT 0,

            gross_reversal REAL,

            discount_reversal REAL,

            taxable_reversal REAL,

            cgst_reversal REAL,

            sgst_reversal REAL,

            gst_reversal REAL,

            net_reversal REAL,

            accounting_status TEXT NOT NULL DEFAULT 'LEGACY_UNASSESSED'
                CHECK (accounting_status IN ('LEGACY_UNASSESSED', 'COMPLETED')),

            accounting_snapshot_version INTEGER
                CHECK (accounting_snapshot_version IS NULL OR accounting_snapshot_version = 1),

            created_by TEXT DEFAULT 'Administrator',

            created_at TEXT NOT NULL

        );
CREATE TABLE return_items (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            return_id INTEGER NOT NULL,

            product_id INTEGER,

            barcode TEXT,

            product_name TEXT,

            original_bill_item_id INTEGER,

            quantity INTEGER NOT NULL,

            unit_value REAL NOT NULL DEFAULT 0,

            return_value REAL NOT NULL DEFAULT 0,

            mrp REAL,

            gross_reversal REAL,

            discount_percent REAL,

            discount_reversal REAL,

            taxable_reversal REAL,

            gst_rate REAL,

            cgst_reversal REAL,

            sgst_reversal REAL,

            gst_reversal REAL,

            net_reversal REAL,

            remarks TEXT,

            created_at TEXT NOT NULL,

            FOREIGN KEY (return_id)
                REFERENCES returns(id)

        );
CREATE TABLE store_credits (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            store_credit_no TEXT UNIQUE NOT NULL,

            return_id INTEGER NOT NULL,

            original_bill_no TEXT NOT NULL,

            customer_id INTEGER,

            customer_name TEXT NOT NULL,

            customer_mobile TEXT NOT NULL,

            issue_date TEXT NOT NULL,

            valid_until TEXT NOT NULL,

            original_amount REAL NOT NULL DEFAULT 0,

            remaining_balance REAL NOT NULL DEFAULT 0,

            status TEXT NOT NULL DEFAULT 'ISSUED',

            created_by TEXT DEFAULT 'Administrator',

            created_at TEXT NOT NULL,

            CHECK (
                status IN (
                    'ISSUED',
                    'REDEEMED',
                    'EXPIRED'
                )
            ),

            FOREIGN KEY (return_id)
                REFERENCES returns(id)

        );
CREATE TABLE customer_credit_transactions (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            customer_id INTEGER,

            transaction_type TEXT NOT NULL,

            amount REAL NOT NULL,

            reference_type TEXT,

            reference_id TEXT,

            remarks TEXT,

            created_by TEXT DEFAULT 'Administrator',

            created_at TEXT NOT NULL,

            CHECK (
                transaction_type IN (
                    'RETURN_CREDIT',
                    'CREDIT_REDEEMED',
                    'CREDIT_ADJUSTMENT',
                    'CREDIT_REVERSAL'
                )
            )

        );
CREATE TABLE gift_vouchers (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            voucher_code TEXT UNIQUE NOT NULL,

            initial_value REAL NOT NULL,

            expiry_date TEXT,

            status TEXT NOT NULL DEFAULT 'ACTIVE',

            customer_id INTEGER,

            remarks TEXT,

            created_at TEXT NOT NULL

        );
CREATE TABLE gift_voucher_transactions (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            voucher_id INTEGER NOT NULL,

            transaction_type TEXT NOT NULL,

            amount REAL NOT NULL,

            reference_type TEXT,

            reference_id TEXT,

            remarks TEXT,

            created_by TEXT DEFAULT 'Administrator',

            created_at TEXT NOT NULL,

            CHECK (
                transaction_type IN (
                    'VOUCHER_ISSUED',
                    'VOUCHER_REDEEMED',
                    'VOUCHER_ADJUSTMENT',
                    'VOUCHER_REVERSAL',
                    'VOUCHER_VOID'
                )
            ),

            FOREIGN KEY (voucher_id)
                REFERENCES gift_vouchers(id)

        );
CREATE TABLE suppliers (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            supplier_code TEXT UNIQUE,

            supplier_name TEXT NOT NULL,

            contact_person TEXT,

            phone TEXT,

            email TEXT,

            address TEXT,

            gstin TEXT,

            remarks TEXT,

            active INTEGER DEFAULT 1,

            created_at TEXT NOT NULL,

            updated_at TEXT NOT NULL

        );
CREATE INDEX idx_inventory_product
        ON inventory_transactions(product_id)
    ;
CREATE INDEX idx_inventory_barcode
        ON inventory_transactions(barcode)
    ;
CREATE INDEX idx_inventory_type
        ON inventory_transactions(transaction_type)
    ;
CREATE INDEX idx_inventory_created_at
        ON inventory_transactions(created_at)
    ;
CREATE INDEX idx_return_original_bill
        ON returns(original_bill_no)
    ;
CREATE INDEX idx_returns_original_bill_canonical
        ON returns(UPPER(TRIM(original_bill_no)))
    ;
CREATE UNIQUE INDEX idx_returns_credit_note_canonical
        ON returns(UPPER(TRIM(credit_note_no)))
        WHERE credit_note_no IS NOT NULL
    ;
CREATE INDEX idx_returns_accounting_date_status
        ON returns(business_date, accounting_status)
    ;
CREATE TRIGGER trg_returns_one_per_original_bill_insert
BEFORE INSERT ON returns
FOR EACH ROW
BEGIN
    SELECT CASE
        WHEN NEW.original_bill_no IS NULL
          OR TRIM(NEW.original_bill_no) = ''
        THEN RAISE(
            ABORT,
            'KLBS_RETURN_ORIGINAL_BILL_REQUIRED'
        )
    END;

    SELECT CASE
        WHEN EXISTS (
            SELECT 1
            FROM returns
            WHERE UPPER(TRIM(original_bill_no)) =
                  UPPER(TRIM(NEW.original_bill_no))
        )
        THEN RAISE(
            ABORT,
            'KLBS_RETURN_ALREADY_COMPLETED'
        )
    END;
END;
CREATE TRIGGER trg_returns_original_bill_immutable
BEFORE UPDATE OF original_bill_no ON returns
FOR EACH ROW
WHEN UPPER(TRIM(NEW.original_bill_no)) <>
     UPPER(TRIM(OLD.original_bill_no))
BEGIN
    SELECT RAISE(
        ABORT,
        'KLBS_RETURN_ORIGINAL_BILL_IMMUTABLE'
    );
END;
CREATE TRIGGER trg_returns_accounting_insert_valid
BEFORE INSERT ON returns
FOR EACH ROW
WHEN NEW.accounting_status = 'COMPLETED'
BEGIN
    SELECT CASE WHEN
        NEW.accounting_snapshot_version IS NOT 1 OR
        NEW.credit_note_no IS NULL OR
        TRIM(NEW.credit_note_no) NOT GLOB
            'CN[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' OR
        NEW.business_date IS NULL OR
        NEW.original_bill_date IS NULL OR
        NEW.gross_reversal IS NULL OR
        NEW.discount_reversal IS NULL OR
        NEW.taxable_reversal IS NULL OR
        NEW.cgst_reversal IS NULL OR
        NEW.sgst_reversal IS NULL OR
        NEW.gst_reversal IS NULL OR
        NEW.net_reversal IS NULL OR
        NEW.return_amount IS NOT NEW.net_reversal
    THEN RAISE(ABORT, 'KLBS_RETURN_ACCOUNTING_INVALID') END;
END;
CREATE TRIGGER trg_returns_accounting_immutable_update
BEFORE UPDATE ON returns
FOR EACH ROW
WHEN OLD.accounting_status = 'COMPLETED' AND (
    NEW.return_no IS NOT OLD.return_no OR
    NEW.credit_note_no IS NOT OLD.credit_note_no OR
    NEW.original_bill_no IS NOT OLD.original_bill_no OR
    NEW.business_date IS NOT OLD.business_date OR
    NEW.original_bill_date IS NOT OLD.original_bill_date OR
    NEW.return_amount IS NOT OLD.return_amount OR
    NEW.gross_reversal IS NOT OLD.gross_reversal OR
    NEW.discount_reversal IS NOT OLD.discount_reversal OR
    NEW.taxable_reversal IS NOT OLD.taxable_reversal OR
    NEW.cgst_reversal IS NOT OLD.cgst_reversal OR
    NEW.sgst_reversal IS NOT OLD.sgst_reversal OR
    NEW.gst_reversal IS NOT OLD.gst_reversal OR
    NEW.net_reversal IS NOT OLD.net_reversal OR
    NEW.accounting_status IS NOT OLD.accounting_status OR
    NEW.accounting_snapshot_version IS NOT OLD.accounting_snapshot_version OR
    NEW.customer_id IS NOT OLD.customer_id OR
    NEW.customer_name IS NOT OLD.customer_name OR
    NEW.customer_mobile IS NOT OLD.customer_mobile OR
    NEW.return_reason IS NOT OLD.return_reason OR
    NEW.remarks IS NOT OLD.remarks OR
    NEW.created_by IS NOT OLD.created_by OR
    NEW.created_at IS NOT OLD.created_at
)
BEGIN
    SELECT RAISE(ABORT, 'KLBS_RETURN_ACCOUNTING_IMMUTABLE');
END;
CREATE TRIGGER trg_returns_accounting_immutable_delete
BEFORE DELETE ON returns
FOR EACH ROW
WHEN OLD.accounting_status = 'COMPLETED'
BEGIN
    SELECT RAISE(ABORT, 'KLBS_RETURN_ACCOUNTING_IMMUTABLE');
END;
CREATE TRIGGER trg_return_items_accounting_insert_valid
BEFORE INSERT ON return_items
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM returns
    WHERE id = NEW.return_id
      AND accounting_status = 'COMPLETED'
)
BEGIN
    SELECT CASE WHEN
        NEW.original_bill_item_id IS NULL OR
        NEW.product_id IS NULL OR
        NEW.quantity <= 0 OR
        NEW.mrp IS NULL OR
        NEW.gross_reversal IS NULL OR
        NEW.discount_percent IS NULL OR
        NEW.discount_reversal IS NULL OR
        NEW.taxable_reversal IS NULL OR
        NEW.gst_rate IS NULL OR
        NEW.cgst_reversal IS NULL OR
        NEW.sgst_reversal IS NULL OR
        NEW.gst_reversal IS NULL OR
        NEW.net_reversal IS NULL OR
        NEW.unit_value IS NOT NEW.mrp OR
        NEW.return_value IS NOT NEW.net_reversal
    THEN RAISE(ABORT, 'KLBS_RETURN_ACCOUNTING_INVALID') END;
END;
CREATE TRIGGER trg_return_items_accounting_immutable_update
BEFORE UPDATE ON return_items
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM returns
    WHERE id = OLD.return_id
      AND accounting_status = 'COMPLETED'
)
BEGIN
    SELECT RAISE(ABORT, 'KLBS_RETURN_ACCOUNTING_IMMUTABLE');
END;
CREATE TRIGGER trg_return_items_accounting_immutable_delete
BEFORE DELETE ON return_items
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM returns
    WHERE id = OLD.return_id
      AND accounting_status = 'COMPLETED'
)
BEGIN
    SELECT RAISE(ABORT, 'KLBS_RETURN_ACCOUNTING_IMMUTABLE');
END;
CREATE INDEX idx_return_customer
        ON returns(customer_id)
    ;
CREATE INDEX idx_return_items_return
        ON return_items(return_id)
    ;
CREATE INDEX idx_credit_customer
        ON customer_credit_transactions(customer_id)
    ;
CREATE INDEX idx_credit_reference
        ON customer_credit_transactions(reference_type, reference_id)
    ;
CREATE INDEX idx_voucher_transactions
        ON gift_voucher_transactions(voucher_id)
    ;
CREATE INDEX idx_customers_mobile
        ON customers(mobile)
    ;
CREATE TABLE bills (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    bill_no TEXT UNIQUE,

    bill_date TEXT,

    bill_time TEXT,

    customer_name TEXT,

    customer_mobile TEXT,

    total_items INTEGER,

    total_qty INTEGER,

    gross_amount REAL,

    discount_amount REAL,

    taxable_amount REAL,

    cgst_amount REAL,

    sgst_amount REAL,

    gst_amount REAL,

    net_amount REAL,

    cash_amount REAL,

    upi_amount REAL,

    card_amount REAL,

    store_credit_amount REAL DEFAULT 0,

    gift_voucher_amount REAL DEFAULT 0,

    payment_status TEXT,

    created_at TEXT

);
CREATE TABLE bill_items (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    bill_no TEXT,

    barcode TEXT,

    product_name TEXT,

    brand TEXT,

    category TEXT,

    size TEXT,

    colour TEXT,

    qty INTEGER,

    mrp REAL,

    discount_percent REAL,

    discount_amount REAL,

    taxable_amount REAL,

    gst_rate REAL,

    gst_amount REAL,

    net_amount REAL

);
CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                password_hash TEXT,
                role TEXT
            );
CREATE TABLE settings (

                id INTEGER PRIMARY KEY,

                store_name TEXT,

                gstin TEXT,

                phone TEXT,

                address TEXT,

                receipt_message TEXT,

                default_printer TEXT,

                backup_location TEXT,

                auto_backup_time TEXT DEFAULT '21:30',

                smtp_host TEXT DEFAULT 'smtp.gmail.com',

                smtp_port INTEGER DEFAULT 587,

                smtp_secure INTEGER DEFAULT 0,

                smtp_user TEXT,

                smtp_password TEXT,

                smtp_from TEXT,

                ff_enabled INTEGER DEFAULT 1,

                ff_discount_percent REAL DEFAULT 20,

    ff_pin TEXT,
    admin_pin_hash TEXT,
    admin_security_initialized INTEGER NOT NULL DEFAULT 0 CHECK (admin_security_initialized IN (0, 1)),

                last_updated TEXT

            );
CREATE TABLE inventory_import_log (

        id INTEGER PRIMARY KEY CHECK (id = 1),

        file_name TEXT,

        imported_on TEXT,

        products_imported INTEGER

    );
CREATE TABLE activities (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                activity_date TEXT,

                activity_time TEXT,

                category TEXT,

                action TEXT,

                details TEXT,

                user_name TEXT,

                status TEXT

            );
