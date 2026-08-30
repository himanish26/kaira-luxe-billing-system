const ExcelJS = require("exceljs");

function formatDate(date) {

    const d = new Date(date);

    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();

    return `${day}/${month}/${year}`;

};

function toPaise(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) {
        throw new Error("Invalid accounting value in report export.");
    }
    return Math.round((amount + Number.EPSILON) * 100);
}

function fromPaise(value) {
    if (!Number.isSafeInteger(value)) {
        throw new Error("Report accounting total exceeds safe limits.");
    }
    return value / 100;
}

function addPaise(total, value) {
    const result = total + toPaise(value);
    if (!Number.isSafeInteger(result)) {
        throw new Error("Report accounting total exceeds safe limits.");
    }
    return result;
}

function setReportMetadata(sheet, reportName, fromDate, toDate) {
    sheet.getCell("A1").value = "Store Name";
    sheet.getCell("B1").value = "KAIRA LUXE";
    sheet.getCell("A2").value = "Address";
    sheet.getCell("B2").value =
        "Shop No.3, Shree Towers, Near Khallikote University, Berhampur-760001, Odisha";
    sheet.getCell("A3").value = "Contact";
    sheet.getCell("B3").value = "0680-3596443";
    sheet.getCell("A4").value = "Email";
    sheet.getCell("B4").value = "kairaluxe@gmail.com";
    sheet.getCell("A5").value = "GSTIN";
    sheet.getCell("B5").value = "21BBLPP6327G1ZO";
    sheet.getCell("A7").value = "Report Name";
    sheet.getCell("B7").value = reportName;
    sheet.getCell("A8").value = "Report Generated On";
    sheet.getCell("B8").value = new Date().toLocaleString("en-IN");
    sheet.getCell("A9").value = "Report Period";
    sheet.getCell("B9").value =
        `${formatDate(fromDate)} to ${formatDate(toDate)}`;
}

function styleNewRegister(sheet, headerRowNumber) {
    const header = sheet.getRow(headerRowNumber);
    header.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF4F2F24" }
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });
}

function setSummarySection(sheet, row, title) {
    sheet.mergeCells(`A${row}:B${row}`);
    const cell = sheet.getCell(`A${row}`);
    cell.value = title;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4F2F24" }
    };
}

function expandSummaryMetadata(sheet) {
    for (const row of [2, 7, 8, 9]) {
        sheet.mergeCells(`B${row}:D${row}`);
        sheet.getCell(`B${row}`).alignment = { horizontal: "left" };
    }
    sheet.getColumn(3).width = 25;
    sheet.getColumn(4).width = 25;
}

function addBusinessCreditNoteSheets(
    workbook,
    salesData,
    creditNoteItems,
    fromDate,
    toDate
) {
    const sheet = workbook.addWorksheet("Returns & Credit Notes");
    setReportMetadata(
        sheet,
        "Business Report - Returns & Credit Notes",
        fromDate,
        toDate
    );
    sheet.columns = [
        { width: 18 }, { width: 16 }, { width: 18 }, { width: 18 },
        { width: 18 }, { width: 24 }, { width: 16 }, { width: 18 },
        { width: 18 }, { width: 28 }, { width: 16 }, { width: 14 },
        { width: 10 }, { width: 18 }, { width: 13 }, { width: 13 },
        { width: 17 }, { width: 19 }, { width: 19 }, { width: 10 },
        { width: 17 }, { width: 17 }, { width: 17 }, { width: 17 }
    ];
    sheet.getRow(11).values = [
        "Credit Note No", "Credit Note Date", "Return No",
        "Original Bill No", "Original Bill Date", "Customer Name",
        "Mobile Number", "Barcode", "Brand", "Product Name",
        "Style Code", "Colour", "Size", "Category", "Qty Returned",
        "MRP", "Gross Reversal", "Discount Reversal",
        "Taxable Reversal", "GST %", "CGST Reversal", "SGST Reversal",
        "GST Reversal", "Net Reversal"
    ];
    styleNewRegister(sheet, 11);

    let rowNumber = 12;
    for (const item of creditNoteItems) {
        sheet.getRow(rowNumber).values = [
            item.credit_note_no,
            item.credit_note_date,
            item.return_no,
            item.original_bill_no,
            item.original_bill_date,
            item.customer_name,
            item.customer_mobile,
            item.barcode,
            item.brand || null,
            item.product_name,
            item.style_code || null,
            item.colour || null,
            item.size || null,
            item.category || null,
            item.quantity_returned,
            item.mrp,
            item.gross_reversal,
            item.discount_reversal,
            item.taxable_reversal,
            item.gst_rate,
            item.cgst_reversal,
            item.sgst_reversal,
            item.gst_reversal,
            item.net_reversal
        ];
        rowNumber++;
    }

    const creditNoteDataEnd = rowNumber - 1;
    if (creditNoteItems.length === 0) {
        sheet.mergeCells("A12:X12");
        sheet.getCell("A12").value = "No Credit Notes for selected period";
        sheet.getCell("A12").alignment = { horizontal: "center" };
    }
    else {
        const totalRow = sheet.getRow(rowNumber);
        totalRow.values = ["TOTAL"];
        for (const column of [15, 17, 18, 19, 21, 22, 23, 24]) {
            const letter = sheet.getColumn(column).letter;
            const result = creditNoteItems.reduce(
                (total, item) => {
                    const fields = {
                        15: "quantity_returned",
                        17: "gross_reversal",
                        18: "discount_reversal",
                        19: "taxable_reversal",
                        21: "cgst_reversal",
                        22: "sgst_reversal",
                        23: "gst_reversal",
                        24: "net_reversal"
                    };
                    return column === 15
                        ? total + Number(item[fields[column]] || 0)
                        : addPaise(total, item[fields[column]]);
                },
                0
            );
            totalRow.getCell(column).value = {
                formula: `SUM(${letter}12:${letter}${creditNoteDataEnd})`,
                result: column === 15 ? result : fromPaise(result)
            };
        }
        totalRow.font = { bold: true };
    }

    for (const column of [16, 17, 18, 19, 21, 22, 23, 24]) {
        sheet.getColumn(column).numFmt =
            '"₹"#,##0.00;[Red]("₹"#,##0.00);-';
    }
    for (const column of [1, 3, 4, 7, 8]) {
        sheet.getColumn(column).numFmt = "@";
    }
    sheet.getColumn(20).numFmt = "0.00";
    sheet.views = [{ state: "frozen", ySplit: 11 }];

    const salesTotals = salesData.reduce(
        (totals, row) => {
            totals.gross = addPaise(
                totals.gross,
                Number(row.mrp || 0) * Number(row.quantity || 0)
            );
            totals.discount = addPaise(totals.discount, row.discount_amount);
            totals.net = addPaise(totals.net, row.net_amount);
            return totals;
        },
        { gross: 0, discount: 0, net: 0 }
    );
    const creditTotals = creditNoteItems.reduce(
        (totals, item) => {
            totals.qty += Number(item.quantity_returned || 0);
            for (const field of [
                "gross_reversal", "discount_reversal", "taxable_reversal",
                "cgst_reversal", "sgst_reversal", "gst_reversal",
                "net_reversal"
            ]) {
                totals[field] = addPaise(totals[field], item[field]);
            }
            totals.creditNotes.add(
                String(item.credit_note_no || "").trim().toUpperCase()
            );
            return totals;
        },
        {
            qty: 0,
            gross_reversal: 0,
            discount_reversal: 0,
            taxable_reversal: 0,
            cgst_reversal: 0,
            sgst_reversal: 0,
            gst_reversal: 0,
            net_reversal: 0,
            creditNotes: new Set()
        }
    );

    const summary = workbook.addWorksheet("Summary");
    setReportMetadata(summary, "Business Report - Summary", fromDate, toDate);
    summary.columns = [{ width: 32 }, { width: 20 }];
    expandSummaryMetadata(summary);
    setSummarySection(summary, 11, "SALES");
    setSummarySection(summary, 16, "RETURNS / CREDIT NOTES");
    setSummarySection(summary, 27, "NET BUSINESS");
    const salesEnd = Math.max(12, 11 + salesData.length);
    const cnEnd = Math.max(12, creditNoteDataEnd);
    const rows = [
        [12, "Gross Sales", `SUMPRODUCT('Business Report'!M12:M${salesEnd},'Business Report'!N12:N${salesEnd})`, salesTotals.gross],
        [13, "Discount", `SUM('Business Report'!O12:O${salesEnd})`, salesTotals.discount],
        [14, "Net Billing", `SUM('Business Report'!T12:T${salesEnd})`, salesTotals.net],
        [18, "Returned Qty", `SUM('Returns & Credit Notes'!O12:O${cnEnd})`, creditTotals.qty, true],
        [19, "Gross Reversal", `SUM('Returns & Credit Notes'!Q12:Q${cnEnd})`, creditTotals.gross_reversal],
        [20, "Discount Reversal", `SUM('Returns & Credit Notes'!R12:R${cnEnd})`, creditTotals.discount_reversal],
        [21, "Taxable Reversal", `SUM('Returns & Credit Notes'!S12:S${cnEnd})`, creditTotals.taxable_reversal],
        [22, "CGST Reversal", `SUM('Returns & Credit Notes'!U12:U${cnEnd})`, creditTotals.cgst_reversal],
        [23, "SGST Reversal", `SUM('Returns & Credit Notes'!V12:V${cnEnd})`, creditTotals.sgst_reversal],
        [24, "GST Reversal", `SUM('Returns & Credit Notes'!W12:W${cnEnd})`, creditTotals.gst_reversal],
        [25, "Net Reversal", `SUM('Returns & Credit Notes'!X12:X${cnEnd})`, creditTotals.net_reversal],
        [28, "Net Sales After Returns", "B14-B25", salesTotals.net - creditTotals.net_reversal]
    ];
    summary.getCell("A17").value = "Credit Notes";
    summary.getCell("B17").value = creditTotals.creditNotes.size;
    summary.getCell("B17").numFmt = "#,##0";
    for (const [row, label, formula, result, count] of rows) {
        summary.getCell(`A${row}`).value = label;
        summary.getCell(`B${row}`).value = {
            formula,
            result: count ? result : fromPaise(result)
        };
        summary.getCell(`B${row}`).numFmt = count
            ? "#,##0"
            : '"₹"#,##0.00;[Red]("₹"#,##0.00);-';
    }
    summary.getRow(28).font = { bold: true };
}

function addGSTCreditNoteSheets(
    workbook,
    salesData,
    creditNoteGST,
    fromDate,
    toDate
) {
    const sheet = workbook.addWorksheet("Credit Note GST Reversal");
    setReportMetadata(
        sheet,
        "GST Report - Credit Note GST Reversal",
        fromDate,
        toDate
    );
    sheet.columns = [
        { width: 18 }, { width: 16 }, { width: 18 }, { width: 18 },
        { width: 18 }, { width: 10 }, { width: 19 }, { width: 17 },
        { width: 17 }, { width: 17 }, { width: 17 }
    ];
    sheet.getRow(11).values = [
        "Credit Note No", "Credit Note Date", "Return No",
        "Original Bill No", "Original Bill Date", "GST %",
        "Taxable Reversal", "CGST Reversal", "SGST Reversal",
        "GST Reversal", "Net Reversal"
    ];
    styleNewRegister(sheet, 11);
    let rowNumber = 12;
    for (const row of creditNoteGST) {
        sheet.getRow(rowNumber).values = [
            row.credit_note_no, row.credit_note_date, row.return_no,
            row.original_bill_no, row.original_bill_date, row.gst_rate,
            row.taxable_reversal, row.cgst_reversal, row.sgst_reversal,
            row.gst_reversal, row.net_reversal
        ];
        rowNumber++;
    }
    const cnEnd = rowNumber - 1;
    if (creditNoteGST.length === 0) {
        sheet.mergeCells("A12:K12");
        sheet.getCell("A12").value = "No Credit Notes for selected period";
        sheet.getCell("A12").alignment = { horizontal: "center" };
    }
    else {
        const totalRow = sheet.getRow(rowNumber);
        totalRow.getCell(1).value = "TOTAL";
        for (const column of [7, 8, 9, 10, 11]) {
            const letter = sheet.getColumn(column).letter;
            const field = [
                "taxable_reversal", "cgst_reversal", "sgst_reversal",
                "gst_reversal", "net_reversal"
            ][column - 7];
            const result = creditNoteGST.reduce(
                (total, row) => addPaise(total, row[field]),
                0
            );
            totalRow.getCell(column).value = {
                formula: `SUM(${letter}12:${letter}${cnEnd})`,
                result: fromPaise(result)
            };
        }
        totalRow.font = { bold: true };
    }
    for (const column of [7, 8, 9, 10, 11]) {
        sheet.getColumn(column).numFmt =
            '"₹"#,##0.00;[Red]("₹"#,##0.00);-';
    }
    for (const column of [1, 3, 4]) {
        sheet.getColumn(column).numFmt = "@";
    }
    sheet.getColumn(6).numFmt = "0.00";
    sheet.views = [{ state: "frozen", ySplit: 11 }];

    const sales = salesData.reduce(
        (totals, row) => {
            totals.taxable = addPaise(totals.taxable, row.taxable_value);
            totals.cgst = addPaise(totals.cgst, row.cgst_amount);
            totals.sgst = addPaise(totals.sgst, row.sgst_amount);
            totals.gst = addPaise(totals.gst, row.gst_total);
            return totals;
        },
        { taxable: 0, cgst: 0, sgst: 0, gst: 0 }
    );
    const credit = creditNoteGST.reduce(
        (totals, row) => {
            totals.taxable = addPaise(totals.taxable, row.taxable_reversal);
            totals.cgst = addPaise(totals.cgst, row.cgst_reversal);
            totals.sgst = addPaise(totals.sgst, row.sgst_reversal);
            totals.gst = addPaise(totals.gst, row.gst_reversal);
            return totals;
        },
        { taxable: 0, cgst: 0, sgst: 0, gst: 0 }
    );
    const summary = workbook.addWorksheet("GST Summary");
    setReportMetadata(summary, "GST Report - Summary", fromDate, toDate);
    summary.columns = [{ width: 32 }, { width: 20 }];
    expandSummaryMetadata(summary);
    setSummarySection(summary, 11, "SALES GST");
    setSummarySection(summary, 17, "CREDIT NOTE REVERSAL");
    setSummarySection(summary, 23, "NET GST POSITION");
    const salesEnd = Math.max(12, 11 + salesData.length);
    const creditEnd = Math.max(12, cnEnd);
    const rows = [
        [12, "Sales Taxable Value", `SUM('GST Report'!D12:D${salesEnd})`, sales.taxable],
        [13, "Sales CGST", `SUM('GST Report'!E12:E${salesEnd})`, sales.cgst],
        [14, "Sales SGST", `SUM('GST Report'!F12:F${salesEnd})`, sales.sgst],
        [15, "Sales GST Total", `SUM('GST Report'!G12:G${salesEnd})`, sales.gst],
        [18, "CN Taxable Reversal", `SUM('Credit Note GST Reversal'!G12:G${creditEnd})`, credit.taxable],
        [19, "CN CGST Reversal", `SUM('Credit Note GST Reversal'!H12:H${creditEnd})`, credit.cgst],
        [20, "CN SGST Reversal", `SUM('Credit Note GST Reversal'!I12:I${creditEnd})`, credit.sgst],
        [21, "CN GST Reversal", `SUM('Credit Note GST Reversal'!J12:J${creditEnd})`, credit.gst],
        [24, "Net Taxable Value", "B12-B18", sales.taxable - credit.taxable],
        [25, "Net CGST", "B13-B19", sales.cgst - credit.cgst],
        [26, "Net SGST", "B14-B20", sales.sgst - credit.sgst],
        [27, "Net GST", "B15-B21", sales.gst - credit.gst]
    ];
    for (const [row, label, formula, result] of rows) {
        summary.getCell(`A${row}`).value = label;
        summary.getCell(`B${row}`).value = {
            formula,
            result: fromPaise(result)
        };
        summary.getCell(`B${row}`).numFmt =
            '"₹"#,##0.00;[Red]("₹"#,##0.00);-';
    }
    for (const row of [24, 25, 26, 27]) {
        summary.getRow(row).font = { bold: true };
    }
}

/* ===========================================
   BUSINESS REPORT
=========================================== */

async function exportBusinessReport(
    data,
    creditNoteItems,
    filePath,
    fromDate,
    toDate
) {

    const workbook = new ExcelJS.Workbook();

const worksheet =
    workbook.addWorksheet("Business Report");

// ===========================================
// Report Header
// ===========================================

worksheet.getCell("A1").value = "Store Name";
worksheet.getCell("B1").value = "KAIRA LUXE";

worksheet.getCell("A2").value = "Address";
worksheet.getCell("B2").value =
    "Shop No.3, Shree Towers, Near Khallikote University, Berhampur-760001, Odisha";

worksheet.getCell("A3").value = "Contact";
worksheet.getCell("B3").value = "0680-3596443";

worksheet.getCell("A4").value = "Email";
worksheet.getCell("B4").value = "kairaluxe@gmail.com";

worksheet.getCell("A5").value = "GSTIN";
worksheet.getCell("B5").value = "21BBLPP6327G1ZO";

worksheet.getCell("A7").value = "Report Name";
worksheet.getCell("B7").value = "Business Report";

worksheet.getCell("A8").value = "Report Generated On";
worksheet.getCell("B8").value =
    new Date().toLocaleString("en-IN");

worksheet.getCell("A9").value = "Report Period";
worksheet.getCell("B9").value =
    `${formatDate(fromDate)} to ${formatDate(toDate)}`;
        
    worksheet.columns = [

    { key: "bill_no", width: 15 },
    { key: "bill_date", width: 15 },
    { key: "bill_time", width: 12 },
   
    { key: "barcode", width: 18 },
    { key: "brand", width: 20 },
    { key: "product_name", width: 30 },

    { key: "style_code", width: 18 },
    { key: "colour", width: 15 },
    { key: "size", width: 10 },
    { key: "supplier", width: 20 },
    { key: "category", width: 18 },
    { key: "hsn_code", width: 15 },

    { key: "quantity", width: 10 },
    { key: "mrp", width: 12 },
    { key: "discount_amount", width: 14 },
    { key: "taxable_amount", width: 18 },
    { key: "gst_rate", width: 10 },
    { key: "cgst_amount", width: 12 },
    { key: "sgst_amount", width: 12 },
    { key: "net_amount", width: 15 },

    { key: "cash_amount", width: 12 },
    { key: "upi_amount", width: 12 },
    { key: "card_amount", width: 12 }

];

    const headerRow = worksheet.getRow(11);

headerRow.values = [
    "Bill No",
    "Bill Date",
    "Bill Time",

    "Barcode",
    "Brand",
    "Product Name",
    "Style Code",
    "Colour",
    "Size",
    "Supplier",
    "Category",
    "HSN Code",

    "Qty",
    "MRP",
    "Discount",
    "Taxable Amount",
    "GST %",
    "CGST",
    "SGST",
    "Net Amount",

    "Cash",
    "UPI",
    "Card"
];

let currentRow = 12;

// Totals

let totalQty = 0;

let totalDiscount = 0;

let totalTaxable = 0;

let totalCGST = 0;

let totalSGST = 0;

let totalNet = 0;

let totalCash = 0;

let totalUPI = 0;

let totalCard = 0;

const processedBills = new Set();

let previousBillNo = "";

for (const row of data) {

    const isNewBill = row.bill_no !== previousBillNo;

worksheet.getRow(currentRow).values = [

    isNewBill ? row.bill_no : "",
    isNewBill ? row.bill_date : "",
    isNewBill ? row.bill_time : "",

    row.barcode,
    row.brand,
    row.product_name,
    row.style_code,
    row.colour,
    row.size,
    row.supplier,
    row.category,
    row.hsn_code,

    row.quantity,
    row.mrp,
    row.discount_amount,
    row.taxable_amount,
    row.gst_rate,
    row.cgst_amount,
    row.sgst_amount,
    row.net_amount,

    isNewBill ? row.cash_amount : "",
    isNewBill ? row.upi_amount : "",
    isNewBill ? row.card_amount : ""

];

previousBillNo = row.bill_no;

    totalQty += Number(row.quantity || 0);

    totalDiscount += Number(row.discount_amount || 0);

    totalTaxable += Number(row.taxable_amount || 0);

    totalCGST += Number(row.cgst_amount || 0);

    totalSGST += Number(row.sgst_amount || 0);

    totalNet += Number(row.net_amount || 0);

    if (!processedBills.has(row.bill_no)) {

    totalCash += Number(row.cash_amount || 0);

    totalUPI += Number(row.upi_amount || 0);

    totalCard += Number(row.card_amount || 0);

    processedBills.add(row.bill_no);

}

    currentRow++;

}

    worksheet.getRow(currentRow).values = [

    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",

    totalQty,

    "",

    totalDiscount,

    totalTaxable,

    "",

    totalCGST,

    totalSGST,

    totalNet,

    totalCash,

    totalUPI,

    totalCard

];

worksheet.getRow(currentRow).font = {

    bold: true

};

addBusinessCreditNoteSheets(
    workbook,
    data,
    creditNoteItems,
    fromDate,
    toDate
);

{
    await workbook.xlsx.writeFile(filePath);

return {
    success: true,
    filePath
    };
}

}

/* ===========================================
   GST REPORT
=========================================== */

async function exportGSTReport(
    data,
    creditNoteGST,
    filePath,
    fromDate,
    toDate
) {

    const totalColumns = 8;

    const lastColumn =
        String.fromCharCode(64 + totalColumns);

    const workbook = new ExcelJS.Workbook();

    const worksheet =
        workbook.addWorksheet("GST Report");

    // ===========================================
// Report Header
// ===========================================

worksheet.getCell("A1").value = "Store Name";
worksheet.getCell("B1").value = "KAIRA LUXE";

worksheet.getCell("A2").value = "Address";
worksheet.getCell("B2").value =
    "Shop No.3, Shree Towers, Near Khallikote University, Berhampur-760001, Odisha";

worksheet.getCell("A3").value = "Contact";
worksheet.getCell("B3").value = "0680-3596443";

worksheet.getCell("A4").value = "Email";
worksheet.getCell("B4").value = "kairaluxe@gmail.com";

worksheet.getCell("A5").value = "GSTIN";
worksheet.getCell("B5").value = "21BBLPP6327G1ZO";

worksheet.getCell("A7").value = "Report Name";
worksheet.getCell("B7").value = "GST Report";

worksheet.getCell("A8").value = "Report Generated On";
worksheet.getCell("B8").value =
    new Date().toLocaleString("en-IN");

worksheet.getCell("A9").value = "Report Period";
worksheet.getCell("B9").value =
    `${formatDate(fromDate)} to ${formatDate(toDate)}`;

    worksheet.columns = [

        { key: "bill_no", width: 15 },
        { key: "bill_date", width: 15 },
        { key: "gst_rate", width: 10 },
        { key: "taxable_value", width: 18 },
        { key: "cgst_amount", width: 15 },
        { key: "sgst_amount", width: 15 },
        { key: "gst_total", width: 15 },
        { key: "net_amount", width: 18 }

    ];

    const headerRow = worksheet.getRow(11);

    headerRow.values = [

        "Bill No",
        "Bill Date",
        "GST %",
        "Taxable Value",
        "CGST",
        "SGST",
        "GST Total",
        "Net Amount"

    ];

    let currentRow = 12;

    let totalTaxable = 0;

    let totalCGST = 0;

    let totalSGST = 0;

    let totalGST = 0;

    let totalNet = 0;

    for (const row of data) {

        worksheet.getRow(currentRow).values = [

            row.bill_no,
            row.bill_date,
            row.gst_rate,
            row.taxable_value,
            row.cgst_amount,
            row.sgst_amount,
            row.gst_total,
            row.net_amount

        ];

        totalTaxable += Number(row.taxable_value || 0);

        totalCGST += Number(row.cgst_amount || 0);

        totalSGST += Number(row.sgst_amount || 0);

        totalGST += Number(row.gst_total || 0);

        totalNet += Number(row.net_amount || 0);

        currentRow++;

    }

    worksheet.getRow(currentRow).values = [

    "TOTAL",

    "",

    "",

    totalTaxable,

    totalCGST,

    totalSGST,

    totalGST,

    totalNet

];

worksheet.getRow(currentRow).font = {

    bold: true

};

    addGSTCreditNoteSheets(
        workbook,
        data,
        creditNoteGST,
        fromDate,
        toDate
    );

    await workbook.xlsx.writeFile(filePath);

    return {

        success: true,

        filePath

    };

}

/* ===========================================
   PRODUCT SALES REPORT
=========================================== */

async function exportProductSalesReport(
    data,
    filePath,
    fromDate,
    toDate
) {

    const totalColumns = 13;

    const lastColumn =
        String.fromCharCode(64 + totalColumns);

    const workbook = new ExcelJS.Workbook();

    const worksheet =
        workbook.addWorksheet("Product Sales Report");

    // ===========================================
// Report Header
// ===========================================

worksheet.getCell("A1").value = "Store Name";
worksheet.getCell("B1").value = "KAIRA LUXE";

worksheet.getCell("A2").value = "Address";
worksheet.getCell("B2").value =
    "Shop No.3, Shree Towers, Near Khallikote University, Berhampur-760001, Odisha";

worksheet.getCell("A3").value = "Contact";
worksheet.getCell("B3").value = "0680-3596443";

worksheet.getCell("A4").value = "Email";
worksheet.getCell("B4").value = "kairaluxe@gmail.com";

worksheet.getCell("A5").value = "GSTIN";
worksheet.getCell("B5").value = "21BBLPP6327G1ZO";

worksheet.getCell("A7").value = "Report Name";
worksheet.getCell("B7").value = "Product Sales Report";

worksheet.getCell("A8").value = "Report Generated On";
worksheet.getCell("B8").value =
    new Date().toLocaleString("en-IN");

worksheet.getCell("A9").value = "Report Period";
worksheet.getCell("B9").value =
    `${formatDate(fromDate)} to ${formatDate(toDate)}`;
    
    worksheet.columns = [

        { key: "barcode", width: 18 },
        { key: "brand", width: 18 },
        { key: "product_name", width: 30 },
        { key: "style_code", width: 18 },
        { key: "colour", width: 15 },
        { key: "size", width: 10 },
        { key: "category", width: 18 },
        { key: "qty_sold", width: 12 },
        { key: "gross_sales", width: 15 },
        { key: "discount_amount", width: 15 },
        { key: "taxable_value", width: 18 },
        { key: "gst_amount", width: 15 },
        { key: "net_sales", width: 15 }

    ];

    const headerRow = worksheet.getRow(11);

    headerRow.values = [

        "Barcode",
        "Brand",
        "Product Name",
        "Style Code",
        "Colour",
        "Size",
        "Category",
        "Qty Sold",
        "Gross Sales",
        "Discount",
        "Taxable Value",
        "GST",
        "Net Sales"

    ];

    let currentRow = 12;

    let totalQtySold = 0;

    for (const row of data) {

        worksheet.getRow(currentRow).values = [

            row.barcode,
            row.brand,
            row.product_name,
            row.style_code,
            row.colour,
            row.size,
            row.category,
            row.qty_sold,
            row.gross_sales,
            row.discount_amount,
            row.taxable_value,
            row.gst_amount,
            row.net_sales

        ];

        totalQtySold += Number(row.qty_sold || 0);

        currentRow++;

    }

    worksheet.getRow(currentRow).values = [

    "TOTAL",

    "",

    "",

    "",

    "",

    "",

    "",

    totalQtySold

];

worksheet.getRow(currentRow).font = {

    bold: true

};

    await workbook.xlsx.writeFile(filePath);

    return {

        success: true,

        filePath

    };

}

/* ===========================================
   CUSTOMER PURCHASE REPORT
=========================================== */

async function exportCustomerPurchaseReport(
    data,
    filePath,
    fromDate,
    toDate
)

{

    const workbook = new ExcelJS.Workbook();

    const sheet =
        workbook.addWorksheet(
            "Customer Purchase Report"
        );

    // ===========================================
    // Report Header
    // ===========================================

    sheet.getCell("A1").value = "Store Name";
    sheet.getCell("B1").value = "KAIRA LUXE";

    sheet.getCell("A2").value = "Address";
    sheet.getCell("B2").value =
        "Shop No.3, Shree Towers, Near Khallikote University, Berhampur-760001, Odisha";

    sheet.getCell("A3").value = "Contact";
    sheet.getCell("B3").value = "0680-3596443";

    sheet.getCell("A4").value = "Email";
    sheet.getCell("B4").value = "kairaluxe@gmail.com";

    sheet.getCell("A5").value = "GSTIN";
    sheet.getCell("B5").value = "21BBLPP6327G1ZO";

    sheet.getCell("A7").value = "Report Name";
    sheet.getCell("B7").value = "Customer Purchase Report";

    sheet.getCell("A8").value = "Report Generated On";
    sheet.getCell("B8").value =
        new Date().toLocaleString("en-IN");

    sheet.getCell("A9").value = "Report Period";

const formatDate = (date) => {

    const d = new Date(date);

    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();

    return `${day}/${month}/${year}`;

};

sheet.getCell("B9").value =
    `${formatDate(fromDate)} to ${formatDate(toDate)}`;

    // ===========================================
    // Columns
    // ===========================================

    sheet.columns = [

        {
            key: "customer_name",
            width: 28
        },

        {
            key: "customer_mobile",
            width: 18
        },

        {
            key: "total_bills",
            width: 12
        },

        {
            key: "quantity_purchased",
            width: 18
        },

        {
            key: "total_purchase",
            width: 18
        },

        {
            key: "average_bill",
            width: 18
        },

        {
            key: "first_purchase",
            width: 16
        },

        {
            key: "last_purchase",
            width: 16
        }

    ];

    // ===========================================
    // Table Header
    // ===========================================

    const headerRow = sheet.getRow(11);

    headerRow.values = [

        "Customer Name",
        "Mobile Number",
        "Bills",
        "Quantity Purchased",
        "Total Purchase",
        "Average Bill",
        "First Purchase",
        "Last Purchase"

    ];

    // ===========================================
    // Data
    // ===========================================

    let currentRow = 12;

    for (const row of data) {

        sheet.getRow(currentRow).values = [

            row.customer_name,
            row.customer_mobile,
            row.total_bills,
            row.quantity_purchased,
            row.total_purchase,
            row.average_bill,
            row.first_purchase,
            row.last_purchase

        ];

        currentRow++;

    }

    // ===========================================
    // Freeze Header
    // ===========================================

    sheet.views = [

        {

            state: "frozen",

            ySplit: 11

        }

    ];

    await workbook.xlsx.writeFile(filePath);

    return {

        success: true,

        filePath

    };

}

module.exports = {

    exportBusinessReport,

    exportGSTReport,

    exportProductSalesReport,

    exportCustomerPurchaseReport

};
