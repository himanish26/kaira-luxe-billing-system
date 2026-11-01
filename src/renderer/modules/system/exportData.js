/* =====================================
   DATA IMPORT & EXPORT
===================================== */

function showExportDataPage() {
    renderSettingsPage({
        title: "DATA IMPORT & EXPORT",
        icon: "🔄",
        subtitle: "Export business data or convert supplier invoices for KLBS Stock Inward.",
        backText: "← System",
        backAction: showSystemPage,
        content: `
<div class="settings-grid supplier-invoice-entry-grid">
    <div class="settings-card" id="exportBusinessDataCard">
        <div class="settings-icon">📤</div>
        <h2>Export Business Data</h2>
        <p>Create business data exports</p>
    </div>
    <div class="settings-card" id="supplierInvoiceConverterCard" role="button" tabindex="0">
        <div class="settings-icon">🧾</div>
        <h2>Supplier Invoice Converter</h2>
        <p>Convert supplier invoices into the KLBS Stock Inward format</p>
    </div>
</div>`
    });

    document.getElementById("exportBusinessDataCard")?.addEventListener("click", () => showComingSoon("Export Business Data"));
    const converterCard = document.getElementById("supplierInvoiceConverterCard");
    converterCard?.addEventListener("click", showSupplierInvoiceConverter);
    converterCard?.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            showSupplierInvoiceConverter();
        }
    });
}

function showSupplierInvoiceConverter() {
    renderSettingsPage({
        title: "SUPPLIER INVOICE CONVERTER",
        icon: "🧾",
        subtitle: "Prepare a supplier invoice as a KLBS Stock Inward workbook.",
        backText: "← Import & Export",
        backAction: showExportDataPage,
        content: `
<section class="integration-section supplier-invoice-converter">
    <div class="integration-outbox">
        <div class="integration-outbox-header">
            <div>
                <h2>Convert supplier invoice</h2>
                <p>Select an Excel or CSV invoice. KLBS will create a separate Stock Inward workbook for review.</p>
            </div>
        </div>
        <div class="supplier-invoice-converter-guide">
            <ol>
                <li>Select the supplier and confirm its product profile.</li>
                <li>Drop the invoice into the upload area, or choose a file.</li>
                <li>Save the converted KLBS workbook and review its rows against the invoice.</li>
                <li>Later, upload that workbook in Stock Inward and physically scan every received item.</li>
            </ol>
            <p>KLBS remembers each supplier’s column layout. If invoice headings are new or changed, open that supplier’s Edit Profile drawer and map the columns there. Later invoices with the same headings can be converted automatically. KLBS assigns its own SKU to new barcodes.</p>
        </div>
        <div id="supplierInvoiceConverterWorkspace">
            <label class="supplier-invoice-supplier-field" for="supplierInvoiceSupplier">Supplier
                <select id="supplierInvoiceSupplier"><option value="">Loading suppliers…</option></select>
            </label>
            <div id="supplierInvoiceProfileConfirmation" class="supplier-invoice-profile-confirmation" hidden></div>
            <div id="supplierInvoiceDropZone" class="supplier-invoice-dropzone is-disabled" role="group" aria-label="Supplier invoice file upload" aria-disabled="true">
                <div class="supplier-invoice-dropzone-icon" aria-hidden="true">📄</div>
                <strong>Drop supplier invoice here</strong>
                <span>Excel or CSV · one file · up to 25 MB</span>
                <span class="supplier-invoice-dropzone-hint">First select a supplier and confirm its product profile.</span>
                <input id="supplierInvoiceFileInput" type="file" accept=".xlsx,.xls,.csv" hidden>
                <button type="button" id="supplierInvoiceBrowseButton" class="klbs-cancel-btn" disabled>CHOOSE FILE</button>
            </div>
            <div id="supplierInvoiceConvertStatus" class="supplier-invoice-converter-status" role="status" aria-live="polite">No invoice converted yet.</div>
            <div id="supplierInvoiceConvertResult" class="supplier-invoice-converter-result" hidden>
                <strong id="supplierInvoiceConvertSummary"></strong>
                <span id="supplierInvoiceConvertFile"></span>
            </div>
        </div>
    </div>
</section>`
    });

    loadSupplierInvoiceConverterSuppliers();
    const dropZone = document.getElementById("supplierInvoiceDropZone");
    const fileInput = document.getElementById("supplierInvoiceFileInput");
    const browseButton = document.getElementById("supplierInvoiceBrowseButton");
    browseButton?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", () => { if (fileInput.files?.[0]) runSupplierInvoiceConversion(fileInput.files[0]); });
    dropZone?.addEventListener("keydown", event => {
        if ((event.key === "Enter" || event.key === " ") && event.target === dropZone && !dropZone.classList.contains("is-disabled")) {
            event.preventDefault(); fileInput?.click();
        }
    });
    dropZone?.addEventListener("dragenter", event => { event.preventDefault(); if (!dropZone.classList.contains("is-disabled")) dropZone.classList.add("is-dragover"); });
    dropZone?.addEventListener("dragover", event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; if (!dropZone.classList.contains("is-disabled")) dropZone.classList.add("is-dragover"); });
    dropZone?.addEventListener("dragleave", event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("is-dragover"); });
    dropZone?.addEventListener("drop", event => {
        event.preventDefault(); dropZone.classList.remove("is-dragover");
        const files = [...(event.dataTransfer?.files || [])];
        if (files.length !== 1) { document.getElementById("supplierInvoiceConvertStatus").textContent = files.length ? "Drop one invoice file at a time." : "No file was dropped."; return; }
        runSupplierInvoiceConversion(files[0]);
    });
}

async function loadSupplierInvoiceConverterSuppliers() {
    const select = document.getElementById("supplierInvoiceSupplier");
    if (!select) return;
    try {
        const suppliers = await window.electronAPI.getSupplierInvoiceConverterSuppliers();
        select.replaceChildren(new Option("Select supplier", ""));
        for (const supplier of suppliers || []) {
            if (String(supplier.status || "ACTIVE").toUpperCase() !== "ACTIVE") continue;
            select.add(new Option(`${supplier.name} · ${supplier.supplier_code}`, String(supplier.id)));
        }
        select.addEventListener("change", loadSelectedSupplierInvoiceProfile);
        if (select.options.length === 1) select.add(new Option("No active suppliers found", ""));
    } catch (error) {
        select.replaceChildren(new Option("Supplier list unavailable", ""));
        document.getElementById("supplierInvoiceConvertStatus").textContent = cleanSupplierInvoiceError(error);
    }
}

let selectedSupplierInvoiceContext = null;
async function loadSelectedSupplierInvoiceProfile() {
    const supplierId = Number(document.getElementById("supplierInvoiceSupplier")?.value);
    const panel = document.getElementById("supplierInvoiceProfileConfirmation");
    selectedSupplierInvoiceContext = null;
    updateSupplierInvoiceDropZone();
    panel.hidden = true;
    panel.replaceChildren();
    if (!Number.isSafeInteger(supplierId) || supplierId <= 0) return;
    document.getElementById("supplierInvoiceConvertStatus").textContent = "Loading supplier profile…";
    try {
        const profile = await window.electronAPI.getSupplierInvoiceConverterProfile(supplierId);
        renderSupplierInvoiceProfileConfirmation(profile);
        document.getElementById("supplierInvoiceConvertStatus").textContent = "Confirm the invoice’s product scope, then choose the file.";
    } catch (error) {
        document.getElementById("supplierInvoiceConvertStatus").textContent = cleanSupplierInvoiceError(error);
    }
}

function renderSupplierInvoiceProfileConfirmation(profile) {
    const panel = document.getElementById("supplierInvoiceProfileConfirmation");
    panel.innerHTML = `
        <h3>Confirm supplier profile</h3>
        <p class="supplier-invoice-profile-summary"></p>
        <p class="supplier-invoice-profile-layouts"></p>
        <div class="supplier-invoice-profile-fields">
            <label for="sicProfileSegment">Segment<select id="sicProfileSegment"></select></label>
            <label for="sicProfileBusinessSegment">Business Segment<select id="sicProfileBusinessSegment"></select></label>
            <label for="sicProfileBrand">Brand<select id="sicProfileBrand"></select></label>
            <label for="sicProfileSeason">Default Season for new barcodes<select id="sicProfileSeason"></select></label>
        </div>
        <p class="supplier-invoice-profile-help">These choices fill missing details for new barcodes. Existing barcodes keep their Product Master details. If the invoice has its own Season column, its value is used.</p>`;
    panel.hidden = false;
    panel.querySelector(".supplier-invoice-profile-summary").textContent = `${profile.supplierName} · ${profile.supplierCode} · ${profile.supplierType || "Supplier"} · ${profile.relationships.length} active product profile${profile.relationships.length === 1 ? "" : "s"}`;
    const layouts = profile.layouts || [];
    panel.querySelector(".supplier-invoice-profile-layouts").textContent = layouts.length
        ? `Saved invoice layouts: ${layouts.map(item => `${item.sheetName}, heading row ${item.headerRow}`).join("; ")}. New or changed headings are mapped in this supplier’s Edit Profile drawer.`
        : "No invoice layout saved yet. Use this supplier’s Edit Profile drawer to map its invoice columns.";
    const segment = panel.querySelector("#sicProfileSegment");
    const business = panel.querySelector("#sicProfileBusinessSegment");
    const brand = panel.querySelector("#sicProfileBrand");
    const season = panel.querySelector("#sicProfileSeason");
    const addOptions = (select, values, label) => {
        select.replaceChildren(new Option(`Select ${label}`, ""));
        for (const value of [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))) select.add(new Option(value, value));
    };
    const relationships = profile.relationships || [];
    addOptions(segment, relationships.map(row => row.productSegment), "segment");
    const refreshBusiness = () => {
        const matching = relationships.filter(row => row.productSegment === segment.value);
        const prior = business.value;
        addOptions(business, matching.map(row => row.businessSegment), "business segment");
        if (matching.some(row => row.businessSegment === prior)) business.value = prior;
        refreshBrand();
    };
    const refreshBrand = () => {
        const matching = relationships.filter(row => row.productSegment === segment.value && row.businessSegment === business.value);
        const prior = brand.value;
        addOptions(brand, matching.map(row => row.brand), "brand");
        if (matching.some(row => row.brand === prior)) brand.value = prior;
        refreshContext();
    };
    const refreshContext = () => {
        const valid = relationships.some(row => row.productSegment === segment.value && row.businessSegment === business.value && row.brand === brand.value);
        selectedSupplierInvoiceContext = valid ? { segment: segment.value, businessSegment: business.value, brand: brand.value, season: season.value } : null;
        updateSupplierInvoiceDropZone();
    };
    segment.addEventListener("change", refreshBusiness);
    business.addEventListener("change", refreshBrand);
    brand.addEventListener("change", refreshContext);
    addOptions(season, profile.seasons || [], "season default");
    if ((profile.seasons || []).length === 1) season.value = profile.seasons[0];
    season.addEventListener("change", refreshContext);
    if (relationships.length === 1) {
        segment.value = relationships[0].productSegment;
        refreshBusiness();
        business.value = relationships[0].businessSegment;
        refreshBrand();
        brand.value = relationships[0].brand;
        refreshContext();
    } else {
        updateSupplierInvoiceDropZone();
    }
}

let supplierInvoiceConversionBusy = false;
function updateSupplierInvoiceDropZone() {
    const zone = document.getElementById("supplierInvoiceDropZone");
    const browse = document.getElementById("supplierInvoiceBrowseButton");
    if (!zone) return;
    const ready = Boolean(selectedSupplierInvoiceContext) && !supplierInvoiceConversionBusy;
    zone.classList.toggle("is-disabled", !ready);
    zone.classList.toggle("is-ready", ready);
    zone.setAttribute("aria-disabled", String(!ready));
    zone.tabIndex = ready ? 0 : -1;
    if (browse) browse.disabled = !ready;
    const hint = zone.querySelector(".supplier-invoice-dropzone-hint");
    if (hint) hint.textContent = ready ? "Drop the invoice here, or choose a file below." : "First select a supplier and confirm its product profile.";
}

async function runSupplierInvoiceConversion(selectedFile) {
    const status = document.getElementById("supplierInvoiceConvertStatus");
    const resultPanel = document.getElementById("supplierInvoiceConvertResult");
    const summary = document.getElementById("supplierInvoiceConvertSummary");
    const file = document.getElementById("supplierInvoiceConvertFile");
    const supplierId = Number(document.getElementById("supplierInvoiceSupplier")?.value);
    if (supplierInvoiceConversionBusy) return;
    if (!Number.isSafeInteger(supplierId) || supplierId <= 0) {
        status.textContent = "Select the supplier for this invoice first.";
        return;
    }
    if (!selectedSupplierInvoiceContext) {
        status.textContent = "Confirm the supplier’s Segment, Business Segment and Brand before adding an invoice.";
        return;
    }
    const supplierContext = { ...selectedSupplierInvoiceContext };
    const extension = String(selectedFile?.name || "").split(".").pop().toLowerCase();
    if (!selectedFile || !["xlsx", "xls", "csv"].includes(extension)) {
        status.textContent = "Choose an Excel (.xlsx or .xls) or CSV invoice.";
        return;
    }
    if (selectedFile.size > 25 * 1024 * 1024) {
        status.textContent = "This file is larger than the 25 MB conversion limit.";
        return;
    }
    supplierInvoiceConversionBusy = true;
    updateSupplierInvoiceDropZone();
    resultPanel.hidden = true;
    status.textContent = `Reading ${selectedFile.name}…`;
    try {
        const sourceBytes = new Uint8Array(await selectedFile.arrayBuffer());
        status.textContent = "Checking the invoice layout…";
        const converted = await window.electronAPI.convertSupplierInvoice({ supplierId, supplierContext, sourceName: selectedFile.name, sourceBytes });
        if (converted.failed) { status.textContent = cleanSupplierInvoiceError(converted.error); return; }
        if (converted.canceled) {
            status.textContent = "No converted workbook was saved.";
            return;
        }
        if (converted.needsMapping) {
            status.textContent = "This invoice uses new or changed headings. Open this supplier’s Edit Profile drawer to map the columns, then select the invoice again to convert it.";
            const manage=document.createElement("button");manage.type="button";manage.className="klbs-cancel-btn";manage.textContent="OPEN SUPPLIER PROFILE TO MAP COLUMNS";manage.addEventListener("click",()=>window.openSupplierInvoiceLayoutEditor?.(converted));
            status.append(" ",manage);
            return;
        }
        summary.textContent = `Converted ${converted.rowCount} invoice rows · ${converted.quantityTotal} expected pieces · ${converted.supplierName || "supplier"}`;
        file.textContent = converted.filePath;
        resultPanel.hidden = false;
        status.textContent = "Conversion complete. Review the saved workbook, then upload it separately in Stock Inward.";
    } catch (error) {
        status.textContent = cleanSupplierInvoiceError(error);
    } finally {
        supplierInvoiceConversionBusy = false;
        const input = document.getElementById("supplierInvoiceFileInput");
        if (input) input.value = "";
        updateSupplierInvoiceDropZone();
    }
}

const supplierInvoiceMappingFields = [
    ["barcode", "Barcode", true], ["quantity", "Quantity", true], ["mrp", "Printed MRP", true], ["unitCost", "Invoice Rate / Piece", true],
    ["productName", "Product Name", false], ["brand", "Brand", false], ["segment", "Segment", false], ["businessSegment", "Business Segment", false],
    ["category", "Category", false], ["season", "Season", false], ["collection", "Collection", false], ["styleCode", "Style Code", false],
    ["size", "Size", false], ["colour", "Colour", false], ["discount", "Discount", false], ["sellingPrice", "Selling Price", false],
    ["gstRate", "GST Rate", false], ["hsnCode", "HSN Code", false], ["supplier", "Supplier", false],
    ["reorderLevel", "Reorder Level", false], ["active", "Active", false], ["variableValue", "Variable Value", false]
];

function cleanSupplierInvoiceError(error) {
    return String((typeof error === "string" ? error : error?.message) || "The supplier invoice could not be converted.")
        .replace(/^Error invoking remote method '[^']+': Error: /, "")
        .replace(/^Error: /, "");
}

function invoiceColumnLabel(index, heading) {
    let value = index + 1, letters = "";
    while (value) { const digit = (value - 1) % 26; letters = String.fromCharCode(65 + digit) + letters; value = Math.floor((value - 1) / 26); }
    return `${letters} — ${String(heading || "").trim() || `Column ${letters}`}`;
}

function renderSupplierInvoiceColumnMapping(conversion) {
    const workspace = document.getElementById("supplierInvoiceConverterWorkspace");
    if (!workspace) return;
    workspace.innerHTML = `
        <div class="supplier-invoice-mapping">
            <h3>Map all Stock Inward columns</h3>
            <p>Review every Stock Inward field and choose its supplier-invoice column where available. Barcode, Quantity, Printed MRP and Invoice Rate / Piece are required. Fields left unmapped stay blank. KLBS saves this layout for the selected supplier; the invoice stays on this computer.</p>
            <p class="supplier-invoice-mapping-source"></p>
            <div class="supplier-invoice-mapping-controls">
                <label>Worksheet<select id="sicWorksheet"></select></label>
                <label>Heading row<select id="sicHeaderRow"></select></label>
            </div>
            <div class="supplier-invoice-system-field"><strong>SKU</strong><span>Assigned by KLBS during Stock Inward. Supplier SKU / item codes are never imported as KLBS SKUs.</span></div>
            <div id="sicRequiredFields" class="supplier-invoice-mapping-fields"></div>
            <details class="supplier-invoice-mapping-optional" open>
                <summary>Map all other Stock Inward columns</summary>
                <div id="sicOptionalFields" class="supplier-invoice-mapping-fields"></div>
            </details>
            <div class="integration-actions supplier-invoice-converter-actions">
                <button type="button" id="sicConvertButton" class="dashboard-btn">CREATE KLBS INWARD WORKBOOK</button>
            </div>
            <div id="sicMappingStatus" class="supplier-invoice-converter-status" role="status" aria-live="polite"></div>
        </div>`;
    workspace.querySelector(".supplier-invoice-mapping-source").textContent = `${conversion.supplierName || "Selected supplier"} · ${conversion.supplierContext?.brand || ""} · ${conversion.supplierContext?.segment || ""} / ${conversion.supplierContext?.businessSegment || ""} · Invoice: ${conversion.sourceName}`;
    const worksheetSelect = document.getElementById("sicWorksheet");
    for (const sheet of conversion.inspection.worksheets) {
        const option = document.createElement("option"); option.value = sheet.name; option.textContent = sheet.name; worksheetSelect.appendChild(option);
    }
    const getSheet = () => conversion.inspection.worksheets.find(sheet => sheet.name === worksheetSelect.value);
    const headerSelect = document.getElementById("sicHeaderRow");
    const renderRowsAndFields = () => {
        const sheet = getSheet();
        headerSelect.replaceChildren();
        for (const row of sheet.rows) {
            const option = document.createElement("option"); option.value = String(row.rowNumber);
            const detail = row.cells.filter(Boolean).slice(0, 5).join(" · ");
            option.textContent = `Row ${row.rowNumber}${detail ? ` — ${detail}` : ""}`;
            if (row.suggestedMapping && Object.keys(row.suggestedMapping).length) option.dataset.suggested = JSON.stringify(row.suggestedMapping);
            headerSelect.appendChild(option);
        }
        const renderFields = (containerId, fields) => {
            const container = document.getElementById(containerId); container.replaceChildren();
            const selectedRow = sheet.rows.find(row => row.rowNumber === Number(headerSelect.value));
            const suggestion = { ...(selectedRow?.suggestedMapping || {}), ...(selectedRow?.savedMapping || {}) };
            for (const [field, label, required] of fields) {
                const wrapper = document.createElement("label"); wrapper.textContent = `${label}${required ? " *" : ""}`;
                const select = document.createElement("select"); select.id = `sicMap_${field}`;
                const blank = document.createElement("option"); blank.value = ""; blank.textContent = "— Select column —"; select.appendChild(blank);
                selectedRow.cells.forEach((heading, index) => {
                    const option = document.createElement("option"); option.value = String(index); option.textContent = invoiceColumnLabel(index, heading);
                    if (Number(suggestion[field]) === index) option.selected = true;
                    select.appendChild(option);
                });
                wrapper.appendChild(select); container.appendChild(wrapper);
            }
        };
        renderFields("sicRequiredFields", supplierInvoiceMappingFields.filter(field => field[2]));
        renderFields("sicOptionalFields", supplierInvoiceMappingFields.filter(field => !field[2]));
    };
    worksheetSelect.addEventListener("change", renderRowsAndFields);
    headerSelect.addEventListener("change", renderRowsAndFields);
    renderRowsAndFields();
    document.getElementById("sicConvertButton").addEventListener("click", async event => {
        const button = event.currentTarget, status = document.getElementById("sicMappingStatus");
        const mapping = {};
        for (const [field, , required] of supplierInvoiceMappingFields) {
            const value = document.getElementById(`sicMap_${field}`)?.value;
            if (required && value === "") { status.textContent = "Choose a column for each required field."; return; }
            if (value !== "") mapping[field] = Number(value);
        }
        button.disabled = true; status.textContent = "Validating invoice rows…";
        try {
            const result = await window.electronAPI.convertSupplierInvoice({ token: conversion.token, mappingOptions: {
                sheetName: worksheetSelect.value, headerRow: Number(headerSelect.value), mapping
            } });
            if (result.failed) throw new Error(result.error || "The supplier invoice could not be converted.");
            if (result.canceled) { status.textContent = "No converted workbook was saved. You can adjust the mapping and try again."; return; }
            workspace.innerHTML = `<div class="supplier-invoice-converter-result"><strong id="sicSuccessSummary"></strong><span id="sicSuccessFile"></span><span>Review the saved workbook, then upload it separately in Stock Inward and scan every received item.</span></div>`;
            document.getElementById("sicSuccessSummary").textContent = `Converted ${result.rowCount} invoice rows · ${result.quantityTotal} expected pieces`;
            document.getElementById("sicSuccessFile").textContent = result.filePath;
        } catch (error) {
            status.textContent = cleanSupplierInvoiceError(error);
            button.disabled = false;
        }
    });
}
