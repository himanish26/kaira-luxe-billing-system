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

    const insertBillWithLines = async (suffix, specs) => {
        const billNo = `RR-BILL-${suffix}`;
        for (const spec of specs) {
            await run(db, `INSERT INTO products
                (barcode, sku, brand, category, product_name, mrp, discount, selling_price,
                 gst_rate, opening_stock, active, variable_value)
                VALUES (?, ?, 'Test', 'Test', ?, ?, ?, ?, 0, ?, 1, ?)`,
                [spec.barcode, spec.barcode, spec.productName, spec.mrp,
                    spec.discountPercent, spec.mrp, spec.qty, spec.variableValue ? 1 : 0]);
            const product = await get(db, "SELECT id FROM products WHERE barcode = ?", [spec.barcode]);
            await run(db, `INSERT INTO inventory_transactions
                (product_id, barcode, transaction_type, quantity, reference_type, reference_id, created_at)
                VALUES (?, ?, 'OPENING', ?, 'RETURN_REASON_TEST', ?, datetime('now'))`,
                [product.id, spec.barcode, spec.qty, billNo]);
        }

        const gross = specs.reduce((sum, spec) => sum + Number(spec.grossAmount ?? spec.qty * spec.mrp), 0);
        const discount = specs.reduce((sum, spec) => sum + Number(spec.discountAmount || 0), 0);
        const taxable = specs.reduce((sum, spec) => sum + Number(spec.taxableAmount), 0);
        const gst = specs.reduce((sum, spec) => sum + Number(spec.gstAmount || 0), 0);
        const net = specs.reduce((sum, spec) => sum + Number(spec.netAmount), 0);
        const quantity = specs.reduce((sum, spec) => sum + spec.qty, 0);
        await run(db, `INSERT INTO bills
            (bill_no, bill_date, bill_time, customer_name, customer_mobile, total_items,
             total_qty, gross_amount, discount_amount, taxable_amount, cgst_amount,
             sgst_amount, gst_amount, net_amount, cash_amount, upi_amount, card_amount,
             payment_status, created_at)
            VALUES (?, date('now'), '10:00:00 AM', 'Return Reason Test', '9999999999',
                    ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 0, 0, 'PAID', datetime('now'))`,
            [billNo, specs.length, quantity, gross, discount, taxable, gst, net, net]);

        for (const spec of specs) {
            const item = await run(db, `INSERT INTO bill_items
                (bill_no, barcode, product_name, brand, category, size, colour, qty, mrp,
                 discount_percent, discount_amount, taxable_amount, gst_rate, gst_amount,
                 net_amount, gross_amount)
                VALUES (?, ?, ?, 'Test', 'Test', '', '', ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
                [billNo, spec.barcode, spec.productName, spec.qty, spec.mrp,
                    spec.discountPercent, spec.discountAmount || 0, spec.taxableAmount,
                    spec.gstAmount || 0, spec.netAmount, spec.variableValue ? spec.grossAmount : null]);
            spec.billItemId = item.lastID;
        }
        return { billNo, specs };
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
        assert.strictEqual(result.return_amount, 100);
        assert.strictEqual(result.gross_reversal, 100);
        assert.strictEqual(result.discount_reversal, 0);
        assert.strictEqual(result.net_reversal, 100);
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

    const { getBillForReturn } = require("../src/database/returnService");
    const variableOnly = await insertBillWithLines("VVP-ONLY", [
        { barcode: "RR-VVP-ONLY", productName: "VVP Test Item", qty: 2, mrp: 1,
            variableValue: true, grossAmount: 80, discountPercent: 0, discountAmount: 0,
            taxableAmount: 80, gstAmount: 0, netAmount: 80 }
    ]);
    const variableOnlyLookup = await getBillForReturn(variableOnly.billNo);
    assert.strictEqual(variableOnlyLookup.items.length, 1, "VVP-only bill line remains visible");
    assert.strictEqual(Number(variableOnlyLookup.items[0].variable_value), 1);
    const baselineReturnWrites = await Promise.all([
        get(db, "SELECT COUNT(*) AS count FROM returns"),
        get(db, "SELECT COUNT(*) AS count FROM return_items"),
        get(db, "SELECT COUNT(*) AS count FROM inventory_transactions WHERE transaction_type = 'RETURN'"),
        get(db, "SELECT COUNT(*) AS count FROM store_credits"),
        get(db, "SELECT COUNT(*) AS count FROM customer_credit_transactions")
    ]);
    const assertReturnWritesUnchanged = async () => {
        const counts = await Promise.all([
            get(db, "SELECT COUNT(*) AS count FROM returns"),
            get(db, "SELECT COUNT(*) AS count FROM return_items"),
            get(db, "SELECT COUNT(*) AS count FROM inventory_transactions WHERE transaction_type = 'RETURN'"),
            get(db, "SELECT COUNT(*) AS count FROM store_credits"),
            get(db, "SELECT COUNT(*) AS count FROM customer_credit_transactions")
        ]);
        assert.deepStrictEqual(counts.map(row => row.count), baselineReturnWrites.map(row => row.count));
    };
    const forgedReturnData = (billNo, itemIds) => ({
        original_bill_no: billNo,
        customer_name: "Return Reason Test",
        customer_mobile: "9999999999",
        return_reason: reasons[0],
        items: itemIds.map(({ id, variable_value }) => ({
            original_bill_item_id: id,
            quantity: 1,
            variable_value
        }))
    });
    const quantityValidationBill = await insertBill("NORMAL-QTY-VALIDATION");
    const quantityValidationRequest = quantity => ({
        original_bill_no: quantityValidationBill.billNo,
        customer_name: "Return Reason Test",
        customer_mobile: "9999999999",
        return_reason: reasons[0],
        items: [{ original_bill_item_id: quantityValidationBill.billItemId, quantity }]
    });
    await assert.rejects(
        () => saveReturn(quantityValidationRequest(0)),
        /Returned quantity must be a positive whole number/
    );
    await assert.rejects(
        () => saveReturn(quantityValidationRequest(0.5)),
        /Returned quantity must be a positive whole number/
    );
    await assert.rejects(
        () => saveReturn(quantityValidationRequest(2)),
        /Returned quantity exceeds the original quantity sold/
    );
    await assertReturnWritesUnchanged();

    await assert.rejects(() => saveReturn(forgedReturnData(variableOnly.billNo, [
        { id: variableOnly.specs[0].billItemId, variable_value: 0 }
    ])), /Variable Value items are not eligible for return/);
    await assertReturnWritesUnchanged();

    const mixed = await insertBillWithLines("MIXED-VVP", [
        { barcode: "RR-MIX-A", productName: "Normal A", qty: 1, mrp: 100,
            variableValue: false, discountPercent: 0, discountAmount: 0, taxableAmount: 100, netAmount: 100 },
        { barcode: "RR-MIX-VVP", productName: "VVP Nighty", qty: 2, mrp: 1,
            variableValue: true, grossAmount: 80, discountPercent: 0, discountAmount: 0,
            taxableAmount: 80, gstAmount: 0, netAmount: 80 },
        { barcode: "RR-MIX-B", productName: "Normal B", qty: 2, mrp: 50,
            variableValue: false, discountPercent: 10, discountAmount: 10, taxableAmount: 90, netAmount: 90 }
    ]);
    const mixedLookup = await getBillForReturn(mixed.billNo);
    assert.strictEqual(mixedLookup.items.length, 3, "mixed lookup keeps all original lines visible");
    assert.deepStrictEqual(mixedLookup.items.map(item => Number(item.variable_value)), [0, 1, 0]);

    await assert.rejects(() => saveReturn(forgedReturnData(mixed.billNo, [
        { id: mixed.specs[1].billItemId, variable_value: 0 }
    ])), /Variable Value items are not eligible for return/);
    await assertReturnWritesUnchanged();
    await assert.rejects(() => saveReturn(forgedReturnData(mixed.billNo, [
        { id: mixed.specs[0].billItemId, variable_value: 0 },
        { id: mixed.specs[1].billItemId, variable_value: 0 }
    ])), /Variable Value items are not eligible for return/);
    await assertReturnWritesUnchanged();

    const mixedNormalReturn = await saveReturn({
        original_bill_no: mixed.billNo,
        customer_name: "Return Reason Test",
        customer_mobile: "9999999999",
        return_reason: reasons[1],
        return_amount: 145,
        items: [
            { original_bill_item_id: mixed.specs[0].billItemId, quantity: 1 },
            { original_bill_item_id: mixed.specs[2].billItemId, quantity: 1 }
        ]
    });
    assert.strictEqual(mixedNormalReturn.success, true);
    assert.strictEqual(mixedNormalReturn.return_amount, 145);
    assert.strictEqual(mixedNormalReturn.gross_reversal, 150);
    assert.strictEqual(mixedNormalReturn.discount_reversal, 5);
    assert.strictEqual(mixedNormalReturn.taxable_reversal, 145);
    assert.strictEqual(mixedNormalReturn.net_reversal, 145);
    assert.strictEqual((await get(db, `SELECT COUNT(*) AS count FROM return_items
        WHERE return_id = ? AND original_bill_item_id IN (?, ?)`,
        [mixedNormalReturn.return_id, mixed.specs[0].billItemId, mixed.specs[2].billItemId])).count, 2);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM return_items WHERE return_id = ? AND original_bill_item_id = ?",
        [mixedNormalReturn.return_id, mixed.specs[1].billItemId])).count, 0);
    assert.strictEqual((await get(db, "SELECT variable_value FROM products WHERE barcode = 'RR-MIX-VVP'")).variable_value, 1);
    assert.strictEqual((await get(db, "SELECT gross_amount FROM bill_items WHERE id = ?", [mixed.specs[1].billItemId])).gross_amount, 80);

    const integrity = await get(db, "PRAGMA integrity_check");
    assert.strictEqual(integrity.integrity_check, "ok");
    const renderer = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
    const returnService = fs.readFileSync(path.join(__dirname, "../src/database/returnService.js"), "utf8");
    assert.match(returnService, /COALESCE\(p\.variable_value, 0\) AS variable_value[\s\S]*?LEFT JOIN products p\s+ON p\.barcode = bi\.barcode/);
    assert.match(returnService, /p\.variable_value AS variable_value[\s\S]*?Number\(product\.variable_value\) === 1[\s\S]*?Variable Value items are not eligible for return/);
    assert.match(renderer, /const variableValueReturnLine = Number\(item\.variable_value\) === 1/);
    assert.match(renderer, /value="\$\{variableValueReturnLine \? 0 : item\.qty\}"[\s\S]*?\$\{variableValueReturnLine \? "disabled" : ""\}/);
    assert.match(renderer, /if \(Number\(item\.variable_value\) === 1\)\s*\{\s*item\.qty = 0;/);
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
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "klbs-return-reason-"));
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
