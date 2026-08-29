const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { app } = require("electron");

// Development database path
// Keeps Electron and DB Browser pointed at the same billing.db
const dbPath = path.join(__dirname, "..", "..", "billing.db");

console.log("Database Path:", dbPath);

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

    discount REAL DEFAULT 0,

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

    store_credit_amount REAL DEFAULT 0,

    gift_voucher_amount REAL DEFAULT 0,

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

        console.log("All Tables Created Successfully");
    });

}

function runDatabaseMigrations() {

    return new Promise((resolve, reject) => {

        db.all(
            "PRAGMA table_info(settings)",
            [],
            async (err, columns) => {

                if (err) {
                    reject(err);
                    return;
                }

                const existingColumns =
                    columns.map(column => column.name);

                const migrations = [
                    {
                        name: "backup_location",
                        sql: `ALTER TABLE settings ADD COLUMN backup_location TEXT`
                    },
                    {
                        name: "auto_backup_time",
                        sql: `ALTER TABLE settings ADD COLUMN auto_backup_time TEXT DEFAULT '21:30'`
                    },
                    {
                        name: "default_printer",
                        sql: `ALTER TABLE settings ADD COLUMN default_printer TEXT`
                    },
                    {
                        name: "smtp_host",
                        sql: `ALTER TABLE settings ADD COLUMN smtp_host TEXT DEFAULT 'smtp.gmail.com'`
                    },
                    {
                        name: "smtp_port",
                        sql: `ALTER TABLE settings ADD COLUMN smtp_port INTEGER DEFAULT 587`
                    },
                    {
                        name: "smtp_secure",
                        sql: `ALTER TABLE settings ADD COLUMN smtp_secure INTEGER DEFAULT 0`
                    },
                    {
                        name: "smtp_user",
                        sql: `ALTER TABLE settings ADD COLUMN smtp_user TEXT`
                    },
                    {
                        name: "smtp_password",
                        sql: `ALTER TABLE settings ADD COLUMN smtp_password TEXT`
                    },
                    {
                        name: "smtp_from",
                        sql: `ALTER TABLE settings ADD COLUMN smtp_from TEXT`
                    },
                    {
                        name: "ff_enabled",
                        sql: `ALTER TABLE settings ADD COLUMN ff_enabled INTEGER DEFAULT 1`
                    },
                    {
                        name: "ff_discount_percent",
                        sql: `ALTER TABLE settings ADD COLUMN ff_discount_percent REAL DEFAULT 20`
                    },
                    {
                        name: "ff_pin",
                        sql: `ALTER TABLE settings ADD COLUMN ff_pin TEXT`
                    }
                ].filter(
                    migration =>
                        !existingColumns.includes(
                            migration.name
                        )
                );

                try {

                    for (const migration of migrations) {

                        await new Promise(
                            (alterResolve, alterReject) => {

                                db.run(
                                    migration.sql,
                                    alterErr => {

                                        if (alterErr) {
                                            alterReject(alterErr);
                                            return;
                                        }

                                        console.log(
                                            `✓ Added column: ${migration.name}`
                                        );

                                        alterResolve();

                                    }
                                );

                            }
                        );

                    }

                    resolve();

                }
                catch (migrationErr) {
                    reject(migrationErr);
                }

            }
        );

    });

}

function migrateProductDiscountColumn() {

    return new Promise((resolve, reject) => {

        db.all(
            "PRAGMA table_info(products)",
            [],
            (err, columns) => {

                if (err) {
                    reject(err);
                    return;
                }

                const existingColumns =
                    columns.map(column => column.name);

                if (existingColumns.includes("discount")) {
                    resolve();
                    return;
                }

                db.run(
                    `
                    ALTER TABLE products
                    ADD COLUMN discount REAL DEFAULT 0
                    `,
                    alterErr => {

                        if (alterErr) {
                            reject(alterErr);
                            return;
                        }

                        console.log(
                            "✓ Added column: products.discount"
                        );

                        resolve();

                    }
                );

            }
        );

    });
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
    // STORE CREDITS
    // --------------------------------------------------------
    db.run(`
        CREATE TABLE IF NOT EXISTS store_credits (

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

    return new Promise((resolve, reject) => {

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

                    reject(err);
                    return;
                }

                if (row && row.status === 'COMPLETED') {

                    console.log(
                        '✓ Opening Stock already initialized. Skipping.'
                    );

                    resolve();
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

                            reject(err);
                            return;
                        }

                        if (!products || products.length === 0) {

                            console.log(
                                'Opening Stock not initialized: no opening stock found.'
                            );

                            resolve();
                            return;
                        }

                        const totalProducts =
                            products.length;

                        const totalQuantity =
                            products.reduce(
                                (total, product) =>
                                    total +
                                    Number(
                                        product.opening_stock || 0
                                    ),
                                0
                            );

                        console.log(
                            `Opening Stock detected: ${totalProducts} products / ${totalQuantity} units`
                        );

                        db.serialize(() => {

                            db.run(
                                'BEGIN TRANSACTION',
                                (beginErr) => {

                                    if (beginErr) {

                                        reject(beginErr);
                                        return;
                                    }

                                    const now =
                                        new Date().toISOString();

                                    const insert =
                                        db.prepare(`
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

                                    let pending =
                                        products.length;

                                    let transactionError =
                                        null;

                                    products.forEach(
                                        (product) => {

                                            insert.run(
                                                [
                                                    product.id,
                                                    product.barcode || null,
                                                    Number(
                                                        product.opening_stock
                                                    ),
                                                    'Initial opening stock',
                                                    now
                                                ],
                                                (insertErr) => {

                                                    if (
                                                        insertErr &&
                                                        !transactionError
                                                    ) {

                                                        transactionError =
                                                            insertErr;
                                                    }

                                                    pending--;

                                                    if (pending !== 0) {
                                                        return;
                                                    }

                                                    insert.finalize(
                                                        (finalizeErr) => {

                                                            if (
                                                                finalizeErr &&
                                                                !transactionError
                                                            ) {

                                                                transactionError =
                                                                    finalizeErr;
                                                            }

                                                            if (
                                                                transactionError
                                                            ) {

                                                                db.run(
                                                                    'ROLLBACK',
                                                                    () => {

                                                                        console.error(
                                                                            'Opening Stock initialization failed. Transaction rolled back:',
                                                                            transactionError.message
                                                                        );

                                                                        reject(
                                                                            transactionError
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
                                                                (controlErr) => {

                                                                    if (
                                                                        controlErr
                                                                    ) {

                                                                        db.run(
                                                                            'ROLLBACK',
                                                                            () => {

                                                                                console.error(
                                                                                    'Opening Stock control record failed. Transaction rolled back:',
                                                                                    controlErr.message
                                                                                );

                                                                                reject(
                                                                                    controlErr
                                                                                );
                                                                            }
                                                                        );

                                                                        return;
                                                                    }

                                                                    db.run(
                                                                        'COMMIT',
                                                                        (commitErr) => {

                                                                            if (
                                                                                commitErr
                                                                            ) {

                                                                                console.error(
                                                                                    'Opening Stock commit failed:',
                                                                                    commitErr.message
                                                                                );

                                                                                reject(
                                                                                    commitErr
                                                                                );

                                                                                return;
                                                                            }

                                                                            console.log(
                                                                                `✓ Opening Stock initialized successfully: ${totalProducts} products / ${totalQuantity} units`
                                                                            );

                                                                            resolve();
                                                                        }
                                                                    );
                                                                }
                                                            );
                                                        }
                                                    );
                                                }
                                            );
                                        }
                                    );
                                }
                            );
                        });
                    }
                );
            }
        );
    });
}

async function initializeSmtpSettings() {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT
                smtp_host,
                smtp_port,
                smtp_secure,
                smtp_user,
                smtp_password,
                smtp_from
            FROM settings
            WHERE id = 1
            `,
            [],
            (err, settings) => {

                if (err) {

                    reject(err);

                    return;

                }

                const smtpUser =
                    settings.smtp_user ||
                    process.env.SMTP_USER;

                const smtpPassword =
                    settings.smtp_password ||
                    process.env.SMTP_PASSWORD;

                const smtpFrom =
                    settings.smtp_from ||
                    process.env.SMTP_FROM;

                if (
                    settings.smtp_user &&
                    settings.smtp_password
                ) {

                    resolve();

                    return;

                }

                db.run(
                    `
                    UPDATE settings

                    SET
                        smtp_host = ?,
                        smtp_port = ?,
                        smtp_secure = ?,
                        smtp_user = ?,
                        smtp_password = ?,
                        smtp_from = ?

                    WHERE id = 1
                    `,
                    [
                        settings.smtp_host ||
                            process.env.SMTP_HOST ||
                            "smtp.gmail.com",

                        settings.smtp_port ||
                            Number(
                                process.env.SMTP_PORT ||
                                587
                            ),

                        settings.smtp_secure !== null &&
                        settings.smtp_secure !== undefined
                            ? settings.smtp_secure
                            : (
                                process.env.SMTP_SECURE === "true"
                                    ? 1
                                    : 0
                            ),

                        smtpUser,

                        smtpPassword,

                        smtpFrom

                    ],
                    (updateErr) => {

                        if (updateErr) {

                            reject(updateErr);

                            return;

                        }

                        console.log(
                            "✓ SMTP settings initialized."
                        );

                        resolve();

                    }
                );

            }
        );

    });

}

/* ===========================================
   MIGRATE STORE CREDIT TABLE SCHEMA
=========================================== */

function migrateStoreCreditSchema() {

    return new Promise((resolve, reject) => {

        db.all(
            `PRAGMA table_info(store_credits)`,
            [],
            (err, columns) => {

                if (err) {

                    reject(err);
                    return;

                }

                const statusColumn =
                    columns.find(
                        column => column.name === "status"
                    );

                if (!statusColumn) {

                    reject(
                        new Error(
                            "store_credits.status column not found"
                        )
                    );

                    return;

                }

                // New RC5 schema is already active.
                // No migration required.
                if (
                    statusColumn.dflt_value === "'ISSUED'" ||
                    statusColumn.dflt_value === '"ISSUED"'
                ) {

                    console.log(
                        "✓ Store Credit schema already up to date."
                    );

                    resolve();
                    return;

                }

                db.serialize(() => {

            db.run("BEGIN TRANSACTION");

            db.run(

                `
                CREATE TABLE IF NOT EXISTS store_credits_new (

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

                )
                `,

                createErr => {

                    if (createErr) {

                        db.run("ROLLBACK");
                        reject(createErr);
                        return;

                    }

                    db.run(

                        `
                        INSERT INTO store_credits_new
                        (
                            id,
                            store_credit_no,
                            return_id,
                            original_bill_no,
                            customer_id,
                            customer_name,
                            customer_mobile,
                            issue_date,
                            valid_until,
                            original_amount,
                            remaining_balance,
                            status,
                            created_by,
                            created_at
                        )

                        SELECT
                            id,
                            store_credit_no,
                            return_id,
                            original_bill_no,
                            customer_id,
                            customer_name,
                            customer_mobile,
                            issue_date,
                            valid_until,
                            original_amount,
                            remaining_balance,

                            CASE
                                WHEN status = 'ACTIVE'
                                    THEN 'ISSUED'

                                WHEN status = 'USED'
                                    THEN 'REDEEMED'

                                WHEN status = 'EXPIRED'
                                    THEN 'EXPIRED'

                                ELSE 'ISSUED'
                            END,

                            created_by,
                            created_at

                        FROM store_credits
                        `,

                        copyErr => {

                            if (copyErr) {

                                db.run("ROLLBACK");
                                reject(copyErr);
                                return;

                            }

                            db.run(

                                `
                                DROP TABLE store_credits
                                `,

                                dropErr => {

                                    if (dropErr) {

                                        db.run("ROLLBACK");
                                        reject(dropErr);
                                        return;

                                    }

                                    db.run(

                                        `
                                        ALTER TABLE
                                        store_credits_new
                                        RENAME TO store_credits
                                        `,

                                        renameErr => {

                                            if (renameErr) {

                                                db.run(
                                                    "ROLLBACK"
                                                );

                                                reject(renameErr);
                                                return;

                                            }

                                            db.run(

                                                "COMMIT",

                                                commitErr => {

                                                    if (
                                                        commitErr
                                                    ) {

                                                        reject(
                                                            commitErr
                                                        );

                                                        return;

                                                    }

                                                    resolve();

                                                }

                                            );

                                        }

                                    );

                                }

                            );

                        }

                    );

                }

            );

                });

            }
        );

    });

}

/* ===========================================
   MIGRATE BILL PAYMENT COLUMNS
=========================================== */

function migrateBillPaymentColumns() {

    return new Promise((resolve, reject) => {

        db.all(
            `PRAGMA table_info(bills)`,
            [],
            (err, columns) => {

                if (err) {
                    reject(err);
                    return;
                }

                const columnNames =
                    columns.map(
                        column => column.name
                    );

                const migrations = [];

                if (
                    !columnNames.includes(
                        "store_credit_amount"
                    )
                ) {

                    migrations.push(
                        `
                        ALTER TABLE bills
                        ADD COLUMN store_credit_amount
                        REAL DEFAULT 0
                        `
                    );

                }

                if (
                    !columnNames.includes(
                        "gift_voucher_amount"
                    )
                ) {

                    migrations.push(
                        `
                        ALTER TABLE bills
                        ADD COLUMN gift_voucher_amount
                        REAL DEFAULT 0
                        `
                    );

                }

                if (
                    migrations.length === 0
                ) {

                    resolve();
                    return;

                }

                let pending =
                    migrations.length;

                migrations.forEach(sql => {

                    db.run(
                        sql,
                        alterErr => {

                            if (alterErr) {
                                reject(alterErr);
                                return;
                            }

                            pending--;

                            if (pending === 0) {

                                console.log(
                                    "✓ Bill payment columns migrated."
                                );

                                resolve();

                            }

                        }
                    );

                });

            }
        );

    });

}

/* ===========================================
   ENFORCE ONE RETURN PER ORIGINAL BILL
=========================================== */

function migrateReturnUniquenessEnforcement() {

    return new Promise((resolve, reject) => {

        const run = (sql, params = []) =>
            new Promise((runResolve, runReject) => {

                db.run(
                    sql,
                    params,
                    runErr => {

                        if (runErr) {
                            runReject(runErr);
                            return;
                        }

                        runResolve();

                    }
                );

            });

        const get = (sql, params = []) =>
            new Promise((getResolve, getReject) => {

                db.get(
                    sql,
                    params,
                    (getErr, row) => {

                        if (getErr) {
                            getReject(getErr);
                            return;
                        }

                        getResolve(row);

                    }
                );

            });

        let transactionStarted = false;

        (async () => {

            try {

                await run("BEGIN IMMEDIATE TRANSACTION");
                transactionStarted = true;

                const returnsTable = await get(
                    `
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'table'
                      AND name = 'returns'
                    `
                );

                if (!returnsTable) {
                    throw new Error(
                        "Return uniqueness migration failed: returns table not found."
                    );
                }

                const preMigrationCounts = await get(
                    `
                    SELECT
                        (SELECT COUNT(*) FROM returns)
                            AS returns_count,
                        (SELECT COUNT(*) FROM return_items)
                            AS return_items_count,
                        (SELECT COUNT(*) FROM store_credits)
                            AS store_credits_count,
                        (
                            SELECT COUNT(*)
                            FROM (
                                SELECT
                                    UPPER(TRIM(original_bill_no))
                                        AS canonical_bill
                                FROM returns
                                GROUP BY
                                    UPPER(TRIM(original_bill_no))
                            )
                        ) AS canonical_bill_count,
                        (
                            SELECT COUNT(*)
                            FROM (
                                SELECT
                                    UPPER(TRIM(original_bill_no))
                                        AS canonical_bill
                                FROM returns
                                GROUP BY
                                    UPPER(TRIM(original_bill_no))
                                HAVING COUNT(*) > 1
                            )
                        ) AS duplicate_group_count
                    `
                );

                await run(
                    `
                    CREATE INDEX IF NOT EXISTS
                        idx_returns_original_bill_canonical
                    ON returns (
                        UPPER(TRIM(original_bill_no))
                    )
                    `
                );

                await run(
                    `
                    DROP TRIGGER IF EXISTS
                        trg_returns_one_per_original_bill_insert
                    `
                );

                await run(
                    `
                    CREATE TRIGGER
                        trg_returns_one_per_original_bill_insert
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
                                WHERE
                                    UPPER(TRIM(original_bill_no)) =
                                    UPPER(TRIM(NEW.original_bill_no))
                            )
                            THEN RAISE(
                                ABORT,
                                'KLBS_RETURN_ALREADY_COMPLETED'
                            )
                        END;
                    END
                    `
                );

                await run(
                    `
                    DROP TRIGGER IF EXISTS
                        trg_returns_original_bill_immutable
                    `
                );

                await run(
                    `
                    CREATE TRIGGER
                        trg_returns_original_bill_immutable
                    BEFORE UPDATE OF original_bill_no
                    ON returns
                    FOR EACH ROW
                    WHEN
                        UPPER(TRIM(NEW.original_bill_no)) <>
                        UPPER(TRIM(OLD.original_bill_no))
                    BEGIN
                        SELECT RAISE(
                            ABORT,
                            'KLBS_RETURN_ORIGINAL_BILL_IMMUTABLE'
                        );
                    END
                    `
                );

                const canonicalIndex = await get(
                    `
                    SELECT
                        name,
                        [unique] AS is_unique
                    FROM pragma_index_list('returns')
                    WHERE name =
                        'idx_returns_original_bill_canonical'
                    `
                );

                if (
                    !canonicalIndex ||
                    Number(canonicalIndex.is_unique) !== 0
                ) {
                    throw new Error(
                        "Return uniqueness migration failed: canonical index missing or unique."
                    );
                }

                const insertTrigger = await get(
                    `
                    SELECT sql
                    FROM sqlite_master
                    WHERE type = 'trigger'
                      AND name =
                        'trg_returns_one_per_original_bill_insert'
                    `
                );

                const immutableTrigger = await get(
                    `
                    SELECT sql
                    FROM sqlite_master
                    WHERE type = 'trigger'
                      AND name =
                        'trg_returns_original_bill_immutable'
                    `
                );

                const insertTriggerSql =
                    insertTrigger && insertTrigger.sql
                        ? insertTrigger.sql.toUpperCase()
                        : "";

                const immutableTriggerSql =
                    immutableTrigger && immutableTrigger.sql
                        ? immutableTrigger.sql.toUpperCase()
                        : "";

                if (
                    !insertTriggerSql.includes(
                        "KLBS_RETURN_ALREADY_COMPLETED"
                    ) ||
                    !insertTriggerSql.includes(
                        "KLBS_RETURN_ORIGINAL_BILL_REQUIRED"
                    ) ||
                    !insertTriggerSql.includes(
                        "UPPER(TRIM(ORIGINAL_BILL_NO))"
                    ) ||
                    !insertTriggerSql.includes(
                        "UPPER(TRIM(NEW.ORIGINAL_BILL_NO))"
                    )
                ) {
                    throw new Error(
                        "Return uniqueness migration failed: insert trigger verification failed."
                    );
                }

                if (
                    !immutableTriggerSql.includes(
                        "KLBS_RETURN_ORIGINAL_BILL_IMMUTABLE"
                    ) ||
                    !immutableTriggerSql.includes(
                        "UPPER(TRIM(NEW.ORIGINAL_BILL_NO))"
                    ) ||
                    !immutableTriggerSql.includes(
                        "UPPER(TRIM(OLD.ORIGINAL_BILL_NO))"
                    )
                ) {
                    throw new Error(
                        "Return uniqueness migration failed: immutability trigger verification failed."
                    );
                }

                const postMigrationCounts = await get(
                    `
                    SELECT
                        (SELECT COUNT(*) FROM returns)
                            AS returns_count,
                        (SELECT COUNT(*) FROM return_items)
                            AS return_items_count,
                        (SELECT COUNT(*) FROM store_credits)
                            AS store_credits_count
                    `
                );

                if (
                    preMigrationCounts.returns_count !==
                        postMigrationCounts.returns_count ||
                    preMigrationCounts.return_items_count !==
                        postMigrationCounts.return_items_count ||
                    preMigrationCounts.store_credits_count !==
                        postMigrationCounts.store_credits_count
                ) {
                    throw new Error(
                        "Return uniqueness migration failed: business row counts changed."
                    );
                }

                await run("COMMIT");
                transactionStarted = false;

                console.log(
                    "✓ One-return-per-original-bill enforcement ready: " +
                    `${preMigrationCounts.canonical_bill_count} canonical bill locks, ` +
                    `${preMigrationCounts.duplicate_group_count} grandfathered duplicate groups.`
                );

                resolve();

            }
            catch (migrationErr) {

                if (transactionStarted) {

                    try {
                        await run("ROLLBACK");
                    }
                    catch (rollbackErr) {
                        console.error(
                            "Return uniqueness migration rollback failed:",
                            rollbackErr.message
                        );
                    }

                }

                reject(migrationErr);

            }

        })();

    });

}

// ============================================================
// DATABASE READY CHECKPOINT
// All database initialization operations queued above must
// complete before the application is allowed to use the DB.
// ============================================================

db.serialize(() => {

    db.get(
        `SELECT 1`,
        [],
       async (err) => {

            if (err) {

                console.error(
                    'Database Initialization Failed:',
                    err.message
                );

                databaseReadyReject(err);
                return;
            }

try {

        await runDatabaseMigrations();

        await migrateProductDiscountColumn();

        await migrateReturnUniquenessEnforcement();

        await initializeSmtpSettings();

        await migrateStoreCreditSchema();

        await migrateBillPaymentColumns();

        await initializeOpeningStock();

    console.log(
        '✓ Database Initialization Complete'
    );
    databaseReadyResolve();

}

catch (error) {

    console.error(
        "Database Initialization Failed:",
        error.message
    );

    databaseReadyReject(error);

}

        }
    );

});

function closeDatabase() {

    return new Promise((resolve, reject) => {

        db.close((err) => {

            if (err) {

                reject(err);

                return;

            }

            console.log(
                "✓ Database Connection Closed"
            );

            resolve();

        });

    });

}

module.exports = db;
module.exports.databaseReady = databaseReady;
module.exports.closeDatabase = closeDatabase;
