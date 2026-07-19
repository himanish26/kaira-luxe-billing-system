const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../billing.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database Connection Error:', err.message);
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

    category TEXT,

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
            CREATE TABLE IF NOT EXISTS settings (

    id INTEGER PRIMARY KEY,

    store_name TEXT,

    gstin TEXT,

    phone TEXT,

    address TEXT,

    receipt_message TEXT,

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

        console.log("All Tables Created Successfully");
    });

    

}



module.exports = db;

