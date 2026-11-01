"use strict";

const ExcelJS = require("exceljs");
const XLSX = require("xlsx");
const crypto = require("node:crypto");

const HEADERS = ["BARCODE", "SKU", "BRAND", "SEGMENT", "BUSINESS SEGMENT", "CATEGORY", "SEASON", "COLLECTION", "PRODUCT NAME", "STYLE CODE", "SIZE", "COLOUR", "PRINTED MRP", "DISCOUNT", "SELLING PRICE", "INVOICE RATE / PIECE", "GST RATE", "HSN CODE", "QUANTITY", "REORDER LEVEL", "SUPPLIER", "ACTIVE", "VARIABLE VALUE"];
const MAX_ROWS = 20000;

function cellText(cell) {
    if (!cell || cell.value == null) return "";
    if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Hyperlink || cell.type === ExcelJS.ValueType.Error) {
        throw new Error(`Row ${cell.row}, column ${cell.col}: formulas and linked cells are not supported.`);
    }
    const value = cell.value;
    if (typeof value === "object") {
        if (Object.prototype.hasOwnProperty.call(value, "formula") || Object.prototype.hasOwnProperty.call(value, "sharedFormula")) {
            throw new Error(`Row ${cell.row}, column ${cell.col}: formulas are not supported.`);
        }
        if (Array.isArray(value.richText)) return value.richText.map(part => part.text || "").join("");
        if (value.text != null) return String(value.text);
        throw new Error(`Row ${cell.row}, column ${cell.col}: use plain cell values.`);
    }
    const text = String(value).trim();
    if (text.startsWith("=")) throw new Error(`Row ${cell.row}, column ${cell.col}: formulas are not supported.`);
    return text;
}

function excelBarcodeText(value, numberFormat, rowNumber) {
    if (typeof value !== "number") return String(value ?? "").trim();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Row ${rowNumber}: barcode is not an exact whole number. Correct it to text in the supplier file.`);
    const digits = String(value);
    if (/^0{8,14}$/.test(String(numberFormat || ""))) return digits.padStart(String(numberFormat).length, "0");
    if (digits.length === 13 || digits.length === 14) return digits;
    throw new Error(`Row ${rowNumber}: numeric barcode ${digits} may have lost leading zeroes. Store it as text or use a zero-padded Excel format before conversion.`);
}

function moneyPaise(value, label, row) {
    const text = String(value ?? "").trim().replace(/^₹\s*/, "");
    if (!/^\d+(?:\.\d{1,4})?$/.test(text)) throw new Error(`Row ${row}: ${label} must be a non-negative amount with up to 2 decimals.`);
    const [rupees, fraction = ""] = text.split(".");
    if (fraction.length > 2 && /[^0]/.test(fraction.slice(2))) throw new Error(`Row ${row}: ${label} has fractions smaller than one paisa and cannot be represented safely.`);
    const paise = Number(rupees) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
    if (!Number.isSafeInteger(paise)) throw new Error(`Row ${row}: ${label} is too large.`);
    return paise;
}

function optionalNumber(value, label, row, max = 100000000) {
    if (value == null || String(value).trim() === "") return null;
    const text = String(value).trim().replace(/^₹\s*/, "").replace(/\s*%$/, "");
    if (!/^\d+(?:\.\d{1,4})?$/.test(text)) throw new Error(`Row ${row}: ${label} must be a non-negative number.`);
    const number = Number(text);
    if (!Number.isFinite(number) || number > max) throw new Error(`Row ${row}: ${label} is outside the supported range.`);
    return number;
}

function normalizeInvoiceRows(rows) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS) throw new Error(`The invoice must contain 1–${MAX_ROWS} product rows.`);
    const normalized = rows.map((row, index) => {
        const line = index + 2;
        const barcode = String(row.barcode ?? "").trim();
        if (!barcode || /[\u0000-\u001F\u007F-\u009F]/.test(barcode)) throw new Error(`Row ${line}: enter a valid barcode.`);
        const quantityText = String(row.quantity ?? "").trim();
        if (!/^\d+(?:\.0+)?$/.test(quantityText) || Number(quantityText) < 1 || !Number.isSafeInteger(Number(quantityText))) throw new Error(`Row ${line}: quantity must be a positive whole number.`);
        const optional = value => {
            const text = String(value ?? "").trim();
            if (/[\u0000-\u001F\u007F-\u009F]/.test(text)) throw new Error(`Row ${line}: text contains unsupported control characters.`);
            return text || null;
        };
        const activeText = String(row.active ?? "").trim().toUpperCase();
        if (activeText && !["YES", "NO", "TRUE", "FALSE", "1", "0", "ACTIVE", "INACTIVE"].includes(activeText)) throw new Error(`Row ${line}: Active must be Yes or No.`);
        const variableText = String(row.variableValue ?? "").trim().toUpperCase();
        if (variableText && !["YES", "NO", "TRUE", "FALSE", "1", "0"].includes(variableText)) throw new Error(`Row ${line}: Variable Value must be Yes or No.`);
        const reorder = optionalNumber(row.reorderLevel, "Reorder Level", line, 1000000);
        if (reorder != null && !Number.isSafeInteger(reorder)) throw new Error(`Row ${line}: Reorder Level must be a whole number.`);
        return {
            barcode, sku: optional(row.sku), brand: optional(row.brand), segment: optional(row.segment), businessSegment: optional(row.businessSegment),
            category: optional(row.category), season: optional(row.season), collection: optional(row.collection), productName: optional(row.productName),
            styleCode: optional(row.styleCode), size: optional(row.size), colour: optional(row.colour), discount: optionalNumber(row.discount, "Discount", line),
            sellingPricePaise: row.sellingPrice == null || String(row.sellingPrice).trim() === "" ? null : moneyPaise(row.sellingPrice, "Selling Price", line),
            gstRate: optionalNumber(row.gstRate, "GST Rate", line), hsnCode: optional(row.hsnCode), quantity: Number(quantityText),
            mrpPaise: moneyPaise(row.mrp, "Printed MRP", line), unitCostPaise: moneyPaise(row.unitCost, "Invoice rate / piece", line),
            reorderLevel: reorder, supplier: optional(row.supplier), active: activeText ? !["NO", "FALSE", "0", "INACTIVE"].includes(activeText) : null,
            variableValue: variableText ? ["YES", "TRUE", "1"].includes(variableText) : null
        };
    });
    const rates = new Map();
    const total = normalized.reduce((sum,row)=>sum+row.quantity,0);
    if (!Number.isSafeInteger(total)) throw new Error("The invoice quantity total is too large.");
    for (const row of normalized) {
        const key = `${row.barcode}\u0000${row.mrpPaise}`;
        if (rates.has(key) && rates.get(key) !== row.unitCostPaise) throw new Error(`Barcode ${row.barcode} has different invoice rates for the same MRP. Correct the workbook before importing.`);
        rates.set(key,row.unitCostPaise);
    }
    return normalized;
}

async function createTemplateBuffer() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KLBS";
    const sheet = workbook.addWorksheet("Stock Inward", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(HEADERS);
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF8A004F" } };
    [20, 18, 18, 14, 20, 18, 14, 20, 34, 18, 12, 15, 16, 12, 16, 24, 12, 15, 14, 16, 22, 12, 18].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.getColumn(1).numFmt = "@";
    sheet.getRow(1).eachCell(cell => { cell.alignment = { vertical: "middle", wrapText: true }; });
    const instructions = workbook.addWorksheet("Instructions");
    instructions.addRows([
        ["KLBS STOCK INWARD WORKBOOK"],
        ["Use one row for each barcode + printed MRP + invoice rate combination."],
        ["If the same barcode arrives at two MRPs, enter two rows with their separate quantities."],
        ["Leave SKU blank. KLBS creates its SKU for a new barcode. Existing barcodes keep their current KLBS SKU."],
        ["Keep barcodes as text and preserve leading zeroes. Safely formatted zero-padded barcodes and exact 13–14 digit numeric barcodes can be read; ambiguous shorter numeric barcodes must be corrected to text. Do not add formulas."],
        ["Quantity is a whole number. Printed MRP and invoice rate are per piece in INR."],
        ["Brand, Category, Product Name, Business Segment and GST Rate are required to create a new Product Master record. Missing details go to manager review."],
        ["Invoice upload records expected quantities only. Cashier must physically scan every received piece before posting."],
        ["Example: barcode 8901234567890, quantity 3, MRP 100, invoice rate 62.50"]
    ]);
    instructions.getColumn(1).width = 115;
    instructions.getRow(1).font = { bold: true, size: 14, color: { argb: "FF8A004F" } };
    return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function createConvertedWorkbookBuffer(rows) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS) throw new Error(`The invoice must contain 1–${MAX_ROWS} product rows.`);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KLBS";
    const sheet = workbook.addWorksheet("Stock Inward", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(HEADERS);
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF8A004F" } };
    [20, 18, 18, 14, 20, 18, 14, 20, 34, 18, 12, 15, 16, 12, 16, 24, 12, 15, 14, 16, 22, 12, 18].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.getColumn(1).numFmt = "@";
    sheet.getRow(1).eachCell(cell => { cell.alignment = { vertical: "middle", wrapText: true }; });
    for (const row of rows) {
        const normalized = normalizeInvoiceRows([{
            ...row,
            sku: "", // Supplier SKUs are not KLBS SKUs; KLBS assigns new ones during inward review.
            mrp: (row.mrpPaise / 100).toFixed(2),
            unitCost: (row.unitCostPaise / 100).toFixed(2),
            sellingPrice: row.sellingPricePaise == null ? "" : (row.sellingPricePaise / 100).toFixed(2)
        }])[0];
        sheet.addRow([
            normalized.barcode, "", normalized.brand, normalized.segment, normalized.businessSegment, normalized.category,
            normalized.season, normalized.collection, normalized.productName, normalized.styleCode, normalized.size, normalized.colour,
            normalized.mrpPaise / 100, normalized.discount, normalized.sellingPricePaise == null ? "" : normalized.sellingPricePaise / 100,
            normalized.unitCostPaise / 100, normalized.gstRate, normalized.hsnCode, normalized.quantity, normalized.reorderLevel,
            normalized.supplier, normalized.active == null ? "" : normalized.active ? "Yes" : "No",
            normalized.variableValue == null ? "" : normalized.variableValue ? "Yes" : "No"
        ]);
    }
    sheet.getColumn(13).numFmt = '₹#,##0.00';
    sheet.getColumn(15).numFmt = '₹#,##0.00';
    sheet.getColumn(16).numFmt = '₹#,##0.00';
    const instructions = workbook.addWorksheet("Instructions");
    instructions.addRows([
        ["KLBS STOCK INWARD WORKBOOK — CONVERTED SUPPLIER INVOICE"],
        ["Review the converted product details and quantities against the supplier invoice before uploading to Stock Inward."],
        ["The supplier's SKU or item code is not used as a KLBS SKU. KLBS preserves existing SKUs and assigns new ones to new barcodes during inward review."],
        ["The workbook records expected quantities only. Cashier must physically scan every received piece before posting."],
        ["If a supplier column could not be identified, its value remains blank. Complete missing Product Master details before posting new products."],
        ["Keep barcode values as text and preserve leading zeroes. Ambiguous shorter numeric barcodes must be corrected to text. Do not add formulas."]
    ]);
    instructions.getColumn(1).width = 115;
    instructions.getRow(1).font = { bold: true, size: 14, color: { argb: "FF8A004F" } };
    return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function parseInvoiceWorkbook(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Stock Inward") || workbook.worksheets[0];
    if (!sheet) throw new Error("The workbook has no worksheet.");
    const headerMap = new Map();
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => headerMap.set(headerKey(cellText(cell)), column));
    const aliases = {
        barcode: ["BARCODE"], sku: ["SKU"], brand: ["BRAND"], segment: ["SEGMENT"], businessSegment: ["BUSINESS SEGMENT"],
        category: ["CATEGORY"], season: ["SEASON"], collection: ["COLLECTION"], productName: ["PRODUCT NAME", "PRODUCT"],
        styleCode: ["STYLE CODE"], size: ["SIZE"], colour: ["COLOUR", "COLOR"], mrp: ["PRINTED MRP", "MRP"],
        discount: ["DISCOUNT"], sellingPrice: ["SELLING PRICE"], unitCost: ["INVOICE RATE / PIECE", "INVOICE RATE", "COST PRICE"],
        gstRate: ["GST RATE"], hsnCode: ["HSN CODE"], quantity: ["QUANTITY"], reorderLevel: ["REORDER LEVEL"],
        supplier: ["SUPPLIER"], active: ["ACTIVE"], variableValue: ["VARIABLE VALUE"]
    };
    const columns = Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, names.map(headerKey).map(name => headerMap.get(name)).find(column => column != null)]));
    for (const required of ["barcode", "quantity", "mrp", "unitCost"]) if (columns[required] == null) throw new Error(`Missing required column: ${required}. Download the KLBS Stock Inward template or use matching supplier invoice headings.`);
    const pick = (row, field) => columns[field] == null ? "" : cellText(row.getCell(columns[field]));
    const rows = [];
    for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo++) {
        const row = sheet.getRow(rowNo);
        const barcodeCell = row.getCell(columns.barcode);
        if (barcodeCell && barcodeCell.value != null && typeof barcodeCell.value === "number") excelBarcodeText(barcodeCell.value, barcodeCell.numFmt, rowNo);
        const values = Object.values(columns).filter(column => column != null).map(column => cellText(row.getCell(column)));
        if (values.every(value => !value)) continue;
        rows.push({
            barcode: excelBarcodeText(barcodeCell.value, barcodeCell.numFmt, rowNo), sku: pick(row, "sku"), brand: pick(row, "brand"), segment: pick(row, "segment"),
            businessSegment: pick(row, "businessSegment"), category: pick(row, "category"), season: pick(row, "season"), collection: pick(row, "collection"),
            productName: pick(row, "productName"), styleCode: pick(row, "styleCode"), size: pick(row, "size"), colour: pick(row, "colour"),
            mrp: pick(row, "mrp"), discount: pick(row, "discount"), sellingPrice: pick(row, "sellingPrice"), unitCost: pick(row, "unitCost"),
            gstRate: pick(row, "gstRate"), hsnCode: pick(row, "hsnCode"), quantity: pick(row, "quantity"), reorderLevel: pick(row, "reorderLevel"),
            supplier: pick(row, "supplier"), active: pick(row, "active"), variableValue: pick(row, "variableValue")
        });
    }
    return normalizeInvoiceRows(rows);
}

const SUPPLIER_HEADER_ALIASES = Object.freeze({
    barcode: ["BARCODE", "EAN", "EAN CODE", "EAN/UPC", "UPC", "GTIN", "ITEM CODE", "PRODUCT CODE", "ARTICLE CODE", "STYLE CODE"],
    quantity: ["QUANTITY", "QTY", "INVOICE QTY", "RECEIVED QTY", "UNITS", "PCS", "PIECES"],
    mrp: ["PRINTED MRP", "MRP", "RETAIL PRICE", "TAG PRICE", "MAX RETAIL PRICE"],
    unitCost: ["INVOICE RATE / PIECE", "INVOICE RATE", "ITEM RATE", "RATE", "RATE / PIECE", "RATE PER PIECE", "UNIT RATE", "UNIT COST", "PURCHASE RATE", "COST PRICE"],
    productName: ["PRODUCT", "PRODUCT NAME", "ITEM DESCRIPTION", "DESCRIPTION", "ITEM NAME", "STYLE"],
    size: ["SIZE", "SIZES"],
    colour: ["COLOUR", "COLOR", "SHADE"],
    brand: ["BRAND"],
    segment: ["SEGMENT"],
    businessSegment: ["BUSINESS SEGMENT", "BUSINESS LINE"],
    category: ["CATEGORY"],
    season: ["SEASON"],
    collection: ["COLLECTION"],
    styleCode: ["STYLE CODE", "STYLE"],
    discount: ["DISCOUNT", "DISC%", "DISCOUNT %"],
    sellingPrice: ["SELLING PRICE", "SALE PRICE"],
    gstRate: ["GST RATE", "GST%", "TAX PERCENTAGE", "TAX %"],
    hsnCode: ["HSN CODE", "HSN"],
    reorderLevel: ["REORDER LEVEL"],
    supplier: ["SUPPLIER", "PARTY NAME", "DISTRIBUTOR"],
    active: ["ACTIVE"],
    variableValue: ["VARIABLE VALUE"],
    sku: ["SKU"],
    voucherType: ["VOUCHER TYPE", "TRANSACTION TYPE", "TRAN TYPE", "DOCUMENT TYPE"]
});

function isBillWiseItemList(rows) {
    const preview = rows.slice(0, 12).flat().map(value => String(value ?? "")).join(" ").toUpperCase();
    return /BILL\s*WISE\s*ITEM\s*LIST/.test(preview);
}

function headerKey(value) {
    return String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function supplierInvoiceFormatSignature(headers) {
    const canonical = (Array.isArray(headers) ? headers : []).map(headerKey);
    while (canonical.length && !canonical[canonical.length - 1]) canonical.pop();
    return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function findSupplierInvoiceTable(sheet, options = {}) {
    const aliases = new Map(Object.entries(SUPPLIER_HEADER_ALIASES).flatMap(([field, names]) => names.map(name => [headerKey(name), field])));
    if (options.billWise === true || isBillWiseItemList(sheet)) {
        // In Dora's Bill Wise Item List, StockNo is the barcode, Batch No. carries printed MRP,
        // and Doc Rate is the per-piece invoice rate. "Sales" is Dora's side of this invoice.
        aliases.set(headerKey("STOCKNO"), "barcode");
        aliases.set(headerKey("BATCH NO."), "mrp");
        aliases.set(headerKey("DOC RATE"), "unitCost");
        aliases.delete(headerKey("TAX"));
        aliases.set(headerKey("TAX PERC."), "gstRate");
        aliases.set(headerKey("COLOUR CODE"), "colour");
        aliases.set(headerKey("PRODUCT CODE"), "category");
        aliases.set(headerKey("RANGE CODE"), "collection");
    }
    const limit = Math.min(sheet.length, 60);
    let best = null;
    for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
        const row = sheet[rowIndex] || [];
        const mapping = new Map();
        row.forEach((value, column) => {
            const field = aliases.get(headerKey(value));
            if (field && !mapping.has(field)) mapping.set(field, column);
        });
        const score = ["barcode", "quantity", "mrp", "unitCost"].filter(field => mapping.has(field)).length;
        if (!best || score > best.score) best = { rowIndex, mapping, score };
        if (score === 4) break;
    }
    if (!best || best.score < 4) {
        throw new Error("KLBS could not identify Barcode, Quantity, MRP and Invoice Rate columns. Check the supplier sheet headings or use the KLBS Stock Inward template.");
    }
    return best;
}

function parseSupplierInvoiceWorkbook(buffer, options = {}) {
    const workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: false, cellFormula: true, WTF: true });
    let selected = null;
    if (options.mapping) {
        const name = String(options.sheetName || workbook.SheetNames[0] || "");
        const sheet = workbook.Sheets[name];
        if (!sheet || !sheet["!ref"]) throw new Error("Select a worksheet that contains the invoice items.");
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: true });
        const rowIndex = Number(options.headerRow) - 1;
        if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) throw new Error("Select the row containing the invoice column headings.");
        const mapping = new Map();
        for (const [field, column] of Object.entries(options.mapping)) {
            if (!Number.isSafeInteger(Number(column)) || Number(column) < 0 || Number(column) >= 100) throw new Error("One of the selected invoice columns is invalid.");
            mapping.set(field, Number(column));
        }
        // Supplier invoices can correctly say "Sales" from the supplier's accounting perspective.
        const aliases = new Map(Object.entries(SUPPLIER_HEADER_ALIASES).flatMap(([field, names]) => names.map(alias => [headerKey(alias), field])));
        (rows[rowIndex] || []).forEach((value, column) => {
            const field = aliases.get(headerKey(value));
            if (field === "voucherType" && !mapping.has(field)) mapping.set(field, column);
        });
        for (const field of ["barcode", "quantity", "mrp", "unitCost"]) {
            if (!mapping.has(field)) throw new Error(`Select a column for ${field === "unitCost" ? "Invoice Rate / Piece" : field}.`);
        }
        if (new Set(["barcode", "quantity", "mrp", "unitCost"].map(field => mapping.get(field))).size !== 4) {
            throw new Error("Barcode, Quantity, Printed MRP and Invoice Rate must each use a different column.");
        }
        selected = { name, rows, table: { rowIndex, mapping, score: 4 } };
    } else {
        for (const name of workbook.SheetNames) {
            const sheet = workbook.Sheets[name];
            if (!sheet || !sheet["!ref"]) continue;
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: false });
            try {
                const table = findSupplierInvoiceTable(rows);
                if (!selected || table.score > selected.table.score) selected = { name, rows, table };
                if (table.score === 4) break;
            } catch (_) { /* Continue looking through supplier workbook sheets. */ }
        }
    }
    if (!selected) {
        for (const name of workbook.SheetNames) {
            const sheet = workbook.Sheets[name];
            if (!sheet?.["!ref"]) continue;
        }
        throw new Error("No worksheet contains recognizable invoice columns.");
    }
    const { name, rows, table } = selected;
    const sheet = workbook.Sheets[name];
    const required = ["barcode", "quantity", "mrp", "unitCost"];
    if (required.some(field => !table.mapping.has(field))) throw new Error("Invoice headings are incomplete. Barcode, Quantity, MRP and Invoice Rate are required.");
    const result = [];
    const headerCells = [...table.mapping.values()].map(column => sheet[XLSX.utils.encode_cell({ r: table.rowIndex, c: column })]);
    if (headerCells.some(cell => cell?.f || cell?.l)) throw new Error("Formulas and linked cells are not supported in supplier invoice files.");
    for (let rowIndex = table.rowIndex + 1; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex] || [];
        const value = field => table.mapping.has(field) ? row[table.mapping.get(field)] : "";
        const barcodeCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: table.mapping.get("barcode") })];
        const rawBarcode = value("barcode");
        if (rawBarcode == null || String(rawBarcode).trim() === "") continue;
        const sourceCells = [...table.mapping.values()].map(column => sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })]);
        if (sourceCells.some(cell => cell?.f || cell?.l)) throw new Error(`Invoice row ${rowIndex + 1}: formulas and linked cells are not supported.`);
        const barcode = excelBarcodeText(rawBarcode, barcodeCell?.z, rowIndex + 1);
        if (/[eE][+-]?\d/.test(barcode)) throw new Error(`Invoice row ${rowIndex + 1}: barcode is in scientific notation. Correct the source cell to text and retry.`);
        if (!/^[A-Za-z0-9._/-]{3,64}$/.test(barcode)) throw new Error(`Invoice row ${rowIndex + 1}: barcode contains unsupported characters.`);
        const quantity = value("quantity");
        const mrp = value("mrp");
        const unitCost = value("unitCost");
        // Supplier report files often have footer totals; ignore them when they do not contain line values.
        if ([quantity, mrp, unitCost].every(item => item == null || String(item).trim() === "")) continue;
        result.push({ barcode, quantity, mrp, unitCost, productName: value("productName"), size: value("size"), colour: value("colour"), sku: value("sku"),
            brand: value("brand"), segment: value("segment"), businessSegment: value("businessSegment"), category: value("category"), season: value("season"),
            collection: value("collection"), styleCode: value("styleCode"), discount: value("discount"), sellingPrice: value("sellingPrice"), gstRate: value("gstRate"),
            hsnCode: value("hsnCode"), reorderLevel: value("reorderLevel"), supplier: value("supplier"), active: value("active"), variableValue: value("variableValue") });
        if (result.length > MAX_ROWS) throw new Error(`The invoice exceeds the ${MAX_ROWS.toLocaleString("en-IN")} row limit.`);
    }
    if (!result.length) throw new Error("No product rows were found under the detected invoice headings.");
    return normalizeInvoiceRows(result);
}

function inspectSupplierInvoiceWorkbook(buffer) {
    const workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: false, cellFormula: true, WTF: true });
    const worksheets = [];
    for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        if (!sheet || !sheet["!ref"]) continue;
        const sourceRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: true });
        const candidates = [];
        const limit = Math.min(sourceRows.length, 60);
        for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
            const source = sourceRows[rowIndex] || [];
            const cells = source.slice(0, 80).map(value => value == null ? "" : String(value).replace(/[\r\n]+/g, " ").slice(0, 100));
            const nonEmpty = cells.filter(value => value.trim()).length;
            if (nonEmpty < 2) continue;
            let suggestedMapping = {};
            try {
                const table = findSupplierInvoiceTable([source], { billWise: isBillWiseItemList(sourceRows) });
                suggestedMapping = Object.fromEntries(table.mapping);
            } catch (_) {
                const aliases = new Map(Object.entries(SUPPLIER_HEADER_ALIASES).flatMap(([field, names]) => names.map(alias => [headerKey(alias), field])));
                if (isBillWiseItemList(sourceRows)) {
                    aliases.set(headerKey("STOCKNO"), "barcode");
                    aliases.set(headerKey("BATCH NO."), "mrp");
                    aliases.set(headerKey("DOC RATE"), "unitCost");
                    aliases.delete(headerKey("TAX"));
                    aliases.set(headerKey("TAX PERC."), "gstRate");
                    aliases.set(headerKey("COLOUR CODE"), "colour");
                }
                source.forEach((value, column) => { const field = aliases.get(headerKey(value)); if (field && suggestedMapping[field] == null) suggestedMapping[field] = column; });
            }
            candidates.push({ rowNumber: rowIndex + 1, cells, headers: cells, formatSignature: supplierInvoiceFormatSignature(cells), suggestedMapping });
        }
        if (candidates.length) worksheets.push({ name, rows: candidates });
    }
    if (!worksheets.length) throw new Error("No readable invoice rows were found in this file.");
    return { worksheets };
}

module.exports = { HEADERS, MAX_ROWS, createTemplateBuffer, createConvertedWorkbookBuffer, inspectSupplierInvoiceWorkbook, parseInvoiceWorkbook, parseSupplierInvoiceWorkbook, normalizeInvoiceRows, supplierInvoiceFormatSignature };
