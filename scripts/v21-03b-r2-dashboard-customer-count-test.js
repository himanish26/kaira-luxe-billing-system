"use strict";

const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) {
    error ? reject(error) : resolve(this);
}));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

async function main() {
    const db = new sqlite3.Database(":memory:");
    const databasePath = require.resolve("../src/database/database");
    require.cache[databasePath] = { exports: db };
    const customers = require("../src/database/customerService");
    const { getDashboardSummary } = require("../src/database/billService");

    try {
        await run(db, "CREATE TABLE products (id INTEGER PRIMARY KEY)");
        await run(db, `CREATE TABLE customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT, customer_code TEXT UNIQUE,
            name TEXT NOT NULL, mobile TEXT, email TEXT, address TEXT, remarks TEXT,
            active INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            birthday_ddmm TEXT, marriage_anniversary_ddmm TEXT
        )`);
        await run(db, `CREATE TABLE bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT, bill_no TEXT, bill_date TEXT,
            customer_name TEXT, customer_mobile TEXT, customer_id INTEGER,
            total_qty INTEGER DEFAULT 0, net_amount REAL DEFAULT 0,
            cash_amount REAL DEFAULT 0, upi_amount REAL DEFAULT 0,
            card_amount REAL DEFAULT 0, store_credit_amount REAL DEFAULT 0,
            gift_voucher_amount REAL DEFAULT 0
        )`);

        const count = async () => Number((await getDashboardSummary()).customers);
        assert.strictEqual(await count(), 0, "zero active profiles produce a zero Dashboard Customers count");

        await run(db, `INSERT INTO bills (bill_no, bill_date, customer_name, customer_mobile)
            VALUES ('LEGACY-SNAPSHOT', '2024-01-01', 'Historical Name', '9876543210')`);
        assert.strictEqual(await count(), 0, "historical unlinked bill snapshots do not count as profiles");

        const first = await customers.createCustomerProfile({ name: "Manual Profile", mobile: "9876543210" });
        assert.strictEqual(await count(), 1, "a manually created active profile increments the count once");
        const second = await customers.createCustomerProfile({ name: "Shared Mobile Profile", mobile: "9876543210" });
        assert.strictEqual(await count(), 2, "shared-mobile profiles count independently by customer row");

        await run(db, `INSERT INTO bills (bill_no, bill_date, customer_name, customer_mobile, customer_id, net_amount)
            VALUES ('LINKED-1', '2026-10-01', 'Sale Snapshot', '9876543210', ?, 100),
                   ('LINKED-2', '2026-10-02', 'Sale Snapshot', '9876543210', ?, 200),
                   ('UNLINKED-2', '2026-10-03', 'Other Snapshot', '9876543210', NULL, 300)`, [first.id, first.id]);
        assert.strictEqual(await count(), 2, "more bills for an existing profile do not change profile count");

        const billingCreatedProfile = await customers.createCustomerProfile({ name: "Billing-created Profile", mobile: "9123456780" });
        assert.strictEqual(billingCreatedProfile.id > second.id, true);
        assert.strictEqual(await count(), 3, "a profile created by the same customer service population counts regardless of creation source");

        await run(db, "UPDATE customers SET active = 0 WHERE id = ?", [second.id]);
        assert.strictEqual(await count(), 2, "Dashboard and Customer Directory both count active profiles only");

        console.log("V21-03B-R2 Dashboard customer authority: PASS (active profile count, shared mobile, linked and unlinked bills, billing-created profile population)");
    } finally {
        delete require.cache[require.resolve("../src/database/billService")];
        delete require.cache[require.resolve("../src/database/customerService")];
        delete require.cache[databasePath];
        await close(db);
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
