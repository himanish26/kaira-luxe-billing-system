"use strict";
const ExcelJS = require("exceljs");

async function exportUnknownBarcodes(rows, filePath) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KLBS";
    workbook.subject = "Unresolved Stock Inward barcodes";
    const sheet = workbook.addWorksheet("UNKNOWN BARCODES");
    sheet.columns = [
        { header: "STOCK INWARD CODE", key: "movement_no", width: 20 },
        { header: "BUSINESS DATE", key: "business_date", width: 16 },
        { header: "STORE CODE", key: "store_code_snapshot", width: 14 },
        { header: "SUPPLIER CODE", key: "supplier_code_snapshot", width: 16 },
        { header: "SUPPLIER NAME", key: "supplier_name", width: 28 },
        { header: "SUPPLIER INVOICE CODE", key: "supplier_invoice_code_snapshot", width: 22 },
        { header: "EXTERNAL INVOICE / REFERENCE", key: "invoice_no", width: 30 },
        { header: "INVOICE DATE", key: "invoice_date", width: 16 },
        { header: "INVOICE TOTAL QTY", key: "invoice_total_quantity", width: 18 },
        { header: "BARCODE", key: "barcode", width: 24 },
        { header: "SCANNED QUANTITY", key: "scanned_quantity", width: 18 },
        { header: "RESOLUTION STATUS", key: "resolution_note", width: 22 },
        { header: "CREATED TIMESTAMP", key: "created_at", width: 26 },
        { header: "DOCUMENT STATUS", key: "status", width: 18 },
        { header: "PRODUCT MASTER LOOKUP", key: "lookup_helper", width: 30 }
    ];
    sheet.addRows(rows.map(row => ({ ...row, lookup_helper: "Search this barcode in Product Master" })));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF70233A" } };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: sheet.columns.length } };
    await workbook.xlsx.writeFile(filePath);
    return { success: true, filePath, rowCount: rows.length };
}
module.exports = { exportUnknownBarcodes };
