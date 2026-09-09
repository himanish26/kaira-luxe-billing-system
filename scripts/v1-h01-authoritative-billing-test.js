const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function (error) {
        error ? reject(error) : resolve(this);
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => {
        error ? reject(error) : resolve(row);
    }));
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function child(tempRoot) {
    const { app } = require("electron");
    app.setPath("userData", path.join(tempRoot, "user data"));

    const db = require("../src/database/database");
    await db.databaseReady;

    await run(db, `
        INSERT INTO products
            (barcode, sku, brand, product_name, mrp, discount, selling_price, gst_rate, opening_stock, active)
        VALUES ('890-H01', 'H01-A', 'H01', 'H-01 Product', 1200, 20, 1100, 12, 10, 1)
    `);
    await run(db, `
        INSERT INTO inventory_transactions
            (product_id, barcode, transaction_type, quantity, reference_type, reference_id, remarks, created_by, created_at)
        SELECT id, barcode, 'OPENING', 10, 'H01_TEST', 'H01', 'H-01 disposable test', 'TEST', datetime('now')
        FROM products WHERE barcode = '890-H01'
    `);
    const product = await get(db, "SELECT mrp, discount, gst_rate, active FROM products WHERE barcode = '890-H01'");
    assert.deepStrictEqual(product, { mrp: 1200, discount: 20, gst_rate: 12, active: 1 });

    const { saveBill } = require("../src/database/billService");

    const payload = (billNo, overrides = {}) => ({
        bill_no: billNo,
        bill_time: "10:00:00 AM",
        customer_name: "H-01 Test",
        customer_mobile: "",
        total_items: 1,
        total_qty: 1,
        gross_amount: 1000,
        discount_amount: 100,
        taxable_amount: 857,
        cgst_amount: 45,
        sgst_amount: 45,
        gst_amount: 90,
        net_amount: 990,
        cash_amount: 960,
        upi_amount: 0,
        card_amount: 0,
        gift_voucher_amount: 0,
        store_credit: null,
        items: [{
            barcode: "890-H01",
            product_name: "Forged renderer name",
            brand: "Forged",
            category: "Forged",
            size: "F",
            colour: "F",
            qty: 1,
            mrp: 1000,
            master_discount: 10,
            discount: 10,
            gst_rate: 5,
            ff_discount: null
        }],
        ...overrides
    });

    await saveBill(payload("H01-001"));
    const saved = await get(db, "SELECT * FROM bill_items WHERE bill_no = 'H01-001'");
    const bill = await get(db, "SELECT * FROM bills WHERE bill_no = 'H01-001'");

    assert.strictEqual(saved.mrp, 1200);
    assert.strictEqual(saved.gst_rate, 12);
    assert.strictEqual(saved.discount_percent, 20);
    assert.strictEqual(bill.net_amount, 960);

    await run(db, "UPDATE products SET mrp = 1300, discount = 15, gst_rate = 18 WHERE barcode = '890-H01'");
    await saveBill(payload("H01-003", {
        cash_amount: 1105,
        items: [{
            barcode: "890-H01",
            product_name: "Old cart name",
            qty: 1,
            mrp: 1200,
            discount: 20,
            gst_rate: 12,
            ff_discount: null
        }]
    }));
    const updated = await get(db, "SELECT * FROM bill_items WHERE bill_no = 'H01-003'");
    assert.strictEqual(updated.mrp, 1300);
    assert.strictEqual(updated.gst_rate, 18);
    assert.strictEqual(updated.discount_percent, 15);
    assert.strictEqual((await get(db, "SELECT gst_rate FROM bill_items WHERE bill_no = 'H01-001'")).gst_rate, 12);

    await saveBill(payload("H01-004", {
        cash_amount: 975,
        items: [{
            barcode: "890-H01",
            product_name: "Forged renderer name",
            qty: 1,
            mrp: 1,
            discount: 1,
            gst_rate: 1,
            ff_discount: 25
        }]
    }));
    const familyFriendsBill = await get(db, "SELECT discount_percent FROM bill_items WHERE bill_no = 'H01-004'");
    assert.strictEqual(familyFriendsBill.discount_percent, 25);

    await assert.rejects(
        saveBill(payload("H01-005", {
            cash_amount: 975,
            items: [{ ...payload("unused").items[0], ff_discount: 31 }]
        })),
        error => error.code === "KLBS_BILL_DISCOUNT_INVALID"
    );
    assert.strictEqual(await get(db, "SELECT 1 AS found FROM bills WHERE bill_no = 'H01-005'"), undefined);

    await run(db, `
        INSERT INTO products
            (barcode, sku, brand, product_name, mrp, discount, selling_price, gst_rate, opening_stock, active)
        VALUES ('890-H01-B', 'H01-B', 'H01', 'H-01 Product B', 1000, 0, 900, 5, 1, 1)
    `);
    await run(db, `
        INSERT INTO inventory_transactions
            (product_id, barcode, transaction_type, quantity, reference_type, reference_id, remarks, created_by, created_at)
        SELECT id, barcode, 'OPENING', 1, 'H01_TEST', 'H01-B', 'H-01 disposable test', 'TEST', datetime('now')
        FROM products WHERE barcode = '890-H01-B'
    `);
    await saveBill(payload("H01-006", {
        cash_amount: 2105,
        items: [
            { barcode: "890-H01", qty: 1, mrp: 1, discount: 1, gst_rate: 1, ff_discount: null },
            { barcode: "890-H01-B", qty: 1, mrp: 1, discount: 1, gst_rate: 1, ff_discount: null }
        ]
    }));
    const mixed = await get(db, "SELECT COUNT(*) AS count FROM bill_items WHERE bill_no = 'H01-006'");
    assert.strictEqual(mixed.count, 2);

    await assert.rejects(
        saveBill(payload("H01-007", {
            cash_amount: 1300,
            items: [{ ...payload("unused").items[0], mrp: 1300, discount: 15, gst_rate: 18 }]
        })),
        error => error.code === "KLBS_BILL_SETTLEMENT_MISMATCH"
    );
    assert.strictEqual(await get(db, "SELECT 1 AS found FROM bills WHERE bill_no = 'H01-007'"), undefined);

    await run(db, `
        INSERT INTO returns
            (return_no, original_bill_no, business_date, original_bill_date, customer_name,
             customer_mobile, return_reason, return_amount, created_at)
        VALUES ('H01-RETURN', 'H01-001', date('now'), date('now'), 'H-01 Test', '9999999999', 'H-01 test', 1105, datetime('now'))
    `);
    await run(db, `
        INSERT INTO store_credits
            (store_credit_no, return_id, original_bill_no, customer_name, customer_mobile,
             issue_date, valid_until, original_amount, remaining_balance, status, created_at)
        VALUES ('H01-SC', (SELECT id FROM returns WHERE return_no = 'H01-RETURN'), 'H01-001',
                'H-01 Test', '9999999999', date('now'), date('now', '+180 day'), 1105, 1105, 'ISSUED', datetime('now'))
    `);
    await saveBill(payload("H01-008", {
        customer_mobile: "9999999999",
        cash_amount: 0,
        store_credit: { store_credit_no: "H01-SC", amount: 1105 },
        items: [{ ...payload("unused").items[0], mrp: 1300, discount: 15, gst_rate: 18 }]
    }));
    const redeemed = await get(db, "SELECT status, remaining_balance FROM store_credits WHERE store_credit_no = 'H01-SC'");
    assert.strictEqual(redeemed.status, "REDEEMED");
    assert.strictEqual(redeemed.remaining_balance, 0);

    await saveBill(payload("H01-009", {
        cash_amount: 0,
        gift_voucher_amount: 1105,
        items: [{ ...payload("unused").items[0], mrp: 1300, discount: 15, gst_rate: 18 }]
    }));
    assert.strictEqual((await get(db, "SELECT gift_voucher_amount FROM bills WHERE bill_no = 'H01-009'")).gift_voucher_amount, 1105);

    await assert.rejects(
        saveBill(payload("H01-010", {
            cash_amount: 0,
            items: [{ ...payload("unused").items[0], barcode: "MISSING-H01" }]
        })),
        error => error.code === "KLBS_BILL_PRODUCT_NOT_FOUND"
    );
    assert.strictEqual(await get(db, "SELECT 1 AS found FROM bills WHERE bill_no = 'H01-010'"), undefined);

    await run(db, "UPDATE products SET active = 0 WHERE barcode = '890-H01'");
    await assert.rejects(
        saveBill(payload("H01-002")),
        error => error.code === "KLBS_BILL_PRODUCT_INACTIVE"
    );
    assert.strictEqual(await get(db, "SELECT 1 AS found FROM bills WHERE bill_no = 'H01-002'"), undefined);
    assert.strictEqual(await get(db, "SELECT 1 AS found FROM inventory_transactions WHERE reference_id = 'H01-002'"), undefined);

    await close(db);
    process.stdout.write("H-01 disposable authoritative billing tests: PASS\n");
    app.exit(0);
}

if (process.argv.includes("--h01-child")) {
    child(process.argv[process.argv.indexOf("--h01-child") + 1]).catch(error => {
        console.error(error);
        try { require("electron").app.exit(1); } catch (_) {}
        process.exitCode = 1;
    });
}
else {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-h01-"));
    const electronBinary = require("electron");
    const result = spawnSync(
        electronBinary,
        ["--disable-gpu", "--in-process-gpu", __filename, "--h01-child", tempRoot],
        {
            cwd: path.resolve(__dirname, ".."),
            env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "billing.db") },
            encoding: "utf8",
            timeout: 120000,
            windowsHide: true
        }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
        process.stdout.write(result.stdout || "");
        process.stderr.write(result.stderr || "");
        process.exit(result.status || 1);
    }
    process.stdout.write(result.stdout);
}
