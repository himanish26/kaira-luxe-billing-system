const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        error ? reject(error) : resolve(this);
    }));
}
function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}
function close(db) { return new Promise(resolve => db.close(() => resolve())); }

async function child(root) {
    const { app } = require("electron");
    app.setPath("userData", path.join(root, "user data"));
    const db = require("../src/database/database");
    await db.databaseReady;
    const customers = require("../src/database/customerService");
    const { saveBill } = require("../src/database/billService");
    const now = new Date().toISOString();

    assert.strictEqual(customers.normalizeIndianMobile("9876543210"), "9876543210");
    assert.strictEqual(customers.normalizeIndianMobile("987654321"), null);
    assert.strictEqual(customers.normalizeDdMm("29/02"), "29/02");
    assert.throws(() => customers.normalizeDdMm("31/04"));
    assert.throws(() => customers.normalizeDdMm("2020-02-29"));

    for (const email of ["himanish26@gmail.com", "store@kairaluxe.in", "accounts+kl@gmail.com", "customer.name@example.co.in"]) {
        assert.strictEqual(customers.normalizeOptionalEmail(email), email);
    }
    assert.strictEqual(customers.normalizeOptionalEmail("   "), null, "blank email is optional");
    assert.strictEqual(customers.normalizeOptionalEmail("  accounts+kl@gmail.com  "), "accounts+kl@gmail.com", "email trims only surrounding whitespace");
    for (const email of ["himanish26.com", "himanish26@", "@gmail.com", "himanish26@gmail", "himanish26 @gmail.com", "himanish26@gmail..com"]) {
    assert.throws(() => customers.normalizeOptionalEmail(email), /valid email/i, `${email} is rejected by backend validation`);
    }
    await assert.rejects(customers.createCustomerProfile({ name: "Invalid Email", mobile: "9000000000", email: "himanish26.com" }), /valid email/i);

    const first = await customers.createCustomerProfile({
        name: "Profile Alpha", mobile: "9876543210", birthday_ddmm: "29/02",
        marriage_anniversary_ddmm: "31/12", email: "alpha@example.invalid", notes: "Optional note"
    });
    const trimmedEmailProfile = await customers.createCustomerProfile({
        name: "Email Validation", mobile: "9555555555", email: "  customer.name@example.co.in  "
    });
    assert.strictEqual(trimmedEmailProfile.email, "customer.name@example.co.in");
    const updatedEmailProfile = await customers.updateCustomerProfile(trimmedEmailProfile.id, {
        name: "Email Validation", mobile: "9555555555", email: "  store@kairaluxe.in  "
    });
    assert.strictEqual(updatedEmailProfile.email, "store@kairaluxe.in", "profile update trims surrounding whitespace only");
    await assert.rejects(customers.updateCustomerProfile(trimmedEmailProfile.id, {
        name: "Email Validation", mobile: "9555555555", email: "himanish26@gmail..com"
    }), /valid email/i);
    assert.strictEqual((await customers.getCustomerProfile(trimmedEmailProfile.id)).email, "store@kairaluxe.in", "rejected profile update preserves prior valid email");
    const second = await customers.createCustomerProfile({ name: "Profile Beta", mobile: "9876543210" });
    assert(first.id && second.id && first.id !== second.id);
    assert.match(first.customer_code, /^KLCUS[0-9]{6}$/);
    assert.match(second.customer_code, /^KLCUS[0-9]{6}$/);
    assert.notStrictEqual(first.customer_code, second.customer_code, "shared mobile profiles receive separate business IDs");
    assert.strictEqual(second.email, "", "profile creation accepts an omitted optional email");
    assert.strictEqual((await customers.findCustomersByMobile("9000000000")).length, 0);
    assert.strictEqual((await customers.findCustomersByMobile("9876543210")).length, 2);
    await assert.rejects(customers.createCustomerProfile({ name: "Invalid date", mobile: "9000000000", birthday_ddmm: "31/02" }));

    async function addProduct(barcode, cost, variable = 0) {
        await run(db, `INSERT INTO products
            (barcode, sku, brand, category, product_name, mrp, discount, selling_price, cost_price,
             gst_rate, opening_stock, active, business_segment, variable_value)
            VALUES (?, ?, 'Test', 'Test', ?, 100, 0, 100, ?, 0, 50, 1, 'KL', ?)`,
            [barcode, `SKU-${barcode}`, `Product ${barcode}`, cost, variable]);
        const product = await get(db, "SELECT id FROM products WHERE barcode = ?", [barcode]);
        await run(db, `INSERT INTO inventory_transactions
            (product_id, barcode, transaction_type, quantity, reference_type, reference_id, remarks, created_by, created_at)
            VALUES (?, ?, 'OPENING', 50, 'V21-02-TEST', ?, 'Disposable test fixture', 'TEST', ?)`,
            [product.id, barcode, barcode, now]);
    }
    await addProduct("COST-100", 125.50);
    await addProduct("COST-NULL", null);
    await addProduct("COST-ZERO", 0);
    await addProduct("VARIABLE", 500, 1);

    function payload(billNo, overrides = {}) {
        return {
            bill_no: billNo, bill_time: "10:00:00 AM", customer_name: "", customer_mobile: "",
            cash_amount: 100, upi_amount: 0, card_amount: 0, gift_voucher_amount: 0,
            store_credit: null, items: [{ barcode: "COST-100", qty: 1, gross_amount: 100,
                unit_cost_paise: 1, cost_basis_status: "CAPTURED", cost_source: "FORGED", cost_method: "FORGED" }],
            ...overrides
        };
    }

    await assert.rejects(saveBill(payload("V2102-ROLLBACK", {
        customer_name: "Rollback Profile", customer_mobile: "9333333333",
        cash_amount: 5100, items: [{ barcode: "COST-100", qty: 51, gross_amount: 5100 }]
    })));
    assert.strictEqual((await customers.findCustomersByMobile("9333333333")).length, 0);

    // Anonymous, name-only and mobile-only transactions remain valid and unlinked.
    await saveBill(payload("V2102-ANON"));
    await saveBill(payload("V2102-NAME", { customer_name: "Name Only" }));
    await saveBill(payload("V2102-MOBILE", { customer_mobile: "9000000000" }));
    for (const no of ["V2102-ANON", "V2102-NAME", "V2102-MOBILE"]) {
        assert.strictEqual((await get(db, "SELECT customer_id FROM bills WHERE bill_no = ?", [no])).customer_id, null);
    }
    assert.strictEqual((await customers.findCustomersByMobile("9000000000")).length, 0);

    // Shared mobile stays ambiguous unless a profile is explicitly selected.
    await saveBill(payload("V2102-AMBIGUOUS", { customer_name: "As Typed", customer_mobile: "9876543210" }));
    const ambiguous = await get(db, "SELECT customer_id, customer_name, customer_mobile FROM bills WHERE bill_no = 'V2102-AMBIGUOUS'");
    assert.strictEqual(ambiguous.customer_id, null);
    assert.deepStrictEqual([ambiguous.customer_name, ambiguous.customer_mobile], ["As Typed", "9876543210"]);
    await saveBill(payload("V2102-SELECTED", {
        customer_name: "Snapshot Name", customer_mobile: "9876543210", customer_profile_id: first.id
    }));
    assert.strictEqual((await customers.getCustomerProfile(first.id)).customer_code, first.customer_code, "additional linked sales do not change Customer ID");
    const selectedBill = await get(db, "SELECT customer_id, customer_name, customer_mobile FROM bills WHERE bill_no = 'V2102-SELECTED'");
    assert.strictEqual(selectedBill.customer_id, first.id);
    assert.deepStrictEqual([selectedBill.customer_name, selectedBill.customer_mobile], ["Snapshot Name", "9876543210"]);

    // No profile is created for an abandoned draft; creation happens inside successful save.
    assert.strictEqual((await customers.findCustomersByMobile("9111111111")).length, 0);
    await saveBill(payload("V2102-AUTO", { customer_name: "Auto Profile", customer_mobile: "9111111111" }));
    const autoBill = await get(db, "SELECT customer_id, customer_name, customer_mobile FROM bills WHERE bill_no = 'V2102-AUTO'");
    assert(autoBill.customer_id);
    const autoProfile = await customers.getCustomerProfile(autoBill.customer_id);
    assert.strictEqual(autoProfile.name, "Auto Profile");
    assert.match(autoProfile.customer_code, /^KLCUS[0-9]{6}$/, "successful New Bill auto-creation uses the shared Customer ID generator");
    assert.deepStrictEqual([autoBill.customer_name, autoBill.customer_mobile], ["Auto Profile", "9111111111"]);
    const autoCustomerCode = autoProfile.customer_code;
    await customers.updateCustomerProfile(autoProfile.id, { name: "Edited Profile", mobile: "9111111111" });
    assert.strictEqual((await customers.getCustomerProfile(autoProfile.id)).customer_code, autoCustomerCode, "profile edits do not alter Customer ID");
    const afterEdit = await get(db, "SELECT customer_name, customer_mobile FROM bills WHERE bill_no = 'V2102-AUTO'");
    assert.deepStrictEqual(afterEdit, { customer_name: "Auto Profile", customer_mobile: "9111111111" });

    const linkedHistory = await customers.getCustomerPurchaseHistory(first.id);
    assert(linkedHistory.some(bill => bill.bill_no === "V2102-SELECTED"));
    assert(!linkedHistory.some(bill => bill.bill_no === "V2102-AMBIGUOUS"));

    const captured = await get(db, "SELECT unit_cost_paise, cost_basis_status, cost_source, cost_method FROM bill_items WHERE bill_no = 'V2102-AUTO'");
    assert.deepStrictEqual(captured, {
        unit_cost_paise: 12550, cost_basis_status: "CAPTURED",
        cost_source: "PRODUCT_MASTER", cost_method: "SALE_TIME_COST_PRICE_PAISE"
    });
    await run(db, "UPDATE products SET cost_price = 300 WHERE barcode = 'COST-100'");
    assert.strictEqual((await get(db, "SELECT unit_cost_paise FROM bill_items WHERE bill_no = 'V2102-AUTO'")).unit_cost_paise, 12550);
    await assert.rejects(run(db, "UPDATE bill_items SET unit_cost_paise = 500 WHERE bill_no = 'V2102-AUTO'"));

    for (const barcode of ["COST-NULL", "COST-ZERO", "VARIABLE"]) {
        const billNo = `V2102-${barcode}`;
        const itemGross = barcode === "VARIABLE" ? 100 : 100;
        await saveBill(payload(billNo, { items: [{ barcode, qty: 1, gross_amount: itemGross }] }));
    }
    for (const barcode of ["COST-NULL", "COST-ZERO"]) {
        const item = await get(db, "SELECT unit_cost_paise, cost_basis_status FROM bill_items WHERE bill_no = ?", [`V2102-${barcode}`]);
        assert.deepStrictEqual(item, { unit_cost_paise: null, cost_basis_status: "UNKNOWN" });
    }
    const variableItem = await get(db, "SELECT unit_cost_paise, cost_basis_status FROM bill_items WHERE bill_no = 'V2102-VARIABLE'");
    assert.deepStrictEqual(variableItem, { unit_cost_paise: null, cost_basis_status: "NOT_APPLICABLE" });

    await run(db, `INSERT INTO bills (bill_no, bill_date, customer_name, customer_mobile, customer_id, net_amount)
        VALUES ('V2102-HISTORICAL', '2020-01-01', 'Historic Snapshot', '9222222222', NULL, 100)`);
    await run(db, `INSERT INTO bill_items (bill_no, barcode, product_name, qty, net_amount)
        VALUES ('V2102-HISTORICAL', 'OLD', 'Old Product', 1, 100)`);
    const historical = await get(db, "SELECT customer_id FROM bills WHERE bill_no = 'V2102-HISTORICAL'");
    const historicalCost = await get(db, "SELECT unit_cost_paise, cost_basis_status FROM bill_items WHERE bill_no = 'V2102-HISTORICAL'");
    assert.strictEqual(historical.customer_id, null);
    assert.deepStrictEqual(historicalCost, { unit_cost_paise: null, cost_basis_status: "UNKNOWN" });

    const appSource = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
    assert.match(appSource, /saveBillBtn\.addEventListener\([\s\S]*?saveCurrentBill/);
    assert.match(appSource, /printBillBtn\.addEventListener\([\s\S]*?saveAndPrintBill/);
    assert.match(html, /customerProfileOpen/);
    assert.match(html, /customerPurchaseHistory/);
    assert.strictEqual(Number((await get(db, "SELECT net_amount FROM bills WHERE bill_no = 'V2102-AUTO'")).net_amount), 100);

    await close(db);
    process.stdout.write("PASS V21-02 customer profile, bill linkage/snapshots, history, immutable sale-time cost, unknown cost and legacy billing totals\n");
    app.exit(0);
}

if (process.argv.includes("--child")) {
    child(process.argv[process.argv.indexOf("--child") + 1]).catch(error => {
        console.error(error.message);
        try { require("electron").app.exit(1); } catch (_) {}
        process.exitCode = 1;
    });
} else {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "klbs-v21-02-"));
    const electron = require("electron");
    const result = spawnSync(electron, ["--disable-gpu", "--in-process-gpu", __filename, "--child", root], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(root, "billing.db") },
        encoding: "utf8", timeout: 120000, windowsHide: true
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
