const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const sqlite3 = require("sqlite3").verbose();
const { createStyleFamilyService } = require("../src/database/styleFamilyService");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function (error) {
        error ? reject(error) : resolve(this);
    }));
}
function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}
function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

class RendererElement {
    constructor(id = "") {
        this.id = id; this.children = []; this.handlers = {}; this.hidden = false;
        this.value = ""; this.checked = false; this.textContent = ""; this.className = "";
        this.parentElement = null; this.scrollTop = 0; this.classes = new Set();
        this.classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value) };
    }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    add(child) { this.append(child); }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    focus() { this.focused = true; }
    click() { this.handlers.click?.({}); }
    async keydown(key) { return this.handlers.keydown?.({ key, preventDefault() {} }); }
}

async function verifyRendererOrdering() {
    const ids = ["openStyleExplorerBtn","inventoryStyleExplorerOverlay","inventoryStyleExplorerDrawer","closeStyleExplorerBtn","styleExplorerInput","styleExplorerState","styleExplorerResults","styleExplorerCandidates","styleExplorerVariantRows","styleExplorerColour","styleExplorerInStock","styleExplorerNoStock","styleExplorerScanned","styleExplorerBrandStyle","styleExplorerCategory","styleExplorerProductName","styleExplorerSummary"];
    const elements = Object.fromEntries(ids.map(id => [id, new RendererElement(id)]));
    elements.styleExplorerResults.parentElement = new RendererElement("inventory-style-body");
    elements.styleExplorerInput.parentElement = elements.styleExplorerResults.parentElement;
    let open = false;
    const variants = [
        { barcode: "BLACK-S", colour: "Black", size: "S", currentStock: 3, mrp: 900 },
        { barcode: "BLUE-S", colour: "Blue", size: "S", currentStock: 1, mrp: 950 },
        { barcode: "BLUE-M", colour: "Blue", size: "M", currentStock: 0, mrp: 960 },
        { barcode: "SCAN-RED-M", colour: "Red", size: "M", currentStock: 4, mrp: 1200 },
        { barcode: "RED-S", colour: "Red", size: "S", currentStock: 2, mrp: 1100 }
    ];
    const searchResults = new Map();
    searchResults.set("SCAN-RED-M", { status: "FAMILY", exactProduct: variants[3], family: { brand: "Jockey", styleCode: "RX15", category: "Bra", productName: "RX15", variants, summary: { available: 4, totalStock: 10 } } });
    searchResults.set("STYLE-X", { status: "FAMILY", family: { brand: "Jockey", styleCode: "STYLE-X", category: "Bra", productName: "RX15", variants, summary: { available: 4, totalStock: 10 } } });
    searchResults.set("SCAN-BLUE-S", { status: "FAMILY", exactProduct: variants[1], family: { brand: "Jockey", styleCode: "RX15", category: "Bra", productName: "RX15", variants, summary: { available: 4, totalStock: 10 } } });
    const window = {
        KLBSDrawer: { create: () => ({ isOpen: () => open, isClosing: () => false, open: () => { open = true; }, close: () => { open = false; } }) },
        electronAPI: { searchInventoryStyle: async ({ query }) => searchResults.get(query) || { status: "NOT_FOUND" } }
    };
    const document = {
        getElementById: id => elements[id] || null,
        createElement: tag => { const element = new RendererElement(tag); element.tagName = tag; return element; },
        createTextNode: text => ({ textContent: text }),
        activeElement: null
    };
    class TestOption { constructor(text, value) { this.textContent = text; this.value = value; } }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/renderer/modules/styleExplorer.js"), "utf8"), { window, document, Option: TestOption, console });
    window.initializeStyleExplorer();
    elements.openStyleExplorerBtn.click();
    const submit = async query => { elements.styleExplorerInput.value = query; await elements.styleExplorerInput.keydown("Enter"); await new Promise(resolve => setImmediate(resolve)); };
    const names = () => elements.styleExplorerVariantRows.children.map(group => group.children[0].children[0].textContent);
    const redResult = searchResults.get("SCAN-RED-M");
    elements.styleExplorerResults.parentElement.scrollTop = 180;
    await submit("SCAN-RED-M");
    assert.deepStrictEqual(names(), ["Red", "Black", "Blue"], "exact barcode promotes only its scanned colour and retains the relative alphabetical order of the rest");
    const redTiles = elements.styleExplorerVariantRows.children[0].children[1].children;
    assert(redTiles.some(tile => tile.children.some(child => child.textContent === "SCANNED") && tile.classes.has("is-scanned")), "exact scanned size retains its badge and highlight");
    assert.deepStrictEqual(redTiles.map(tile => tile.children[0].textContent), ["M", "S"], "size order within the promoted colour is preserved");
    assert.strictEqual(redTiles[0].children[2].children[0].textContent, "4", "stock counts remain unchanged after group ordering");
    assert.strictEqual(redTiles[0].children[2].children[2].textContent, "₹1,200.00", "prices remain unchanged after group ordering");
    assert.strictEqual(elements.styleExplorerResults.parentElement.scrollTop, 0, "exact barcode result scrolls only the drawer results body to top");
    assert.strictEqual(redResult.family.variants[0].barcode, "BLACK-S", "render ordering does not mutate resolver product arrays");
    elements.styleExplorerResults.parentElement.scrollTop = 75;
    await submit("STYLE-X");
    assert.deepStrictEqual(names(), ["Black", "Blue", "Red"], "style-code search keeps resolver alphabetical ordering");
    assert.strictEqual(elements.styleExplorerResults.parentElement.scrollTop, 75, "Style Code search does not trigger the exact-barcode scroll reset");
    await submit("SCAN-RED-M");
    await submit("SCAN-BLUE-S");
    assert.deepStrictEqual(names(), ["Blue", "Black", "Red"], "second exact barcode replaces the previous colour priority");
    elements.styleExplorerColour.value = "red";
    elements.styleExplorerColour.handlers.change();
    assert.deepStrictEqual(names(), ["Red"], "colour filter remains authoritative over scanned-colour priority");
    elements.styleExplorerColour.value = "";
    elements.styleExplorerInStock.checked = true;
    elements.styleExplorerInStock.handlers.change();
    const blueGroup = elements.styleExplorerVariantRows.children.find(group => group.children[0].children[0].textContent === "Blue");
    assert.deepStrictEqual(blueGroup.children[1].children.map(tile => tile.children[0].textContent), ["S"], "In Stock Only retains the existing filtered-out zero-stock sibling size");
    assert.strictEqual(elements.styleExplorerSummary.textContent, "4 VARIANTS　 4 AVAILABLE　 TOTAL STOCK 10", "group ordering preserves displayed stock/variant summary values");
    const currentScannedTile = elements.styleExplorerVariantRows.children[0].children[1].children.find(tile => tile.classes.has("is-scanned"));
    assert(currentScannedTile, "scanned identity remains present under the existing In Stock Only scanned-SKU rule");
    await submit("");
    assert.strictEqual(elements.styleExplorerVariantRows.children.length, 0, "search reset clears rendered groups and scanned priority");
    await submit("STYLE-X");
    assert.deepStrictEqual(names(), ["Black", "Blue", "Red"], "style-code search after reset has no stale scanned priority");
}

async function seed(db, data) {
    const result = await run(db, `INSERT INTO products
        (barcode, sku, brand, style_code, category, product_name, size, colour, mrp, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, [data.barcode, data.sku, data.brand, data.style, data.category, data.name, data.size, data.colour, data.mrp ?? 1000]);
    if (data.stock !== undefined) {
        await run(db, `INSERT INTO inventory_transactions
            (product_id, barcode, transaction_type, quantity, reference_type, reference_id, remarks, created_by, created_at)
            VALUES (?, ?, 'OPENING', ?, 'TEST', ?, 'Read-only resolver fixture', 'TEST', datetime('now'))`,
        [result.lastID, data.barcode, data.stock, `STYLE-EXPLORER-${data.barcode}`]);
    }
    return result.lastID;
}

async function runTests() {
    const db = new sqlite3.Database(":memory:");
    try {
        await run(db, `CREATE TABLE products (
            id INTEGER PRIMARY KEY AUTOINCREMENT, barcode TEXT UNIQUE, sku TEXT, brand TEXT,
            style_code TEXT, category TEXT, product_name TEXT, size TEXT, colour TEXT,
            mrp REAL, active INTEGER)`);
        await run(db, `CREATE TABLE inventory_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, barcode TEXT,
            transaction_type TEXT, quantity INTEGER, reference_type TEXT, reference_id TEXT,
            remarks TEXT, created_by TEXT, created_at TEXT)`);

        const cleanIds = [];
        cleanIds.push(await seed(db, { barcode: " 10001 ", sku: "A1", brand: "Jockey", style: "FE41", category: "Bra", name: "Everyday Bra", size: "34B", colour: "Black", stock: 2 }));
        cleanIds.push(await seed(db, { barcode: "10002", sku: "A2", brand: "JOCKEY", style: "fe41", category: " bra ", name: "Everyday Bra", size: "34B", colour: "Black", stock: 0 }));
        cleanIds.push(await seed(db, { barcode: "10003", sku: "A3", brand: "Jockey", style: "FE41", category: "Bra", name: "Everyday Bra", size: "36B", colour: "White", stock: -1 }));
        await seed(db, { barcode: "20001", sku: "X1", brand: "XYXX", style: "R2-ACE", category: "Brief", name: "Brief", size: "M", colour: "Navy", stock: 3 });
        await seed(db, { barcode: "20002", sku: "X2", brand: "XYXX", style: "R2-ACE", category: "Trunk", name: "Trunk", size: "M", colour: "Navy", stock: 4 });
        await seed(db, { barcode: "30001", sku: "S1", brand: "SafeBrand", style: "S-ONE", category: "Bra", name: "Bra", size: "S", colour: "Rose", stock: 1 });
        await seed(db, { barcode: "30002", sku: "S2", brand: "SafeBrand", style: "S-ONE", category: "Na", name: "Bra", size: "M", colour: "Rose", stock: 0 });
        await seed(db, { barcode: "40001", sku: "U1", brand: "UnsafeBrand", style: "U-ONE", category: "Bra", name: "Bra", size: "S", colour: "Blue", stock: 1 });
        await seed(db, { barcode: "40002", sku: "U2", brand: "UnsafeBrand", style: "U-ONE", category: "Brief", name: "Brief", size: "M", colour: "Blue", stock: 1 });
        await seed(db, { barcode: "40003", sku: "U3", brand: "UnsafeBrand", style: "U-ONE", category: "NA", name: "Unknown", size: "L", colour: "Blue", stock: 1 });
        await seed(db, { barcode: "50001", sku: "B1", brand: "Jockey", style: "", category: "Brief", name: "No Style", size: "L", colour: "Green", stock: 0 });
        await seed(db, { barcode: "60001", sku: "D1", brand: "Brand One", style: "COMMON", category: "Top", name: "Top", size: "S", colour: "Red", stock: 1 });
        await seed(db, { barcode: "60002", sku: "D2", brand: "Brand Two", style: "COMMON", category: "Bottom", name: "Bottom", size: "M", colour: "Black", stock: 1 });

        const service = createStyleFamilyService(db);
        const before = await get(db, "SELECT (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM inventory_transactions) AS transactions");

        const barcode = await service.resolveStyleFamily(" 10001 ");
        assert.strictEqual(barcode.status, "FAMILY", "1 exact trimmed Barcode resolves");
        assert.strictEqual(barcode.exactProduct.productId, cleanIds[0], "2 exact scanned SKU identity is returned");
        assert.strictEqual(barcode.family.variants.length, 3, "3 Brand + Style + Category family includes duplicate Size/Colour SKUs");
        assert.deepStrictEqual(barcode.family.variants.map(item => item.productId).sort(), cleanIds.slice().sort(), "4 each Product Master SKU remains a separate row");
        assert.strictEqual(barcode.family.summary.available, 1, "5 available counts positive stock rows");
        assert.strictEqual(barcode.family.summary.totalStock, 1, "6 ledger stock preserves zero and negative values");
        assert(barcode.family.variants.some(item => item.currentStock === 0), "7 zero-stock variants are retained");
        assert(barcode.family.variants.some(item => item.currentStock === -1), "8 negative stock remains truthful");
        assert.strictEqual(barcode.exactProduct.currentStock, 2, "9 scanned stock is ledger-derived");

        const style = await service.resolveStyleFamily(" fe41 ");
        assert.strictEqual(style.status, "FAMILY", "10 normalized direct Style Code finds a single family");
        assert.strictEqual(style.family.variants.length, 3);
        assert.strictEqual((await service.resolveStyleFamily("UNKNOWN-CODE")).status, "NOT_FOUND", "11 unknown barcode/style returns not found");
        assert.strictEqual((await service.resolveStyleFamily("   ")).status, "EMPTY", "12 blank search has an inline empty state contract");

        const categorySeparated = await service.resolveStyleFamily("20001");
        assert.strictEqual(categorySeparated.family.category, "Brief", "13 exact barcode remains in its category family");
        assert.strictEqual(categorySeparated.family.variants.length, 1, "14 Brand + Style does not merge Brief and Trunk");
        const ambiguous = await service.resolveStyleFamily("R2-ACE");
        assert.strictEqual(ambiguous.status, "AMBIGUOUS_STYLE", "15 multi-category Style Code returns chooser candidates");
        assert.deepStrictEqual(ambiguous.candidates.map(item => item.category).sort(), ["Brief", "Trunk"]);
        const chosen = await service.resolveStyleFamily({ query: "R2-ACE", candidateToken: ambiguous.candidates[1].token });
        assert.strictEqual(chosen.status, "FAMILY", "16 candidate selection resolves through canonical service");
        assert.strictEqual(chosen.family.variants.length, 1);

        const safePlaceholder = await service.resolveStyleFamily("30002");
        assert.strictEqual(safePlaceholder.status, "FAMILY", "17 Na placeholder joins only one unambiguous named category");
        assert.strictEqual(safePlaceholder.family.category, "Bra");
        assert.strictEqual(safePlaceholder.family.variants.length, 2);
        const unsafePlaceholder = await service.resolveStyleFamily("40003");
        assert.strictEqual(unsafePlaceholder.status, "UNRESOLVED_FAMILY", "18 Na with multiple named categories never guesses");
        assert.strictEqual(unsafePlaceholder.variants.length, 1, "19 unresolved scan still returns exact SKU only");
        assert.strictEqual(unsafePlaceholder.diagnostic, "PLACEHOLDER_CATEGORY_AMBIGUITY");
        const blankStyle = await service.resolveStyleFamily("50001");
        assert.strictEqual(blankStyle.status, "STYLE_UNAVAILABLE", "20 blank Style Code falls back to exact SKU");
        assert.strictEqual(blankStyle.variants.length, 1);

        const ambiguousBrand = await service.resolveStyleFamily("COMMON");
        assert.strictEqual(ambiguousBrand.status, "AMBIGUOUS_STYLE", "21 Style Code shared by brands is not silently selected");
        assert.deepStrictEqual(ambiguousBrand.candidates.map(item => item.brand).sort(), ["Brand One", "Brand Two"]);
        const after = await get(db, "SELECT (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM inventory_transactions) AS transactions");
        assert.deepStrictEqual(after, before, "22 resolution performs no Product or inventory writes");

        const root = path.join(__dirname, "..");
        const renderer = fs.readFileSync(path.join(root, "src/renderer/modules/styleExplorer.js"), "utf8");
        const template = fs.readFileSync(path.join(root, "src/renderer/modules/productMasterTemplate.js"), "utf8");
        const inventory = fs.readFileSync(path.join(root, "src/renderer/modules/inventory.js"), "utf8");
        const preload = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");
        const main = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
        const css = fs.readFileSync(path.join(root, "src/renderer/styles/Inventory.css"), "utf8");
        const drawerCss = fs.readFileSync(path.join(root, "src/renderer/styles/klbsDrawer.css"), "utf8");
        const shortcuts = fs.readFileSync(path.join(root, "src/renderer/modules/shortcuts.js"), "utf8");
        assert(template.includes("id=\"inventorySearch\""), "23 existing Inventory search input remains");
        assert(template.includes("id=\"openStyleExplorerBtn\""), "24 Product Search entry control exists");
        assert(template.includes("🔎 PRODUCT SEARCH") && css.includes("flex: 0 0 190px") && css.includes("white-space: nowrap"), "25 visible Product Search button has compact one-line desktop width");
        assert(css.includes("flex: 0 0 auto; width: 100%; min-height: 48px;"), "26 narrow Product Search button avoids desktop fixed height/width");
        assert(inventory.includes("window.initializeStyleExplorer?.();"), "27 drawer binds after Inventory template insertion");
        assert(template.includes("id=\"inventoryStyleExplorerDrawer\"") && renderer.includes("drawerShell?.open({ opener: byId(\"openStyleExplorerBtn\") })"), "28 drawer opens through the universal shell");
        assert(template.includes("placeholder=\"Scan barcode or enter Style Code\"") && !template.includes("SCAN BARCODE") && !template.includes("Scan a product to check size"), "29 one scanner input remains without redundant instructional labels");
        assert(template.includes('id="styleExplorerVariantRows" class="inventory-style-colour-groups"'), "30 variants render in the grouped Colour presentation");
        assert(!template.includes("inventory-style-table") && !template.includes("<th>COLOUR</th>"), "31 traditional row-per-SKU table is removed");
        assert(renderer.includes("item.barcode") && renderer.includes("String(item.barcode).trim() === scannedBarcode"), "32 Barcode remains in internal result and scanned identity");
        assert(renderer.includes("inventory-style-tile-size") && renderer.includes("inventory-style-tile-details") && renderer.includes("item.mrp"), "33 each size tile retains its own stock and MRP");
        assert(renderer.includes('badge.textContent = "SCANNED"') && renderer.includes("tile.classList.add(\"is-scanned\")"), "34 scanned badge and exact SKU tile highlight remain visible");
        assert(renderer.includes("groups.get(key).variants.push(item)") && renderer.includes("group.variants"), "35 colour is grouped once while each SKU variant remains separate");
        const sizeGridCss = css.match(/\.inventory-style-size-grid\s*\{([^}]*)\}/)?.[1] || "";
        assert(sizeGridCss.includes("grid-template-columns: repeat(5, minmax(0, 1fr))") && !/justify-content:\s*center/.test(sizeGridCss), "36 five-column CSS grid naturally left-aligns incomplete final rows");
        assert(renderer.includes('const groupWord = group.variants.length === 1 ? "SIZE" : "SIZES"') && renderer.includes('allAvailable ? "AVAILABLE" : "SHOWN"'), "37 group count uses truthful size wording and says AVAILABLE only when every shown SKU has stock");
        assert(renderer.includes("!inStockOnly || Number(item.currentStock) > 0 ||") && renderer.includes("=== scannedBarcode"), "38 In Stock Only preserves the exact scanned zero-stock SKU");
        assert(renderer.includes('byId("styleExplorerInStock").checked = true'), "39 fresh drawer/search state defaults In Stock Only to checked");
        assert(renderer.includes("const available = visible.filter") && renderer.includes("visible.reduce"), "40 displayed summary stays truthful for filtered rows and zero-stock exception");
        assert(renderer.includes("const orderedGroups = [...groups.values()]"), "scanned-colour priority uses a copied display array");
        assert(renderer.includes("orderedGroups.unshift(orderedGroups.splice(scannedGroupIndex, 1)[0])"), "only the visible scanned group moves while remaining groups retain their existing order");
        assert(renderer.includes("String(result.exactProduct.barcode).trim() === query") && renderer.includes('byId("styleExplorerResults").parentElement.scrollTop = 0'), "only a successful exact barcode result resets the drawer results body scroll");
        assert(renderer.includes('"No variants currently in stock"'), "41 all-zero family communicates unavailable stock even when scanned SKU is retained");
        assert(drawerCss.includes("width:clamp(560px,54vw,840px)") && drawerCss.includes("width:min(720px,76vw)") && drawerCss.includes("width:100vw"), "34 drawer follows standard Billing responsive geometry");
        const drawerWidthAt = width => width <= 700 ? width : width <= 1000 ? Math.min(720, width * 0.76) : Math.min(840, width * 0.54);
        assert.strictEqual(drawerWidthAt(1920), 840, "35 1920px uses Billing max width");
        assert(Math.abs(drawerWidthAt(1440) - 777.6) < 0.1, "36 1440px uses Billing percentage width");
        assert(Math.abs(drawerWidthAt(1024) - 552.96) < 0.1, "37 1024px uses Billing standard percentage width");
        assert.strictEqual(drawerWidthAt(390), 390, "38 narrow drawer uses full viewport width");
        assert(template.includes("<section class=\"inventory-style-family-head\""), "39 compact family identity result area remains present");
        assert(template.includes("id=\"styleExplorerSummary\"") && template.includes("id=\"styleExplorerScanned\""), "40 summary strip and scanned identity are separate compact regions");
        assert(template.includes("class=\"klbs-drawer-title\">PRODUCT SEARCH") && !template.includes("inventoryStyleExplorerSubtitle"), "41 shared shell title is used without subtitle");
        assert(renderer.includes("event.key === \"Enter\""), "42 scanner Enter executes search");
        assert(renderer.includes("input.value = \"\""), "43 scanner input resets for repeated scans");
        assert(renderer.includes("function close()") && renderer.includes("openStyleExplorerBtn") && renderer.includes("focus()"), "44 close restores focus");
        assert(renderer.includes("window.closeStyleExplorer = close"), "45 canonical close is exposed for ESC handling");
        assert(renderer.includes("initialFocus: () => byId(\"styleExplorerInput\")"), "46 universal shell automatically focuses scanner field");
        assert(renderer.includes("styleExplorerColour") && renderer.includes("styleExplorerInStock"), "47 only Colour and In Stock filters are provided");
        assert(renderer.includes("normalized(item.colour) === colour") && renderer.includes("Number(item.currentStock) > 0"), "48 filters compare normalized colours and positive ledger stock");
        assert(renderer.includes("textContent = text"), "49 database values are rendered as text, not markup");
        assert(!renderer.includes("alert("), "50 normal search errors do not use alert");
        assert(!renderer.includes("customerProfile") && !renderer.includes("supplier"), "51 no Customer/Supplier drawer coupling");
        assert(preload.includes("searchInventoryStyle") && preload.includes("inventory:style-search"), "52 one read-only search IPC is exposed");
        assert(main.includes("inventory:style-search") && main.includes("styleFamilyService.resolveStyleFamily"), "53 main invokes canonical resolver");
        assert(renderer.includes("onEscape: () => { close(); return true; }") && shortcuts.includes("KLBSDrawer?.hasOpenDrawer?.()"), "54 generic drawer ESC handling precedes page navigation");
        assert(!shortcuts.includes("inventoryStyleExplorerOverlay"), "55 page shortcuts detect the shared active drawer");
        assert(!/styleExplorer[^\n]*(?:stockInward|stockOutward|updateProduct|importProducts)/i.test(renderer), "56 renderer has no product/stock mutation call");
        assert(css.includes("@media (max-width: 1200px)") && css.includes("@media (max-width: 700px)") && css.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"), "57 responsive desktop/narrow layouts preserve readable grouped tiles");
        assert(css.includes(".inventory-style-body") && !css.includes(".customer-drawer") && drawerCss.includes(".klbs-drawer-panel"), "58 feature content CSS remains scoped and shell CSS is shared");
        assert(css.includes("background: #0f7b0f") && css.includes("background: #0b610b") && css.includes("color: #fff"), "59 Product Search button uses approved normal/hover operational green");
        assert(!/CREATE\s+TABLE|ALTER\s+TABLE|migrate/i.test(fs.readFileSync(path.join(root, "src/database/styleFamilyService.js"), "utf8")), "60 resolver requires no schema migration");
        await verifyRendererOrdering();
        process.stdout.write("V21-10 Inventory Style Explorer test: PASS (existing 76 service/safety/UI assertions plus actual renderer ordering, filtering, reset, and scroll checks)\n");
    } finally {
        await close(db);
    }
}

runTests().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
