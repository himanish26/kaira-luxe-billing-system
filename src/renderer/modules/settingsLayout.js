/* =====================================
   SETTINGS PAGE LAYOUT
===================================== */

let deviceStatusRefreshInterval = null;

function renderSettingsPage({

    title,

    icon,

    subtitle,

    backText,

    backAction,

    content

}) {

    /* Build the replacement before publishing the page visibility. */
    settingsPageContent.innerHTML = `

<div class="settings-layout">

    <div class="settings-header">

        <h1>

            ${icon} ${title}

        </h1>

        <p class="page-subtitle">

            ${subtitle}

        </p>

    </div>

    ${content}

</div>

`;

    settingsScreen.style.display = "none";
    settingsPage.style.display = "block";

    requestAnimationFrame(() => {

        window.scrollTo(0, 0);

        document.documentElement.scrollTop = 0;

        document.body.scrollTop = 0;

    });

    const backButton =
    document.getElementById(
        "settingsPageBackBtn"
    );

backButton.textContent = backText;

backButton.onclick = () => {

    if (typeof backAction === "function") {

        backAction();

    } else {

        settingsPage.style.display = "none";
        settingsScreen.style.display = "block";

    }

};

}

function setSettingsPageBackToSettings() {
    const backButton = document.getElementById("settingsPageBackBtn");
    if (!backButton) return;

    backButton.textContent = "← Settings";
    backButton.onclick = () => {
        settingsPage.style.display = "none";
        settingsScreen.style.display = "block";
    };
}

function showDeviceSettings() {

        if (deviceStatusRefreshInterval) {

        clearInterval(
            deviceStatusRefreshInterval
        );

        deviceStatusRefreshInterval = null;

    }

    settingsScreen.style.display = "none";

    settingsPage.style.display = "block";
    const pageBackButton = document.getElementById("settingsPageBackBtn");
    if (pageBackButton) pageBackButton.hidden = false;
    setSettingsPageBackToSettings();

settingsPageContent.innerHTML = `

<main id="deviceSettingsRoot" class="device-settings-page">
<h1 class="settings-title">🖨 Device Settings</h1>

<div class="device-settings-container">

    <div class="device-card printer-card">

        <h2 class="device-card-title">

            🖨 Printer

        </h2>

        <div class="settings-field">

    <label>

        Default Printer

    </label>

    <select id="printerSelect">

        <option>

            Loading printers...

        </option>

    </select>

</div>

        <!-- Existing Printer HTML starts here -->

        <div class="settings-field">

            <label>Status</label>

            <div

    id="printerStatus"

    class="status-badge status-warning"

>

    🟡 Loading...

</div>

        </div>

        <div class="settings-actions">

            <button
                id="testPrinterBtn"
                class="integration-button integration-button-secondary">

                🧾 TEST PRINT

            </button>

            <button
                id="savePrinterBtn"
                class="integration-button integration-button-primary"
                disabled>

                💾 SAVE

            </button>

        </div>

    </div>

    <div class="device-card scanner-card">

    <h2 class="device-card-title">

            📷 Scanner

        </h2>

    <div class="settings-field">

        <label>Test Type</label>

        <select id="scannerTestType">

            <option value="barcode">

                Barcode

            </option>

            <option value="qr">

                QR Code

            </option>

        </select>

    </div>

    <div class="settings-field">

        <label>Test Code</label>

        <div
            id="scannerCodePreview"
            class="scanner-test-preview">

        </div>

    </div>

    <div class="settings-field">

        <label>Expected Scan</label>

        <div

        id="expectedScan"

        class="expected-scan"

        >

        8901234567890

        </div>

    </div>

    <div class="settings-field">

        <label>Scanner Output</label>

        <input

id="scannerOutput"

placeholder="Scan a barcode..."

autocomplete="off"

>

    </div>

    <div class="settings-field">

        <label>Status</label>

        <div id="scannerStatus" class="status-badge status-warning">

            🟡 Waiting for Scan

        </div>

    </div>

</div>

</div>

<section class="device-card stock-print-routing-card" aria-labelledby="stockPrintRoutingHeading">
  <div>
    <h2 id="stockPrintRoutingHeading">Stock Inward &amp; Outward Printing</h2>
    <p>Choose a printer and matching paper layout for each workflow, then save both. Select A4 sheet for an A4 printer or POS thermal receipt for the POS. These choices do not change the KLBS default printer.</p>
  </div>
  <div class="stock-print-routing-grid">
    <div class="stock-print-route">
      <h3>Stock Inward</h3>
      <label for="stockInwardPrinterSelect">Printer</label>
      <select id="stockInwardPrinterSelect"><option value="">Loading printers…</option></select>
      <label for="stockInwardPrintProfile">Paper layout</label>
      <select id="stockInwardPrintProfile">
        <option value="A4">A4 sheet</option>
        <option value="THERMAL">POS thermal receipt</option>
      </select>
      <button id="saveStockInwardPrintSettings" type="button" class="integration-button integration-button-primary" disabled>SAVE INWARD PRINTING</button>
      <p id="stockInwardPrintStatus" class="stock-print-route-status" role="status" aria-live="polite"></p>
    </div>
    <div class="stock-print-route">
      <h3>Stock Outward</h3>
      <label for="stockOutwardPrinterSelect">Printer</label>
      <select id="stockOutwardPrinterSelect"><option value="">Loading printers…</option></select>
      <label for="stockOutwardPrintProfile">Paper layout</label>
      <select id="stockOutwardPrintProfile">
        <option value="A4">A4 sheet</option>
        <option value="THERMAL">POS thermal receipt</option>
      </select>
      <button id="saveStockOutwardPrintSettings" type="button" class="integration-button integration-button-primary" disabled>SAVE OUTWARD PRINTING</button>
      <p id="stockOutwardPrintStatus" class="stock-print-route-status" role="status" aria-live="polite"></p>
    </div>
  </div>
</section>

<section class="device-card print-layout-card" aria-labelledby="printLayoutHeading">
  <div class="print-layout-header">
    <div>
      <h2 id="printLayoutHeading">Print Layout Preview</h2>
      <p>Review the full receipt layout before sending a sample to the selected printer.</p>
    </div>
    <span class="print-preview-only-badge">Thermal receipts + A4 stock sheets</span>
  </div>
  <p class="print-preview-note">Saved Tax Invoice font, size and margins apply to new bills, Bill History reprints and 80 mm PDF exports. Print Sample uses the current selections. Stock Inward and Stock Outward keep separate A4 sheet and POS thermal layouts.</p>
  <div class="print-layout-workbench">
    <div class="print-layout-controls" aria-label="Print layout controls">
      <label>Print layout
        <select id="printPreviewType">
          <option value="tax-invoice">Tax Invoice</option>
          <option value="store-credit">Store Credit</option>
          <option value="day-closing">Day Closing</option>
          <option value="printer-test">Printer Test</option>
          <option value="credit-note">Credit Note</option>
          <option value="stock-inward">Stock Inward</option>
          <option value="stock-outward">Stock Outward</option>
          <option value="stock-inward-a4">Stock Inward · A4 sheet</option>
          <option value="stock-outward-a4">Stock Outward · A4 sheet</option>
        </select>
      </label>
      <label>Document font
        <select id="printPreviewFont">
          <option value="arial">Arial / Helvetica</option>
          <option value="trebuchet">Trebuchet MS</option>
          <option value="verdana">Verdana</option>
          <option value="georgia">Georgia</option>
          <option value="times">Times New Roman</option>
          <option value="courier">Courier New</option>
        </select>
      </label>
      <label>Body text size
        <span class="print-preview-number"><input id="printPreviewFontSize" type="number" min="9" max="18" step="1" value="13"><span>px</span></span>
      </label>
      <div class="print-preview-margin-group" role="group" aria-label="Print page margins in millimetres">
        <span class="print-preview-control-title">Page margins <small>mm</small></span>
        <label>Top<input id="printPreviewMarginTop" type="number" min="0" max="12" step="1" value="2"></label>
        <label>Right<input id="printPreviewMarginRight" type="number" min="0" max="12" step="1" value="5"></label>
        <label>Bottom<input id="printPreviewMarginBottom" type="number" min="0" max="12" step="1" value="2"></label>
        <label>Left<input id="printPreviewMarginLeft" type="number" min="0" max="12" step="1" value="5"></label>
      </div>
      <button id="savePrintPreviewSettings" type="button" class="integration-button integration-button-primary" disabled>💾 SAVE PRINT SETTINGS</button>
      <button id="printPreviewReset" type="button" class="integration-button integration-button-neutral">RESTORE DOCUMENT PRESET</button>
      <p id="printPreviewSaveStatus" class="print-preview-print-status" role="status" aria-live="polite"></p>
    </div>
    <div class="print-preview-stage">
      <div class="print-preview-stage-heading"><strong id="printPreviewTitle">Tax Invoice</strong><button id="printPreviewPrintButton" type="button" class="integration-button integration-button-secondary">🖨 PRINT SAMPLE</button></div>
      <p id="printPreviewPrintStatus" class="print-preview-print-status" role="status" aria-live="polite"></p>
      <div class="print-preview-scroll">
    <iframe id="printPreviewFrame" class="print-preview-frame" title="Full print layout preview" src="devicePrintPreviews/tax-invoice.html"></iframe>
      </div>
    </div>
  </div>
</section>
</main>

`;

const printerSelect =
    document.getElementById("printerSelect");

const printerStatus =
    document.getElementById("printerStatus");

const stockInwardPrinterSelect = document.getElementById("stockInwardPrinterSelect");
const stockInwardPrintProfile = document.getElementById("stockInwardPrintProfile");
const stockOutwardPrinterSelect = document.getElementById("stockOutwardPrinterSelect");
const stockOutwardPrintProfile = document.getElementById("stockOutwardPrintProfile");
const stockInwardPrintStatus = document.getElementById("stockInwardPrintStatus");
const stockOutwardPrintStatus = document.getElementById("stockOutwardPrintStatus");
let savedPrintPreviewSettings = {};
let savedDefaultPrinter = "";
let savedStockPrintRoutes = { inward: null, outward: null };
let savedReceiptFooterMessage = "";

function populateStockPrinterSelect(select, printers, selectedName, defaultName) {
    select.innerHTML = "";
    const selected = selectedName || defaultName || "";
    const knownNames = new Set(printers.map(printer => printer.name));
    if (selected && !knownNames.has(selected)) {
        const unavailable = document.createElement("option");
        unavailable.value = selected;
        unavailable.textContent = `${selected} (currently unavailable)`;
        select.appendChild(unavailable);
    }
    for (const printer of printers) {
        const option = document.createElement("option");
        option.value = printer.name;
        option.textContent = printer.displayName || printer.name;
        select.appendChild(option);
    }
    if (!select.options.length) {
        const none = document.createElement("option");
        none.value = "";
        none.textContent = "No printers available";
        select.appendChild(none);
    }
    select.value = selected;
}

    async function refreshPrinterStatus() {

    try {

        const status =
            await window.electronAPI.getSystemStatus();

        switch (status.printer.status) {

            case "Ready":

                printerStatus.textContent =
                    `🟢 ${status.printer.name}`;

                printerStatus.className =
                    "status-badge status-success";

                break;

            case "Offline":

                printerStatus.textContent =
                    `🟡 ${status.printer.name} (Offline)`;

                printerStatus.className =
                    "status-badge status-warning";

                break;

            case "No Default":

                printerStatus.textContent =
                    "🟡 No Default Printer";

                printerStatus.className =
                    "status-badge status-warning";

                break;

            case "No Printer":

                printerStatus.textContent =
                    "🔴 No Printer Installed";

                printerStatus.className =
                    "status-badge status-error";

                break;

            default:

                printerStatus.textContent =
                    "🔴 Unavailable";

                printerStatus.className =
                    "status-badge status-error";

        }

    }

    catch (err) {

        console.error(err);

        printerStatus.textContent =
            "🔴 Unable to Detect Printer";

        printerStatus.className =
            "status-badge status-error";

    }

}

async function loadPrinters() {

    try {

        const [
            result,
            settings
        ] = await Promise.all([

            window.electronAPI.getPrinters(),

            window.electronAPI.getSettings()

        ]);

        if (!result.success) {

            printerStatus.textContent =
                "🔴 Unable to load printers";

            printerStatus.className =
                "status-badge status-error";

            return;

        }

        printerSelect.innerHTML = "";

        populateStockPrinterSelect(stockInwardPrinterSelect, result.printers,
            settings.stock_inward_printer, settings.default_printer);
        populateStockPrinterSelect(stockOutwardPrinterSelect, result.printers,
            settings.stock_outward_printer, settings.default_printer);
        stockInwardPrintProfile.value = settings.stock_inward_print_profile === "A4" ? "A4" : "THERMAL";
        stockOutwardPrintProfile.value = settings.stock_outward_print_profile === "A4" ? "A4" : "THERMAL";
        savedStockPrintRoutes = {
            inward: { printer: stockInwardPrinterSelect.value, profile: stockInwardPrintProfile.value },
            outward: { printer: stockOutwardPrinterSelect.value, profile: stockOutwardPrintProfile.value }
        };
        try {
            const saved = JSON.parse(settings.device_print_preview_settings || "{}");
            savedPrintPreviewSettings = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
        } catch { savedPrintPreviewSettings = {}; }
        savedReceiptFooterMessage = typeof settings.receipt_message === "string" ? settings.receipt_message : "";
        applyPrintPreviewDefaults(printPreviewType.value);
        updatePrintPreview();
        updatePrintPreviewSaveButton();

        result.printers.forEach(printer => {

            const option =
                document.createElement("option");

            option.value =
                printer.name;

            option.textContent =
                printer.displayName ||
                printer.name;

            printerSelect.appendChild(option);

        });

        if (settings.default_printer) {

            const savedPrinterExists =
                result.printers.some(
                    printer =>
                        printer.name ===
                        settings.default_printer
                );

            if (savedPrinterExists) {

                printerSelect.value =
                    settings.default_printer;

            }

        }

        savedDefaultPrinter = printerSelect.value;
        updateDefaultPrinterSaveButton();
        updateStockPrintSaveButtons();

        await refreshPrinterStatus();

    }

    catch (err) {

        console.error(
            "Printer Loading Error:",
            err
        );

        printerStatus.textContent =
            "🔴 Unable to load printers";

        printerStatus.className =
            "status-badge status-error";

    }

}

loadPrinters();

function updateDefaultPrinterSaveButton() {
    const button = document.getElementById("savePrinterBtn");
    if (button) button.disabled = !printerSelect.value || printerSelect.value === savedDefaultPrinter;
}

function updateStockPrintSaveButtons() {
    const inward = document.getElementById("saveStockInwardPrintSettings");
    const outward = document.getElementById("saveStockOutwardPrintSettings");
    if (inward) inward.disabled = !savedStockPrintRoutes.inward ||
        (stockInwardPrinterSelect.value === savedStockPrintRoutes.inward.printer && stockInwardPrintProfile.value === savedStockPrintRoutes.inward.profile);
    if (outward) outward.disabled = !savedStockPrintRoutes.outward ||
        (stockOutwardPrinterSelect.value === savedStockPrintRoutes.outward.printer && stockOutwardPrintProfile.value === savedStockPrintRoutes.outward.profile);
}

printerSelect.addEventListener("change", updateDefaultPrinterSaveButton);
[stockInwardPrinterSelect, stockInwardPrintProfile, stockOutwardPrinterSelect, stockOutwardPrintProfile]
    .forEach(control => control.addEventListener("change", updateStockPrintSaveButtons));

deviceStatusRefreshInterval =
    setInterval(
        refreshPrinterStatus,
        10000
    );

document
    .getElementById("savePrinterBtn")
    .addEventListener(

        "click",

        async () => {

            const button = document.getElementById("savePrinterBtn");
            if (button.disabled) return;
            button.disabled = true;

            try {

                const saveResult = await window.electronAPI.saveSettings({

                    default_printer:
                        printerSelect.value

                });

                await refreshPrinterStatus();
                savedDefaultPrinter = printerSelect.value;

                alert(
                    "✅ Printer settings saved successfully." +
                    (saveResult?.activityWarning
                        ? `\n\nWarning: ${saveResult.activityWarning}`
                        : "")
                );

            }

            catch (err) {

                console.error(err);

                alert(
                    "Unable to save printer settings."
                );

            } finally {
                updateDefaultPrinterSaveButton();
            }

        }

    );

document
    .getElementById("testPrinterBtn")
    .addEventListener("click", async () => {
        try {
            const selectedPrinter = printerSelect.value;
            const result = await window.electronAPI.testPrinter(selectedPrinter); // or ipcRenderer.invoke("printer:test", selectedPrinter)
            if (result && result.success) {
                alert("✅ Test print sent successfully.");
            } else {
                alert("🔴 Print failed: " + (result?.error || "Unknown error"));
            }
        } catch (err) {
            console.error(err);
            alert("🔴 Failed to trigger test print.");
        }
    });

async function saveStockPrintRoute(workflow) {
    const inward = workflow === "inward";
    const printer = inward ? stockInwardPrinterSelect.value : stockOutwardPrinterSelect.value;
    const profile = inward ? stockInwardPrintProfile.value : stockOutwardPrintProfile.value;
    const status = inward ? stockInwardPrintStatus : stockOutwardPrintStatus;
    const button = document.getElementById(inward ? "saveStockInwardPrintSettings" : "saveStockOutwardPrintSettings");
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = "Saving print destination…";
    try {
        const saveResult = await window.electronAPI.saveStockDocumentPrintSettings(inward
            ? { stock_inward_printer: printer, stock_inward_print_profile: profile }
            : { stock_outward_printer: printer, stock_outward_print_profile: profile });
        if (saveResult?.success) savedStockPrintRoutes[workflow] = { printer, profile };
        status.textContent = saveResult?.activityWarning || "Saved. New and reprinted documents will use this printer and layout.";
    } catch (error) {
        status.textContent = error.message || "Could not save this print destination.";
    } finally {
        updateStockPrintSaveButtons();
    }
}

document.getElementById("saveStockInwardPrintSettings").addEventListener("click", () => saveStockPrintRoute("inward"));
document.getElementById("saveStockOutwardPrintSettings").addEventListener("click", () => saveStockPrintRoute("outward"));

const PRINT_PREVIEW_FONTS = {
    arial: "Arial, Helvetica, sans-serif",
    trebuchet: "'Trebuchet MS', Arial, sans-serif",
    verdana: "Verdana, Geneva, sans-serif",
    georgia: "Georgia, 'Times New Roman', serif",
    times: "'Times New Roman', Times, serif",
    courier: "'Courier New', monospace"
};
const printPreviewDocuments = {
    "tax-invoice": { title: "Tax Invoice", file: "tax-invoice.html", font: "arial", size: 13, margins: { top: 2, right: 5, bottom: 2, left: 5 } },
    "store-credit": { title: "Store Credit", file: "store-credit.html", font: "arial", size: 13, margins: { top: 2, right: 5, bottom: 2, left: 5 } },
    "day-closing": { title: "Day Closing", file: "day-closing.html", font: "arial", size: 13, margins: { top: 2, right: 5, bottom: 2, left: 5 } },
    "printer-test": { title: "Printer Test", file: "printer-test.html", font: "courier", size: 13, margins: { top: 3, right: 3, bottom: 3, left: 3 } },
    "credit-note": { title: "Credit Note", file: "credit-note.html", font: "arial", size: 13, margins: { top: 6, right: 6, bottom: 6, left: 6 } },
    "stock-inward": { title: "Stock Inward · POS thermal", file: "stock-inward.html", font: "arial", size: 12, margins: { top: 3, right: 6, bottom: 3, left: 6 } },
    "stock-outward": { title: "Stock Outward · POS thermal", file: "stock-outward.html", font: "arial", size: 12, margins: { top: 3, right: 6, bottom: 3, left: 6 } },
    "stock-inward-a4": { title: "Stock Inward · A4 sheet", file: "../stock-inward-a4.html", font: "arial", size: 10, margins: { top: 6, right: 6, bottom: 6, left: 6 } },
    "stock-outward-a4": { title: "Stock Outward · A4 sheet", file: "../stock-outward-a4.html", font: "arial", size: 10, margins: { top: 6, right: 6, bottom: 6, left: 6 } }
};
const printPreviewType = document.getElementById("printPreviewType");
const printPreviewFont = document.getElementById("printPreviewFont");
const printPreviewFontSize = document.getElementById("printPreviewFontSize");
const printPreviewFrame = document.getElementById("printPreviewFrame");
const printPreviewTitle = document.getElementById("printPreviewTitle");
const printPreviewPrintButton = document.getElementById("printPreviewPrintButton");
const printPreviewPrintStatus = document.getElementById("printPreviewPrintStatus");
const printPreviewMargins = {
    top: document.getElementById("printPreviewMarginTop"),
    right: document.getElementById("printPreviewMarginRight"),
    bottom: document.getElementById("printPreviewMarginBottom"),
    left: document.getElementById("printPreviewMarginLeft")
};

function sendPrintPreviewSettings() {
    if (!printPreviewFrame.contentWindow) return;
    const fontSize = Math.max(9, Math.min(18, Number(printPreviewFontSize.value) || 13));
    const margins = {};
    for (const [side, input] of Object.entries(printPreviewMargins)) {
        margins[side] = Math.max(0, Math.min(12, Number(input.value) || 0));
        input.value = String(margins[side]);
    }
    printPreviewFrame.contentWindow.postMessage({
        type: "KLBS_DEVICE_PRINT_PREVIEW_SETTINGS",
        font: printPreviewFont.value,
        fontSize,
        margins,
        ...(printPreviewType.value === "tax-invoice" ? { receiptMessage: savedReceiptFooterMessage } : {})
    }, "*");
}

function updatePrintPreview() {
    const selected = printPreviewDocuments[printPreviewType.value] || printPreviewDocuments["tax-invoice"];
    printPreviewTitle.textContent = selected.title;
    const nextSource = `devicePrintPreviews/${selected.file}`;
    if (printPreviewFrame.getAttribute("src") !== nextSource) {
        printPreviewFrame.setAttribute("src", nextSource);
    } else {
        sendPrintPreviewSettings();
    }
    printPreviewPrintButton.setAttribute("aria-label", `Print ${selected.title} sample`);
    printPreviewPrintStatus.textContent = "";
}

function applyPrintPreviewDefaults(previewType, options = {}) {
    const selected = printPreviewDocuments[previewType] || printPreviewDocuments["tax-invoice"];
    const saved = options.useSaved === false ? null : savedPrintPreviewSettings[previewType];
    printPreviewFont.value = PRINT_PREVIEW_FONTS[saved?.font] ? saved.font : selected.font;
    printPreviewFontSize.value = String(Math.max(9, Math.min(18, Number(saved?.size) || selected.size)));
    for (const [side, input] of Object.entries(printPreviewMargins)) {
        const savedMargin = Number(saved?.margins?.[side]);
        input.value = String(Number.isFinite(savedMargin) && savedMargin >= 0 && savedMargin <= 12
            ? savedMargin : selected.margins[side]);
    }
}

function currentPrintPreviewPreference() {
    return {
        font: printPreviewFont.value,
        size: Math.max(9, Math.min(18, Number(printPreviewFontSize.value) || 13)),
        margins: Object.fromEntries(Object.entries(printPreviewMargins).map(([side, input]) =>
            [side, Math.max(0, Math.min(12, Number(input.value) || 0))]))
    };
}

function updatePrintPreviewSaveButton() {
    const button = document.getElementById("savePrintPreviewSettings");
    const type = printPreviewType.value;
    const baseline = savedPrintPreviewSettings[type] || printPreviewDocuments[type];
    if (!button || !baseline) return;
    const current = currentPrintPreviewPreference();
    const original = { font: baseline.font, size: Number(baseline.size), margins: baseline.margins };
    button.disabled = JSON.stringify(current) === JSON.stringify(original);
}

printPreviewFrame.addEventListener("load", sendPrintPreviewSettings);
[printPreviewFont, printPreviewFontSize, ...Object.values(printPreviewMargins)]
    .forEach(control => {
        control.addEventListener("input", () => { sendPrintPreviewSettings(); updatePrintPreviewSaveButton(); });
        control.addEventListener("change", () => { sendPrintPreviewSettings(); updatePrintPreviewSaveButton(); });
    });

printPreviewType.addEventListener("change", () => {
    applyPrintPreviewDefaults(printPreviewType.value);
    updatePrintPreview();
    updatePrintPreviewSaveButton();
});

document.getElementById("printPreviewReset").addEventListener("click", () => {
    const currentType = printPreviewType.value;
    applyPrintPreviewDefaults(currentType, { useSaved: false });
    updatePrintPreview();
    updatePrintPreviewSaveButton();
    document.getElementById("printPreviewSaveStatus").textContent = "Preset restored for this preview. Save if you want to keep it.";
});

document.getElementById("savePrintPreviewSettings").addEventListener("click", async event => {
    const button = event.currentTarget;
    const status = document.getElementById("printPreviewSaveStatus");
    const documentType = printPreviewType.value;
    if (button.disabled) return;
    const settings = currentPrintPreviewPreference();
    button.disabled = true;
    status.textContent = "Saving preview choices…";
    try {
        const result = await window.electronAPI.saveDevicePrintPreviewSettings({ documentType, settings });
        savedPrintPreviewSettings = result?.allPreferences || { ...savedPrintPreviewSettings, [documentType]: settings };
        updatePrintPreviewSaveButton();
        const statusTitles = {
            "tax-invoice": "Tax Invoice", "store-credit": "Store Credit", "day-closing": "Day Closing",
            "printer-test": "Printer Test", "credit-note": "Credit Note", "stock-inward": "Stock Inward",
            "stock-outward": "Stock Outward", "stock-inward-a4": "Stock Inward A4", "stock-outward-a4": "Stock Outward A4"
        };
        status.textContent = result?.activityWarning || `Saved ${statusTitles[documentType] || "print"} print settings.`;
    } catch (error) {
        status.textContent = error.message || "Could not save print settings.";
    } finally {
        updatePrintPreviewSaveButton();
    }
});

printPreviewPrintButton.addEventListener("click", async () => {
    const selectedType = printPreviewType.value;
    const selected = printPreviewDocuments[selectedType];
    if (!selected) return;
    printPreviewPrintButton.disabled = true;
    printPreviewPrintStatus.textContent = `Sending ${selected.title} sample to the saved printer…`;
    try {
        const result = await window.electronAPI.printLayoutPreview(selectedType, currentPrintPreviewPreference());
        printPreviewPrintStatus.textContent = result?.success
            ? `${selected.title} sample sent to the saved printer.`
            : (result?.error || "The sample could not be printed.");
    } catch (error) {
        printPreviewPrintStatus.textContent = error.message || "The sample could not be printed.";
    } finally {
        printPreviewPrintButton.disabled = false;
    }
});

updatePrintPreview();

const backButton =
    document.getElementById("settingsPageBackBtn");

if (backButton) {

    backButton.textContent = "← Settings";

    backButton.onclick = () => {

        if (deviceStatusRefreshInterval) {

            clearInterval(
                deviceStatusRefreshInterval
            );

            deviceStatusRefreshInterval =
                null;

        }

        settingsPage.style.display = "none";

        settingsScreen.style.display = "block";

    };

}

/* =====================================
   SCANNER TEST
===================================== */

const TEST_CODES = {

    barcode: "8901234567890",

    qr: "KL-SCANNER-TEST"

};

const scannerType =
    document.getElementById("scannerTestType");

const expectedScan =
    document.getElementById("expectedScan");

const scannerOutput =
    document.getElementById("scannerOutput");

const scannerStatus =
    document.getElementById("scannerStatus");

const scannerPreview =
    document.getElementById("scannerCodePreview");

function updateScannerUI() {

    const type =
        scannerType.value;

    expectedScan.textContent =
        TEST_CODES[type];

    scannerOutput.disabled =
        false;

    scannerOutput.value = "";

    scannerStatus.textContent =
        "🟡 Waiting for Scan";

    scannerStatus.className =
        "status-badge status-warning";

    scannerOutput.focus();

    if (type === "barcode") {

        scannerPreview.innerHTML =
            '<svg id="barcodeSvg"></svg>';

        JsBarcode(

            "#barcodeSvg",

            TEST_CODES.barcode,

            {

                format: "CODE128",

                width: 2,

                height: 60,

                displayValue: true,

                margin: 10

            }

        );

    }

    else {

        scannerPreview.innerHTML =
            '<div id="qrCode"></div>';

        new QRCode(

            document.getElementById("qrCode"),

            {

                text: TEST_CODES.qr,

                width: 180,

                height: 180

            }

        );

    }

}

function validateScanner() {

    if (scannerOutput.disabled) {

        return;

    }

    const scannedValue =
        scannerOutput.value.trim();

    const expectedValue =
        expectedScan.textContent.trim();

    if (scannedValue === expectedValue) {

        scannerStatus.innerHTML =
            "🟢 Scanner Test Passed";

        scannerStatus.className =
            "status-badge status-success";

        scannerOutput.disabled =
            true;

        setTimeout(

            () => {

                updateScannerUI();

            },

            3000

        );

    }

    else {

        scannerStatus.innerHTML =
            "🔴 Invalid Scan";

        scannerStatus.className =
            "status-badge status-error";

    }

}

updateScannerUI();

scannerType.addEventListener(

    "change",

    updateScannerUI

);

scannerOutput.addEventListener(

    "keydown",

    function(event){

        if(event.key==="Enter"){

            event.preventDefault();

            validateScanner();

        }

    }

);
    
}
