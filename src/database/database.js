const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { app } = require("electron");

const dbPath = path.join(app.getPath("userData"), "billing.db");

let databaseReadyResolve;

let databaseReadyReject;

const databaseReady = new Promise((resolve, reject) => {
    databaseReadyResolve = resolve;
    databaseReadyReject = reject;
});

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database Connection Error:', err.message);
        databaseReadyReject(err);
    } else {
        console.log('Database Connected Successfully');

        createTables();
    }
});

function createTables() {

    db.serialize(() => {

        db.run(`
            CREATE TABLE IF NOT EXISTS products (

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

)
        `);



        db.run(`
            CREATE TABLE IF NOT EXISTS bills (

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

)
            
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS bill_items (

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

)
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                password_hash TEXT,
                role TEXT
            )
        `);

                db.run(`
            CREATE TABLE IF NOT EXISTS activities (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                activity_date TEXT,

                activity_time TEXT,

                category TEXT,

                action TEXT,

                details TEXT,

                user_name TEXT,

                status TEXT

            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS settings (

                id INTEGER PRIMARY KEY,

                store_name TEXT,

                gstin TEXT,

                phone TEXT,

                address TEXT,

                receipt_message TEXT,

                backup_location TEXT,

                auto_backup_time TEXT DEFAULT '21:30',

                last_updated TEXT

            )
    
        `);

db.run(`
    CREATE TABLE IF NOT EXISTS inventory_import_log (

        id INTEGER PRIMARY KEY CHECK (id = 1),

        file_name TEXT,

        imported_on TEXT,

        products_imported INTEGER

    )

    
`);



        db.run(`
    INSERT OR IGNORE INTO settings
    (
        id,
        store_name,
        gstin,
        phone,
        address,
        receipt_message,
        last_updated
    )
    VALUES
    (
        1,
        'KAIRA LUXE',
        '21BBLPP6327G1ZO',
        '0680-3596443',
        'Shop No.3
Shree Towers
Near Khallikote University
Berhampur-760001',
        '',
        ''
    )
`);

        runDatabaseMigrations();

        console.log("All Tables Created Successfully");
    });

}

        db.run(`
            CREATE TABLE IF NOT EXISTS day_closing (

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

            )
        `);

        runDatabaseMigrations();

        console.log("All Tables Created Successfully");

function runDatabaseMigrations() {

    db.all(
    "PRAGMA table_info(settings)",
    [],
    (err, columns) => {

        if (err) {

            console.error("Migration Error:", err);
            return;

        }

        const existingColumns =
            columns.map(c => c.name);

        if (!existingColumns.includes("backup_location")) {

    db.run(`
        ALTER TABLE settings
        ADD COLUMN backup_location TEXT
    `);

    console.log("✓ Added column: backup_location");

}

if (!existingColumns.includes("auto_backup_time")) {

    db.run(`
        ALTER TABLE settings
        ADD COLUMN auto_backup_time
        TEXT DEFAULT '21:30'
    `);

    console.log("✓ Added column: auto_backup_time");

}

    }
);

}

db.run(`
    CREATE TABLE IF NOT EXISTS payment_corrections (

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

    )
`);

// ============================================================
// RC5 DATABASE FOUNDATION
// Future-proof database structure for Inventory, Customers,
// Returns, Credit Notes, Gift Vouchers and Suppliers.
// Only OPENING STOCK will be activated in RC5.
// ============================================================

db.serialize(() => {

    // --------------------------------------------------------
    // INVENTORY TRANSACTIONS
    // Single source of truth for future stock movements.
    // --------------------------------------------------------
    db.run(`
        CREATE TABLE IF NOT EXISTS inventory_transactions (

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

        )
    `);


    // --------------------------------------------------------
    // INVENTORY INITIALIZATION CONTROL
    // Prevents Opening Stock from being initialized twice.
    // --------------------------------------------------------
    db.run(`
        CREATE TABLE IF NOT EXISTS inventory_initialization (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            initialization_type TEXT NOT NULL UNIQUE,

            status TEXT NOT NULL,

            initialized_at TEXT,

            initialized_by TEXT,

            remarks TEXT

        )
    `);


    // --------------------------------------------------------
    // CUSTOMERS
    // --------------------------------------------------------
    db.run(`
        CREATE TABLE IF NOT EXISTS customers (

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

        )
    `);


    // --------------------------------------------------------
    // RETURNS
    // --------------------------------------------------------
    db.run(`
        CREATE TABLE IF NOT EXISTS returns (

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

        )
    `);


    // --------------------------------------------------------
    // RETURN ITEMS
    // --------------------------------------------------------
    db.run(`
        CREATE TABLE IF NOT EXISTS return_items (

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

        )
    `);


    // --------------------------------------------------------
    // CUSTOMER CREDIT / STORE CREDIT LEDGER
    // --------------------------------------------------------
    db.run(`
        CREATE TABLE IF NOT EXISTS customer_credit_transactions (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            customer_id INTEGER NOT NULL,

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

        )
    `);


    // --------------------------------------------------------
    // GIFT VOUCHERS
    // --------------------------------------------------------
    db.run(`
        CREATE TABLE IF NOT EXISTS gift_vouchers (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            voucher_code TEXT UNIQUE NOT NULL,

            initial_value REAL NOT NULL,

            expiry_date TEXT,

            status TEXT NOT NULL DEFAULT 'ACTIVE',

            customer_id INTEGER,

            remarks TEXT,

            created_at TEXT NOT NULL

        )
    `);


    // --------------------------------------------------------
    // GIFT VOUCHER TRANSACTIONS
    // --------------------------------------------------------
    db.run(`
        CREATE TABLE IF NOT EXISTS gift_voucher_transactions (

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

        )
    `);


    // --------------------------------------------------------
    // SUPPLIERS
    // --------------------------------------------------------
    db.run(`
        CREATE TABLE IF NOT EXISTS suppliers (

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

        )
    `);


    // --------------------------------------------------------
    // INDEXES
    // --------------------------------------------------------

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_inventory_product
        ON inventory_transactions(product_id)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_inventory_barcode
        ON inventory_transactions(barcode)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_inventory_type
        ON inventory_transactions(transaction_type)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_inventory_created_at
        ON inventory_transactions(created_at)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_return_original_bill
        ON returns(original_bill_no)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_return_customer
        ON returns(customer_id)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_return_items_return
        ON return_items(return_id)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_credit_customer
        ON customer_credit_transactions(customer_id)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_credit_reference
        ON customer_credit_transactions(reference_type, reference_id)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_voucher_transactions
        ON gift_voucher_transactions(voucher_id)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_customers_mobile
        ON customers(mobile)
    `);

        console.log("✓ RC5 Database Foundation Ready");

});

// ============================================================
// RC5 OPENING STOCK INITIALIZATION
// Reads opening_stock dynamically from products.
// This operation is protected against duplicate initialization.
// ============================================================

function initializeOpeningStock() {

    db.get(
        `
        SELECT status
        FROM inventory_initialization
        WHERE initialization_type = 'OPENING_STOCK'
        `,
        [],
        (err, row) => {

            if (err) {
                console.error(
                    'Opening Stock Check Error:',
                    err.message
                );
                return;
            }

            if (row && row.status === 'COMPLETED') {

                console.log(
                    '✓ Opening Stock already initialized. Skipping.'
                );

                return;
            }

            db.all(
                `
                SELECT
                    id,
                    barcode,
                    opening_stock
                FROM products
                WHERE active = 1
                  AND COALESCE(opening_stock, 0) > 0
                `,
                [],
                (err, products) => {

                    if (err) {
                        console.error(
                            'Opening Stock Product Read Error:',
                            err.message
                        );
                        return;
                    }

                    if (!products || products.length === 0) {

                        console.log(
                            'Opening Stock not initialized: no opening stock found.'
                        );

                        return;
                    }

                    const totalProducts = products.length;

                    const totalQuantity =
                        products.reduce(
                            (total, product) =>
                                total +
                                Number(product.opening_stock || 0),
                            0
                        );

                    console.log(
                        `Opening Stock detected: ${totalProducts} products / ${totalQuantity} units`
                    );

                    db.serialize(() => {

                        db.run('BEGIN TRANSACTION');

                        let transactionError = null;

                        const insert = db.prepare(`
                            INSERT INTO inventory_transactions
                            (
                                product_id,
                                barcode,
                                transaction_type,
                                quantity,
                                reference_type,
                                reference_id,
                                remarks,
                                created_by,
                                created_at
                            )
                            VALUES
                            (
                                ?,
                                ?,
                                'OPENING',
                                ?,
                                'OPENING_STOCK',
                                'RC5',
                                ?,
                                'Administrator',
                                ?
                            )
                        `);

                        const now = new Date().toISOString();

                        products.forEach((product) => {

                            if (transactionError) {
                                return;
                            }

                            insert.run(
                                product.id,
                                product.barcode || null,
                                Number(product.opening_stock),
                                'Initial opening stock',
                                now,
                                (err) => {

                                    if (err && !transactionError) {
                                        transactionError = err;
                                    }

                                }
                            );

                        });

                        insert.finalize((err) => {

                            if (err && !transactionError) {
                                transactionError = err;
                            }

                            if (transactionError) {

                                db.run(
                                    'ROLLBACK',
                                    () => {

                                        console.error(
                                            'Opening Stock initialization failed. Transaction rolled back:',
                                            transactionError.message
                                        );

                                    }
                                );

                                return;
                            }

                            db.run(
                                `
                                INSERT INTO inventory_initialization
                                (
                                    initialization_type,
                                    status,
                                    initialized_at,
                                    initialized_by,
                                    remarks
                                )
                                VALUES
                                (
                                    'OPENING_STOCK',
                                    'COMPLETED',
                                    ?,
                                    'Administrator',
                                    ?
                                )
                                `,
                                [
                                    now,
                                    `${totalProducts} products / ${totalQuantity} units`
                                ],
                                (err) => {

                                    if (err) {

                                        db.run(
                                            'ROLLBACK',
                                            () => {

                                                console.error(
                                                    'Opening Stock control record failed. Transaction rolled back:',
                                                    err.message
                                                );

                                            }
                                        );

                                        return;
                                    }

                                    db.run(
                                        'COMMIT',
                                        (err) => {

                                            if (err) {

                                                console.error(
                                                    'Opening Stock commit failed:',
                                                    err.message
                                                );

                                                return;
                                            }

                                            console.log(
                                                `✓ Opening Stock initialized successfully: ${totalProducts} products / ${totalQuantity} units`
                                            );

                                        }
                                    );

                                }
                            );

                        });

                    });

                }
            );

        }
    );

}

initializeOpeningStock();

// ============================================================
// DATABASE READY CHECKPOINT
// All database initialization operations queued above must
// complete before the application is allowed to use the DB.
// ============================================================

db.serialize(() => {

    db.get(
        `SELECT 1`,
        [],
        (err) => {

            if (err) {

                console.error(
                    'Database Initialization Failed:',
                    err.message
                );

                databaseReadyReject(err);
                return;
            }

            console.log(
                '✓ Database Initialization Complete'
            );

            databaseReadyResolve();

        }
    );

});

module.exports = db;
module.exports.databaseReady = databaseReady;