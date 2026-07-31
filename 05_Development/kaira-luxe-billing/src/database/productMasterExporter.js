const ExcelJS = require("exceljs");

async function downloadProductMasterTemplate(filePath) {

    const workbook = new ExcelJS.Workbook();

    /* ===========================================
       PRODUCT MASTER SHEET
    =========================================== */

    const sheet = workbook.addWorksheet("Product Master");

    sheet.columns = [

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
        { header: "Selling Price", key: "selling_price", width: 15 },
        { header: "Cost Price", key: "cost_price", width: 15 },
        { header: "GST Rate", key: "gst_rate", width: 12 },
        { header: "HSN Code", key: "hsn_code", width: 15 },
        { header: "Opening Stock", key: "opening_stock", width: 15 },
        { header: "Reorder Level", key: "reorder_level", width: 15 },
        { header: "Supplier", key: "supplier", width: 20 },
        { header: "Active", key: "active", width: 10 }

    ];

/* ===========================================
   SAMPLE PRODUCTS
=========================================== */

sheet.addRow({
    barcode: "8901000001",
    sku: "KL000001",
    brand: "Jockey",
    segment: "Men",
    category: "Brief",
    season: "NOS",
    collection: "Classic",
    product_name: "Jockey Men's Brief",
    style_code: "JM-BR101",
    size: "M",
    colour: "White",
    mrp: 399,
    selling_price: 399,
    cost_price: 220,
    gst_rate: 5,
    hsn_code: "621210",
    opening_stock: 25,
    reorder_level: 5,
    supplier: "Jockey India",
    active: true
});

sheet.addRow({
    barcode: "8901000002",
    sku: "KL000002",
    brand: "Jockey",
    segment: "Men",
    category: "Vest",
    season: "SS26",
    collection: "Air",
    product_name: "Jockey Men's Vest",
    style_code: "JM-VS201",
    size: "L",
    colour: "White",
    mrp: 499,
    selling_price: 499,
    cost_price: 280,
    gst_rate: 5,
    hsn_code: "610910",
    opening_stock: 20,
    reorder_level: 5,
    supplier: "Jockey India",
    active: true
});

sheet.addRow({
    barcode: "8901000003",
    sku: "KL000003",
    brand: "Jockey",
    segment: "Women",
    category: "Bra",
    season: "FW26",
    collection: "Comfort",
    product_name: "Jockey Women's Wirefree Bra",
    style_code: "JW-BR301",
    size: "34B",
    colour: "Skin",
    mrp: 899,
    selling_price: 899,
    cost_price: 520,
    gst_rate: 5,
    hsn_code: "621210",
    opening_stock: 18,
    reorder_level: 5,
    supplier: "Jockey India",
    active: true
});

sheet.addRow({
    barcode: "8901000004",
    sku: "KL000004",
    brand: "Jockey",
    segment: "Unisex",
    category: "Socks",
    season: "SS26",
    collection: "Active",
    product_name: "Jockey Cotton Socks",
    style_code: "JS-SK401",
    size: "Free",
    colour: "Black",
    mrp: 199,
    selling_price: 199,
    cost_price: 95,
    gst_rate: 5,
    hsn_code: "611595",
    opening_stock: 40,
    reorder_level: 10,
    supplier: "Jockey India",
    active: true
});

sheet.addRow({
    barcode: "8901000005",
    sku: "KL000005",
    brand: "Zivame",
    segment: "Women",
    category: "Panty",
    season: "FW26",
    collection: "Everyday",
    product_name: "Zivame Cotton Panty",
    style_code: "ZV-PN501",
    size: "M",
    colour: "Pink",
    mrp: 349,
    selling_price: 349,
    cost_price: 180,
    gst_rate: 5,
    hsn_code: "610821",
    opening_stock: 30,
    reorder_level: 8,
    supplier: "Zivame",
    active: true
});

sheet.addRow({
    barcode: "8901000006",
    sku: "KL000006",
    brand: "Loveable",
    segment: "Women",
    category: "Bra",
    season: "SS26",
    collection: "Elegance",
    product_name: "Loveable Padded Bra",
    style_code: "LV-BR601",
    size: "36C",
    colour: "Beige",
    mrp: 999,
    selling_price: 999,
    cost_price: 590,
    gst_rate: 5,
    hsn_code: "621210",
    opening_stock: 15,
    reorder_level: 5,
    supplier: "Loveable India",
    active: true
});

sheet.addRow({
    barcode: "8901000007",
    sku: "KL000007",
    brand: "Loveable",
    segment: "Women",
    category: "Panty",
    season: "NOS",
    collection: "Everyday",
    product_name: "Loveable Hipster Panty",
    style_code: "LV-PN701",
    size: "L",
    colour: "Black",
    mrp: 399,
    selling_price: 399,
    cost_price: 210,
    gst_rate: 5,
    hsn_code: "610821",
    opening_stock: 28,
    reorder_level: 8,
    supplier: "Loveable India",
    active: true
});


/* ===========================================
   INSTRUCTIONS SHEET
=========================================== */

const instructions = workbook.addWorksheet("Instructions");

instructions.addRow([
    "KAIRA LUXE PRODUCT MASTER TEMPLATE"
]);

instructions.addRow([]);

instructions.addRow([
    "Mandatory Fields"
]);

instructions.addRow([
    "• Barcode"
]);

instructions.addRow([
    "• Brand"
]);

instructions.addRow([
    "• Category"
]);

instructions.addRow([
    "• Product Name"
]);

instructions.addRow([
    "• MRP"
]);

instructions.addRow([
    "• GST Rate"
]);

instructions.addRow([]);

instructions.addRow([
    "Optional Fields"
]);

instructions.addRow([
    "• SKU"
]);

instructions.addRow([
    "• Segment"
]);

instructions.addRow([
    "• Season"
]);

instructions.addRow([
    "• Collection"
]);

instructions.addRow([
    "• Style Code"
]);

instructions.addRow([
    "• Size"
]);

instructions.addRow([
    "• Colour"
]);

instructions.addRow([
    "• Selling Price"
]);

instructions.addRow([
    "• Cost Price"
]);

instructions.addRow([
    "• HSN Code"
]);

instructions.addRow([
    "• Opening Stock"
]);

instructions.addRow([
    "• Reorder Level"
]);

instructions.addRow([
    "• Supplier"
]);

instructions.addRow([
    "• Active"
]);

instructions.addRow([]);

instructions.addRow([
    "Season Examples"
]);

instructions.addRow([
    "NOS = Never Out of Stock"
]);

instructions.addRow([
    "SS26 = Spring / Summer 2026"
]);

instructions.addRow([
    "FW26 = Fall / Winter 2026"
]);

instructions.addRow([]);

instructions.addRow([
    "These are examples only."
]);

instructions.addRow([
    "You may use SS27, FW27, SS28, FW28 or any season code used by your brands."
]);

instructions.addRow([]);

instructions.addRow([
    "Collection Examples"
]);

instructions.addRow([
    "Classic"
]);

instructions.addRow([
    "Air"
]);

instructions.addRow([
    "Comfort"
]);

instructions.addRow([
    "Active"
]);

instructions.addRow([
    "Everyday"
]);

instructions.addRow([
    "Elegance"
]);

instructions.addRow([]);

instructions.addRow([
    "Import Guidelines"
]);

instructions.addRow([
    "• Do not rename column headers."
]);

instructions.addRow([
    "• Do not leave mandatory fields blank."
]);

instructions.addRow([
    "• Do not delete any columns."
]);

instructions.addRow([
    "• Delete the sample products and add your own products before importing."
]);

instructions.addRow([
    "• Save the workbook as .xlsx."
]);

instructions.addRow([
    "• Do not change the worksheet names."
]);

instructions.columns = [

    {

        width: 70

    }

];

    await workbook.xlsx.writeFile(filePath);

    

    return {

        success: true,

        filePath

    };

}

module.exports = {

    downloadProductMasterTemplate

};