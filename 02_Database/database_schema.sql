-- ==========================================
-- KAIRA LUXE BILLING SYSTEM
-- Version: 1.0
-- Database: SQLite
-- ==========================================

-- ==========================================
-- PRODUCTS MASTER
-- ==========================================

CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    barcode TEXT NOT NULL UNIQUE,

    brand TEXT NOT NULL,

    category TEXT NOT NULL,

    product_name TEXT NOT NULL,

    style_code TEXT,

    size TEXT,

    colour TEXT,

    mrp REAL NOT NULL,

    gst_rate REAL NOT NULL,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- BILLS HEADER
-- ==========================================

CREATE TABLE bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    bill_no TEXT NOT NULL UNIQUE,

    bill_date DATE NOT NULL,

    bill_time TIME NOT NULL,

    customer_name TEXT,

    customer_mobile TEXT,

    total_qty INTEGER DEFAULT 0,

    bill_status TEXT DEFAULT 'ACTIVE',

    gross_amount REAL NOT NULL,

    discount_type TEXT,

    discount_value REAL DEFAULT 0,

    discount_amount REAL DEFAULT 0,

    taxable_amount REAL NOT NULL,

    cgst_amount REAL NOT NULL,

    sgst_amount REAL NOT NULL,

    net_amount REAL NOT NULL,

    cash_amount REAL DEFAULT 0,

    upi_amount REAL DEFAULT 0,

    card_amount REAL DEFAULT 0,

    created_by TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- BILL ITEMS
-- ==========================================

CREATE TABLE bill_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    bill_id INTEGER NOT NULL,

    barcode TEXT NOT NULL,

    product_name TEXT NOT NULL,

    qty INTEGER NOT NULL,

    mrp REAL NOT NULL,

    gst_rate REAL NOT NULL,

    discount_type TEXT,

    discount_value REAL DEFAULT 0,

    discount_amount REAL DEFAULT 0,

    taxable_amount REAL NOT NULL,

    cgst_amount REAL NOT NULL,

    sgst_amount REAL NOT NULL,

    line_total REAL NOT NULL,

    FOREIGN KEY (bill_id) REFERENCES bills(id)
);

-- ==========================================
-- USERS
-- ==========================================

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    username TEXT NOT NULL UNIQUE,

    password_hash TEXT NOT NULL,

    full_name TEXT,

    role TEXT NOT NULL,

    is_active INTEGER DEFAULT 1,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- SETTINGS
-- ==========================================

CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    store_name TEXT,

    gstin TEXT,

    address TEXT,

    phone TEXT,

    bill_prefix TEXT DEFAULT 'KL',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX idx_products_barcode
ON products(barcode);

CREATE INDEX idx_bills_bill_no
ON bills(bill_no);

CREATE INDEX idx_bills_date
ON bills(bill_date);

CREATE INDEX idx_bills_mobile
ON bills(customer_mobile);

CREATE INDEX idx_bill_items_bill_id
ON bill_items(bill_id);