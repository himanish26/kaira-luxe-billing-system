const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { app } = require("electron");
const {
    hashCredential,
    isCredentialRecord
} = require("../services/credentialCrypto");
const {
    migrateDayClosingSnapshots
} = require("./dayClosingMigration");
const {
    migrateActivityLogSchema
} = require("./activityMigration");
const { migrateManagerSecurity } = require("./managerSecurityMigration");

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

        db.run(
            "PRAGMA foreign_keys = ON",
            pragmaErr => {

                if (pragmaErr) {
                    databaseReadyReject(pragmaErr);
                    return;
                }

                db.get(
                    "PRAGMA foreign_keys",
                    [],
                    (verifyErr, row) => {

                        if (verifyErr || !row || row.foreign_keys !== 1) {
                            databaseReadyReject(
                                verifyErr ||
                                new Error(
                                    "SQLite foreign key enforcement could not be enabled."
                                )
                            );
                            return;
                        }

                        createTables();

                    }
                );

            }
        );
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

                status TEXT,

                entity_type TEXT,

                reference_no TEXT,

                change_data TEXT,

                created_at TEXT

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

                admin_pin_hash TEXT,

                admin_security_initialized INTEGER NOT NULL DEFAULT 0
                    CHECK (admin_security_initialized IN (0, 1)),

                manager_pin_hash TEXT,

                manager_security_initialized INTEGER NOT NULL DEFAULT 0
                    CHECK (manager_security_initialized IN (0, 1)),

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
                    },
                    {
                        name: "admin_pin_hash",
                        sql: `ALTER TABLE settings ADD COLUMN admin_pin_hash TEXT`
                    },
                    {
                        name: "admin_security_initialized",
                        sql: `ALTER TABLE settings ADD COLUMN admin_security_initialized INTEGER NOT NULL DEFAULT 0 CHECK (admin_security_initialized IN (0, 1))`
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

function migrateAdministratorSecurity() {
    function run(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, error => error ? reject(error) : resolve());
        });
    }

    function get(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
        });
    }

    return (async () => {
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            const row = await get(`
                SELECT
                    ff_pin,
                    admin_pin_hash,
                    admin_security_initialized
                FROM settings
                WHERE id = 1
            `);

            if (!row) {
                throw new Error("Administrator security migration requires settings row id 1.");
            }

            let pinHash = row.admin_pin_hash;
            let initialized = row.admin_security_initialized === 1 ? 1 : 0;
            const historicalPin = String(row.ff_pin || "").trim();

            if (!isCredentialRecord(pinHash) && /^\d{4}$/.test(historicalPin)) {
                pinHash = await hashCredential(historicalPin);
            }

            if (isCredentialRecord(pinHash)) {
                initialized = 1;
            }
            else {
                initialized = 0;
            }

            await run(`
                UPDATE settings
                SET admin_pin_hash = ?,
                    admin_security_initialized = ?,
                    ff_pin = CASE WHEN ? = 1 THEN NULL ELSE ff_pin END
                WHERE id = 1
            `, [pinHash || null, initialized, initialized]);

            await run("COMMIT");
            console.log("✓ Administrator security migration complete");
        }
        catch (error) {
            await run("ROLLBACK").catch(() => {});
            throw error;
        }
    })();
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

            db.run(
                "BEGIN IMMEDIATE TRANSACTION",
                beginErr => {

                    if (beginErr) {
                        reject(beginErr);
                        return;
                    }

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
   ALLOW LEDGER ROWS WITHOUT CUSTOMER MASTER ID
=========================================== */

function migrateCustomerCreditCustomerIdNullable() {

    return new Promise((resolve, reject) => {

        const run = (sql, params = []) =>
            new Promise((runResolve, runReject) => {
                db.run(sql, params, runErr => {
                    if (runErr) {
                        runReject(runErr);
                        return;
                    }
                    runResolve();
                });
            });

        const get = (sql, params = []) =>
            new Promise((getResolve, getReject) => {
                db.get(sql, params, (getErr, row) => {
                    if (getErr) {
                        getReject(getErr);
                        return;
                    }
                    getResolve(row);
                });
            });

        const all = (sql, params = []) =>
            new Promise((allResolve, allReject) => {
                db.all(sql, params, (allErr, rows) => {
                    if (allErr) {
                        allReject(allErr);
                        return;
                    }
                    allResolve(rows);
                });
            });

        let transactionStarted = false;

        (async () => {

            try {

                const columns = await all(
                    "PRAGMA table_info(customer_credit_transactions)"
                );

                const customerIdColumn = columns.find(
                    column => column.name === "customer_id"
                );

                if (!customerIdColumn) {
                    throw new Error(
                        "customer_credit_transactions.customer_id column not found"
                    );
                }

                if (Number(customerIdColumn.notnull) === 0) {
                    resolve();
                    return;
                }

                await run("BEGIN IMMEDIATE TRANSACTION");
                transactionStarted = true;

                const tableDefinition = await get(
                    `
                    SELECT sql
                    FROM sqlite_master
                    WHERE type = 'table'
                      AND name = 'customer_credit_transactions'
                    `
                );

                if (!tableDefinition || !tableDefinition.sql) {
                    throw new Error(
                        "customer_credit_transactions table definition not found"
                    );
                }

                const schemaObjects = await all(
                    `
                    SELECT type, name, sql
                    FROM sqlite_master
                    WHERE tbl_name = 'customer_credit_transactions'
                      AND type IN ('index', 'trigger')
                      AND sql IS NOT NULL
                    ORDER BY type, name
                    `
                );

                const beforeRows = await all(
                    "SELECT * FROM customer_credit_transactions ORDER BY id"
                );

                let rebuiltSql = tableDefinition.sql.replace(
                    /CREATE TABLE(?: IF NOT EXISTS)?\s+customer_credit_transactions/i,
                    "CREATE TABLE customer_credit_transactions_new"
                );

                rebuiltSql = rebuiltSql.replace(
                    /(\bcustomer_id\s+INTEGER)\s+NOT\s+NULL/i,
                    "$1"
                );

                if (
                    !/CREATE TABLE customer_credit_transactions_new/i.test(
                        rebuiltSql
                    ) ||
                    /customer_id\s+INTEGER\s+NOT\s+NULL/i.test(
                        rebuiltSql
                    )
                ) {
                    throw new Error(
                        "Unable to build nullable customer credit ledger schema"
                    );
                }

                const columnList = columns
                    .map(column =>
                        `"${String(column.name).replace(/"/g, '""')}"`
                    )
                    .join(", ");

                await run(rebuiltSql);
                await run(
                    `
                    INSERT INTO customer_credit_transactions_new
                    (${columnList})
                    SELECT ${columnList}
                    FROM customer_credit_transactions
                    `
                );
                await run("DROP TABLE customer_credit_transactions");
                await run(
                    `
                    ALTER TABLE customer_credit_transactions_new
                    RENAME TO customer_credit_transactions
                    `
                );

                for (const schemaObject of schemaObjects) {
                    await run(schemaObject.sql);
                }

                const afterColumns = await all(
                    "PRAGMA table_info(customer_credit_transactions)"
                );
                const afterCustomerId = afterColumns.find(
                    column => column.name === "customer_id"
                );
                const afterRows = await all(
                    "SELECT * FROM customer_credit_transactions ORDER BY id"
                );

                if (
                    !afterCustomerId ||
                    Number(afterCustomerId.notnull) !== 0 ||
                    JSON.stringify(beforeRows) !== JSON.stringify(afterRows)
                ) {
                    throw new Error(
                        "Customer credit ledger migration verification failed"
                    );
                }

                await run("COMMIT");
                transactionStarted = false;

                console.log(
                    "✓ Customer credit ledger customer_id is nullable."
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
                            "Customer credit ledger rollback failed:",
                            rollbackErr.message
                        );
                    }
                }

                reject(migrationErr);

            }

        })();

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

/* ===========================================
   CREDIT NOTE ACCOUNTING SNAPSHOT
=========================================== */

function migrateCreditNoteAccounting() {

    const run = (sql, params = []) =>
        new Promise((resolve, reject) => {
            db.run(sql, params, error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });

    const get = (sql, params = []) =>
        new Promise((resolve, reject) => {
            db.get(sql, params, (error, row) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(row);
            });
        });

    const all = (sql, params = []) =>
        new Promise((resolve, reject) => {
            db.all(sql, params, (error, rows) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(rows);
            });
        });

    return (async () => {

        let transactionStarted = false;

        try {
            await run("BEGIN IMMEDIATE TRANSACTION");
            transactionStarted = true;

            const tables = await all(`
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                  AND name IN ('returns', 'return_items')
            `);

            if (tables.length !== 2) {
                throw new Error(
                    "Credit Note accounting migration requires returns and return_items tables."
                );
            }

            const preCounts = await get(`
                SELECT
                    (SELECT COUNT(*) FROM returns) AS returns_count,
                    (SELECT COUNT(*) FROM return_items) AS return_items_count
            `);

            const returnColumns = new Map(
                (await all("PRAGMA table_info(returns)"))
                    .map(column => [column.name, column])
            );
            const returnItemColumns = new Map(
                (await all("PRAGMA table_info(return_items)"))
                    .map(column => [column.name, column])
            );

            const preAuthoritativeCount =
                returnColumns.has("accounting_status")
                    ? Number((await get(`
                        SELECT COUNT(*) AS count
                        FROM returns
                        WHERE accounting_status = 'COMPLETED'
                    `)).count)
                    : 0;

            const returnMigrations = [
                ["credit_note_no", "TEXT"],
                ["business_date", "TEXT"],
                ["original_bill_date", "TEXT"],
                ["gross_reversal", "REAL"],
                ["discount_reversal", "REAL"],
                ["taxable_reversal", "REAL"],
                ["cgst_reversal", "REAL"],
                ["sgst_reversal", "REAL"],
                ["gst_reversal", "REAL"],
                ["net_reversal", "REAL"],
                [
                    "accounting_status",
                    "TEXT NOT NULL DEFAULT 'LEGACY_UNASSESSED'"
                ],
                ["accounting_snapshot_version", "INTEGER"]
            ];

            const itemMigrations = [
                ["mrp", "REAL"],
                ["gross_reversal", "REAL"],
                ["discount_percent", "REAL"],
                ["discount_reversal", "REAL"],
                ["taxable_reversal", "REAL"],
                ["gst_rate", "REAL"],
                ["cgst_reversal", "REAL"],
                ["sgst_reversal", "REAL"],
                ["gst_reversal", "REAL"],
                ["net_reversal", "REAL"]
            ];

            for (const [name, definition] of returnMigrations) {
                if (!returnColumns.has(name)) {
                    await run(
                        `ALTER TABLE returns ADD COLUMN ${name} ${definition}`
                    );
                }
            }

            for (const [name, definition] of itemMigrations) {
                if (!returnItemColumns.has(name)) {
                    await run(
                        `ALTER TABLE return_items ADD COLUMN ${name} ${definition}`
                    );
                }
            }

            await run(`
                CREATE UNIQUE INDEX IF NOT EXISTS
                    idx_returns_credit_note_canonical
                ON returns (UPPER(TRIM(credit_note_no)))
                WHERE credit_note_no IS NOT NULL
            `);

            await run(`
                CREATE INDEX IF NOT EXISTS
                    idx_returns_accounting_date_status
                ON returns (business_date, accounting_status)
            `);

            const triggers = [
                "trg_returns_accounting_insert_valid",
                "trg_returns_accounting_immutable_update",
                "trg_returns_accounting_immutable_delete",
                "trg_return_items_accounting_insert_valid",
                "trg_return_items_accounting_immutable_update",
                "trg_return_items_accounting_immutable_delete"
            ];

            for (const trigger of triggers) {
                await run(`DROP TRIGGER IF EXISTS ${trigger}`);
            }

            await run(`
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
                    THEN RAISE(
                        ABORT,
                        'KLBS_RETURN_ACCOUNTING_INVALID'
                    ) END;
                END
            `);

            await run(`
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
                    NEW.accounting_snapshot_version IS NOT
                        OLD.accounting_snapshot_version OR
                    NEW.customer_id IS NOT OLD.customer_id OR
                    NEW.customer_name IS NOT OLD.customer_name OR
                    NEW.customer_mobile IS NOT OLD.customer_mobile OR
                    NEW.return_reason IS NOT OLD.return_reason OR
                    NEW.remarks IS NOT OLD.remarks OR
                    NEW.created_by IS NOT OLD.created_by OR
                    NEW.created_at IS NOT OLD.created_at
                )
                BEGIN
                    SELECT RAISE(
                        ABORT,
                        'KLBS_RETURN_ACCOUNTING_IMMUTABLE'
                    );
                END
            `);

            await run(`
                CREATE TRIGGER trg_returns_accounting_immutable_delete
                BEFORE DELETE ON returns
                FOR EACH ROW
                WHEN OLD.accounting_status = 'COMPLETED'
                BEGIN
                    SELECT RAISE(
                        ABORT,
                        'KLBS_RETURN_ACCOUNTING_IMMUTABLE'
                    );
                END
            `);

            await run(`
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
                    THEN RAISE(
                        ABORT,
                        'KLBS_RETURN_ACCOUNTING_INVALID'
                    ) END;
                END
            `);

            await run(`
                CREATE TRIGGER trg_return_items_accounting_immutable_update
                BEFORE UPDATE ON return_items
                FOR EACH ROW
                WHEN EXISTS (
                    SELECT 1 FROM returns
                    WHERE id = OLD.return_id
                      AND accounting_status = 'COMPLETED'
                )
                BEGIN
                    SELECT RAISE(
                        ABORT,
                        'KLBS_RETURN_ACCOUNTING_IMMUTABLE'
                    );
                END
            `);

            await run(`
                CREATE TRIGGER trg_return_items_accounting_immutable_delete
                BEFORE DELETE ON return_items
                FOR EACH ROW
                WHEN EXISTS (
                    SELECT 1 FROM returns
                    WHERE id = OLD.return_id
                      AND accounting_status = 'COMPLETED'
                )
                BEGIN
                    SELECT RAISE(
                        ABORT,
                        'KLBS_RETURN_ACCOUNTING_IMMUTABLE'
                    );
                END
            `);

            const postCounts = await get(`
                SELECT
                    (SELECT COUNT(*) FROM returns) AS returns_count,
                    (SELECT COUNT(*) FROM return_items) AS return_items_count,
                    (SELECT COUNT(*) FROM returns
                     WHERE accounting_status = 'COMPLETED')
                        AS authoritative_count
            `);

            if (
                preCounts.returns_count !== postCounts.returns_count ||
                preCounts.return_items_count !== postCounts.return_items_count ||
                Number(postCounts.authoritative_count) !==
                    preAuthoritativeCount
            ) {
                throw new Error(
                    "Credit Note accounting migration changed historical business data."
                );
            }

            const cnIndex = await get(`
                SELECT [unique] AS is_unique, partial
                FROM pragma_index_list('returns')
                WHERE name = 'idx_returns_credit_note_canonical'
            `);
            const accountingIndex = await get(`
                SELECT name
                FROM pragma_index_list('returns')
                WHERE name = 'idx_returns_accounting_date_status'
            `);
            const installedTriggers = await get(`
                SELECT COUNT(*) AS count
                FROM sqlite_master
                WHERE type = 'trigger'
                  AND name IN (
                    'trg_returns_accounting_insert_valid',
                    'trg_returns_accounting_immutable_update',
                    'trg_returns_accounting_immutable_delete',
                    'trg_return_items_accounting_insert_valid',
                    'trg_return_items_accounting_immutable_update',
                    'trg_return_items_accounting_immutable_delete'
                  )
            `);

            if (
                !cnIndex ||
                Number(cnIndex.is_unique) !== 1 ||
                Number(cnIndex.partial) !== 1 ||
                !accountingIndex ||
                Number(installedTriggers.count) !== 6
            ) {
                throw new Error(
                    "Credit Note accounting schema verification failed."
                );
            }

            await run("COMMIT");
            transactionStarted = false;
            console.log("✓ Credit Note accounting schema ready.");
        }
        catch (error) {
            if (transactionStarted) {
                await run("ROLLBACK").catch(() => {});
            }
            throw error;
        }

    })();

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

        await migrateActivityLogSchema(db);

        console.log("✓ Activity Log schema ready.");

        await migrateAdministratorSecurity();

        await migrateManagerSecurity(db);

        await migrateProductDiscountColumn();

        await migrateCustomerCreditCustomerIdNullable();

        await migrateReturnUniquenessEnforcement();

        await migrateCreditNoteAccounting();

        await migrateDayClosingSnapshots(db);

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
