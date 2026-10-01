const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ExcelJS = require("exceljs");

const { exportInventory, INVENTORY_EXPORT_COLUMNS } = require("../src/database/inventoryExporter");
const {
    exportBusinessReport,
    exportProductSalesReport
} = require("../src/database/excelExporter");

    const inventorySource = fs.readFileSync(
    path.join(__dirname, "../src/renderer/modules/inventory.js"),
    "utf8"
);
const productMasterTemplate = fs.readFileSync(
    path.join(__dirname, "../src/renderer/modules/productMasterTemplate.js"),
    "utf8"
);
const productServiceSource = fs.readFileSync(
    path.join(__dirname, "../src/database/productService.js"),
    "utf8"
);
const reportServiceSource = fs.readFileSync(
    path.join(__dirname, "../src/database/reportService.js"),
    "utf8"
);

function cellText(row, column) {
    const value = row.getCell(column).value;
    if (value && typeof value === "object" && "result" in value) {
        return value.result;
    }
    return value;
}

function headerIndex(row) {
    const result = new Map();
    row.eachCell((cell, column) => result.set(String(cell.value), column));
    return result;
}

async function readWorkbook(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return workbook;
}

async function run() {
    assert(productServiceSource.includes("AS latest_sku"));
    assert(productServiceSource.includes("CAST(substr(latest_products.sku, 3) AS INTEGER) DESC"));
    assert(productServiceSource.includes("latest_products.sku GLOB 'KL[0-9]*'"));
    const lastImportStart = productMasterTemplate.indexOf("<h2>Last Import</h2>");
    const fileNameIndex = productMasterTemplate.indexOf("<label>File Name</label>", lastImportStart);
    const importedOnIndex = productMasterTemplate.indexOf("<label>Imported On</label>", fileNameIndex);
    const productsImportedIndex = productMasterTemplate.indexOf("<label>Products Imported</label>", importedOnIndex);
    const latestSkuIndex = productMasterTemplate.indexOf("<label>Last Existing SKU</label>", productsImportedIndex);
    assert(lastImportStart >= 0);
    assert(fileNameIndex > lastImportStart);
    assert(importedOnIndex > fileNameIndex);
    assert(productsImportedIndex > importedOnIndex);
    assert(latestSkuIndex > productsImportedIndex);
    assert.strictEqual((productMasterTemplate.match(/<label>Last Existing SKU<\/label>/g) || []).length, 1);
    assert.strictEqual((productMasterTemplate.match(/id="inventoryLatestSku"/g) || []).length, 1);
    assert(inventorySource.includes('inventoryKeyword = "";'));
    assert(!inventorySource.includes("searchBox.value = inventoryKeyword"));
    assert(inventorySource.includes("inventoryPage = 1"));
    assert(inventorySource.includes("if (keyword === \"\")"));
    assert(productMasterTemplate.includes("<th>Variable Value</th>"));
    assert(inventorySource.includes('Number(product.variable_value) === 1 ? "YES" : "NO"'));

    assert(reportServiceSource.includes("bi.business_segment"));
    assert(reportServiceSource.includes("obi.business_segment"));
    assert(reportServiceSource.includes("p.segment"));
    assert(reportServiceSource.includes("String(row.segment || \"\")"));

    const tempDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "klbs-inventory-segment-")
    );
    const inventoryPath = path.join(tempDirectory, "inventory.xlsx");
    const businessPath = path.join(tempDirectory, "business.xlsx");
    const productSalesPath = path.join(tempDirectory, "product-sales.xlsx");

    try {
        const inventoryProducts = [
            {
                barcode: "A", sku: "KL001", brand: "Brand A",
                business_segment: "KL", segment: "L'Oréal Men", category: "Top", variable_value: 1, hsn_code: "6109",
                product_name: "Product A", current_stock: 4, mrp: 100,
                discount: 0, selling_price: 100, gst_rate: 5, active: 1
            },
            {
                barcode: "B", sku: "KL002", brand: "Brand B",
                business_segment: "KL", segment: "L'Oréal Woman", category: "Top", variable_value: 0, hsn_code: "6110",
                product_name: "Product B", current_stock: 5, mrp: 200,
                discount: 0, selling_price: 200, gst_rate: 5, active: 1
            },
            {
                barcode: "C", sku: "KL003", brand: "Brand C",
                business_segment: "KL", segment: "Perfumes", category: "Top", variable_value: null, hsn_code: "3303",
                product_name: "Product C", current_stock: 6, mrp: 300,
                discount: 0, selling_price: 300, gst_rate: 5, active: 1
            },
            {
                barcode: "D", sku: "KL004", brand: "Brand D",
                business_segment: "KL", segment: "Men", category: "Top",
                product_name: "Product D", current_stock: 7, mrp: 400,
                discount: 0, selling_price: 400, gst_rate: 5, active: 1
            },
            {
                barcode: "E", sku: "KL005", brand: "Brand E",
                business_segment: "MENS", segment: "Men", category: "Top",
                product_name: "Product E", current_stock: 8, mrp: 500,
                discount: 0, selling_price: 500, gst_rate: 5, active: 1
            },
            {
                barcode: "F", sku: "KL006", brand: "Brand F",
                business_segment: "KIDS", segment: "Kids", category: "Top",
                product_name: "Product F", current_stock: 9, mrp: 600,
                discount: 0, selling_price: 600, gst_rate: 5, active: 1
            },
            {
                barcode: "G", sku: "KL007", brand: "Brand G",
                business_segment: null, segment: "Perfumes", category: "Top",
                product_name: "Product G", current_stock: 10, mrp: 700,
                discount: 0, selling_price: 700, gst_rate: 5, active: 1
            },
            {
                barcode: "H", sku: "KL008", brand: "Brand H",
                business_segment: "KL", segment: null, category: "Top",
                product_name: "Product H", current_stock: 11, mrp: 800,
                discount: 0, selling_price: 800, gst_rate: 5, active: 1
            }
        ];
        await exportInventory(inventoryProducts, inventoryPath);
        const inventoryWorkbook = await readWorkbook(inventoryPath);
        const inventorySheet = inventoryWorkbook.getWorksheet("Inventory");
        const inventoryHeaders = headerIndex(inventorySheet.getRow(1));
        assert.strictEqual(
            inventoryHeaders.get("Business Segment"),
            4
        );
        assert.strictEqual(inventoryHeaders.get("Segment"), 5);
        assert(inventoryHeaders.has("Variable Value"));
        assert(inventoryHeaders.has("HSN Code"));
        assert.strictEqual(
            inventorySheet.getRow(1).values.filter(value => value === "Segment").length,
            1
        );
        assert.strictEqual(
            inventorySheet.getRow(1).values.filter(value => value === "Business Segment").length,
            1
        );
        assert.strictEqual(
            INVENTORY_EXPORT_COLUMNS.filter(column => column.header === "Business Segment").length,
            1
        );
        assert.strictEqual(cellText(inventorySheet.getRow(2), 4), "KL");
        assert.strictEqual(cellText(inventorySheet.getRow(2), inventoryHeaders.get("Variable Value")), "YES");
        assert.strictEqual(cellText(inventorySheet.getRow(3), inventoryHeaders.get("Variable Value")), "NO");
        assert.strictEqual(cellText(inventorySheet.getRow(4), inventoryHeaders.get("Variable Value")), "NO");
        assert.strictEqual(cellText(inventorySheet.getRow(2), inventoryHeaders.get("HSN Code")), "6109");
        assert.strictEqual(cellText(inventorySheet.getRow(3), 4), "KL");
        assert.strictEqual(cellText(inventorySheet.getRow(4), 4), "KL");
        assert.strictEqual(cellText(inventorySheet.getRow(5), 4), "KL");
        assert.strictEqual(cellText(inventorySheet.getRow(6), 4), "MENS");
        assert.strictEqual(cellText(inventorySheet.getRow(7), 4), "KIDS");
        assert.strictEqual(cellText(inventorySheet.getRow(8), 4), null);
        assert.strictEqual(cellText(inventorySheet.getRow(9), 4), "KL");
        assert.strictEqual(cellText(inventorySheet.getRow(2), 5), "L'Oréal Men");
        assert.strictEqual(cellText(inventorySheet.getRow(3), 5), "L'Oréal Woman");
        assert.strictEqual(cellText(inventorySheet.getRow(4), 5), "Perfumes");
        assert.strictEqual(cellText(inventorySheet.getRow(8), 5), "Perfumes");
        assert.strictEqual(cellText(inventorySheet.getRow(9), 5), null);

        const businessRows = [
            ["A", "L'Oréal Men", "KL", 100],
            ["B", "L'Oréal Woman", "KL", 200],
            ["C", "Perfumes", "KL", 300],
            ["D", "Men", "KL", 400],
            ["E", "Men", "MENS", 500],
            ["F", "Kids", "KIDS", 600],
            ["G", "Perfumes", null, 700],
            ["H", null, "KL", 800]
        ].map(([barcode, segment, business_segment, amount], index) => ({
            bill_no: `B${String(index + 1).padStart(3, "0")}`,
            bill_date: "2026-09-21",
            bill_time: `10:${String(index).padStart(2, "0")}`,
            barcode,
            brand: `Brand ${barcode}`,
            segment,
            business_segment,
            product_name: `Product ${barcode}`,
            quantity: 1,
            mrp: amount,
            discount_amount: 0,
            taxable_amount: amount * 0.95,
            gst_rate: 5,
            cgst_amount: amount * 0.025,
            sgst_amount: amount * 0.025,
            net_amount: amount,
            cash_amount: amount,
            upi_amount: 0,
            card_amount: 0
        }));
        const creditRows = [{
            credit_note_no: "CN001", credit_note_date: "2026-09-21",
            return_no: "R001", original_bill_no: "B001",
            original_bill_date: "2026-09-21", customer_name: "Customer",
            customer_mobile: "9999999999", barcode: "A", brand: "Brand A",
            segment: "L'Oréal Men", business_segment: "KL", product_name: "Product A",
            quantity_returned: 1, mrp: 100, gross_reversal: 100,
            discount_reversal: 0, taxable_reversal: 95, gst_rate: 5,
            cgst_reversal: 2.5, sgst_reversal: 2.5, gst_reversal: 5,
            net_reversal: 100
        }];
        await exportBusinessReport(
            businessRows,
            creditRows,
            businessPath,
            "2026-09-21",
            "2026-09-21"
        );
        const businessWorkbook = await readWorkbook(businessPath);
        const businessSheet = businessWorkbook.getWorksheet("Business Report");
        const businessHeaders = headerIndex(businessSheet.getRow(11));
        assert.strictEqual(businessHeaders.get("Segment"), 6);
        assert.strictEqual(businessHeaders.get("Business Segment"), 7);
        assert.strictEqual(businessHeaders.get("Product Name"), 8);
        assert.strictEqual(
            businessSheet.getRow(11).values.filter(value => value === "Segment").length,
            1
        );
        assert.strictEqual(
            businessSheet.getRow(11).values.filter(value => value === "Business Segment").length,
            1
        );
        assert.strictEqual(cellText(businessSheet.getRow(12), 6), "L'Oréal Men");
        assert.strictEqual(cellText(businessSheet.getRow(12), 7), "KL");
        assert.strictEqual(cellText(businessSheet.getRow(13), 6), "L'Oréal Woman");
        assert.strictEqual(cellText(businessSheet.getRow(13), 7), "KL");
        assert.strictEqual(cellText(businessSheet.getRow(14), 6), "Perfumes");
        assert.strictEqual(cellText(businessSheet.getRow(14), 7), "KL");
        assert.strictEqual(cellText(businessSheet.getRow(15), 6), "Men");
        assert.strictEqual(cellText(businessSheet.getRow(15), 7), "KL");
        assert.strictEqual(cellText(businessSheet.getRow(16), 6), "Men");
        assert.strictEqual(cellText(businessSheet.getRow(16), 7), "MENS");
        assert.strictEqual(cellText(businessSheet.getRow(17), 6), "Kids");
        assert.strictEqual(cellText(businessSheet.getRow(17), 7), "KIDS");
        assert.strictEqual(cellText(businessSheet.getRow(18), 6), "Perfumes");
        assert.strictEqual(cellText(businessSheet.getRow(18), 7), null);
        assert.strictEqual(cellText(businessSheet.getRow(19), 6), null);
        assert.strictEqual(cellText(businessSheet.getRow(19), 7), "KL");
        assert.strictEqual(cellText(businessSheet.getRow(12), 8), "Product A");
        assert.strictEqual(cellText(businessSheet.getRow(20), 15), 8);
        assert.strictEqual(cellText(businessSheet.getRow(20), 17), 0);
        assert.strictEqual(cellText(businessSheet.getRow(20), 22), 3600);
        assert.strictEqual(cellText(businessSheet.getRow(20), 23), 3600);
        const businessSummary = businessWorkbook.getWorksheet("Summary");
        assert.strictEqual(
            businessSummary.getCell("B12").value.formula,
            "SUM('Business Report'!Z12:Z19)"
        );
        const variableBusinessPath = path.join(tempDirectory, "variable-business-report.xlsx");
        await exportBusinessReport([{
            bill_no: "VV001", bill_date: "2026-09-21", bill_time: "10:00",
            barcode: "VV", product_name: "Variable", business_segment: "KL",
            quantity: 3, mrp: 1, gross_amount: 80, discount_amount: 0,
            taxable_amount: 76.19, gst_rate: 5, cgst_amount: 1.9,
            sgst_amount: 1.9, net_amount: 80, cash_amount: 80,
            upi_amount: 0, card_amount: 0
        }], [], variableBusinessPath, "2026-09-21", "2026-09-21");
        const variableBusinessWorkbook = await readWorkbook(variableBusinessPath);
        const variableBusinessSheet = variableBusinessWorkbook.getWorksheet("Business Report");
        assert.strictEqual(cellText(variableBusinessSheet.getRow(12), 26), 80);
        assert.strictEqual(variableBusinessSheet.getColumn(26).hidden, true);
        const variableBusinessSummary = variableBusinessWorkbook.getWorksheet("Summary");
        assert.strictEqual(variableBusinessSummary.getCell("B12").value.result, 80);
        const creditSheet = businessWorkbook.getWorksheet("Returns & Credit Notes");
        const creditHeaders = headerIndex(creditSheet.getRow(11));
        assert.strictEqual(creditHeaders.get("Segment"), 10);
        assert.strictEqual(creditHeaders.get("Business Segment"), 11);
        assert.strictEqual(creditHeaders.get("Product Name"), 12);
        assert.strictEqual(cellText(creditSheet.getRow(12), 10), "L'Oréal Men");
        assert.strictEqual(cellText(creditSheet.getRow(12), 11), "KL");
        assert.strictEqual(cellText(creditSheet.getRow(12), 12), "Product A");

        const productRows = [
            ["A", "L'Oréal Men", "KL", 100],
            ["B", "L'Oréal Woman", "KL", 200],
            ["C", "Perfumes", "KL", 300],
            ["D", "Men", "KL", 400],
            ["E", "Men", "MENS", 500],
            ["F", "Kids", "KIDS", 600],
            ["G", "Perfumes", null, 700],
            ["H", null, "KL", 800]
        ].map(([barcode, segment, business_segment, amount]) => ({
            barcode,
            brand: `Brand ${barcode}`,
            segment,
            business_segment,
            product_name: `Product ${barcode}`,
            qty_sold: 1,
            qty_returned: 0,
            net_qty_sold: 1,
            gross_sales: amount,
            discount_amount: 0,
            taxable_value: amount * 0.95,
            gst_amount: amount * 0.05,
            net_sales: amount,
            return_cn_value: 0,
            net_sales_after_returns: amount
        }));
        await exportProductSalesReport(
            productRows,
            productSalesPath,
            "2026-09-21",
            "2026-09-21"
        );
        const productWorkbook = await readWorkbook(productSalesPath);
        const productSheet = productWorkbook.getWorksheet("Product Sales Report");
        const productHeaders = headerIndex(productSheet.getRow(11));
        assert.strictEqual(productHeaders.get("Segment"), 3);
        assert.strictEqual(productHeaders.get("Business Segment"), 4);
        assert.strictEqual(productHeaders.get("Product Name"), 5);
        assert.strictEqual(
            productSheet.getRow(11).values.filter(value => value === "Segment").length,
            1
        );
        assert.strictEqual(
            productSheet.getRow(11).values.filter(value => value === "Business Segment").length,
            1
        );
        assert.strictEqual(cellText(productSheet.getRow(12), 3), "L'Oréal Men");
        assert.strictEqual(cellText(productSheet.getRow(12), 4), "KL");
        assert.strictEqual(cellText(productSheet.getRow(13), 3), "L'Oréal Woman");
        assert.strictEqual(cellText(productSheet.getRow(13), 4), "KL");
        assert.strictEqual(cellText(productSheet.getRow(14), 3), "Perfumes");
        assert.strictEqual(cellText(productSheet.getRow(14), 4), "KL");
        assert.strictEqual(cellText(productSheet.getRow(15), 3), "Men");
        assert.strictEqual(cellText(productSheet.getRow(15), 4), "KL");
        assert.strictEqual(cellText(productSheet.getRow(16), 3), "Men");
        assert.strictEqual(cellText(productSheet.getRow(16), 4), "MENS");
        assert.strictEqual(cellText(productSheet.getRow(17), 3), "Kids");
        assert.strictEqual(cellText(productSheet.getRow(17), 4), "KIDS");
        assert.strictEqual(cellText(productSheet.getRow(18), 3), "Perfumes");
        assert.strictEqual(cellText(productSheet.getRow(18), 4), null);
        assert.strictEqual(cellText(productSheet.getRow(19), 3), null);
        assert.strictEqual(cellText(productSheet.getRow(19), 4), "KL");
        assert.strictEqual(cellText(productSheet.getRow(12), 5), "Product A");
        assert.strictEqual(cellText(productSheet.getRow(20), 10), 8);
        assert.strictEqual(cellText(productSheet.getRow(20), 12), 8);
        assert.strictEqual(cellText(productSheet.getRow(20), 19), 3600);

        process.stdout.write("Inventory UX/XLSX Business Segment test: PASS (38 assertions)\n");
    }
    finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
