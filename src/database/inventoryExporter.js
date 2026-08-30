const ExcelJS = require("exceljs");

const INVENTORY_EXPORT_COLUMNS = [
    { header: "Barcode", key: "barcode", width: 18 },
    { header: "SKU", key: "sku", width: 18 },
    { header: "Brand", key: "brand", width: 18 },
    { header: "Segment", key: "segment", width: 15 },
    { header: "Category", key: "category", width: 18 },
    { header: "Season", key: "season", width: 15 },
    { header: "Collection", key: "collection", width: 22 },
    { header: "Product Name", key: "product_name", width: 35 },
    { header: "Style Code", key: "style_code", width: 18 },
    { header: "Size", key: "size", width: 12 },
    { header: "Colour", key: "colour", width: 15 },
    { header: "MRP", key: "mrp", width: 12 },
    { header: "Discount", key: "discount", width: 12 },
    { header: "Selling Price", key: "selling_price", width: 15 },
    { header: "Cost Price", key: "cost_price", width: 15 },
    { header: "GST Rate", key: "gst_rate", width: 12 },
    { header: "HSN Code", key: "hsn_code", width: 15 },
    { header: "Opening Stock", key: "opening_stock", width: 15 },
    { header: "Current Stock", key: "current_stock", width: 15 },
    { header: "Reorder Level", key: "reorder_level", width: 15 },
    { header: "Supplier", key: "supplier", width: 20 },
    { header: "Active", key: "active", width: 10 }
];

async function exportInventory(products, filePath) {

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Inventory");

    sheet.columns = INVENTORY_EXPORT_COLUMNS;

    products.forEach(product => {
        sheet.addRow(product);
    });

    await workbook.xlsx.writeFile(filePath);

}

module.exports = {
    exportInventory,
    INVENTORY_EXPORT_COLUMNS
};
