(function () {
    let initializedButton = null;
    let activeResult = null;
    let scannedBarcode = "";
    let searchSequence = 0;
    let drawerShell = null;

    const byId = id => document.getElementById(id);
    const setText = (id, value) => { const node = byId(id); if (node) node.textContent = value ?? ""; };
    const normalized = value => String(value ?? "").trim().toLocaleLowerCase("en-IN");
    const currency = value => `₹${Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    function mrpStockLabel(item) {
        const parts = (Array.isArray(item.mrpBuckets) ? item.mrpBuckets : [])
            .filter(bucket => Number(bucket.quantity) !== 0)
            .map(bucket => `${currency(bucket.mrp)} × ${Number(bucket.quantity)}`);
        if (Number(item.unallocatedStock) !== 0) {
            parts.push(`MRP UNASSIGNED ${Number(item.unallocatedStock)} · COUNT REQUIRED`);
        }
        if (parts.length) return parts.join(" | ");
        return item.mrp == null ? "MRP unavailable" : `Product Master MRP ${currency(item.mrp)}`;
    }

    function isOpen() {
        return Boolean(drawerShell?.isOpen());
    }

    function clearContent() {
        activeResult = null;
        scannedBarcode = "";
        byId("styleExplorerResults").hidden = true;
        byId("styleExplorerCandidates").hidden = true;
        byId("styleExplorerCandidates").replaceChildren();
        byId("styleExplorerVariantRows").replaceChildren();
        byId("styleExplorerColour").replaceChildren(new Option("All colours", ""));
        byId("styleExplorerSize").replaceChildren(new Option("All sizes", ""));
        byId("styleExplorerInStock").checked = true;
        byId("styleExplorerNoStock").hidden = true;
        byId("styleExplorerScanned").replaceChildren();
    }

    function open() {
        const overlay = byId("inventoryStyleExplorerOverlay");
        if (!overlay) return;
        searchSequence += 1;
        clearContent();
        setText("styleExplorerState", "");
        drawerShell?.open({ opener: byId("openStyleExplorerBtn") });
    }

    function close() {
        const overlay = byId("inventoryStyleExplorerOverlay");
        if (!overlay || overlay.hidden || drawerShell?.isClosing()) return;
        searchSequence += 1;
        drawerShell?.close();
        clearContent();
    }

    function appendCell(row, text, className = "") {
        const cell = document.createElement("td");
        if (className) cell.className = className;
        cell.textContent = text;
        row.append(cell);
        return cell;
    }

    function filteredVariants() {
        const variants = activeResult?.family?.variants || activeResult?.variants || [];
        const colour = byId("styleExplorerColour").value;
        const size = byId("styleExplorerSize").value;
        const inStockOnly = byId("styleExplorerInStock").checked;
        return variants.filter(item =>
            (!colour || normalized(item.colour) === colour) &&
            (!size || normalized(item.size) === size) &&
            (!inStockOnly || Number(item.currentStock) > 0 ||
                (scannedBarcode && String(item.barcode).trim() === scannedBarcode))
        );
    }

    function renderFamily() {
        const result = activeResult;
        const family = result?.family;
        const variants = family?.variants || result?.variants || [];
        byId("styleExplorerResults").hidden = false;
        byId("styleExplorerCandidates").hidden = true;
        const brand = family?.brand || result?.exactProduct?.brand || "";
        const styleCode = family?.styleCode || result?.exactProduct?.styleCode || "";
        setText("styleExplorerBrandStyle", [brand, styleCode].filter(Boolean).join(" · "));
        setText("styleExplorerCategory", family?.category || result?.exactProduct?.category || "");
        setText("styleExplorerProductName", family?.productName || result?.exactProduct?.productName || "");

        const colorValues = new Map();
        for (const item of variants) {
            const label = String(item.colour || "Unspecified").trim() || "Unspecified";
            if (!colorValues.has(normalized(label))) colorValues.set(normalized(label), label);
        }
        const colourSelect = byId("styleExplorerColour");
        colourSelect.replaceChildren(new Option("All colours", ""));
        for (const [key, label] of colorValues) colourSelect.add(new Option(label, key));
        renderSizeOptions(variants);

        const scanned = result?.exactProduct;
        if (scanned) {
            const panel = byId("styleExplorerScanned");
            const detail = document.createElement("span");
            detail.className = "inventory-style-scanned-variant";
            detail.textContent = `${scanned.colour || "Colour unavailable"} · ${scanned.size || "Size unavailable"}`;
            const badge = document.createElement("span");
            badge.className = "inventory-style-scanned-badge";
            badge.textContent = "SCANNED";
            const stock = document.createElement("b");
            stock.textContent = `${Number(scanned.currentStock)} TOTAL IN STOCK`;
            const mrpStock = document.createElement("span");
            mrpStock.className = "inventory-style-scanned-mrp-stock";
            mrpStock.textContent = mrpStockLabel(scanned);
            panel.replaceChildren(detail, badge, stock, mrpStock);
        } else {
            byId("styleExplorerScanned").replaceChildren();
        }

        renderRows();
    }

    function renderSizeOptions(variants) {
        const selectedColour = byId("styleExplorerColour").value;
        const sizeValues = new Map();
        for (const item of variants) {
            if (selectedColour && normalized(item.colour) !== selectedColour) continue;
            const label = String(item.size || "Unspecified").trim() || "Unspecified";
            const key = normalized(label);
            if (!sizeValues.has(key)) sizeValues.set(key, label);
        }
        const sizeSelect = byId("styleExplorerSize");
        const previousSize = sizeSelect.value;
        sizeSelect.replaceChildren(new Option("All sizes", ""));
        const collator = new Intl.Collator("en-IN", { numeric: true, sensitivity: "base" });
        for (const [key, label] of [...sizeValues].sort((left, right) => collator.compare(left[1], right[1]))) {
            sizeSelect.add(new Option(label, key));
        }
        if (previousSize && sizeValues.has(previousSize)) sizeSelect.value = previousSize;
    }

    function renderRows() {
        const familyVariants = activeResult?.family?.variants || activeResult?.variants || [];
        const visible = filteredVariants();
        const groupsNode = byId("styleExplorerVariantRows");
        groupsNode.replaceChildren();
        const groups = new Map();
        for (const item of visible) {
            const colour = String(item.colour || "Unspecified").trim() || "Unspecified";
            const key = normalized(colour);
            if (!groups.has(key)) groups.set(key, { label: colour, variants: [] });
            groups.get(key).variants.push(item);
        }
        const orderedGroups = [...groups.values()];
        const scannedGroupIndex = orderedGroups.findIndex(group =>
            group.variants.some(item => scannedBarcode && String(item.barcode).trim() === scannedBarcode)
        );
        if (scannedGroupIndex > 0) {
            orderedGroups.unshift(orderedGroups.splice(scannedGroupIndex, 1)[0]);
        }
        for (const group of orderedGroups) {
            const section = document.createElement("section");
            section.className = "inventory-style-colour-group";
            const groupHasScannedSku = group.variants.some(item => scannedBarcode && String(item.barcode).trim() === scannedBarcode);
            if (groupHasScannedSku) section.classList.add("is-scanned-group");
            const heading = document.createElement("div");
            heading.className = "inventory-style-colour-heading";
            const colourName = document.createElement("h3");
            colourName.textContent = group.label;
            const count = document.createElement("span");
            const allAvailable = group.variants.every(item => Number(item.currentStock) > 0);
            const groupWord = group.variants.length === 1 ? "SIZE" : "SIZES";
            count.textContent = `${group.variants.length} ${groupWord} ${allAvailable ? "AVAILABLE" : "SHOWN"}`;
            heading.append(colourName, count);
            const grid = document.createElement("div");
            grid.className = "inventory-style-size-grid";
            for (const item of group.variants) {
                const isScanned = Boolean(scannedBarcode) && String(item.barcode).trim() === scannedBarcode;
                const tile = document.createElement("article");
                tile.className = `inventory-style-size-tile ${Number(item.currentStock) > 0 ? "is-in-stock" : "is-out-of-stock"}`;
                if (isScanned) tile.classList.add("is-scanned");
                const size = document.createElement("strong");
                size.className = "inventory-style-tile-size";
                size.textContent = item.size || "—";
                const details = document.createElement("div");
                details.className = "inventory-style-tile-details";
                const stock = document.createElement("b");
                stock.textContent = String(item.currentStock);
                const mrp = document.createElement("span");
                mrp.textContent = mrpStockLabel(item);
                details.append(stock, document.createTextNode(" · "), mrp);
                tile.append(size);
                if (isScanned) {
                    const badge = document.createElement("span");
                    badge.className = "inventory-style-tile-scanned";
                    badge.textContent = "SCANNED";
                    tile.append(badge);
                }
                tile.append(details);
                grid.append(tile);
            }
            section.append(heading, grid);
            groupsNode.append(section);
        }

        const available = visible.filter(item => Number(item.currentStock) > 0).length;
        const totalStock = visible.reduce((sum, item) => sum + Number(item.currentStock || 0), 0);
        const variantLabel = visible.length === 1 ? "VARIANT" : "VARIANTS";
        setText("styleExplorerSummary", `${visible.length} ${variantLabel}　 ${available} AVAILABLE　 TOTAL STOCK ${totalStock}`);
        const noStockMessage = byId("styleExplorerNoStock");
        const isFamily = Boolean(activeResult?.family);
        const availableCount = isFamily
            ? Number(activeResult.family.summary?.available ?? 0)
            : familyVariants.filter(item => Number(item.currentStock) > 0).length;
        const noneAvailable = familyVariants.length > 0 && availableCount === 0;
        noStockMessage.hidden = familyVariants.length === 0 || (!noneAvailable && visible.length > 0);
        if (!noStockMessage.hidden) noStockMessage.textContent = noneAvailable
            ? "No variants currently in stock"
            : "No variants match these filters.";
    }

    function showExactOnly(result, message) {
        activeResult = { ...result, family: null, variants: result.exactProduct ? [result.exactProduct] : [] };
        scannedBarcode = String(result.exactProduct?.barcode || "").trim();
        setText("styleExplorerState", message);
        renderFamily();
    }

    function showCandidates(result) {
        clearContent();
        setText("styleExplorerState", "Choose the matching product type.");
        const container = byId("styleExplorerCandidates");
        container.hidden = false;
        for (const candidate of result.candidates || []) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "inventory-style-candidate";
            const brand = document.createElement("strong");
            brand.textContent = candidate.brand || "Brand unavailable";
            const detail = document.createElement("span");
            detail.textContent = [candidate.styleCode, candidate.category || candidate.productName].filter(Boolean).join(" · ");
            button.append(brand, detail);
            button.addEventListener("click", () => search(candidate.styleCode, candidate.token));
            container.append(button);
        }
    }

    async function search(value, candidateToken) {
        const sequence = ++searchSequence;
        const query = String(value ?? "").trim();
        if (!query) {
            clearContent();
            setText("styleExplorerState", "");
            byId("styleExplorerInput")?.focus();
            return;
        }
        clearContent();
        setText("styleExplorerState", "Searching…");
        try {
            const result = await window.electronAPI.searchInventoryStyle({ query, candidateToken });
            if (!isOpen() || sequence !== searchSequence) return;
            if (result.status === "FAMILY") {
                activeResult = result;
                scannedBarcode = String(result.exactProduct?.barcode || "").trim();
                setText("styleExplorerState", "");
                renderFamily();
            } else if (result.status === "STYLE_UNAVAILABLE") {
                showExactOnly(result, "Style information unavailable.");
            } else if (result.status === "UNRESOLVED_FAMILY") {
                showExactOnly(result, "Similar variants could not be identified.");
            } else if (result.status === "AMBIGUOUS_STYLE") {
                showCandidates(result);
            } else if (result.status === "TOO_MANY_VARIANTS") {
                setText("styleExplorerState", "This style has too many variants to display safely.");
            } else {
                setText("styleExplorerState", "Product not found.");
            }
            if (result.exactProduct && String(result.exactProduct.barcode).trim() === query && !byId("styleExplorerResults").hidden) {
                byId("styleExplorerResults").parentElement.scrollTop = 0;
            }
        } catch (error) {
            console.error("Product Search failed", error);
            setText("styleExplorerState", "Product search is unavailable. Please scan again.");
        } finally {
            const input = byId("styleExplorerInput");
            if (input && isOpen() && sequence === searchSequence) {
                input.value = "";
                input.focus();
            }
        }
    }

    function initialize() {
        const openButton = byId("openStyleExplorerBtn");
        if (!openButton || initializedButton === openButton) return;
        initializedButton = openButton;
        drawerShell = window.KLBSDrawer.create({
            root: byId("inventoryStyleExplorerOverlay"),
            panel: byId("inventoryStyleExplorerDrawer"),
            labelledBy: "inventoryStyleExplorerTitle",
            initialFocus: () => byId("styleExplorerInput"),
            exitButtons: [byId("closeStyleExplorerBtn")],
            closeOnOverlay: true,
            onExit: close,
            onEscape: () => { close(); return true; }
        });
        openButton.addEventListener("click", open);
        byId("styleExplorerInput").addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                search(byId("styleExplorerInput").value);
            }
        });
        byId("styleExplorerColour").addEventListener("change", () => {
            const variants = activeResult?.family?.variants || activeResult?.variants || [];
            renderSizeOptions(variants);
            renderRows();
        });
        byId("styleExplorerSize").addEventListener("change", renderRows);
        byId("styleExplorerInStock").addEventListener("change", renderRows);
    }

    window.initializeStyleExplorer = initialize;
    window.isStyleExplorerOpen = isOpen;
    window.closeStyleExplorer = close;
})();
