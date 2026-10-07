"use strict";

const ExcelJS = require("exceljs");

const safeText = value => {
    const text = value === null || value === undefined ? "" : String(value);
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
};

function money(paise) {
    return Number(paise || 0) / 100;
}

function styleHeader(sheet, rowNumber) {
    const row = sheet.getRow(rowNumber);
    row.height = 24;
    row.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F2F24" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
}

function setMetadata(sheet, entries) {
    entries.forEach(([label, value], index) => {
        sheet.getCell(`A${index + 1}`).value = label;
        sheet.getCell(`B${index + 1}`).value = safeText(value);
        sheet.getCell(`A${index + 1}`).font = { bold: true, color: { argb: "FF4F2F24" } };
    });
}

function addExpenseRows(sheet, rows, startRow) {
    const headers = [
        "Expense ID", "Batch ID", "Expense Date", "Expense Header", "Business Segment",
        "Transaction Type", "Receipt / Reference No.", "Amount", "Remarks", "Posted At"
    ];
    sheet.getRow(startRow).values = headers;
    styleHeader(sheet, startRow);
    let rowNumber = startRow + 1;
    for (const row of rows) {
        sheet.getRow(rowNumber).values = [
            safeText(row.expense_code), safeText(row.batch_code), safeText(row.expense_date),
            safeText(row.category), safeText(row.business_segment), safeText(row.payment_mode),
            safeText(row.reference), money(row.amount_paise), safeText(row.remarks), safeText(row.posted_at)
        ];
        sheet.getCell(`H${rowNumber}`).numFmt = '"₹"#,##0.00;[Red]("₹"#,##0.00);-';
        rowNumber += 1;
    }
    sheet.views = [{ state: "frozen", ySplit: startRow }];
    return rowNumber - 1;
}

function styleExpenseColumns(sheet) {
    sheet.columns = [
        { width: 16 }, { width: 17 }, { width: 15 }, { width: 30 }, { width: 18 },
        { width: 19 }, { width: 25 }, { width: 17 }, { width: 42 }, { width: 28 }
    ];
    sheet.eachRow((row, rowNumber) => {
        if (rowNumber > 7) row.alignment = { vertical: "top", wrapText: true };
    });
}

async function exportPostedExpenseBatch(batch, filePath) {
    if (!batch || !batch.batch_code || !Array.isArray(batch.expenses)) {
        throw new Error("A posted expense batch is required for export.");
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Expense Batch");
    setMetadata(sheet, [
        ["Store Code", batch.store_code], ["Store Name", batch.store_name],
        ["Batch ID", batch.batch_code], ["Posted At", batch.posted_at],
        ["Expense Count", batch.expense_count], ["Batch Total", money(batch.total_amount_paise)]
    ]);
    sheet.getCell("B6").numFmt = '"₹"#,##0.00;[Red]("₹"#,##0.00);-';
    styleExpenseColumns(sheet);
    addExpenseRows(sheet, batch.expenses, 8);
    await workbook.xlsx.writeFile(filePath);
    return { success: true, filePath, rowCount: batch.expenses.length };
}

async function exportExpenseHistory(data, options, store, filePath) {
    if (!data || !Array.isArray(data.rows) || !store || !store.storeCode) {
        throw new Error("Filtered posted expense history and current Store identity are required for export.");
    }
    const filterValues = [
        ["Expense Header Filter", options.category || "All"],
        ["Business Segment Filter", options.businessSegment || "All"],
        ["Transaction Type Filter", options.paymentMode || "All"],
        ["Search", data.search || "All"],
        ["Matching Expense Count", data.totalCount],
        ["Matching Total", money(data.totalAmountPaise)]
    ];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Expense History");
    setMetadata(sheet, [
        ["Store Code", store.storeCode], ["Store Name", store.storeName],
        ["Selected Month", options.month], ...filterValues
    ]);
    const totalMetadataRow = filterValues.length + 3;
    sheet.getCell(`B${totalMetadataRow}`).numFmt = '"₹"#,##0.00;[Red]("₹"#,##0.00);-';
    styleExpenseColumns(sheet);
    addExpenseRows(sheet, data.rows, totalMetadataRow + 2);
    await workbook.xlsx.writeFile(filePath);
    return { success: true, filePath, rowCount: data.rows.length };
}

module.exports = { exportPostedExpenseBatch, exportExpenseHistory, safeText };
