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

            original_bill_no TEXT NOT NULL,

            customer_id INTEGER,

            customer_name TEXT NOT NULL,

            customer_mobile TEXT NOT NULL,

            return_reason TEXT NOT NULL,

            remarks TEXT,

            return_amount REAL NOT NULL DEFAULT 0,

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

            remarks TEXT,

            created_at TEXT NOT NULL,

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
