const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const reasons = [
    "Size / Fit Issue",
    "Colour / Preference Issue",
    "Gift / Unwanted Item",
    "Product Defect / Damage"
];

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
    const { saveReturn } = require("../src/database/returnService");

    const insertBill = async (suffix, qty = 1) => {
        const barcode = `RR-${suffix}`;
        const billNo = `RR-BILL-${suffix}`;
        await run(db, `INSERT INTO products
            (barcode, sku, brand, category, product_name, mrp, discount, selling_price,
             gst_rate, opening_stock, active)
            VALUES (?, ?, 'Test', 'Test', ?, 100, 0, 100, 0, ?, 1)`,
            [barcode, barcode, barcode, qty]);
        const product = await get(db, "SELECT id FROM products WHERE barcode = ?", [barcode]);
        await run(db, `INSERT INTO inventory_transactions
            (product_id, barcode, transaction_type, quantity, reference_type, reference_id, created_at)
            VALUES (?, ?, 'OPENING', ?, 'RETURN_REASON_TEST', ?, datetime('now'))`,
            [product.id, barcode, qty, billNo]);
        await run(db, `INSERT INTO bills
            (bill_no, bill_date, bill_time, customer_name, customer_mobile, total_items,
             total_qty, gross_amount, discount_amount, taxable_amount, cgst_amount,
             sgst_amount, gst_amount, net_amount, cash_amount, upi_amount, card_amount,
             payment_status, created_at)
            VALUES (?, date('now'), '10:00:00 AM', 'Return Reason Test', '9999999999',
                    1, ?, 100, 0, 100, 0, 0, 0, 100, 100, 0, 0, 'PAID', datetime('now'))`,
            [billNo, qty]);
        const billItem = await run(db, `INSERT INTO bill_items
            (bill_no, barcode, product_name, qty, mrp, discount_percent, discount_amount,
             taxable_amount, gst_rate, gst_amount, net_amount)
            VALUES (?, ?, ?, ?, 100, 0, 0, 100, 0, 0, 100)`,
            [billNo, barcode, barcode, qty]);
        return { barcode, billNo, billItemId: billItem.lastID };
    };

    for (const [index, reason] of reasons.entries()) {
        const fixture = await insertBill(`VALID-${index}`);
        const result = await saveReturn({
            original_bill_no: fixture.billNo,
            customer_name: "Return Reason Test",
            customer_mobile: "9999999999",
            return_reason: reason,
            return_amount: 100,
            items: [{ original_bill_item_id: fixture.billItemId, quantity: 1 }]
        });
        assert.strictEqual(result.success, true);
        const row = await get(db, "SELECT return_reason FROM returns WHERE return_no = ?", [result.return_no]);
        assert.strictEqual(row.return_reason, reason);
        const activity = await get(db, `SELECT details, change_data FROM activities
            WHERE category = 'RETURN' AND action = 'RETURN_COMPLETED' AND reference_no = ?`, [result.return_no]);
        assert(activity && activity.details.includes(`Return Reason: ${reason}`));
        assert(activity.change_data.includes(reason));
        assert.strictEqual((await get(db, `SELECT COUNT(*) AS count FROM activities
            WHERE category = 'RETURN' AND action = 'RETURN_COMPLETED' AND reference_no = ?`, [result.return_no])).count, 1);
        assert.strictEqual((await get(db, `SELECT COUNT(*) AS count FROM activities
            WHERE reference_no = ? AND action LIKE '%REASON%'`, [result.return_no])).count, 0);
        assert.strictEqual((await get(db, `SELECT COUNT(*) AS count FROM activities
            WHERE category = 'CREDIT NOTE' AND details LIKE ?`, [`%Return ${result.return_no}%`])).count, 1);
        assert.strictEqual((await get(db, `SELECT COUNT(*) AS count FROM activities
            WHERE category = 'STORE CREDIT' AND details LIKE ?`, [`%Return ${result.return_no}%`])).count, 1);
    }

    const invalidReasons = [undefined, "", "   ", "Other", "Customer Changed Mind", "random text"];
    for (const [index, reason] of invalidReasons.entries()) {
        const fixture = await insertBill(`INVALID-${index}`);
        await assert.rejects(
            () => saveReturn({
                original_bill_no: fixture.billNo,
                customer_name: "Return Reason Test",
                customer_mobile: "9999999999",
                return_reason: reason,
                return_amount: 100,
                items: [{ original_bill_item_id: fixture.billItemId, quantity: 1 }]
            }),
            /valid Return Reason/
        );
        assert.strictEqual(await get(db, "SELECT COUNT(*) AS count FROM returns WHERE original_bill_no = ?", [fixture.billNo]).then(row => row.count), 0);
        assert.strictEqual(await get(db, `SELECT COUNT(*) AS count FROM return_items ri
            INNER JOIN returns r ON r.id = ri.return_id WHERE r.original_bill_no = ?`, [fixture.billNo]).then(row => row.count), 0);
        assert.strictEqual(await get(db, "SELECT COUNT(*) AS count FROM inventory_transactions WHERE reference_type = 'RETURN' AND reference_id = ?", [fixture.billNo]).then(row => row.count), 0);
        assert.strictEqual(await get(db, "SELECT COUNT(*) AS count FROM activities WHERE reference_no = ?", [fixture.billNo]).then(row => row.count), 0);
    }

    const multi = await insertBill("MULTI", 2);
    const multiResult = await saveReturn({
        original_bill_no: multi.billNo,
        customer_name: "Return Reason Test",
        customer_mobile: "9999999999",
        return_reason: reasons[1],
        return_amount: 200,
        items: [{ original_bill_item_id: multi.billItemId, quantity: 2 }]
    });
    assert.strictEqual((await get(db, "SELECT return_reason FROM returns WHERE return_no = ?", [multiResult.return_no])).return_reason, reasons[1]);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM return_items WHERE return_id = (SELECT id FROM returns WHERE return_no = ?)", [multiResult.return_no])).count, 1);

    const integrity = await get(db, "PRAGMA integrity_check");
    assert.strictEqual(integrity.integrity_check, "ok");
    const renderer = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
    reasons.forEach(reason => assert(html.includes(`value="${reason}"`)));
    assert(renderer.includes("showReturnReasonDialog"));
    assert(!renderer.includes('return_reason:\n                        "Customer Return"'));
    await close(db);
    process.stdout.write("Return reason regression tests: PASS\n");
    app.exit(0);
}

if (process.argv.includes("--child")) {
    child(process.argv[process.argv.indexOf("--child") + 1]).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
} else {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-return-reason-"));
    const electronBinary = require("electron");
    const result = spawnSync(electronBinary, ["--disable-gpu", "--in-process-gpu", __filename, "--child", tempRoot], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "billing.db") },
        encoding: "utf8",
        timeout: 120000,
        windowsHide: true
    });
    if (result.status !== 0) {
        process.stdout.write(result.stdout || "");
        process.stderr.write(result.stderr || "");
        process.exit(result.status || 1);
    }
    process.stdout.write(result.stdout);
}
