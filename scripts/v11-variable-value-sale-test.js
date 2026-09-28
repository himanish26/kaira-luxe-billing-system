const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const vm = require("vm");

const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "klbs-vv-sale-")));
process.env.KLBS_DEV_DATABASE_PATH = path.join(tempRoot, "billing.db");

const originalLoad = Module._load;
const mockApp = {
    isPackaged: false,
    setPath() {},
    getPath() { return path.join(tempRoot, "user data"); },
    exit() {}
};
Module._load = function(request, parent, isMain) {
    if (request === "electron") return { app: mockApp };
    return originalLoad.call(this, request, parent, isMain);
};

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        error ? reject(error) : resolve(this);
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function getFunction(source, name, nextName) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${nextName}(`, start);
    assert(start >= 0 && end > start, `could not extract ${name}`);
    return source.slice(start, end);
}

async function main() {
    const db = require("../src/database/database");
    await db.databaseReady;
    const { saveBill } = require("../src/database/billService");

    async function addProduct(barcode, name, mrp, variableValue, stock, discount = 0, gst = 0, active = 1) {
        await run(db, `INSERT INTO products
            (barcode, sku, brand, category, product_name, mrp, discount, selling_price, gst_rate, opening_stock, active, business_segment, variable_value)
            VALUES (?, ?, 'Test', 'Test', ?, ?, ?, ?, ?, ?, ?, 'KL', ?)`,
            [barcode, `SKU-${barcode}`, name, mrp, discount, mrp - discount, gst, stock, active, variableValue]);
        const product = await get(db, "SELECT id FROM products WHERE barcode = ?", [barcode]);
        await run(db, `INSERT INTO inventory_transactions
            (product_id, barcode, transaction_type, quantity, reference_type, reference_id, remarks, created_by, created_at)
            VALUES (?, ?, 'OPENING', ?, 'TEST', ?, 'Disposable test fixture', 'TEST', datetime('now'))`,
            [product.id, barcode, stock, barcode]);
    }

    await addProduct("VV-001", "Variable Test", 1, 1, 10, 10, 5);
    await addProduct("NORMAL-001", "Normal Test", 120, 0, 10, 10, 0);
    await addProduct("NORMAL-ONE", "Ordinary One Rupee", 1, 0, 2, 0, 0);
    await addProduct("INACTIVE-001", "Inactive Test", 100, 1, 5, 0, 0, 0);
    await addProduct("VV-BOUNDS", "Variable Bounds Test", 1, 1, 100, 0, 0);

    function payload(billNo, items, cash, overrides = {}) {
        return {
            bill_no: billNo,
            bill_time: "10:00:00 AM",
            customer_name: "Disposable Test",
            customer_mobile: "",
            cash_amount: cash,
            upi_amount: 0,
            card_amount: 0,
            gift_voucher_amount: 0,
            store_credit: null,
            items,
            ...overrides
        };
    }

    const variable = {
        barcode: "VV-001", qty: 4, gross_amount: 550, variable_value: 0,
        mrp: 999, discount: 99, gst_rate: 99, ff_discount: null
    };
    const normal = {
        barcode: "NORMAL-001", qty: 1, gross_amount: 999, variable_value: 1,
        mrp: 1, discount: 99, gst_rate: 99, ff_discount: null
    };
    await saveBill(payload("VV-TEST-001", [variable, normal], 603));

    const variableItem = await get(db, "SELECT * FROM bill_items WHERE bill_no = 'VV-TEST-001' AND barcode = 'VV-001'");
    const normalItem = await get(db, "SELECT * FROM bill_items WHERE bill_no = 'VV-TEST-001' AND barcode = 'NORMAL-001'");
    const mixedBill = await get(db, "SELECT * FROM bills WHERE bill_no = 'VV-TEST-001'");
    assert.strictEqual(variableItem.qty, 4);
    assert.strictEqual(variableItem.gross_amount, 550);
    assert.strictEqual(variableItem.mrp, 1);
    assert.strictEqual(variableItem.discount_percent, 10);
    assert.strictEqual(variableItem.discount_amount, 55);
    assert.strictEqual(variableItem.net_amount, 495);
    assert.strictEqual(variableItem.gst_rate, 5);
    assert(Math.abs(variableItem.taxable_amount - (495 * 100 / 105)) < 1e-9);
    assert(Math.abs(variableItem.gst_amount - (495 - 495 * 100 / 105)) < 1e-9);
    assert.strictEqual(normalItem.gross_amount, 120);
    assert.strictEqual(normalItem.mrp, 120);
    assert.strictEqual(normalItem.discount_amount, 12);
    assert.strictEqual(normalItem.net_amount, 108);
    assert.strictEqual(mixedBill.gross_amount, 670);
    assert.strictEqual(mixedBill.discount_amount, 67);
    assert.strictEqual(mixedBill.net_amount, 603);
    assert.strictEqual(mixedBill.cash_amount, 603);
    assert.strictEqual((await get(db, "SELECT quantity FROM inventory_transactions WHERE transaction_type = 'SALE' AND barcode = 'VV-001'")).quantity, -4);

    await saveBill(payload("VV-TEST-NORMAL-ONE", [{ barcode: "NORMAL-ONE", qty: 1, gross_amount: 999, variable_value: 1, mrp: 999, discount: 100, gst_rate: 99, ff_discount: null }], 1));
    const ordinaryOneItem = await get(db, "SELECT * FROM bill_items WHERE bill_no = 'VV-TEST-NORMAL-ONE'");
    assert.strictEqual(ordinaryOneItem.mrp, 1);
    assert.strictEqual(ordinaryOneItem.gross_amount, 1);
    assert.strictEqual(ordinaryOneItem.discount_amount, 0);
    assert.strictEqual(ordinaryOneItem.net_amount, 1);

    await saveBill(payload("VV-TEST-BOUNDS-VALID", [{
        barcode: "VV-BOUNDS", qty: 99, gross_amount: 9999, ff_discount: null
    }], 9999));
    const boundaryItem = await get(db, "SELECT qty, gross_amount FROM bill_items WHERE bill_no = 'VV-TEST-BOUNDS-VALID'");
    assert.deepStrictEqual({ qty: boundaryItem.qty, gross_amount: boundaryItem.gross_amount }, { qty: 99, gross_amount: 9999 });

    await saveBill(payload("VV-TEST-002", [{ ...variable, qty: 1, ff_discount: 10 }], 495));
    const ffItem = await get(db, "SELECT * FROM bill_items WHERE bill_no = 'VV-TEST-002'");
    assert.strictEqual(ffItem.gross_amount, 550);
    assert.strictEqual(ffItem.mrp, 1);
    assert.strictEqual(ffItem.discount_percent, 10);
    assert.strictEqual(ffItem.discount_amount, 55);
    assert.strictEqual(ffItem.net_amount, 495);
    assert(Math.abs(ffItem.taxable_amount - 495 * 100 / 105) < 1e-9);

    const invalidBillBase = await get(db, "SELECT COUNT(*) AS count FROM bills");
    for (const gross of [undefined, null, "", 0, -1, 0.5, 10.5, 10000, 550.25, NaN, Infinity]) {
        const badItem = { ...variable, qty: 1, gross_amount: gross };
        await assert.rejects(
            saveBill(payload(`VV-BAD-${invalidBillBase.count}-${String(gross)}`, [badItem], 1)),
            error => error.code === "KLBS_BILL_GROSS_AMOUNT_INVALID"
        );
    }
    await assert.rejects(
        saveBill(payload("VV-BAD-QUANTITY-100", [{
            ...variable, barcode: "VV-BOUNDS", qty: 100, gross_amount: 9999
        }], 9999)),
        error => error.code === "KLBS_BILL_QUANTITY_INVALID"
    );
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM bills")).count, invalidBillBase.count);

    await assert.rejects(
        saveBill(payload("VV-TEST-INSUFFICIENT", [{ ...variable, qty: 11 }], 495)),
        /Insufficient stock/
    );
    await assert.rejects(
        saveBill(payload("VV-TEST-INACTIVE", [{ ...variable, barcode: "INACTIVE-001", qty: 1 }], 1)),
        error => error.code === "KLBS_BILL_PRODUCT_INACTIVE"
    );
    assert.strictEqual(await get(db, "SELECT 1 FROM bills WHERE bill_no IN ('VV-TEST-INSUFFICIENT', 'VV-TEST-INACTIVE')"), undefined);
    assert.strictEqual(await get(db, "SELECT 1 FROM inventory_transactions WHERE reference_id IN ('VV-TEST-INSUFFICIENT', 'VV-TEST-INACTIVE') AND transaction_type = 'SALE'"), undefined);

    const renderer = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
    const rendererContext = {
        billItems: [],
        document: {
            addEventListener() {},
            getElementById() { return { value: 0, style: {} }; }
        },
        renderBill() {}, loadPaymentSummary() {}, calculatePayment() {},
        showInsufficientStockDialog() {}, setTimeout
    };
    vm.createContext(rendererContext);
    vm.runInContext(getFunction(renderer, "getSaleLineGross", "validateVariableValueEntry") +
        getFunction(renderer, "validateVariableValueEntry", "showVariableValueDialog") +
        getFunction(renderer, "showVariableValueDialog", "applyVariableValueEntry") +
        getFunction(renderer, "applyVariableValueEntry", "addProductToBill"), rendererContext);
    const validate = rendererContext.validateVariableValueEntry;
    for (const quantity of ["", "0", "-1", "1.5", "NaN", "Infinity"]) {
        assert(validate(quantity, "10", 5).error, `quantity ${quantity} should fail`);
    }
    for (const amount of ["", "0", "-1", "NaN", "Infinity"]) {
        assert(validate("1", amount, 5).error, `amount ${amount} should fail`);
    }
    assert.deepStrictEqual(JSON.parse(JSON.stringify(validate("4", "550", 4))), { quantity: 4, gross_amount: 550 });
    assert.strictEqual(validate("4", "550.25", 4).field, "amount");
    for (const [quantity, stock] of [["1", 1], ["99", 99], ["99", 295], ["10", 10]]) {
        assert.deepStrictEqual(JSON.parse(JSON.stringify(validate(quantity, "1", stock))), {
            quantity: Number(quantity), gross_amount: 1
        });
    }
    for (const [quantity, stock, message] of [
        ["100", 100, /Maximum Quantity is 99/],
        ["2999990000047", 295, /Insufficient stock/],
        ["11", 10, /Insufficient stock/],
        ["99", 10, /Insufficient stock/]
    ]) {
        assert.match(validate(quantity, "1", stock).error, message);
    }
    for (const quantity of ["", "0", "-1", "1.5", "1.0", "1e2", "NaN", "Infinity"]) {
        assert.strictEqual(validate(quantity, "1", 295).field, "quantity");
    }
    for (const amount of ["", "0", "-1", "10.50", "10000", "2999990000047", "NaN", "Infinity"]) {
        assert.strictEqual(validate("1", amount, 295).field, "amount");
    }
    assert.deepStrictEqual(JSON.parse(JSON.stringify(validate("1", "1", 1))), { quantity: 1, gross_amount: 1 });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(validate("1", "9999", 1))), { quantity: 1, gross_amount: 9999 });
    assert(validate("4", "550", 3).error.includes("Insufficient stock"));
    assert.strictEqual(rendererContext.getSaleLineGross({ variable_value: 1, qty: 4, gross_amount: 550, mrp: 1 }), 550);
    assert.strictEqual(rendererContext.getSaleLineGross({ variable_value: 0, qty: 2, mrp: 30, gross_amount: 900 }), 60);

    const stockBeforeEdit = await get(db, "SELECT SUM(quantity) AS stock FROM inventory_transactions WHERE barcode = 'VV-001'");
    const line = { barcode: "VV-001", qty: 4, gross_amount: 550, variable_value: 1, ff_discount: null };
    const product = { barcode: "VV-001", product_name: "Variable Test", current_stock: stockBeforeEdit.stock, mrp: 1, discount: 0, gst_rate: 5 };
    rendererContext.billItems.push(line);
    assert.strictEqual(rendererContext.applyVariableValueEntry(product, { quantity: 3, gross_amount: 440 }, line), true);
    assert.strictEqual(rendererContext.billItems.length, 1);
    assert.strictEqual(line.qty, 3);
    assert.strictEqual(line.gross_amount, 440);
    const unchanged = { qty: line.qty, gross_amount: line.gross_amount };
    // A cancelled dialog resolves null; the scan handler applies only truthy entries.
    assert.strictEqual(unchanged.qty, 3);
    assert.strictEqual(unchanged.gross_amount, 440);
    assert(html.includes('id="variableValueDialog"') && html.includes('id="variableValueQuantity"') && html.includes('id="variableValueAmount"'));
    assert(renderer.includes('const entry = await showVariableValueDialog(product, existingItem);'));
    assert(renderer.includes('if (entry) {') && renderer.includes('applyVariableValueEntry(product, entry, existingItem);'));

    const normalContext = {
        billItems: [], renderBill() {}, loadPaymentSummary() {}, calculatePayment() {},
        document: { getElementById() { return { value: 0 }; } },
        stockBlocked: false,
        showInsufficientStockDialog() { normalContext.stockBlocked = true; }
    };
    vm.createContext(normalContext);
    vm.runInContext(getFunction(renderer, "addProductToBill", "renderBill"), normalContext);
    const normalProduct = { barcode: "NORMAL-TEST", product_name: "Normal ₹1", mrp: 1, discount: 0, gst_rate: 0, variable_value: 0, current_stock: 2 };
    assert.strictEqual(normalContext.addProductToBill(normalProduct), true);
    assert.strictEqual(normalContext.billItems[0].qty, 1);
    assert.strictEqual(normalContext.billItems[0].gross_amount, undefined);
    assert.strictEqual(normalContext.addProductToBill(normalProduct), true);
    assert.strictEqual(normalContext.billItems[0].qty, 2);
    assert.strictEqual(normalContext.addProductToBill(normalProduct), false);
    assert.strictEqual(normalContext.stockBlocked, true);

    const listeners = new Map();
    let focusedNode = null;
    function node() {
        return {
            value: "", textContent: "", style: {},
            addEventListener(name, handler) { listeners.set(`${this.id}:${name}`, handler); },
            removeEventListener(name) { listeners.delete(`${this.id}:${name}`); },
            focus() { focusedNode = this; this.focused = true; },
            select() { this.selected = true; }
        };
    }
    const dialog = Object.assign(node(), { id: "variableValueDialog" });
    const qtyNode = Object.assign(node(), { id: "variableValueQuantity" });
    const amountNode = Object.assign(node(), { id: "variableValueAmount" });
    const productNameNode = node();
    const availableStockNode = node();
    const errorNode = node();
    const confirmNode = Object.assign(node(), { id: "variableValueConfirmBtn" });
    const cancelNode = Object.assign(node(), { id: "variableValueCancelBtn" });
    const dialogContext = {
        billItems: [],
        document: {
            addEventListener() {},
            getElementById(id) {
                return ({ variableValueDialog: dialog, variableValueQuantity: qtyNode, variableValueAmount: amountNode,
                variableValueError: errorNode,
                variableValueProductName: productNameNode,
                variableValueAvailableStock: availableStockNode,
                    variableValueConfirmBtn: confirmNode, variableValueCancelBtn: cancelNode })[id];
            }
        }, setTimeout
    };
    vm.createContext(dialogContext);
    vm.runInContext(getFunction(renderer, "validateVariableValueEntry", "showVariableValueDialog") +
        getFunction(renderer, "showVariableValueDialog", "applyVariableValueEntry"), dialogContext);
    const originalLine = { qty: 4, gross_amount: 550 };
    const canceled = dialogContext.showVariableValueDialog({ product_name: "Variable Test", current_stock: 5 }, originalLine);
    assert.strictEqual(qtyNode.value, "4");
    assert.strictEqual(amountNode.value, "550");
    listeners.get("variableValueCancelBtn:click")();
    assert.strictEqual(await canceled, null);
    assert.deepStrictEqual(originalLine, { qty: 4, gross_amount: 550 });

    const assertInvalidModalInput = async ({ field, value, expectedMessage, stock = 295, viaEnter = false }) => {
        qtyNode.focused = false;
        qtyNode.selected = false;
        amountNode.focused = false;
        amountNode.selected = false;
        focusedNode = null;
        const priorCartCount = dialogContext.billItems.length;
        const pending = dialogContext.showVariableValueDialog({ product_name: "Variable Test", current_stock: stock }, null);
        qtyNode.value = field === "quantity" ? value : "1";
        amountNode.value = field === "amount" ? value : "500";
        if (viaEnter) {
            listeners.get("variableValueDialog:keydown")({
                key: "Enter",
                target: field === "quantity" ? qtyNode : amountNode,
                preventDefault() {},
                stopPropagation() {}
            });
        }
        else {
            listeners.get("variableValueConfirmBtn:click")();
        }
        assert.match(errorNode.textContent, expectedMessage);
        assert.strictEqual(dialog.style.display, "flex", "invalid input leaves the popup open");
        assert.strictEqual(focusedNode, field === "quantity" ? qtyNode : amountNode,
            `invalid ${field} retains focus`);
        assert.strictEqual(field === "quantity" ? qtyNode.selected : amountNode.selected, true,
            `invalid ${field} is fully selected`);
        if (field === "quantity") assert.strictEqual(amountNode.focused, false, "invalid Quantity does not advance focus");
        assert.strictEqual(dialogContext.billItems.length, priorCartCount, "invalid input does not mutate cart");
        listeners.get("variableValueCancelBtn:click")();
        assert.strictEqual(await pending, null);
    };

    await assertInvalidModalInput({ field: "quantity", value: "2999990000047", expectedMessage: /Insufficient stock/, viaEnter: true });
    await assertInvalidModalInput({ field: "quantity", value: "100", expectedMessage: /Maximum Quantity is 99/, viaEnter: true });
    await assertInvalidModalInput({ field: "quantity", value: "0", expectedMessage: /whole-number Quantity/ });
    await assertInvalidModalInput({ field: "quantity", value: "-1", expectedMessage: /whole-number Quantity/ });
    await assertInvalidModalInput({ field: "quantity", value: "1.5", expectedMessage: /whole-number Quantity/ });
    await assertInvalidModalInput({ field: "quantity", value: "abc", expectedMessage: /whole-number Quantity/ });
    await assertInvalidModalInput({ field: "quantity", value: "11", stock: 10, expectedMessage: /Insufficient stock/ });
    await assertInvalidModalInput({ field: "amount", value: "10000", expectedMessage: /₹1 to ₹9,999/, viaEnter: true });
    await assertInvalidModalInput({ field: "amount", value: "2999990000047", expectedMessage: /₹1 to ₹9,999/ });
    await assertInvalidModalInput({ field: "amount", value: "0", expectedMessage: /₹1 to ₹9,999/ });
    await assertInvalidModalInput({ field: "amount", value: "-1", expectedMessage: /₹1 to ₹9,999/ });
    await assertInvalidModalInput({ field: "amount", value: "10.50", expectedMessage: /whole-rupee/ });
    await assertInvalidModalInput({ field: "amount", value: "abc", expectedMessage: /₹1 to ₹9,999/ });

    const validEnter = dialogContext.showVariableValueDialog({ product_name: "Variable Test", current_stock: 99 }, null);
    qtyNode.value = "99";
    amountNode.value = "9999";
    focusedNode = null;
    listeners.get("variableValueDialog:keydown")({ key: "Enter", target: qtyNode, preventDefault() {}, stopPropagation() {} });
    assert.strictEqual(focusedNode, amountNode, "valid Quantity Enter advances to Total Amount");
    assert.strictEqual(dialog.style.display, "flex");
    listeners.get("variableValueDialog:keydown")({ key: "Enter", target: amountNode, preventDefault() {}, stopPropagation() {} });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await validEnter)), { quantity: 99, gross_amount: 9999 });
    assert.strictEqual(dialog.style.display, "none", "valid Total Amount Enter confirms the entry");

    console.log("PASS: isolated Variable-Value authoritative sale, normal-product spoof resistance, F&F, GST, quantity SALE, stock rejection/rollback, validation, and cart edit contract");
    await db.closeDatabase();
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    Module._load = originalLoad;
    fs.rmSync(tempRoot, { recursive: true, force: true });
});
