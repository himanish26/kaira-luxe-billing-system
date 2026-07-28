const ExcelJS = require("exceljs");

/* ===========================================
   BUSINESS REPORT
=========================================== */

const totalColumns = 23;

const lastColumn =
    String.fromCharCode(64 + totalColumns);

async function exportBusinessReport(
    data,
    filePath
) {

    const workbook = new ExcelJS.Workbook();

    const worksheet =
        workbook.addWorksheet("Business Report");

        worksheet.mergeCells(`A1:${lastColumn}1`);
        worksheet.getCell("A1").value = "KAIRA LUXE";

        worksheet.mergeCells(`A2:${lastColumn}2`);
        worksheet.getCell("A2").value = "Store Address";

        worksheet.mergeCells(`A3:${lastColumn}3`);
        worksheet.getCell("A3").value = "Phone";

        worksheet.mergeCells(`A4:${lastColumn}4`);
        worksheet.getCell("A4").value = "Email";

        worksheet.mergeCells(`A5:${lastColumn}5`);
        worksheet.getCell("A5").value = "GSTIN";

        worksheet.mergeCells(`A7:${lastColumn}7`);
        worksheet.getCell("A7").value = "Report Period";

        worksheet.mergeCells(`A8:${lastColumn}8`);
        worksheet.getCell("A8").value = "Generated At";

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

    const headerRow = worksheet.getRow(10);

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

let currentRow = 11;

for (const row of data) {

    worksheet.getRow(currentRow).values = [
        row.bill_no,
        row.bill_date,
        row.bill_time,

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

        row.cash_amount,
        row.upi_amount,
        row.card_amount
    ];

    currentRow++;

}

{
    await workbook.xlsx.writeFile(
    filePath
);

return {

    success: true,

    filePath

};
}

}

/* ===========================================
   GST REPORT
=========================================== */

async function exportGSTReport(data) {

}

/* ===========================================
   PRODUCT SALES REPORT
=========================================== */

async function exportProductSalesReport(data) {

}

module.exports = {

    exportBusinessReport,

    exportGSTReport,

    exportProductSalesReport

};