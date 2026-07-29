const ExcelJS = require("exceljs");

function formatDate(date) {

    const d = new Date(date);

    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();

    return `${day}/${month}/${year}`;

};

/* ===========================================
   BUSINESS REPORT
=========================================== */

async function exportBusinessReport(
    data,
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