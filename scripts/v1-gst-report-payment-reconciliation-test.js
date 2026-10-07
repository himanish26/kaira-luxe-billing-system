const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const sqlite3 = require("sqlite3").verbose();
const ExcelJS = require("exceljs");

let assertions = 0;
function equal(actual, expected, message) {
    assertions += 1;
    assert.deepStrictEqual(actual, expected, message);
}
function ok(value, message) {
    assertions += 1;
    assert.ok(value, message);
}
function paise(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100);
}

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, error => error ? reject(error) : resolve());
});
const exec = (db, sql) => new Promise((resolve, reject) => {
    db.exec(sql, error => error ? reject(error) : resolve());
});
const close = db => new Promise((resolve, reject) => {
    db.close(error => error ? reject(error) : resolve());
});

async function main() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-gst-payment-reconciliation-"));
    const db = new sqlite3.Database(":memory:");
    const outputPath = path.join(tempRoot, "gst-report.xlsx");
    const originalLoad = Module._load;

    try {
        await exec(db, `
            CREATE TABLE bills (
                bill_no TEXT PRIMARY KEY, bill_date TEXT, bill_time TEXT,
                net_amount REAL, cash_amount REAL, upi_amount REAL, card_amount REAL,
                store_credit_amount REAL, gift_voucher_amount REAL
            );
            CREATE TABLE bill_items (
                id INTEGER PRIMARY KEY, bill_no TEXT, barcode TEXT, brand TEXT,
                business_segment TEXT, product_name TEXT, colour TEXT, size TEXT,
                category TEXT, qty INTEGER, mrp REAL, gross_amount REAL,
                discount_percent REAL, discount_amount REAL,
                taxable_amount REAL, gst_rate REAL, gst_amount REAL, net_amount REAL
            );
            CREATE TABLE products (barcode TEXT PRIMARY KEY, segment TEXT);
            CREATE TABLE returns (
                id INTEGER PRIMARY KEY, business_date TEXT, accounting_status TEXT,
                credit_note_no TEXT, accounting_snapshot_version INTEGER,
                return_no TEXT, original_bill_no TEXT, original_bill_date TEXT,
                customer_name TEXT, customer_mobile TEXT
            );
            CREATE TABLE return_items (
                id INTEGER PRIMARY KEY, return_id INTEGER, original_bill_item_id INTEGER,
                barcode TEXT, product_name TEXT, quantity INTEGER, mrp REAL,
                gross_reversal REAL, discount_percent REAL, discount_reversal REAL,
                taxable_reversal REAL, gst_rate REAL, cgst_reversal REAL,
                sgst_reversal REAL, gst_reversal REAL, net_reversal REAL
            );
            CREATE TABLE stores (id INTEGER PRIMARY KEY, store_code TEXT, store_name TEXT, status TEXT);
            CREATE TABLE store_context (id INTEGER PRIMARY KEY, current_store_id INTEGER);
            INSERT INTO stores VALUES (1, 'KL001', 'Kaira Luxe', 'ACTIVE');
            INSERT INTO store_context VALUES (1, 1);
        `);

        let itemId = 0;
        const cases = [
            { no: "CASH", tender: [100, 0, 0, 0, 0], mode: "Cash" },
            { no: "UPI", tender: [0, 100, 0, 0, 0], mode: "UPI" },
            { no: "CARD", tender: [0, 0, 100, 0, 0], mode: "Card" },
            { no: "STORE-CREDIT", tender: [0, 0, 0, 100, 0], mode: "Store Credit" },
            { no: "GIFT-VOUCHER", tender: [0, 0, 0, 0, 100], mode: "Gift Voucher" },
            { no: "CASH-UPI", tender: [50, 50, 0, 0, 0], mode: "Mixed" },
            { no: "CASH-CARD", tender: [50, 0, 50, 0, 0], mode: "Mixed" },
            { no: "UPI-CARD", tender: [0, 50, 50, 0, 0], mode: "Mixed" },
            {
                no: "MULTI-RATE-THREE-WAY", tender: [500, 1000, 500, 0, 0], mode: "Mixed",
                items: [
                    { gst: 5, taxable: 1000, tax: 50, net: 1050 },
                    { gst: 12, taxable: 500, tax: 60, net: 560 },
                    { gst: 18, taxable: 330.51, tax: 59.49, net: 390 }
                ]
            },
            { no: "THREE-PLUS-GIFT", tender: [20, 30, 40, 0, 10], mode: "Mixed" },
            { no: "STORE-PLUS-CASH", tender: [10, 0, 0, 90, 0], mode: "Mixed" },
            { no: "STORE-PLUS-GIFT", tender: [0, 0, 0, 60, 40], mode: "Mixed" },
            { no: "ALL-ZERO-NULL", tender: [null, 0, null, 0, null], mode: "" },
            {
                no: "FF-SAVED-SETTLEMENT", tender: [0, 100, 0, 0, 0], mode: "UPI",
                items: [{ gst: 5, gross: 110, discountPercent: 10, taxable: 95.24, tax: 4.76, net: 100, discount: 10 }]
            }
        ];

        for (const testCase of cases) {
            const tender = testCase.tender;
            const normalized = tender.map(value => value == null ? 0 : value);
            const net = testCase.no === "MULTI-RATE-THREE-WAY"
                ? 2000
                : normalized.reduce((sum, value) => sum + value, 0);
            await run(db, `INSERT INTO bills
                (bill_no,bill_date,bill_time,net_amount,cash_amount,upi_amount,card_amount,
                 store_credit_amount,gift_voucher_amount)
                VALUES (?,?,?,?,?,?,?,?,?)`, [
                testCase.no, "2026-09-28", "10:00:00 AM", net,
                ...tender
            ]);
            const defaultTax = Math.round((net - net / 1.05) * 100) / 100;
            const items = testCase.items || [{
                gst: 5, taxable: Math.round((net - defaultTax) * 100) / 100,
                tax: defaultTax, net
            }];
            for (const item of items) {
                itemId += 1;
                await run(db, `INSERT INTO bill_items
                    (id,bill_no,barcode,brand,business_segment,product_name,colour,size,category,
                     qty,mrp,gross_amount,discount_percent,discount_amount,taxable_amount,
                     gst_rate,gst_amount,net_amount)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
                    itemId, testCase.no, `BC-${itemId}`, "Fixture", "KL", "Fixture Item",
                    "", "", "Fixture", 1, item.gross ?? item.taxable + (item.tax || 0),
                    item.gross ?? item.taxable + (item.tax || 0), item.discountPercent || 0,
                    item.discount || 0, item.taxable, item.gst, item.tax, item.net
                ]);
            }
        }

        // Bills without items are excluded by the existing GST sales join; out-of-range bills are excluded by its date range.
        await run(db, `INSERT INTO bills
            (bill_no,bill_date,bill_time,net_amount,cash_amount,upi_amount,card_amount,store_credit_amount,gift_voucher_amount)
            VALUES ('NO-ITEMS','2026-09-28','11:00:00 AM',100,100,0,0,0,0)`);
        await run(db, `INSERT INTO bills
            (bill_no,bill_date,bill_time,net_amount,cash_amount,upi_amount,card_amount,store_credit_amount,gift_voucher_amount)
            VALUES ('OUT-OF-RANGE','2026-10-01','11:00:00 AM',100,100,0,0,0,0)`);
        itemId += 1;
        await run(db, `INSERT INTO bill_items
            (id,bill_no,taxable_amount,gst_rate,gst_amount,net_amount)
            VALUES (?, 'OUT-OF-RANGE', 100, 5, 5, 105)`, [itemId]);

        await run(db, `INSERT INTO returns
            (id,business_date,accounting_status,credit_note_no,accounting_snapshot_version,
             return_no,original_bill_no,original_bill_date,customer_name,customer_mobile)
            VALUES (1,'2026-09-28','COMPLETED','CN-FIXTURE',1,'RET-FIXTURE','CASH','2026-09-28','Fixture','')`);
        await run(db, `INSERT INTO return_items
            (id,return_id,original_bill_item_id,barcode,product_name,quantity,mrp,gross_reversal,
             discount_percent,discount_reversal,taxable_reversal,gst_rate,cgst_reversal,
             sgst_reversal,gst_reversal,net_reversal)
            VALUES (1,1,1,'BC-1','Fixture Item',1,105,105,0,0,100,5,2.5,2.5,5,105)`);

        const reportServicePath = path.resolve(__dirname, "../src/database/reportService.js");
        Module._load = function(request, parent, isMain) {
            if (request === "./database" && parent && parent.filename === reportServicePath) {
                return { all: (...args) => db.all(...args), get: (...args) => db.get(...args) };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
        const reportService = require(reportServicePath);
        Module._load = originalLoad;

        await reportService.exportReport({
            reportType: "gst",
            fromDate: "2026-09-01",
            toDate: "2026-09-30"
        }, outputPath);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(outputPath);
        equal(workbook.worksheets.map(sheet => sheet.name), [
            "GST Report", "Credit Note GST Reversal", "GST Summary", "Payment Reconciliation"
        ], "existing GST sheets remain in their existing order and reconciliation is additive");

        const gstSheet = workbook.getWorksheet("GST Report");
        equal(gstSheet.getCell("B6").value, "KL001", "GST export includes current Store Code metadata");
        equal(gstSheet.getRow(11).values.slice(1), [
            "Bill No", "Bill Date", "GST %", "Taxable Value", "CGST", "SGST", "GST Total", "Net Amount"
        ], "existing GST sales headers and order remain unchanged");

        const multiGSTRows = [];
        for (let row = 12; row < gstSheet.rowCount; row += 1) {
            if (gstSheet.getCell(row, 1).value === "MULTI-RATE-THREE-WAY") {
                multiGSTRows.push([
                    gstSheet.getCell(row, 3).value,
                    gstSheet.getCell(row, 4).value,
                    gstSheet.getCell(row, 5).value,
                    gstSheet.getCell(row, 6).value,
                    gstSheet.getCell(row, 7).value,
                    gstSheet.getCell(row, 8).value
                ]);
            }
        }
        equal(multiGSTRows, [
            [5, 1000, 25, 25, 50, 1050],
            [12, 500, 30, 30, 60, 560],
            [18, 330.51, 29.75, 29.75, 59.49, 390]
        ], "saved GST-rate rows and tax calculations remain unchanged");

        const paymentSheet = workbook.getWorksheet("Payment Reconciliation");
        equal(paymentSheet.getRow(1).values.slice(1), [
            "Bill No", "Bill Date", "Payment Mode", "Cash", "UPI", "Card",
            "Store Credit", "Gift Voucher", "Total Settlement"
        ], "payment reconciliation header names and order match the approved design");
        ok(!paymentSheet.getRow(1).values.includes("Business Segment"), "Business Segment is omitted");

        const paymentRows = new Map();
        for (let row = 2; row <= paymentSheet.rowCount; row += 1) {
            const billNo = paymentSheet.getCell(row, 1).value;
            if (billNo) {
                const list = paymentRows.get(billNo) || [];
                list.push(row);
                paymentRows.set(billNo, list);
            }
        }
        equal(paymentRows.size, cases.length, "one payment worksheet row exists per eligible saved bill");
        ok(!paymentRows.has("NO-ITEMS"), "bill without an item is excluded consistently with GST sales rows");
        ok(!paymentRows.has("OUT-OF-RANGE"), "out-of-range bill is excluded");
        equal(paymentRows.get("MULTI-RATE-THREE-WAY").length, 1,
            "multi-GST-rate bill has exactly one payment row");
        equal(multiGSTRows.length, 3, "fixture bill has three GST sales rows");

        const components = ["cash", "upi", "card", "store_credit", "gift_voucher"];
        const columnFor = { cash: 4, upi: 5, card: 6, store_credit: 7, gift_voucher: 8 };
        const expectedTotals = Object.fromEntries(components.map(component => [component, 0]));
        let expectedSettlement = 0;
        for (const testCase of cases) {
            const rowNumbers = paymentRows.get(testCase.no) || [];
            equal(rowNumbers.length, 1, `${testCase.no} appears once`);
            const row = rowNumbers[0];
            equal(paymentSheet.getCell(row, 3).value, testCase.mode, `${testCase.no} Payment Mode`);
            let settlementPaise = 0;
            for (let index = 0; index < components.length; index += 1) {
                const component = components[index];
                const expected = testCase.tender[index] == null ? 0 : testCase.tender[index];
                const actual = paymentSheet.getCell(row, columnFor[component]).value;
                equal(paise(actual), paise(expected), `${testCase.no} ${component} component`);
                expectedTotals[component] += paise(expected);
                settlementPaise += paise(expected);
            }
            equal(paise(paymentSheet.getCell(row, 9).value), settlementPaise,
                `${testCase.no} Total Settlement adds the five persisted components`);
            expectedSettlement += settlementPaise;
        }

        for (const component of components) {
            const column = columnFor[component];
            const worksheetTotal = [...paymentRows.values()].flat().reduce(
                (sum, row) => sum + paise(paymentSheet.getCell(row, column).value), 0
            );
            equal(worksheetTotal, expectedTotals[component], `${component} worksheet total equals bill headers`);
        }
        const worksheetSettlement = [...paymentRows.values()].flat().reduce(
            (sum, row) => sum + paise(paymentSheet.getCell(row, 9).value), 0
        );
        equal(worksheetSettlement, expectedSettlement, "Total Settlement total equals all five bill-header component totals");

        const multiPaymentRow = paymentRows.get("MULTI-RATE-THREE-WAY")[0];
        equal([
            paise(paymentSheet.getCell(multiPaymentRow, 4).value),
            paise(paymentSheet.getCell(multiPaymentRow, 5).value),
            paise(paymentSheet.getCell(multiPaymentRow, 6).value)
        ], [50000, 100000, 50000], "multi-rate bill tenders are not multiplied by its three GST rows");

        const creditSheet = workbook.getWorksheet("Credit Note GST Reversal");
        equal(creditSheet.getRow(11).values.slice(1), [
            "Credit Note No", "Credit Note Date", "Return No", "Original Bill No",
            "Original Bill Date", "GST %", "Taxable Reversal", "CGST Reversal",
            "SGST Reversal", "GST Reversal", "Net Reversal"
        ], "credit-note reversal headers remain unchanged");
        ok(!creditSheet.getRow(11).values.some(value => [
            "Cash", "UPI", "Card", "Store Credit", "Gift Voucher", "Total Settlement"
        ].includes(value)), "no sales tender fields are added to credit-note reversal rows");
        equal(creditSheet.getCell(12, 1).value, "CN-FIXTURE", "credit-note reversal remains a separate populated sheet");

        const summary = workbook.getWorksheet("GST Summary");
        equal(summary.getCell("B12").value.formula, "SUM('GST Report'!D12:D27)",
            "GST Summary sales formula remains based on existing GST rows");
        equal(summary.getCell("B24").value.formula, "B12-B18",
            "GST Summary net tax formula remains unchanged");

        console.log(`PASS: GST Payment Reconciliation export path (${assertions} assertions)`);
    }
    finally {
        Module._load = originalLoad;
        await close(db);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
