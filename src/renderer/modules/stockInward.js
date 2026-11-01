"use strict";

(() => {
    let active = false;
    let documentData = null;
    let readOnly = false;
    let pageMode = "home";
    let activeIsNew = false;
    let scanQueue = Promise.resolve();
    let authInProgress = false;
    let previousFocus = null;
    let previousBackHidden = false;
    let previousBackText = "";
    let previousBackOnclick = null;
    let escHandler = null;
    let unresolvedDrawer = null;
    let currentMasterResults = [];
    let duplicateDialog = null;
    let duplicateDialogInvoice = null;
    let dismissedDuplicateInvoice = null;
    let contextSaveTimer = null;
    let duplicateClear = true;
    let contextSaved = false;
    let unresolvedMovementId = null;
    let selectedUnresolvedLineIds = new Set();
    let unresolvedRetryInProgress = false;
    let unresolvedBulkRemoveInProgress = false;
    let unresolvedRetryAlertTimer = null;
    let unresolvedRetryAlertGeneration = 0;
    let previousTopbarClass = "";
    let returnDestination = "inventory";
    let duplicateCheckSequence = 0;
    let messageTimeout = null;
    let currentReconciliation = { state:"NO_INVOICE_QTY", difference:null, text:"" };
    let reviewOpen = false;
    let printInProgress = false;
    let historyPage = 1;
    let historyKeyword = "";
    let historyTotalPages = 1;
    let historyTotalCount = 0;
    let historySearchTimer = null;
    let historyRequestSequence = 0;
    const HISTORY_PAGE_SIZE = 100;
    const api = () => window.electronAPI;
    const el = id => document.getElementById(id);
    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));

    async function enterStockInwardPage(options = {}) {
        if (active) return;
        returnDestination = options?.returnTo === "exportData" ? "exportData" : "inventory";
        previousFocus = document.activeElement;
        const globalBack = el("settingsPageBackBtn");
        previousBackHidden = globalBack.hidden;
        previousBackText = globalBack.textContent;
        previousBackOnclick = globalBack.onclick;
        previousTopbarClass = globalBack.parentElement.className;
        active = true;
        const content = el("settingsPageContent");
        const screen = el("settingsScreen");
        const page = el("settingsPage");
        screen.style.display = "none";
        page.style.display = "block";
        globalBack.hidden = false;
        globalBack.textContent = "← BACK";
        globalBack.parentElement.classList.add("si-page-topbar", "management-pnl-topbar");
        globalBack.insertAdjacentHTML("afterend", '<h1 id="siPageTitle">STOCK INWARD</h1>');
        globalBack.onclick = () => pageMode === "home" ? leavePage() : returnToHome();
        content.innerHTML = `
          <section class="stock-inward-page" aria-label="Stock Inward">
            <main id="siMainScroll" class="si-main-scroll">
              <div id="siPageMessage" class="si-message" role="status" aria-live="polite"></div>
              <div id="stockInwardResume" class="stock-inward-resume" hidden></div>
              <div id="stockInwardWorkspace" hidden>
                <section class="si-document-head" aria-label="Stock Inward document identity"><strong id="siCode">—</strong><span id="siStatus" class="si-status-badge">DRAFT</span><span id="siReadOnlyBanner" class="si-read-only-banner" hidden>READ ONLY</span><span class="si-business-date-label">BUSINESS DATE</span><time id="siBusinessDate">—</time><button id="siReconcileMrp" type="button" class="klbs-cancel-btn">RECONCILE OLD STOCK</button><button id="siHistoricalUnresolved" type="button" class="klbs-cancel-btn" hidden>VIEW UNRESOLVED BARCODES</button><button id="siHistoricalPrint" type="button" class="klbs-primary-btn si-history-print" hidden>REPRINT RECEIPT</button></section>
                <section class="si-context-grid expense-entry-grid" aria-label="Supplier and invoice details">
                  <label>SUPPLIER<select id="siSupplier"><option value="">No Supplier</option></select></label>
                  <label>LINK KLBS INVOICE<select id="siInvoice" disabled><option value="">Select Supplier first</option></select></label>
                  <label>INVOICE NUMBER<input id="siInvoiceNumber" maxlength="120"></label>
                  <label>INVOICE DATE<input id="siInvoiceDate" type="date"></label>
                  <label>INVOICE TOTAL QTY<input id="siInvoiceQty" type="number" min="1" step="1" inputmode="numeric"></label>
                  <label class="si-remarks-field">REMARKS<input id="siRemarks" type="text" maxlength="500" placeholder="Optional remarks"></label>
                </section>
                <section id="siReconciliation" class="si-reconciliation si-neutral" aria-live="polite"></section>
                <section class="si-invoice-workbook-actions" aria-label="Supplier invoice conversion"><button id="siDownloadInvoiceTemplate" type="button" class="klbs-cancel-btn">DOWNLOAD KLBS INWARD TEMPLATE</button><button id="siImportInvoice" type="button" class="klbs-cancel-btn">UPLOAD SUPPLIER INVOICE</button><span id="siInvoiceImportStatus" role="status" aria-live="polite">Excel (.xls/.xlsx) or CSV accepted. Upload loads expected lines only; physically scan every item before review and posting.</span></section>
                <section id="siInvoiceLineReconciliation" class="si-invoice-line-reconciliation" hidden></section>
                <section class="si-scan-area"><label for="siScanner">SCAN PRODUCT</label><input id="siScanner" type="text" autocomplete="off" placeholder="Scan Barcode Here" aria-label="Scan product barcode" disabled><small id="siScanGateHint">Complete receiving details to start scanning.</small></section>
                <div id="siMessage" class="si-message" role="status" aria-live="polite"></div>
                <section class="si-received-items"><h2>RECEIVED ITEMS</h2><div id="siKnownLines"></div></section>
                <section id="siSummary" class="si-summary"></section>
                <section id="siReview" class="si-review" hidden></section>
              </div>
            </main>
            <footer id="siActions" class="si-actions" hidden><button id="siUnresolved" type="button" class="klbs-cancel-btn si-unresolved-btn" disabled>UNRESOLVED BARCODES (0)</button><button id="siDeleteDraft" type="button" class="klbs-cancel-btn si-delete-btn">DELETE DRAFT</button><button id="siPost" type="button" class="klbs-primary-btn si-post-btn">REVIEW STOCK INWARD</button></footer>
            <div id="siUnresolvedOverlay" class="si-unresolved-overlay klbs-drawer-overlay" hidden>
              <aside id="siUnresolvedDrawer" class="klbs-drawer-panel si-unresolved-drawer" role="dialog" aria-modal="true" aria-labelledby="siUnresolvedTitle" tabindex="-1">
                <header class="klbs-drawer-header"><h2 id="siUnresolvedTitle" class="klbs-drawer-title">UNRESOLVED BARCODES</h2><button id="siUnresolvedExit" class="klbs-drawer-exit" type="button" aria-label="Exit unresolved barcodes">EXIT</button></header>
                <div class="klbs-drawer-body"><div id="siUnresolvedContext" class="si-unresolved-context"></div><div id="siProductCapture" class="si-product-capture" hidden></div><div id="siUnknownLines"></div></div>
                <footer class="klbs-drawer-footer si-unresolved-footer"><div id="siRetryAlert" class="si-retry-alert" role="status" aria-live="polite" hidden></div><button id="siExport" type="button" class="si-export-btn">EXPORT UNKNOWN BARCODES</button></footer>
              </aside>
            </div>
          </section>`;
        content.insertAdjacentHTML("beforeend", `<div id="siDuplicateOverlay" class="modal si-duplicate-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="siDuplicateTitle"><section class="modal-content si-duplicate-dialog"><header><h2 id="siDuplicateTitle"></h2></header><div id="siDuplicateBody"></div><footer id="siDuplicateActions"></footer></section></div>`);
        content.insertAdjacentHTML("beforeend", `<div id="siArchiveOverlay" class="modal si-archive-overlay" hidden role="alertdialog" aria-modal="true" aria-labelledby="siArchiveTitle" aria-describedby="siArchiveDescription"><section class="modal-content si-archive-dialog"><h2 id="siArchiveTitle">REMOVE CANCELLED STOCK INWARD</h2><strong id="siArchiveMovementNo" class="si-archive-movement"></strong><p id="siArchiveDescription">Remove this cancelled Stock Inward from the list?</p><div class="modal-buttons si-archive-actions"><button id="siArchiveCancel" type="button" class="klbs-cancel-btn">CANCEL</button><button id="siArchiveConfirm" type="button" class="klbs-primary-btn">REMOVE</button></div></section></div>`);
        content.insertAdjacentHTML("beforeend", `<div id="siSuccessOverlay" class="modal si-success-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="siSuccessTitle" aria-describedby="siSuccessMessage siPartialExplanation"><section class="modal-content si-success-dialog"><h2 id="siSuccessTitle">STOCK INWARD COMPLETE</h2><strong id="siSuccessCode"></strong><p id="siSuccessMessage"></p><p id="siSuccessUnresolved" class="si-success-unresolved" hidden></p><div id="siPartialSummary" class="si-partial-summary" hidden><div class="si-partial-posted"><small>POSTED SUCCESSFULLY</small><strong id="siPartialPostedCount"></strong></div><div class="si-partial-pending"><small>PENDING RESOLUTION</small><strong id="siPartialPendingCount"></strong></div></div><p id="siPartialExplanation" class="si-partial-explanation" hidden></p><p id="siPrintMessage" class="si-print-message" role="status" aria-live="polite"></p><div class="modal-buttons si-success-actions"><button id="siSuccessDone" type="button" class="klbs-primary-btn">DONE</button></div></section></div>`);
        unresolvedDrawer = window.KLBSDrawer.create({
            root: el("siUnresolvedOverlay"), panel: el("siUnresolvedDrawer"),
            labelledBy: "siUnresolvedTitle", exitButtons: [el("siUnresolvedExit")],
            initialFocus: () => el("siUnresolvedExit"), closeOnOverlay: true,
            restoreFocus: () => el("siScanner"),
            onClosing: () => { selectedUnresolvedLineIds.clear(); clearUnresolvedRetryAlert(); },
            onExit: closeUnresolvedDrawer, onEscape: () => { closeUnresolvedDrawer(); return true; }
        });
        escHandler = event => {
            if (event.key !== "Escape" || !active || authInProgress) return;
            if (!el("siArchiveOverlay")?.hidden) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); closeArchiveConfirmation(); return; }
            if (!el("siSuccessOverlay")?.hidden) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); if (!printInProgress) finishPostingSuccess(); return; }
            if (el("siVvpQuantityDialog")?.style.display === "flex") return;
            if (!el("siDuplicateOverlay")?.hidden) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); closeDuplicateModal(); return; }
            event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
            if(pageMode === "home") leavePage(); else returnToHome();
        };
        document.addEventListener("keydown", escHandler, true);
        el("siDuplicateOverlay").addEventListener("click", event => { if(event.target===el("siDuplicateOverlay")) closeDuplicateModal(); });
        el("siDuplicateOverlay").addEventListener("keydown", event => { if(event.key==="Escape"){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();closeDuplicateModal();} });
        el("siExport").onclick = () => exportUnknown(unresolvedMovementId || documentData?.document.id);
        el("siArchiveCancel").onclick = closeArchiveConfirmation;
        el("siArchiveOverlay").addEventListener("click", event => { if(event.target===el("siArchiveOverlay")) closeArchiveConfirmation(); });
        el("siArchiveOverlay").addEventListener("keydown", event => { if(event.key==="Escape"){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();closeArchiveConfirmation();} });
        el("siArchiveConfirm").onclick = confirmArchiveCancelled;
        el("siSuccessDone").onclick = finishPostingSuccess;
        el("siHistoricalPrint").onclick = () => printHistoricalReceipt(documentData?.document.id);
        await showResumeList();
    }
    async function showResumeList({ focusTarget = "settingsPageBackBtn" } = {}) {
        pageMode = "home";
        selectedUnresolvedLineIds.clear();
        clearUnresolvedRetryAlert();
        readOnly = false; documentData = null; reviewOpen = false;
        clearTimeout(messageTimeout);
        el("siPageMessage").textContent="";el("siMessage").textContent="";
        const request = ++historyRequestSequence;
        const [drafts, historyResult] = await Promise.all([api().stockInwardListDrafts(),api().stockInwardHistory({page:historyPage,pageSize:HISTORY_PAGE_SIZE,keyword:historyKeyword})]);
        if (!active || request !== historyRequestSequence) return;
        const draftSummaries = await Promise.all(drafts.map(async row => {
            try {
                const detail = await api().stockInwardLoad(row.id);
                return Number(detail?.document?.id) === Number(row.id) ? detail.summary : null;
            } catch (_error) { return null; }
        }));
        if (!active || request !== historyRequestSequence) return;
        const draftsWithSummaries = drafts.map((row, index) => ({ ...row, unresolved_units: draftSummaries[index]?.unresolvedUnits }));
        const history = historyResult?.rows || [];
        historyPage = Number(historyResult?.page) || 1;
        historyPageSize = Number(historyResult?.pageSize) || HISTORY_PAGE_SIZE;
        historyTotalPages = Number(historyResult?.totalPages) || 1;
        historyTotalCount = Number(historyResult?.totalCount) || 0;
        const resume=el("stockInwardResume"),workspace=el("stockInwardWorkspace");
        el("siPageTitle").textContent="STOCK INWARD";
        el("siReadOnlyBanner").hidden = true;
        el("siActions").hidden = true;
        workspace.hidden=true;resume.hidden=false;
        const draftCard = row => `<article class="si-current-card"><div class="si-open-group"><div class="si-open-field si-open-number"><small>STOCK INWARD</small><strong>${escapeHtml(row.movement_no)}</strong></div><div class="si-open-field"><small>DATE</small><span>${escapeHtml(formatBusinessDate(row.business_date))}</span></div></div><div class="si-open-group"><div class="si-open-field si-open-supplier"><small>SUPPLIER</small><span>${escapeHtml(row.supplier_name || "No Supplier")}</span></div><div class="si-open-field si-open-invoice"><small>INVOICE</small><span>${escapeHtml(row.invoice_no || "—")}</span></div></div><div class="si-open-group si-open-quantities"><div class="si-open-field si-open-count"><small>RECEIVED</small><span>${Number(row.units)||0}</span></div><div class="si-open-field si-open-count si-posted-count"><small>POSTED</small><span>${Number(row.posted_units)||0}</span></div><div class="si-open-field si-open-count si-unresolved-count"><small>UNRESOLVED</small><span>${Number.isFinite(Number(row.unresolved_units))?Number(row.unresolved_units):"—"}</span></div></div><div class="si-open-field si-open-status"><small>STATUS</small><span class="si-status-badge ${escapeHtml(row.status.toLowerCase())}">${escapeHtml(row.status.replaceAll("_"," "))}</span></div><div class="si-card-actions">${Number(row.posted_units)>0?`<button type="button" class="klbs-cancel-btn si-open-reprint" data-reprint="${Number(row.id)}">🖨 REPRINT RECEIPT</button>`:""}<button type="button" class="klbs-primary-btn" data-id="${row.id}">RESUME</button>${["DRAFT","PENDING_MASTER"].includes(row.status)?`<button type="button" class="klbs-cancel-btn si-delete-btn" data-delete-draft="${row.id}">DELETE</button>`:""}</div><small class="si-open-updated">Updated ${escapeHtml(formatUpdated(row.updated_at))}</small></article>`;
        const historyRows = history.map(row => `<tr>
          <td><span class="si-status-badge ${escapeHtml(String(row.status).toLowerCase())}">${escapeHtml(String(row.status).replaceAll("_"," "))}</span></td>
          <td class="si-history-number">${escapeHtml(row.movement_no)}</td>
          <td>${escapeHtml(formatBusinessDate(row.business_date))}</td>
          <td>${escapeHtml(row.supplier_name || "No Supplier")}<small>${escapeHtml(row.supplier_code_snapshot || "")}</small></td>
          <td>${escapeHtml(row.invoice_no || "—")}</td>
          <td class="si-history-posted-units">${Number(row.posted_units)||0}</td>
          <td class="si-history-actions"><button type="button" class="view-btn" data-history="${Number(row.id)}">👁 View</button>${row.status === "CANCELLED"?`<button type="button" class="klbs-cancel-btn si-archive-btn" data-archive="${Number(row.id)}">REMOVE</button>`:""}</td>
          <td class="si-history-actions">${Number(row.posted_units)>0?`<button type="button" class="print-btn" data-reprint="${Number(row.id)}">🖨 Reprint</button>`:"—"}</td>
        </tr>`).join("");
        const historyEmpty = history.length ? "" : `<tr><td class="si-history-empty" colspan="8">${historyKeyword ? "No matching Stock Inwards found." : "No Stock Inward history found."}</td></tr>`;
        const rangeFirst = historyTotalCount ? ((historyPage-1)*historyPageSize)+1 : 0;
        const rangeLast = Math.min(historyPage*historyPageSize,historyTotalCount);
        resume.innerHTML=`<button type="button" id="siNewDraft" class="klbs-primary-btn si-new-btn">+ NEW STOCK INWARD</button>${draftsWithSummaries.length?`<section class="si-current-draft"><h2>OPEN STOCK INWARDS</h2>${draftsWithSummaries.map(draftCard).join("")}</section>`:""}<section class="si-recent-history"><h2>RECENT STOCK INWARDS</h2><label class="si-history-search-label" for="siHistorySearch">Search Stock Inward history</label><input id="siHistorySearch" class="si-history-search" type="search" placeholder="Search Stock Inward / Supplier / Invoice..." value="${escapeHtml(historyKeyword)}"><div class="table-container si-history-table-wrap"><table class="si-history-table"><thead><tr><th>STATUS</th><th>STOCK INWARD NO</th><th>DATE</th><th>SUPPLIER</th><th>INVOICE NO</th><th>POSTED UNITS</th><th>VIEW</th><th>PRINT</th></tr></thead><tbody>${historyRows || historyEmpty}</tbody></table></div><div id="siHistoryPagination" class="history-pagination" ${historyTotalCount ? "" : "hidden"}><div class="pagination-controls"><button type="button" id="siHistoryPrevious" class="pagination-nav-btn" ${historyPage<=1?"disabled":""}>Previous</button><span id="siHistoryPageLabel">Page ${historyPage.toLocaleString("en-US")} of ${historyTotalPages.toLocaleString("en-US")}</span><label for="siHistoryPageJump">Jump to page:</label><input id="siHistoryPageJump" type="number" min="1" step="1" inputmode="numeric" value="${historyPage}" max="${historyTotalPages}" aria-label="Jump to Stock Inward history page"><button type="button" id="siHistoryNext" class="pagination-nav-btn" ${historyPage>=historyTotalPages?"disabled":""}>Next</button></div><span id="siHistoryRangeLabel">Showing ${rangeFirst.toLocaleString("en-US")}–${rangeLast.toLocaleString("en-US")} of ${historyTotalCount.toLocaleString("en-US")} Stock Inwards</span></div></section>`;
        resume.querySelectorAll("[data-id]").forEach(button=>button.onclick=()=>openDraft(Number(button.dataset.id)));
        resume.querySelectorAll("[data-delete-draft]").forEach(button=>button.onclick=()=>deleteDraft(Number(button.dataset.deleteDraft)));
        resume.querySelectorAll("[data-history]").forEach(button=>button.onclick=()=>openDraft(Number(button.dataset.history),{historical:true}));
        resume.querySelectorAll("[data-archive]").forEach(button=>button.onclick=()=>archiveCancelled(Number(button.dataset.archive)));
        resume.querySelectorAll("[data-reprint]").forEach(button=>button.onclick=()=>printHistoricalReceipt(Number(button.dataset.reprint)));
        el("siNewDraft").onclick=()=>createDraft();
        const searchInput=el("siHistorySearch");
        searchInput.oninput=()=>{historyKeyword=searchInput.value;historyPage=1;clearTimeout(historySearchTimer);historySearchTimer=setTimeout(()=>showResumeList({focusTarget:"siHistorySearch"}),180);};
        searchInput.onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();clearTimeout(historySearchTimer);historyKeyword=searchInput.value;historyPage=1;showResumeList({focusTarget:"siHistorySearch"});}};
        el("siHistoryPrevious").onclick=()=>goToHistoryPage(historyPage-1);
        el("siHistoryNext").onclick=()=>goToHistoryPage(historyPage+1);
        el("siHistoryPageJump").onchange=()=>{const raw=el("siHistoryPageJump").value.trim();if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>historyTotalPages){el("siHistoryPageJump").value=String(historyPage);return;}goToHistoryPage(Number(raw));};
        el(focusTarget)?.focus();
    }
    let historyPageSize = HISTORY_PAGE_SIZE;
    async function goToHistoryPage(page) {
        historyPage=Math.min(Math.max(Number(page)||1,1),historyTotalPages);
        await showResumeList({focusTarget:"siHistoryPageJump"});
    }
    function formatUpdated(value) {
        if (!value) return "—";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-IN", { timeZone:"Asia/Kolkata", hour:"numeric", minute:"2-digit", day:"2-digit", month:"short" });
    }
    function formatBusinessDate(value) {
        const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return value || "—";
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${match[3]}-${months[Number(match[2])-1] || match[2]}-${match[1]}`;
    }
    async function createDraft() {
        try {
            const result = await api().stockInwardCreate({});
            await openDraft(result.movementId,{isNew:true});
        } catch (error) { showMessage(error.message, true); await showResumeList(); }
    }
    async function openDraft(id, options = {}) {
        try {
            if (typeof options === "boolean") options = {historical:options};
            const historical = Boolean(options.historical);
            if (Number(documentData?.document?.id) !== Number(id)) {
                selectedUnresolvedLineIds.clear();
                clearUnresolvedRetryAlert();
            }
            documentData = await api().stockInwardLoad(id);
            contextSaved = true; duplicateClear = true; dismissedDuplicateInvoice = null; duplicateDialogInvoice = null; currentMasterResults = [];
            reviewOpen = false;
            pageMode = historical ? "view" : "active";
            activeIsNew = Boolean(options.isNew);
            readOnly = historical || ["COMPLETE","CANCELLED"].includes(documentData.document.status);
            const [suppliers] = await Promise.all([api().stockInwardSuppliers()]);
            if (!active) return;
            el("stockInwardResume").hidden = true;
            el("stockInwardWorkspace").hidden = false;
            el("siActions").hidden = readOnly;
            el("siPageTitle").textContent = activeIsNew ? "NEW STOCK INWARD" : readOnly ? "STOCK INWARD DETAILS" : "EDIT STOCK INWARD";
            el("siReview").hidden = true;
            el("siMessage").textContent = "";
            el("siSupplier").innerHTML = `<option value="">No Supplier</option>${suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)} · ${escapeHtml(s.supplier_code)}${s.status === "INACTIVE" ? " · INACTIVE" : ""}</option>`).join("")}`;
            el("siSupplier").value = documentData.document.supplier_id || "";
            el("siInvoiceNumber").value = documentData.document.invoice_number_snapshot || documentData.document.invoice_no || "";
            el("siInvoiceDate").value = documentData.document.invoice_date || "";
            el("siInvoiceQty").value = documentData.document.invoice_total_quantity ?? "";
            el("siRemarks").value = documentData.document.reference_text || "";
            el("siBusinessDate").textContent = formatBusinessDate(documentData.document.business_date);
            el("siCode").textContent = documentData.document.movement_no;
            el("siSupplier").onchange = async () => { dismissedDuplicateInvoice=null; contextSaved=false; await populateInvoices(); await saveContext(); };
            el("siInvoice").onchange = () => {
                const option=el("siInvoice").selectedOptions[0];
                if(option?.dataset.invoiceNumber && !el("siInvoiceNumber").value.trim()) el("siInvoiceNumber").value=option.dataset.invoiceNumber;
                dismissedDuplicateInvoice=null; contextSaved=false; saveContext();
            };
            ["siInvoiceNumber","siInvoiceDate","siInvoiceQty","siRemarks"].forEach(id => {
                el(id).oninput = () => { contextSaved=false; updateScannerGate(); if(id === "siInvoiceNumber") { dismissedDuplicateInvoice=null; checkDuplicateInvoice(); } clearTimeout(contextSaveTimer); contextSaveTimer=setTimeout(saveContext,250); };
                el(id).onchange = saveContext;
            });
            el("siInvoiceQty").addEventListener("input", updateLiveReconciliation);
            el("siScanner").onkeydown = event => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const scanner = el("siScanner");
                const scannedBarcode = scanner.value;
                if (/[\u0000-\u001F\u007F-\u009F]/.test(scannedBarcode)) {
                    showMessage("Barcode contains unsupported control characters.", true);
                    scanner.focus();
                    scanner.select();
                    return;
                }
                const barcode = scannedBarcode.trim();
                if (!barcode) { showMessage("Scan a product barcode.", "warning"); return; }
                el("siScanner").value = "";
                scanQueue = scanQueue.then(() => scanBarcode(barcode)).catch(error => showMessage(error.message, true));
            };
            el("siDeleteDraft").onclick = () => deleteDraft();
            el("siDownloadInvoiceTemplate").onclick = async () => { try { const result=await api().stockInwardDownloadInvoiceTemplate(); if(!result?.canceled) el("siInvoiceImportStatus").textContent="Stock Inward template saved."; } catch(error) { showMessage(error.message || "Could not save the template.",true); } };
            el("siImportInvoice").onclick = async () => {
                try {
                    if (!await saveContext()) throw new Error("Save the supplier and invoice details before uploading the invoice file.");
                    const result=await api().stockInwardImportInvoiceWorkbook({movementId:documentData.document.id});
                    if(result?.canceled)return;
                    documentData=result; contextSaved=true;
                    el("siInvoiceQty").value=result.document.invoice_total_quantity ?? "";
                    const matched=result.summary.invoiceMatchedBarcodes||0, unresolved=result.summary.invoiceUnresolvedBarcodes||0;
                    el("siInvoiceImportStatus").textContent=`Converted ${result.importedRowCount} rows from ${result.sourceName || "supplier file"}: ${matched} barcode${matched===1?"":"s"} matched KLBS Product Master${unresolved?`, ${unresolved} not yet in Product Master`:""}. Invoice quantities are expected only; physically scan every received piece. Upload does not add stock.`;
                    render();
                } catch(error) { showMessage(error.message || "Could not import the invoice workbook.",true); }
            };
            el("siUnresolved").onclick = openUnresolvedDrawer;
            el("siHistoricalUnresolved").onclick = event => openUnresolvedDrawer(event.currentTarget,documentData.document.id);
            el("siPost").onclick = handlePrimaryAction;
            await populateInvoices();
            render();
            el("siReadOnlyBanner").hidden = !readOnly;
            if(readOnly)el("settingsPageBackBtn").focus();else el("siScanner").focus();
        } catch (error) { showMessage(error.message, true); }
    }
    async function populateInvoices() {
        const supplierId = el("siSupplier").value;
        const select = el("siInvoice");
        select.disabled = true;
        select.innerHTML = supplierId ? `<option value="">No open KLBS invoices</option>` : `<option value="">Select Supplier first</option>`;
        select.dataset.hasInvoices = "false";
        if (!supplierId) return;
        const invoices = await api().stockInwardInvoices(Number(supplierId));
        if (invoices.length) {
            select.innerHTML = `<option value="">No linked invoice</option>`;
            invoices.forEach(invoice => select.insertAdjacentHTML("beforeend", `<option value="${invoice.id}" data-invoice-number="${escapeHtml(invoice.supplier_invoice_number)}">${escapeHtml(invoice.invoice_code)} · ${escapeHtml(invoice.supplier_invoice_number)}</option>`));
            select.dataset.hasInvoices = "true";
            select.disabled = readOnly;
        }
        if (documentData?.document.supplier_invoice_id) select.value = documentData.document.supplier_invoice_id;
    }
    async function saveContext() {
        if (!documentData) return;
        if (!el("siDuplicateOverlay")?.hidden) return false;
        try {
            const context = { movementId:documentData.document.id,supplierId:el("siSupplier").value || null,supplierInvoiceId:el("siInvoice").value || null,invoiceNumber:el("siInvoiceNumber").value,invoiceDate:el("siInvoiceDate").value,invoiceTotalQuantity:el("siInvoiceQty").value,reference:el("siRemarks").value };
            if(isDismissedDuplicate(context.supplierId,context.invoiceNumber)) { duplicateClear=false; updateScannerGate(); return false; }
            const request=++duplicateCheckSequence;
            if(context.supplierId && context.invoiceNumber.trim()) {
                duplicateClear=false; updateScannerGate();
                const duplicate = await api().stockInwardFindDuplicateInvoice({supplierId:Number(context.supplierId),invoiceNumber:context.invoiceNumber,excludeMovementId:context.movementId});
                if(request!==duplicateCheckSequence)return false;
                if(duplicate.duplicate) { duplicateClear=false; openDuplicateModal(duplicate); updateScannerGate(); return false; }
            }
            duplicateClear=true;
            documentData = await api().stockInwardUpdateContext(context);
            if(request!==duplicateCheckSequence)return false;
            if(documentData.invoiceDuplicate) { duplicateClear=false; openDuplicateModal(documentData.invoiceDuplicate); }
            else contextSaved=true;
            render();
            if(documentData.invoiceDuplicate) return false;
            if (documentData.splitDeliveryWarning) showMessage("THIS SUPPLIER INVOICE IS ALREADY LINKED TO ANOTHER STOCK INWARD. THIS MAY BE A SPLIT DELIVERY.", "warning");
            return true;
        } catch (error) { showMessage(error.message, true); return false; }
    }
    async function checkDuplicateInvoice() {
        const request=++duplicateCheckSequence;
        if(!documentData || !el("siSupplier").value || !el("siInvoiceNumber").value.trim()) { duplicateClear=true; updateScannerGate(); return; }
        if(isDismissedDuplicate(el("siSupplier").value,el("siInvoiceNumber").value)) { duplicateClear=false; updateScannerGate(); return; }
        duplicateClear=false; updateScannerGate();
        try {
            const duplicate=await api().stockInwardFindDuplicateInvoice({supplierId:Number(el("siSupplier").value),invoiceNumber:el("siInvoiceNumber").value,excludeMovementId:documentData.document.id});
            if(request!==duplicateCheckSequence)return;
            duplicateClear=!duplicate.duplicate;
            if(duplicate.duplicate) openDuplicateModal(duplicate);
        } catch(error) { if(request===duplicateCheckSequence){duplicateClear=false;showMessage(error.message,true);} }
        updateScannerGate();
    }
    function openDuplicateModal(data) {
        const doc=data.document;
        if(!doc || !el("siDuplicateOverlay")?.hidden) return;
        clearTimeout(contextSaveTimer); contextSaveTimer=null;
        const summary=data.summary, activeDuplicate=doc.status === "DRAFT";
        duplicateDialog=data;
        duplicateDialogInvoice={
            supplierId:String(el("siSupplier")?.value || ""),
            invoiceNumber:String(el("siInvoiceNumber")?.value || "").trim(),
            persistedSupplierId:String(documentData?.document.supplier_id || ""),
            persistedSupplierInvoiceId:String(documentData?.document.supplier_invoice_id || ""),
            persistedInvoiceNumber:String(documentData?.document.invoice_number_snapshot || documentData?.document.invoice_no || "").trim()
        };
        el("siDuplicateTitle").textContent=activeDuplicate ? "INVOICE ALREADY IN PROGRESS" : "INVOICE ALREADY RECEIVED";
        const resumable=["DRAFT","PENDING_MASTER","PARTIALLY_POSTED"].includes(doc.status);
        const master=data.currentMasterSummary || {checked:0,nowFound:0,stillUnresolved:0};
        const masterPanel=summary.unresolvedBarcodes?`<p class="si-duplicate-state ${master.checked>0&&master.stillUnresolved===0?"success":"warning"}">${master.checked>0&&master.stillUnresolved===0?`✓ ALL ${master.nowFound} UNRESOLVED BARCODES NOW RESOLVABLE`:master.nowFound>0?`⚠ PARTIALLY RESOLVED IN PRODUCT MASTER · ${master.nowFound} NOW FOUND · ${master.stillUnresolved} STILL UNRESOLVED`:`⚠ ${master.stillUnresolved} BARCODE(S) STILL UNRESOLVED`}</p>`:"";
        const copy=doc.status === "COMPLETE"?`All ${summary.postedUnits} units were posted to inventory. This invoice cannot be received again.`:`${summary.postedUnits} of ${summary.scannedQty} scanned units were posted to inventory. ${summary.unresolvedUnits} physical units remain unresolved/unposted. Current Product Master matches do not post stock; resume the original Stock Inward to retry and review.`;
        const duplicateStatus=doc.status === "COMPLETE"?"FULLY RECEIVED":doc.status === "DRAFT"?"⚠ IN PROGRESS":master.nowFound>0&&master.stillUnresolved>0?"⚠ PARTIALLY RESOLVED IN PRODUCT MASTER":doc.status === "PARTIALLY_POSTED"?"⚠ PARTIALLY POSTED":"⚠ PENDING MASTER";
        el("siDuplicateBody").innerHTML=`<div class="si-duplicate-party"><strong>${escapeHtml(doc.supplier_name || "Supplier")}</strong><span>${escapeHtml(doc.invoice_number_snapshot || doc.invoice_no || "—")}</span></div><p class="si-duplicate-document">Stock Inward <strong>${escapeHtml(doc.movement_no)}</strong><span class="si-status-badge ${escapeHtml(doc.status.toLowerCase())}">${escapeHtml(doc.status.replaceAll("_"," "))}</span><span>${escapeHtml(formatBusinessDate(doc.business_date))}</span></p><div class="si-duplicate-metrics"><div><small>INVOICE QTY</small><strong>${doc.invoice_total_quantity ?? "—"}</strong></div><div><small>SCANNED</small><strong>${summary.scannedQty}</strong></div><div><small>POSTED</small><strong>${summary.postedUnits}</strong></div><div><small>UNRESOLVED</small><strong>${summary.unresolvedUnits}</strong></div></div><p class="si-duplicate-state ${doc.status === "COMPLETE"?"fully-received":"warning"}">${duplicateStatus}</p>${masterPanel}<p class="si-duplicate-copy">${copy}</p>${summary.unresolvedBarcodes?`<button id="siDuplicateUnresolved" class="klbs-cancel-btn" type="button">VIEW UNRESOLVED BARCODES</button>`:""}`;
        el("siDuplicateActions").innerHTML=`${resumable?`<button id="siDuplicateResume" class="klbs-primary-btn" type="button">${doc.status==="DRAFT"?"RESUME STOCK INWARD":"VIEW / RESUME STOCK INWARD"}</button>`:`<button id="siDuplicateView" class="klbs-primary-btn" type="button">VIEW STOCK INWARD</button>`}<button id="siDuplicateClose" class="klbs-cancel-btn" type="button">CLOSE</button>`;
        el("siDuplicateOverlay").hidden=false; el("siDuplicateOverlay").classList.add("si-dialog-visible");
        el("siDuplicateClose").onclick=closeDuplicateModal;
        el("siDuplicateResume")?.addEventListener("click",async()=>{closeDuplicateModal();await openDraft(doc.id);});
        el("siDuplicateView")?.addEventListener("click",async()=>{closeDuplicateModal();await openDraft(doc.id,{historical:true});});
        el("siDuplicateUnresolved")?.addEventListener("click",async()=>{closeDuplicateModal();await openDraft(doc.id);await openUnresolvedDrawer(el("siUnresolved"),doc.id);});
        el("siDuplicateClose")?.focus();
    }
    function isDismissedDuplicate(supplierId,invoiceNumber){return Boolean(dismissedDuplicateInvoice && String(supplierId || "")===dismissedDuplicateInvoice.supplierId && String(invoiceNumber || "").trim()===dismissedDuplicateInvoice.invoiceNumber);}
    function isDismissedPersistedDuplicate(supplierId,invoiceNumber){
        return Boolean(documentData && isDismissedDuplicate(supplierId,invoiceNumber) &&
            dismissedDuplicateInvoice.supplierId===String(documentData.document.supplier_id || "") &&
            dismissedDuplicateInvoice.invoiceNumber===String(documentData.document.invoice_number_snapshot || documentData.document.invoice_no || "").trim());
    }
    function closeDuplicateModal(){
        const rejected=duplicateDialogInvoice, invoiceInput=el("siInvoiceNumber"), invoiceSelect=el("siInvoice");
        const currentInvoice=String(invoiceInput?.value || "").trim();
        if(rejected?.invoiceNumber && currentInvoice===rejected.invoiceNumber) {
            const isPersistedPair=rejected.supplierId===rejected.persistedSupplierId && rejected.invoiceNumber===rejected.persistedInvoiceNumber;
            if(!isPersistedPair) {
                invoiceInput.value=rejected.persistedInvoiceNumber;
                const selectedInvoiceNumber=String(invoiceSelect?.selectedOptions?.[0]?.dataset.invoiceNumber || "").trim();
                if(String(invoiceSelect?.value || "")!==rejected.persistedSupplierInvoiceId && selectedInvoiceNumber===rejected.invoiceNumber) invoiceSelect.value=rejected.persistedSupplierInvoiceId;
                dismissedDuplicateInvoice=null;
                duplicateClear=true;
                contextSaved=false;
            } else {
                dismissedDuplicateInvoice={supplierId:rejected.supplierId,invoiceNumber:rejected.invoiceNumber};
            }
        }
        duplicateCheckSequence++;
        clearTimeout(contextSaveTimer); contextSaveTimer=null;
        el("siDuplicateOverlay").classList.remove("si-dialog-visible");el("siDuplicateOverlay").hidden=true;duplicateDialog=null;duplicateDialogInvoice=null;updateScannerGate();
        if(active)invoiceInput?.focus();
    }
    async function scanBarcode(barcode) {
        barcode = String(barcode ?? "").trim();
        if (!barcode) { showMessage("Scan a product barcode.", "warning"); return; }
        if (/[\u0000-\u001F\u007F-\u009F]/.test(barcode)) { showMessage("Barcode contains unsupported control characters.",true); el("siScanner")?.focus(); el("siScanner")?.select(); return; }
        if (!await saveContext() || !scannerHeaderIsValid() || !duplicateClear) { updateScannerGate(); showMessage("Complete receiving details before scanning.",true); return; }
        try {
            const resolution = await api().stockInwardResolveBarcode(barcode);
            let quantity = 1;
            if (resolution.resolution === "UNIQUE" && Number(resolution.product?.variable_value) === 1) {
                quantity = await captureVvpQuantity(resolution.product, barcode);
            }
            if (quantity == null) showMessage("Variable Value quantity entry cancelled.", "warning");
            else {
                documentData = await api().stockInwardScan({ movementId:documentData.document.id,barcode,quantity });
                const allocatedMrps = Array.isArray(documentData.lastMrpAllocations) ? documentData.lastMrpAllocations : [];
                const scannedLine = documentData.lines.find(line => line.barcode === barcode && !line.discarded_at);
                const hasInvoiceRow = (documentData.summary.invoiceLines || []).some(row => row.barcode === barcode && Number(row.expected_quantity) > 0);
                if (documentData.lastResolution === "NOT_ON_INVOICE") showMessage("This barcode is not on the uploaded invoice. It is retained as unresolved.", "warning");
                else if (documentData.lastResolution === "AMBIGUOUS") showMessage("Barcode matches more than one Product. It is retained for review.", "warning");
                else if (documentData.lastResolution === "NOT_FOUND") showMessage("Product not found. Barcode retained as unresolved.", "warning");
                else if (scannedLine?.product_state === "READY" && hasInvoiceRow && !allocatedMrps.length) showMessage(`Scanned quantity for ${barcode} exceeds the remaining invoice quantity. Review the invoice and received count before posting.`, "warning");
                else if (allocatedMrps.length) showMessage(`Scanned. Invoice MRP assigned: ${allocatedMrps.map(row => `₹${(Number(row.mrpPaise)/100).toFixed(2)} × ${row.quantity}`).join(", ")}.`);
                else showMessage("Product added to Stock Inward.");
                render();
            }
        } catch (error) { showMessage(error.message, true); }
        if (active) el("siScanner")?.focus();
    }
    function captureVvpQuantity(product, barcode) {
        const dialog = el("siVvpQuantityDialog"), input = el("siVvpQuantityInput"), error = el("siVvpQuantityError");
        el("siVvpProductName").textContent = product.product_name || "Product";
        el("siVvpProductIdentity").textContent = `${product.sku || "SKU unavailable"} · ${product.barcode || barcode}${Number(product.active) === 0 ? " · PRODUCT IS INACTIVE" : ""}`;
        input.value = "1"; error.textContent = ""; dialog.style.display = "flex";
        return new Promise(resolve => {
            let settled = false;
            const cancelButton = el("siVvpQuantityCancel"), addButton = el("siVvpQuantityAdd");
            const finish = value => {
                if (settled) return;
                settled = true; dialog.style.display = "none";
                cancelButton.removeEventListener("click", cancel); addButton.removeEventListener("click", confirm);
                dialog.removeEventListener("click", backdropClick); dialog.removeEventListener("keydown", keydown);
                resolve(value);
            };
            const cancel = () => finish(null);
            const confirm = () => {
                const raw = input.value.trim();
                const quantity = Number(raw);
                if (!/^\d+$/.test(raw) || !Number.isSafeInteger(quantity) || quantity <= 0) {
                    error.textContent = "Enter a positive whole-number quantity."; input.focus(); input.select(); return;
                }
                finish(quantity);
            };
            const backdropClick = event => { if (event.target === dialog) cancel(); };
            const keydown = event => {
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); cancel(); return; }
                if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); confirm(); return; }
                if (event.key === "Tab") {
                    const items = [input, cancelButton, addButton];
                    const first = items[0], last = items[items.length - 1];
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                }
            };
            cancelButton.addEventListener("click", cancel); addButton.addEventListener("click", confirm);
            dialog.addEventListener("click", backdropClick); dialog.addEventListener("keydown", keydown);
            requestAnimationFrame(() => { input.focus(); input.select(); });
        });
    }
    function renderUnresolvedRows(rows, options = {}) {
        const historical = Boolean(options.historical);
        const readOnlyRows = Boolean(options.readOnly);
        const movementId = Number(options.movementId || documentData?.document?.id);
        const masters = options.masters || new Map();
        const selectable = !historical && !readOnlyRows;
        const eligibleRows = selectable
            ? rows.filter(line => line.product_state === "PENDING_MASTER" && line.posting_state === "UNPOSTED" && !line.discarded_at)
            : [];
        const eligibleIds = new Set(eligibleRows.map(line => Number(line.id)));
        for (const id of selectedUnresolvedLineIds) if (!eligibleIds.has(id)) selectedUnresolvedLineIds.delete(id);
        const selectedRows = eligibleRows.filter(line => selectedUnresolvedLineIds.has(Number(line.id)));
        const selectedUnits = selectedRows.reduce((total, line) => total + (Number(line.scanned_quantity) || 0), 0);
        const retryableRows = selectable ? rows.filter(line => line.product_state === "PENDING_MASTER" && !line.discarded_at) : [];
        const busy = unresolvedRetryInProgress || unresolvedBulkRemoveInProgress;
        const toolbar = selectable ? `<div class="si-unresolved-toolbar">
            <div class="si-selection-controls">
                <input id="siUnresolvedSelectAll" class="si-selection-checkbox" type="checkbox" aria-label="Select all eligible unresolved barcode entries" ${eligibleRows.length > 0 && selectedRows.length === eligibleRows.length ? "checked" : ""} ${!eligibleRows.length || busy ? "disabled" : ""}>
                <details class="si-selection-menu">
                    <summary aria-label="Selection options">▼</summary>
                    <div class="si-selection-menu-options">
                        <button type="button" data-selection-action="all" ${busy ? "disabled" : ""}>Select All</button>
                        <button type="button" data-selection-action="none" ${busy ? "disabled" : ""}>Select None</button>
                        <button type="button" data-selection-action="invert" ${busy ? "disabled" : ""}>Invert Selection</button>
                    </div>
                </details>
            </div>
            <span class="si-selection-summary" aria-live="polite">${selectedRows.length ? `${selectedRows.length} Selected · ${selectedUnits} Units` : ""}</span>
            <div class="si-unresolved-toolbar-actions">
                ${selectedRows.length ? `<button type="button" class="klbs-cancel-btn si-remove-selected" ${busy ? "disabled" : ""}>REMOVE SELECTED</button>` : ""}
                <button type="button" class="klbs-primary-btn si-retry-all" ${!retryableRows.length || busy ? "disabled" : ""}>RETRY ALL</button>
            </div>
        </div>` : "";
        const selectColumn = selectable ? `<span role="columnheader" aria-label="Select"></span>` : "";
        const barcodeHeader = historical ? "BARCODE" : "BARCODE";
        const actionHeader = historical ? "PRODUCT MASTER NOW" : "ACTIONS";
        const table = rows.length ? `<div class="si-unresolved-table ${historical ? "is-historical" : ""}" role="table" aria-label="Unresolved barcode lines">
            <div class="si-unresolved-row si-unresolved-heading ${selectable ? "has-select-checkbox" : ""} ${historical ? "is-historical" : ""}" role="row">${selectColumn}<span role="columnheader">${barcodeHeader}</span><span role="columnheader">QTY</span><span role="columnheader">${historical ? "ORIGINAL STATUS" : "STATUS"}</span><span role="columnheader">${actionHeader}</span></div>
            ${rows.map(line => {
                const lineId = Number(line.id);
                const isEligible = eligibleIds.has(lineId);
                const checkbox = selectable
                    ? `<span class="si-unresolved-select-cell" role="cell">${isEligible ? `<input class="si-selection-checkbox si-line-selection" type="checkbox" data-line-select="${lineId}" aria-label="Select unresolved barcode ${escapeHtml(line.barcode)}" ${selectedUnresolvedLineIds.has(lineId) ? "checked" : ""} ${busy ? "disabled" : ""}>` : "—"}</span>`
                    : "";
                const status = line.discarded_at ? "DISCARDED" : escapeHtml(line.resolution_note || "PRODUCT NOT FOUND");
                const master = masters.get(lineId);
                const detail = historical
                    ? (() => {
                        const master = masters.get(lineId);
                        const state = master?.currentResolution;
                        const stateText = state === "UNIQUE"
                            ? `✓ NOW FOUND · ${[master.currentProduct?.sku,master.currentProduct?.product_name,master.currentProduct?.colour,master.currentProduct?.size].filter(Boolean).map(escapeHtml).join(" · ")}`
                            : state === "AMBIGUOUS" ? "⚠ AMBIGUOUS" : "✕ STILL NOT FOUND";
                        return `<span class="si-master-state ${state === "UNIQUE" ? "found" : state === "AMBIGUOUS" ? "ambiguous" : "missing"}">${stateText}</span>`;
                    })()
                    : `<div class="si-unresolved-actions" role="cell">${line.discarded_at || readOnlyRows ? "—" : `${master?.currentResolution === "NOT_FOUND" && master?.hasInvoiceLine ? `<button class="klbs-cancel-btn si-product-capture-open" data-capture-product="${lineId}" ${busy ? "disabled" : ""}>${master.missingProductFields?.length ? "COMPLETE PRODUCT" : "CREATE PRODUCT"}</button>` : ""}<button class="si-remove-btn" data-remove="${lineId}" ${busy ? "disabled" : ""}>REMOVE</button>`}</div>`;
                return `<div class="si-unresolved-row ${selectable ? "has-select-checkbox" : ""} ${historical ? "is-historical" : ""} ${line.discarded_at ? "si-discarded" : ""}" role="row">${checkbox}<strong class="si-unresolved-barcode" role="cell">${escapeHtml(line.barcode)}</strong><strong class="si-unresolved-qty" role="cell">${line.scanned_quantity}</strong><span class="si-unresolved-status" role="cell">${status}</span>${detail}</div>`;
            }).join("")}
        </div>` : `<p class="si-empty si-unresolved-empty">NO UNRESOLVED BARCODES</p>`;
        el("siUnknownLines").innerHTML = toolbar + table;

        const refresh = () => renderUnresolvedRows(rows, options);
        const selectAll = el("siUnresolvedSelectAll");
        if (selectAll) {
            selectAll.indeterminate = selectedRows.length > 0 && selectedRows.length < eligibleRows.length;
            selectAll.onchange = () => {
                if (selectAll.checked) eligibleRows.forEach(line => selectedUnresolvedLineIds.add(Number(line.id)));
                else eligibleRows.forEach(line => selectedUnresolvedLineIds.delete(Number(line.id)));
                refresh();
            };
        }
        el("siUnknownLines").querySelectorAll("[data-selection-action]").forEach(button => {
            button.onclick = () => {
                if (button.dataset.selectionAction === "all") eligibleRows.forEach(line => selectedUnresolvedLineIds.add(Number(line.id)));
                else if (button.dataset.selectionAction === "none") eligibleRows.forEach(line => selectedUnresolvedLineIds.delete(Number(line.id)));
                else if (button.dataset.selectionAction === "invert") eligibleRows.forEach(line => {
                    const id = Number(line.id);
                    if (selectedUnresolvedLineIds.has(id)) selectedUnresolvedLineIds.delete(id);
                    else selectedUnresolvedLineIds.add(id);
                });
                refresh();
            };
        });
        el("siUnknownLines").querySelectorAll("[data-line-select]").forEach(checkbox => {
            checkbox.onchange = () => {
                const id = Number(checkbox.dataset.lineSelect);
                if (checkbox.checked) selectedUnresolvedLineIds.add(id);
                else selectedUnresolvedLineIds.delete(id);
                refresh();
            };
        });
        el("siUnknownLines").querySelector(".si-remove-selected")?.addEventListener("click", () => bulkRemoveSelected(eligibleRows, movementId));
        el("siUnknownLines").querySelector(".si-retry-all")?.addEventListener("click", () => retryAllUnresolved(movementId));
        el("siUnknownLines").querySelectorAll("[data-capture-product]").forEach(button => button.onclick = () => openInvoiceProductCapture(Number(button.dataset.captureProduct), masters.get(Number(button.dataset.captureProduct))));
    }
    function openInvoiceProductCapture(lineId, master) {
        if (!master?.hasInvoiceLine || master.currentResolution !== "NOT_FOUND") return;
        const draft = master.productDraft || {};
        const rupees = paise => Number.isSafeInteger(Number(paise)) ? (Number(paise) / 100).toFixed(2) : "";
        const field = (key,label,value,required=false,type="text",readOnly=false) => `<label>${label}${required?" *":""}<input name="${key}" type="${type}" value="${escapeHtml(value ?? "")}" ${required?"required":""} ${readOnly?"readonly":""} ${type==="number"?"step=\"0.01\" min=\"0\"":""}></label>`;
        const select = (key,label,value,choices,required=false) => `<label>${label}${required?" *":""}<select name="${key}" ${required?"required":""}><option value="">Select ${label}</option>${choices.map(([v,t])=>`<option value="${escapeHtml(v)}" ${String(value||"")===v?"selected":""}>${escapeHtml(t)}</option>`).join("")}</select></label>`;
        const host = el("siProductCapture");
        host.hidden = false;
        host.innerHTML = `<form id="siProductCaptureForm" class="si-product-capture-form"><header><strong>PRODUCT DETAILS · ${escapeHtml(master.barcode)}</strong><button type="button" class="si-product-capture-close" aria-label="Close">×</button></header><p>KLBS will create a new SKU from this uploaded invoice. Invoice MRP and rate are locked. SKU and opening stock are assigned by KLBS; stock is added only when this inward is posted.</p><div class="si-product-capture-grid">${field("brand","Brand",draft.brand,true)}${field("productName","Product Name",draft.productName,true)}${field("category","Category",draft.category,true)}${select("businessSegment","Business Segment",draft.businessSegment,[["KL","Kaira Luxe"],["MENS","Mens Wear"],["KIDS","Kids Wear"]],true)}${select("segment","Segment",draft.segment||"Women",[["Women","Women"],["Men","Men"],["Kids","Kids"]],true)}${field("gstRate","GST Rate %",draft.gstRate,true,"number")}${field("season","Season",draft.season)}${field("collection","Collection",draft.collection)}${field("styleCode","Style Code",draft.styleCode)}${field("size","Size",draft.size)}${field("colour","Colour",draft.colour)}${field("mrpPaise","Printed MRP ₹",rupees(draft.mrpPaise),true,"number",true)}${field("sellingPricePaise","Selling Price ₹",rupees(draft.sellingPricePaise),false,"number",true)}${field("discount","Discount %",draft.discount)}${field("unitCostPaise","Invoice Rate / Piece ₹",rupees(draft.unitCostPaise),true,"number",true)}${field("hsnCode","HSN Code",draft.hsnCode)}${field("reorderLevel","Reorder Level",draft.reorderLevel,false,"number")}</div><div class="si-product-capture-actions"><button type="button" class="klbs-cancel-btn si-product-capture-close">CANCEL</button><button type="submit" class="klbs-primary-btn">AUTHORIZE &amp; CREATE SKU</button></div><div class="si-product-capture-error" role="status" aria-live="polite"></div></form>`;
        host.querySelectorAll(".si-product-capture-close").forEach(button=>button.onclick=()=>{host.hidden=true;host.replaceChildren();});
        host.querySelector("#siProductCaptureForm").onsubmit = async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = Object.fromEntries(new FormData(form).entries());
            const toPaise = value => Math.round(Number(value || 0) * 100);
            const product = { ...data, mrpPaise:toPaise(data.mrpPaise), sellingPricePaise:data.sellingPricePaise===""?null:toPaise(data.sellingPricePaise), unitCostPaise:toPaise(data.unitCostPaise), gstRate:Number(data.gstRate), discount:data.discount===""?0:Number(data.discount), reorderLevel:data.reorderLevel===""?0:Number(data.reorderLevel) };
            const error = host.querySelector(".si-product-capture-error");
            try {
                const grant = await requestAdminAuthorization("PRODUCT_IMPORT");
                if (!grant) return;
                const result = await api().stockInwardCreateProductFromInvoice({ movementId:unresolvedMovementId,lineId,product,authorizationGrant:grant });
                if (result.productCapture?.missing?.length) { error.textContent=`Complete required details: ${result.productCapture.missing.join(", ")}.`; return; }
                documentData = result;
                host.hidden = true; host.replaceChildren();
                render();
                await openUnresolvedDrawer(el("siUnresolved"), unresolvedMovementId);
                showMessage(`Product created${result.productCapture?.sku ? ` as ${result.productCapture.sku}` : ""}. Review MRP / rate and continue posting.`);
            } catch (failure) { error.textContent=failure.message || "Product could not be created."; }
        };
        host.scrollIntoView({behavior:"smooth",block:"center"});
        host.querySelector("input,select")?.focus();
    }

    async function bulkRemoveSelected(eligibleRows, movementId) {
        if (unresolvedRetryInProgress || unresolvedBulkRemoveInProgress) return;
        const selectedRows = eligibleRows.filter(line => selectedUnresolvedLineIds.has(Number(line.id)));
        if (!selectedRows.length) return;
        const lineIds = selectedRows.map(line => Number(line.id));
        const unitCount = selectedRows.reduce((sum, line) => sum + (Number(line.scanned_quantity) || 0), 0);
        unresolvedBulkRemoveInProgress = true;
        const drawerRows = documentData?.lines?.filter(line => line.product_state === "PENDING_MASTER" && !line.discarded_at) || eligibleRows;
        renderUnresolvedRows(drawerRows, { movementId });
        try {
            const confirmation = await api().showMessageBox({
                type: "warning",
                title: "Remove Unresolved Barcode Entries",
                buttons: ["CANCEL", `REMOVE ${lineIds.length}`],
                defaultId: 0,
                cancelId: 0,
                message: `Remove ${lineIds.length} unresolved barcode entries (${unitCount} units)?\n\nThese unposted entries will be removed from the current Stock Inward draft.\n\nRecognized products and posted inventory will remain unchanged.`
            });
            if (confirmation?.response !== 1) return;
            const result = await api().stockInwardBulkRemoveLines({ movementId, lineIds });
            if (!result?.success) throw new Error(result?.message || "Unable to remove the selected unresolved barcode entries.");
            if (Number(documentData?.document?.id) === Number(movementId)) {
                documentData = result.document;
                selectedUnresolvedLineIds.clear();
                render();
                await openUnresolvedDrawer(el("siUnresolved"), movementId);
            }
        } catch (error) {
            showMessage(error.message || "Unable to remove the selected unresolved barcode entries.", true);
        } finally {
            unresolvedBulkRemoveInProgress = false;
            if (el("siUnresolvedOverlay")?.classList.contains("klbs-drawer-open") && Number(unresolvedMovementId) === Number(movementId)) {
                await openUnresolvedDrawer(el("siUnresolved"), movementId);
            }
        }
    }

    function clearUnresolvedRetryAlert() {
        unresolvedRetryAlertGeneration += 1;
        clearTimeout(unresolvedRetryAlertTimer);
        unresolvedRetryAlertTimer = null;
        const alert = el("siRetryAlert");
        if (!alert) return;
        alert.textContent = "";
        alert.className = "si-retry-alert";
        alert.hidden = true;
    }

    function showUnresolvedRetryAlert(message, state, generation, movementId) {
        if (generation !== unresolvedRetryAlertGeneration ||
            Number(unresolvedMovementId) !== Number(movementId) ||
            !el("siUnresolvedOverlay")?.classList.contains("klbs-drawer-open")) return;
        const alert = el("siRetryAlert");
        if (!alert) return;
        alert.textContent = message;
        alert.className = `si-retry-alert ${state}`;
        alert.hidden = false;
        unresolvedRetryAlertTimer = setTimeout(() => {
            if (generation !== unresolvedRetryAlertGeneration) return;
            alert.textContent = "";
            alert.className = "si-retry-alert";
            alert.hidden = true;
            unresolvedRetryAlertTimer = null;
        }, 5000);
    }

    function retryAlertFromResult(result) {
        const { attemptedCount, matchedCount, remainingCount } = result || {};
        if (![attemptedCount, matchedCount, remainingCount].every(Number.isSafeInteger) ||
            attemptedCount < 0 || matchedCount < 0 || remainingCount < 0 || matchedCount > attemptedCount) return null;
        if (attemptedCount > 0 && matchedCount === attemptedCount && remainingCount === 0) {
            return { message: "All unresolved barcodes matched successfully.", state: "si-success" };
        }
        if (matchedCount > 0 && remainingCount > 0) {
            const barcodeWord = attemptedCount === 1 ? "barcode" : "barcodes";
            const remainingWord = remainingCount === 1 ? "remains" : "remain";
            return { message: `${matchedCount} of ${attemptedCount} ${barcodeWord} matched. ${remainingCount} ${remainingWord} unresolved.`, state: "si-warning" };
        }
        if (matchedCount === 0 && remainingCount > 0) {
            const remainingWord = remainingCount === 1 ? "barcode remains" : "barcodes remain";
            return { message: `No new matches found. ${remainingCount} ${remainingWord} unresolved.`, state: "si-warning" };
        }
        return null;
    }

    async function retryAllUnresolved(movementId) {
        if (unresolvedRetryInProgress || unresolvedBulkRemoveInProgress) return;
        clearUnresolvedRetryAlert();
        const alertGeneration = unresolvedRetryAlertGeneration;
        const targetMovementId = Number(movementId);
        unresolvedRetryInProgress = true;
        const before = documentData?.lines
            ?.filter(line => line.product_state === "PENDING_MASTER" && !line.discarded_at)
            .map(line => `${line.id}:${line.product_state}:${line.posting_state}:${line.product_id}:${line.resolution_note}:${line.scanned_quantity}`)
            .join("|");
        renderUnresolvedRows(documentData?.lines?.filter(line => line.product_state === "PENDING_MASTER" && !line.discarded_at) || [], { movementId: targetMovementId });
        let alertResult = null;
        try {
            let updated;
            try { updated = await api().stockInwardRetryMatching(targetMovementId); }
            catch (_error) {
                if (Number(documentData?.document?.id) === targetMovementId) {
                    alertResult = { message: "Unable to retry barcode matching. Please try again.", state: "si-error" };
                }
                return;
            }
            if (updated?.success === false || updated?.ok === false) {
                if (Number(documentData?.document?.id) === targetMovementId) {
                    alertResult = { message: "Unable to retry barcode matching. Please try again.", state: "si-error" };
                }
                return;
            }
            if (!updated?.document || !Array.isArray(updated.lines) || !updated.summary || !updated.retryResult ||
                !Number.isSafeInteger(updated.retryResult.remainingCount) ||
                updated.retryResult.remainingCount !== Number(updated.summary.unresolvedBarcodes)) return;
            if (Number(documentData?.document?.id) === targetMovementId) {
                const after = updated.lines
                    .filter(line => line.product_state === "PENDING_MASTER" && !line.discarded_at)
                    .map(line => `${line.id}:${line.product_state}:${line.posting_state}:${line.product_id}:${line.resolution_note}:${line.scanned_quantity}`)
                    .join("|");
                if (before !== after) selectedUnresolvedLineIds.clear();
                documentData = updated;
                render();
                alertResult = retryAlertFromResult(updated.retryResult);
            }
        } finally {
            unresolvedRetryInProgress = false;
            if (el("siUnresolvedOverlay")?.classList.contains("klbs-drawer-open") && Number(unresolvedMovementId) === targetMovementId) {
                try { await openUnresolvedDrawer(el("siUnresolved"), targetMovementId); } catch (_error) { /* Keep the retry result tied to its completed operation. */ }
            }
            if (alertResult) showUnresolvedRetryAlert(alertResult.message, alertResult.state, alertGeneration, targetMovementId);
        }
    }

    async function openMrpReconciliationDrawer() {
        if (readOnly) return;
        const overlay = document.createElement("div");
        overlay.className = "klbs-drawer-overlay si-mrp-reconciliation-overlay";
        overlay.innerHTML = `<aside class="klbs-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="siMrpReconcileTitle" tabindex="-1">
            <header class="klbs-drawer-header"><h2 id="siMrpReconcileTitle" class="klbs-drawer-title">ASSIGN MRP TO EXISTING STOCK</h2><button type="button" class="klbs-drawer-exit" data-close>EXIT</button></header>
            <div class="klbs-drawer-body">
                <p class="si-mrp-guide">Use this once for stock already in KLBS that has no MRP split. Scan the barcode, count the pieces by the MRP printed on each item, and enter each MRP with its quantity. The quantities must add up to the unallocated KLBS stock. This only assigns the MRP breakdown; it does not add or remove stock.</p>
                <ol class="si-mrp-steps"><li>Scan or enter the product barcode, then load its stock.</li><li>Enter one row for each printed MRP found on the shelf.</li><li>Check that the counted total matches KLBS stock and enter why you counted it.</li></ol>
                <div class="si-mrp-load-row"><label>BARCODE<input data-barcode autocomplete="off" aria-label="Barcode"></label><button type="button" class="klbs-cancel-btn" data-load>LOAD STOCK</button></div>
                <div data-details class="si-mrp-product-summary" hidden></div>
                <div data-rows class="si-mrp-reconcile-rows"></div>
                <button type="button" class="klbs-cancel-btn" data-add hidden>ADD ANOTHER MRP</button>
                <div data-total class="si-mrp-count-total" hidden></div>
                <label class="si-mrp-reason">REASON FOR COUNT<input data-reason maxlength="500" placeholder="For example: MRP check during stock inward"></label>
                <p data-error class="si-message error" role="alert"></p>
            </div>
            <footer class="klbs-drawer-footer"><button type="button" class="klbs-primary-btn" data-save disabled>SAVE MRP BREAKDOWN</button></footer>
        </aside>`;
        document.body.appendChild(overlay);
        let detail = null;
        const rows = overlay.querySelector("[data-rows]");
        const error = overlay.querySelector("[data-error]");
        const total = overlay.querySelector("[data-total]");
        const save = overlay.querySelector("[data-save]");
        const drawer = window.KLBSDrawer.create({
            root: overlay,
            panel: overlay.querySelector(".klbs-drawer-panel"),
            labelledBy: "siMrpReconcileTitle",
            initialFocus: () => overlay.querySelector("[data-barcode]"),
            exitButtons: [overlay.querySelector("[data-close]")],
            onExit: () => drawer.close(),
            onEscape: () => false,
            onClosed: () => overlay.remove()
        });
        const updateCount = () => {
            if (!detail) return;
            const entries = [...rows.querySelectorAll(".si-mrp-reconcile-row")];
            const quantities = entries.map(row => Number(row.querySelector("[data-qty]").value));
            entries.forEach(row => { row.querySelector("[data-remove]").disabled = entries.length <= 1; });
            const counted = quantities.reduce((sum, qty) => sum + (Number.isFinite(qty) ? qty : 0), 0);
            const valid = entries.length > 0 && entries.every((row, index) => {
                const mrp = Number(row.querySelector("[data-mrp]").value);
                return Number.isFinite(mrp) && mrp >= 0 && Math.abs(mrp * 100 - Math.round(mrp * 100)) < 1e-8 && Number.isInteger(quantities[index]) && quantities[index] > 0;
            });
            const matches = valid && counted === Number(detail.unallocatedQuantity);
            total.textContent = `COUNTED ${counted} OF ${detail.unallocatedQuantity} UNALLOCATED UNITS${matches ? " · MATCHED" : " · MUST MATCH TO SAVE"}`;
            total.classList.toggle("is-matched", matches);
            save.disabled = !matches || !overlay.querySelector("[data-reason]").value.trim();
        };
        const addRow = () => {
            const row = document.createElement("div");
            row.className = "si-mrp-reconcile-row";
            row.innerHTML = '<label>PRINTED MRP ₹<input type="number" min="0" step="0.01" inputmode="decimal" data-mrp></label><label>PHYSICAL QTY<input type="number" min="1" step="1" inputmode="numeric" data-qty></label><button type="button" data-remove aria-label="Remove MRP row">REMOVE</button>';
            rows.appendChild(row);
            updateCount();
        };
        const loadStock = async () => {
            error.textContent = "";
            try {
                detail = await api().stockInwardMrpBuckets(overlay.querySelector("[data-barcode]").value.trim());
                overlay.querySelector("[data-details]").hidden = false;
                overlay.querySelector("[data-details]").textContent = `${detail.product.productName} · ${detail.product.barcode} · Unallocated KLBS stock: ${detail.unallocatedQuantity}`;
                rows.replaceChildren();
                total.hidden = false;
                overlay.querySelector("[data-add]").hidden = false;
                addRow();
                updateCount();
                if (Number(detail.unallocatedQuantity) <= 0) {
                    error.textContent = "There is no unallocated stock to assign an MRP to.";
                    save.disabled = true;
                }
            } catch (failure) {
                detail = null;
                save.disabled = true;
                overlay.querySelector("[data-details]").hidden = true;
                rows.replaceChildren();
                total.hidden = true;
                overlay.querySelector("[data-add]").hidden = true;
                error.textContent = failure?.message || "Barcode could not be loaded.";
            }
        };
        overlay.querySelector("[data-load]").onclick = loadStock;
        overlay.querySelector("[data-barcode]").addEventListener("keydown", event => {
            if (event.key === "Enter") { event.preventDefault(); loadStock(); }
        });
        overlay.querySelector("[data-add]").onclick = addRow;
        rows.addEventListener("input", updateCount);
        rows.addEventListener("click", event => {
            if (!event.target.closest("[data-remove]")) return;
            const entries = rows.querySelectorAll(".si-mrp-reconcile-row");
            if (entries.length <= 1) return;
            event.target.closest(".si-mrp-reconcile-row").remove();
            updateCount();
        });
        overlay.querySelector("[data-reason]").addEventListener("input", updateCount);
        save.onclick = async () => {
            try {
                if (!detail) throw new Error("Load the barcode stock first.");
                const allocations = [...rows.querySelectorAll(".si-mrp-reconcile-row")].map(row => ({
                    mrp: row.querySelector("[data-mrp]").value,
                    quantity: row.querySelector("[data-qty]").value
                }));
                if (allocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0) !== Number(detail.unallocatedQuantity)) {
                    throw new Error(`Physical quantities must total ${detail.unallocatedQuantity}.`);
                }
                const reason = overlay.querySelector("[data-reason]").value.trim();
                if (!reason) throw new Error("Enter a reason for this physical count.");
                await api().stockInwardMrpReconcile({ productId: detail.product.id, operationKey: `MRP-RECON-${window.crypto.randomUUID()}`, reason, allocations });
                showMessage("MRP breakdown saved. Total stock is unchanged.");
                drawer.close();
            } catch (failure) {
                error.textContent = failure?.message || "Could not save the MRP breakdown.";
            }
        };
        drawer.open({opener:document.activeElement});
    }

    async function openMrpAllocationDrawer(line) {
        if (!line || readOnly || line.posting_state === "POSTED") return;
        const existing = await api().stockInwardMrpAllocations(documentData.document.id);
        const allPrior = (Array.isArray(existing) ? existing : []).filter(row => Number(row.movement_line_id) === Number(line.id));
        const prior = allPrior.filter(row => row.posting_state === "UNPOSTED");
        const postedByMrp = new Map();
        for (const row of allPrior.filter(row => row.posting_state === "POSTED")) postedByMrp.set(Number(row.mrp_paise),(postedByMrp.get(Number(row.mrp_paise))||0)+Number(row.quantity));
        const imported = (documentData.summary.invoiceLines || []).filter(row => row.barcode === line.barcode);
        const importedByMrp = new Map();
        for (const row of imported) {
            const priorRow=importedByMrp.get(Number(row.mrp_paise)) || {mrp:Number(row.mrp_paise)/100,quantity:0,unitCost:Number(row.unit_cost_paise)/100};
            priorRow.quantity+=Number(row.expected_quantity); importedByMrp.set(Number(row.mrp_paise),priorRow);
        }
        for(const [mrp,qty] of postedByMrp) if(importedByMrp.has(mrp)) importedByMrp.get(mrp).quantity=Math.max(0,importedByMrp.get(mrp).quantity-qty);
        const remainingQuantity=Number(line.recognized_quantity||line.scanned_quantity)-Number(line.posted_quantity||0);
        const rows = prior.length ? prior.map(row => ({ mrp: Number(row.mrp_paise) / 100, quantity: Number(row.quantity), unitCost: row.unit_cost_paise == null ? "" : Number(row.unit_cost_paise) / 100 }))
            : importedByMrp.size ? [...importedByMrp.values()].filter(row=>row.quantity>0) : [{ mrp: "", quantity: remainingQuantity, unitCost: "" }];
        const overlay = document.createElement("div");
        overlay.className = "klbs-drawer-overlay si-mrp-allocation-overlay";
        overlay.innerHTML = `<aside class="klbs-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="siMrpAllocationTitle" tabindex="-1"><header class="klbs-drawer-header"><h2 id="siMrpAllocationTitle" class="klbs-drawer-title">ASSIGN MRP AND INVOICE RATE</h2><button type="button" class="klbs-drawer-exit" data-close>EXIT</button></header><div class="klbs-drawer-body"><p>${escapeHtml(line.product_name_snapshot)} · ${escapeHtml(line.barcode)}</p><p>Quantity to assign now: <strong>${remainingQuantity}</strong></p><div data-allocation-rows></div><button type="button" class="klbs-cancel-btn" data-add-row>ADD ANOTHER MRP</button><p data-error class="si-message error" role="alert"></p></div><footer class="klbs-drawer-footer"><button type="button" class="klbs-primary-btn" data-save> SAVE MRP ALLOCATION</button></footer></aside>`;
        document.body.appendChild(overlay);
        const list = overlay.querySelector("[data-allocation-rows]");
        const renderRows = () => { list.innerHTML = rows.map((row,index) => `<div class="si-mrp-allocation-row"><label>PRINTED MRP ₹<input type="number" min="0" step="0.01" inputmode="decimal" data-field="mrp" data-index="${index}" value="${escapeHtml(row.mrp)}"></label><label>QTY<input type="number" min="1" step="1" inputmode="numeric" data-field="quantity" data-index="${index}" value="${escapeHtml(row.quantity)}"></label><label>INVOICE RATE / PIECE ₹<input type="number" min="0" step="0.01" inputmode="decimal" data-field="unitCost" data-index="${index}" value="${escapeHtml(row.unitCost)}"></label></div>`).join(""); };
        renderRows();
        let drawer;
        const close = () => drawer.close();
        drawer = window.KLBSDrawer.create({ root: overlay, panel: overlay.querySelector(".klbs-drawer-panel"), labelledBy: "siMrpAllocationTitle", initialFocus: () => overlay.querySelector('[data-field="mrp"]'), exitButtons: [overlay.querySelector("[data-close]")], onExit: close, onEscape: () => false, onClosed: () => overlay.remove() });
        overlay.querySelector("[data-add-row]").onclick = () => { rows.push({ mrp:"",quantity:"",unitCost:"" }); renderRows(); };
        list.addEventListener("input", event => { const input=event.target.closest("[data-field]"); if(input) rows[Number(input.dataset.index)][input.dataset.field]=input.value; });
        overlay.querySelector("[data-save]").onclick = async () => {
            const error=overlay.querySelector("[data-error]");
            try {
                const allocations=rows.map(row=>({mrp:row.mrp,quantity:row.quantity,unitCost:row.unitCost}));
                const total=allocations.reduce((sum,row)=>sum+Number(row.quantity||0),0);
                if(total!==remainingQuantity)throw new Error(`MRP quantities must total ${remainingQuantity} unposted units.`);
                if(allocations.some(row=>!Number.isFinite(Number(row.mrp))||!Number.isFinite(Number(row.unitCost))))throw new Error("Enter a printed MRP and invoice rate per piece for every row.");
                await api().stockInwardMrpAllocate({movementId:documentData.document.id,lineId:Number(line.id),allocations});
                close(); showMessage("MRP and invoice rate saved.");
            } catch (failure) { error.textContent=failure?.message||"Could not save MRP allocation."; }
        };
        drawer.open({opener:document.activeElement});
    }

    function render() {
        if (!documentData || !el("siCode")) return;
        const doc = documentData.document, lines = documentData.lines, summary = documentData.summary;
        readOnly = ["COMPLETE","CANCELLED"].includes(doc.status) || readOnly;
        el("siCode").textContent = doc.movement_no;
        el("siStatus").textContent = doc.status.replaceAll("_", " ");
        el("siStatus").className = `si-status-badge ${doc.status.toLowerCase()}`;
        el("siPageTitle").textContent = activeIsNew ? "NEW STOCK INWARD" : readOnly ? "STOCK INWARD DETAILS" : "EDIT STOCK INWARD";
        el("siActions").hidden = readOnly;
        el("siReadOnlyBanner").hidden = !readOnly;
        el("siHistoricalPrint").hidden = !readOnly || !["COMPLETE","PARTIALLY_POSTED"].includes(doc.status) || summary.postedUnits <= 0;
        const postingStarted = Boolean(doc.posted_at) || summary.postedUnits > 0;
        const identityLocked = readOnly || postingStarted || lines.length > 0;
        el("siSupplier").disabled=identityLocked;el("siInvoice").disabled=identityLocked;
        el("siInvoiceNumber").disabled=identityLocked;el("siInvoiceDate").disabled=identityLocked;
        ["siInvoiceQty","siRemarks"].forEach(id=>el(id).disabled=readOnly || postingStarted);
        el("siRemarks").closest("label").hidden = readOnly && !String(doc.reference_text || "").trim();
        el("siInvoice").disabled = identityLocked || !el("siSupplier").value || el("siInvoice").dataset.hasInvoices !== "true";
        document.querySelector(".si-scan-area").hidden=readOnly;
        el("siHistoricalUnresolved").hidden = !readOnly || summary.unresolvedBarcodes <= 0;
        el("siDeleteDraft").hidden = readOnly || !documentData.meaningful || !["DRAFT","PENDING_MASTER"].includes(doc.status);
        el("siPost").hidden=readOnly;
        el("siUnresolved").disabled = summary.unresolvedBarcodes <= 0 || readOnly;
        currentReconciliation = calculateReconciliation(summary.scannedQty, doc.invoice_total_quantity);
        const reconciliation = currentReconciliation;
        const cls = reconciliationClass(reconciliation.state);
        el("siReconciliation").className = `si-reconciliation ${cls}`;
        el("siReconciliation").innerHTML = reconciliationMarkup(reconciliation, summary.scannedQty, doc.invoice_total_quantity);
        const workbookActions = document.querySelector(".si-invoice-workbook-actions");
        if (workbookActions) workbookActions.hidden = readOnly;
        el("siImportInvoice").disabled = readOnly || lines.length > 0;
        el("siImportInvoice").title = lines.length ? "Import before scanning products." : "Upload the completed KLBS Stock Inward workbook.";
        const expectedRows = summary.invoiceReconciliation || [];
        const invoiceReconciliation = el("siInvoiceLineReconciliation");
        invoiceReconciliation.hidden = expectedRows.length === 0;
        invoiceReconciliation.innerHTML = expectedRows.length ? `<h2>INVOICE BARCODE MATCH &amp; PHYSICAL SCAN</h2><p class="si-invoice-match-guide">KLBS matches invoice rows by barcode. Matched rows show the existing KLBS SKU. Unresolved rows need Product Master attention. Invoice quantities are expected quantities only: scan every received piece before stock can be posted.</p><div class="si-invoice-match-counts"><b>MASTER MATCHED ${summary.invoiceMatchedBarcodes||0}</b><b class="${summary.invoiceUnresolvedBarcodes?"has-unresolved":""}">UNRESOLVED ${summary.invoiceUnresolvedBarcodes||0}</b></div><div class="table-container"><table class="si-table"><thead><tr><th>BARCODE</th><th>PRODUCT / KLBS SKU</th><th>INVOICE QTY</th><th>SCANNED QTY</th><th>MRP / INVOICE RATE</th><th>BARCODE MATCH</th><th>SCAN STATUS</th></tr></thead><tbody>${expectedRows.map(row=>{const match=row.productResolution==="UNIQUE"?`${escapeHtml(row.productName||"Product")}<small>${escapeHtml(row.sku||"SKU pending")}</small>`:row.productResolution==="AMBIGUOUS"?"Duplicate barcode in Product Master":"Not in Product Master";const matchStatus=row.productResolution==="UNIQUE"?"MATCHED":row.productResolution==="AMBIGUOUS"?"AMBIGUOUS — CHECK MASTER":"UNRESOLVED — ADD TO MASTER";return `<tr class="${row.productResolution==="UNIQUE"?"":"si-invoice-unresolved-row"}"><td>${escapeHtml(row.barcode)}</td><td>${match}</td><td>${row.expectedQuantity}</td><td>${row.scannedQuantity}</td><td>${row.mrps.map(mrp=>`₹${(mrp.mrpPaise/100).toFixed(2)} · ${mrp.quantity} pcs @ ₹${(mrp.unitCostPaise/100).toFixed(2)}`).join("<br>") || "Not on invoice"}</td><td>${matchStatus}</td><td>${row.expectedQuantity===0?"NOT ON INVOICE":row.state.replaceAll("_"," ")}${row.difference?` · ${row.difference>0?"SHORT BY":"OVER BY"} ${Math.abs(row.difference)}`:""}</td></tr>`;}).join("")}</tbody></table></div>` : "";
        const known = lines.filter(line => line.product_state === "READY");
        const unknown = lines.filter(line => line.product_state === "PENDING_MASTER");
        el("siKnownLines").innerHTML = known.length ? `<div class="table-container si-received-table-container"><table class="si-table"><thead><tr><th>BARCODE</th><th>PRODUCT / SKU</th><th>COLOUR</th><th>SIZE</th><th>QTY</th><th>STATUS / MRP</th><th>ACTION</th></tr></thead><tbody>${known.map(line => { const mrpTotals=new Map(); for(const row of line.mrpAllocations||[])mrpTotals.set(Number(row.mrp_paise),(mrpTotals.get(Number(row.mrp_paise))||0)+Number(row.quantity)); const mrpText=[...mrpTotals].map(([mrp,quantity])=>`₹${(mrp/100).toFixed(2)} × ${quantity}`).join(", "); return `<tr><td>${escapeHtml(line.barcode)}</td><td>${escapeHtml(line.product_name_snapshot)}<small>${escapeHtml(line.sku_snapshot)}</small>${line.resolution_note === "PRODUCT IS INACTIVE" ? `<b class="si-inactive">PRODUCT IS INACTIVE</b>` : ""}</td><td>${escapeHtml(line.colour_snapshot)}</td><td>${escapeHtml(line.size_snapshot)}</td><td>${Number(line.posted_quantity)>0 || readOnly ? line.scanned_quantity : `<input class="si-qty" type="number" min="1" step="1" inputmode="numeric" value="${line.scanned_quantity}" data-edit="${line.id}" aria-label="Quantity for ${escapeHtml(line.sku_snapshot || line.barcode)}">`}</td><td>${line.posting_state}${mrpText?`<small>MRP ${escapeHtml(mrpText)}</small>`:""}</td><td>${line.posting_state === "POSTED" || readOnly ? "—" : `<button data-mrp-config="${line.id}">${mrpText ? "CHANGE MRP / RATE" : "MRP / RATE"}</button> ${Number(line.posted_quantity)>0 ? "" : `<button data-remove="${line.id}">REMOVE</button>`}`}</td></tr>`; }).join("")}</tbody></table></div>` : `<p class="si-empty">No recognized products scanned yet.</p>`;
        el("siUnresolvedContext").textContent = `${doc.movement_no} · ${summary.unresolvedBarcodes} unresolved barcode${summary.unresolvedBarcodes === 1 ? "" : "s"} · ${summary.unresolvedUnits} unit${summary.unresolvedUnits === 1 ? "" : "s"}`;
        renderUnresolvedRows(unknown, { movementId: doc.id, readOnly });
        el("siSummary").innerHTML = `<span>KNOWN SKUs <b>${summary.knownSkus}</b></span><span>KNOWN UNITS <b>${summary.knownUnits}</b></span><span>UNRESOLVED BARCODES <b>${summary.unresolvedBarcodes}</b></span><span>UNRESOLVED UNITS <b>${summary.unresolvedUnits}</b></span><span>ELIGIBLE TO POST <b>${summary.eligibleToPost}</b></span><span>POSTED UNITS <b>${summary.postedUnits}</b></span>`;
        el("siKnownLines").querySelectorAll("[data-edit]").forEach(input => {
            const restore = () => { input.value = String(lines.find(line => Number(line.id) === Number(input.dataset.edit))?.scanned_quantity ?? ""); };
            input.addEventListener("input", () => {
                if(input.value===""||(/^\d+$/.test(input.value)&&Number.isSafeInteger(Number(input.value)))) {
                    const message=el("siMessage");
                if(message.textContent==="Quantity must be a positive whole number."){message.textContent="";message.classList.remove("error", "warning");}
                }
            });
            input.onkeydown = event => {
                if (event.key === "Enter") { event.preventDefault(); input.blur(); }
                if (event.key === "Escape") { event.preventDefault(); restore(); input.blur(); }
            };
            input.onchange = async () => {
                const candidate = input.value;
                if (!/^[0-9]+$/.test(candidate) || !Number.isSafeInteger(Number(candidate)) || Number(candidate) <= 0) {
                    render(); showMessage("Quantity must be a positive whole number.",true); return;
                }
                try { documentData = await api().stockInwardEditLine({movementId:doc.id,lineId:Number(input.dataset.edit),quantity:candidate}); render(); }
                catch(error) {
                    const invalidQuantity = error?.code === "STOCK_INWARD_QUANTITY_INVALID" || /STOCK_INWARD_QUANTITY_INVALID|Quantity must be a positive whole number/i.test(String(error?.message || ""));
                    render(); showMessage(invalidQuantity ? "Quantity must be a positive whole number." : "Could not update quantity. Please try again.",true);
                }
            };
        });
        el("siKnownLines").querySelectorAll("[data-remove]").forEach(button => button.onclick = () => removeLine(button.dataset.remove));
        el("siKnownLines").querySelectorAll("[data-mrp-config]").forEach(button => button.onclick = () => openMrpAllocationDrawer(lines.find(line => Number(line.id) === Number(button.dataset.mrpConfig))));
        el("siReconcileMrp").hidden=readOnly;
        el("siReconcileMrp").onclick=()=>openMrpReconciliationDrawer();
        el("siUnknownLines").querySelectorAll("[data-remove]").forEach(button => button.onclick = () => removeLine(button.dataset.remove));
        updatePrimaryAction();
        if (reviewOpen) renderReviewCard();
        const unresolvedButton = el("siUnresolved");
        unresolvedButton.textContent = summary.unresolvedBarcodes > 0 ? `⚠ UNRESOLVED BARCODES (${summary.unresolvedBarcodes})` : "UNRESOLVED BARCODES (0)";
        unresolvedButton.disabled = summary.unresolvedBarcodes <= 0 || readOnly;
        unresolvedButton.classList.toggle("has-unresolved", summary.unresolvedBarcodes > 0);
        el("siExport").disabled = summary.unresolvedBarcodes <= 0 || readOnly;
        updateScannerGate();
    }
    function scannerHeaderIsValid() {
        const supplier=el("siSupplier").value, invoice=el("siInvoiceNumber").value.trim(), date=el("siInvoiceDate").value;
        const qty=el("siInvoiceQty").value.trim();
        return Boolean(supplier && invoice && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d+$/.test(qty) && Number.isSafeInteger(Number(qty)) && Number(qty)>0);
    }
    function calculateReconciliation(scannedQty, invoiceValue) {
        if (invoiceValue == null || String(invoiceValue).trim() === "") return {state:"NO_INVOICE_QTY",difference:null,text:`SCANNED QTY ${scannedQty}`};
        const invoiceQty=Number(invoiceValue);
        if(!Number.isSafeInteger(invoiceQty)||invoiceQty<=0)return {state:"NO_INVOICE_QTY",difference:null,text:`SCANNED QTY ${scannedQty}`};
        const difference=invoiceQty-Number(scannedQty||0);
        return difference===0?{state:"MATCHED",difference:0,text:"MATCHED"}:difference>0?{state:"SHORT",difference,text:`SHORT BY ${difference}`}:{state:"OVER",difference,text:`OVER BY ${Math.abs(difference)}`};
    }
    function reconciliationClass(state) { return state==="MATCHED"?"si-matched":state==="SHORT"?"si-short":state==="OVER"?"si-over":"si-neutral"; }
    function reconciliationMarkup(reconciliation, scannedQty, invoiceQty) {
        if(invoiceQty==null)return `<span>SCANNED QTY <strong>${scannedQty}</strong></span>`;
        const marker=reconciliation.state==="MATCHED"?"✓ ":reconciliation.state==="NO_INVOICE_QTY"?"":"⚠ ";
        return `<span>SCANNED QTY <strong>${scannedQty}</strong></span><span>INVOICE QTY <strong>${invoiceQty}</strong></span><strong>${marker}${reconciliation.text}</strong>`;
    }
    function updatePrimaryAction() {
        const button=el("siPost"); if(!button||!documentData)return;
        button.textContent=reviewOpen?"POST STOCK INWARD":"REVIEW STOCK INWARD";
        button.classList.toggle("is-short",currentReconciliation.state==="SHORT");
        button.classList.toggle("is-matched",currentReconciliation.state==="MATCHED");
        button.classList.toggle("is-over",currentReconciliation.state==="OVER");
        button.disabled=documentData.summary.eligibleToPost<=0||!scannerHeaderIsValid()||!contextSaved||!duplicateClear;
    }
    function updateScannerGate() {
        const scanner=el("siScanner"); if(!scanner || !documentData) return;
        const ready=!readOnly && scannerHeaderIsValid() && contextSaved && duplicateClear && !duplicateDialog;
        scanner.disabled=!ready;
        el("siScanGateHint").hidden=ready || readOnly;
    }
    async function openUnresolvedDrawer(opener = el("siUnresolved"), movementId = documentData?.document.id) {
        if (!documentData || !movementId) return;
        const historical = readOnly || Number(movementId) !== Number(documentData.document.id);
        const target = historical ? await api().stockInwardLoad(movementId) : documentData;
        const alreadyOpen=el("siUnresolvedOverlay").classList.contains("klbs-drawer-open");
        if (!target || (!target.summary.unresolvedBarcodes && !alreadyOpen)) return;
        if (!alreadyOpen || unresolvedMovementId !== Number(movementId)) {
            selectedUnresolvedLineIds.clear();
            clearUnresolvedRetryAlert();
        }
        unresolvedMovementId=Number(movementId);
        currentMasterResults = await api().stockInwardCurrentMasterUnresolved(movementId);
        const doc=target.document, rows=target.lines.filter(line=>line.product_state==="PENDING_MASTER" && !line.discarded_at);
        const masters=new Map(currentMasterResults.map(row=>[Number(row.id),row]));
        el("siUnresolvedContext").textContent=`${doc.movement_no} · ${target.summary.unresolvedBarcodes} unresolved barcode${target.summary.unresolvedBarcodes===1?"":"s"} · ${target.summary.unresolvedUnits} unit${target.summary.unresolvedUnits===1?"":"s"}`;
        renderUnresolvedRows(rows, { historical, readOnly: historical, movementId: doc.id, masters });
        el("siExport").disabled=rows.length===0;
        el("siUnknownLines").querySelectorAll("[data-remove]").forEach(button=>button.onclick=()=>removeLine(button.dataset.remove));
        if(!alreadyOpen) unresolvedDrawer?.open({ opener });
    }
    function closeUnresolvedDrawer() { selectedUnresolvedLineIds.clear(); clearUnresolvedRetryAlert(); unresolvedDrawer?.close(); }
    function updateLiveReconciliation() {
        if (!documentData || !el("siReconciliation")) return;
        const invoiceQty=el("siInvoiceQty").value;
        currentReconciliation=calculateReconciliation(documentData.summary.scannedQty,invoiceQty);
        el("siReconciliation").className=`si-reconciliation ${reconciliationClass(currentReconciliation.state)}`;
        el("siReconciliation").innerHTML=reconciliationMarkup(currentReconciliation,documentData.summary.scannedQty,invoiceQty===""?null:invoiceQty);
        updatePrimaryAction();
        if(reviewOpen)renderReviewCard();
    }
    async function removeLine(id) { if (unresolvedRetryInProgress || unresolvedBulkRemoveInProgress || !confirm("Remove this unposted line?")) return; try { documentData = await api().stockInwardRemoveLine({movementId:documentData.document.id,lineId:Number(id)}); selectedUnresolvedLineIds.delete(Number(id)); render(); if (el("siUnresolvedOverlay")?.classList.contains("klbs-drawer-open")) await openUnresolvedDrawer(el("siUnresolved"), unresolvedMovementId); } catch(error){showMessage(error.message,true);} }
    async function handlePrimaryAction() { if(reviewOpen)await post(); else await showPostReview(); }
    async function showPostReview() {
        if (!await saveContext()) return;
        if (!scannerHeaderIsValid()) { showMessage("Complete all receiving details before Review / Post.",true); updateScannerGate(); return; }
        if(isDismissedPersistedDuplicate(el("siSupplier").value,el("siInvoiceNumber").value)) return;
        const request=++duplicateCheckSequence;
        const duplicate=await api().stockInwardFindDuplicateInvoice({supplierId:Number(el("siSupplier").value),invoiceNumber:el("siInvoiceNumber").value,excludeMovementId:documentData.document.id});
        if(request!==duplicateCheckSequence)return;
        if(duplicate.duplicate){duplicateClear=false;openDuplicateModal(duplicate);updateScannerGate();return;}
        const s = documentData.summary, d = documentData.document;
        if(s.eligibleToPost <= 0){showMessage("At least one recognized unit must be eligible to post.",true);return;}
        reviewOpen=true;
        el("siReview").hidden=false;
        currentReconciliation=calculateReconciliation(s.scannedQty,d.invoice_total_quantity);
        renderReviewCard();
        updatePrimaryAction();
        el("siReview").scrollIntoView({behavior:"smooth",block:"nearest"});
    }
    function renderReviewCard() {
        if(!documentData)return;
        const {document:doc,summary:s}=documentData, rec=currentReconciliation;
        const stateClass=reconciliationClass(rec.state);
        el("siReview").innerHTML=`<h2>REVIEW STOCK INWARD</h2><p class="si-review-identity"><strong>${escapeHtml(doc.movement_no)}</strong><span>${escapeHtml(doc.supplier_name||"No Supplier")} · Invoice ${escapeHtml(doc.invoice_number_snapshot||doc.invoice_no||"—")}</span></p><p class="si-review-date">Invoice Date: ${escapeHtml(formatBusinessDate(doc.invoice_date))}</p><div class="si-review-reconciliation ${stateClass}"><span>INVOICE QTY <b>${doc.invoice_total_quantity??"—"}</b></span><span>SCANNED QTY <b>${s.scannedQty}</b></span><strong>${rec.state==="MATCHED"?"✓ ":rec.state==="NO_INVOICE_QTY"?"":"⚠ "}${escapeHtml(rec.text)}</strong></div><div class="si-review-metrics"><div><span>KNOWN SKUs</span><b>${s.knownSkus}</b></div><div><span>KNOWN UNITS</span><b>${s.knownUnits}</b></div><div><span>UNRESOLVED BARCODES</span><b>${s.unresolvedBarcodes}</b></div><div><span>UNRESOLVED UNITS</span><b>${s.unresolvedUnits}</b></div><div><span>ELIGIBLE TO POST</span><b>${s.eligibleToPost}</b></div></div>`;
    }
    async function post() {
        authInProgress = true;
        try {
            const movementId=documentData.document.id;
            if(isDismissedPersistedDuplicate(documentData.document.supplier_id,documentData.document.invoice_number_snapshot || documentData.document.invoice_no)) { duplicateClear=false; updateScannerGate(); return; }
            if (documentData.document.business_date !== documentData.currentBusinessDate) {
                if (!confirm("This older Stock Inward draft must use the current KLBS business date before posting. Continue with the current business date?")) return;
                documentData = await api().stockInwardUpdateContext({
                    movementId,
                    supplierId:el("siSupplier").value || null,
                    supplierInvoiceId:el("siInvoice").value || null,
                    invoiceNumber:el("siInvoiceNumber").value,
                    invoiceDate:el("siInvoiceDate").value,
                    invoiceTotalQuantity:el("siInvoiceQty").value,
                    reference:el("siRemarks").value,
                    businessDate:documentData.currentBusinessDate
                });
            }
            const postedBefore=Number(documentData.summary.postedUnits)||0;
            const duplicateRequest=++duplicateCheckSequence;
            const duplicate=await api().stockInwardFindDuplicateInvoice({supplierId:Number(documentData.document.supplier_id),invoiceNumber:documentData.document.invoice_number_snapshot || documentData.document.invoice_no,excludeMovementId:documentData.document.id});
            if(duplicateRequest!==duplicateCheckSequence)return;
            if(duplicate.duplicate){duplicateClear=false;openDuplicateModal(duplicate);updateScannerGate();return;}
            documentData = await api().stockInwardPost({movementId});
            render();
            if (documentData.pendingMaster) {
                showMessage("No recognized units were posted. Unresolved barcodes remain saved.", "warning");
            } else if (documentData.posted) {
                const added=Math.max(0,Number(documentData.summary.postedUnits)-postedBefore);
                el("siSuccessTitle").textContent=documentData.document.status==="COMPLETE"?"STOCK INWARD COMPLETE":"STOCK INWARD PARTIALLY POSTED";
                el("siSuccessCode").textContent=documentData.document.movement_no;
                const partiallyPosted=documentData.document.status==="PARTIALLY_POSTED";
                const unresolvedUnits=Number(documentData.summary.unresolvedUnits)||0;
                if(partiallyPosted){
                    const unresolvedBarcodes=Number(documentData.summary.unresolvedBarcodes);
                    el("siSuccessMessage").hidden=true;
                    el("siSuccessUnresolved").hidden=true;
                    el("siPartialSummary").hidden=false;
                    el("siPartialPostedCount").textContent=`${added} ${added===1?"Unit":"Units"}`;
                    const invoiceRemaining=Math.max(0,Number(documentData.document.invoice_total_quantity||0)-Number(documentData.summary.scannedQty||0));
                    el("siPartialPendingCount").textContent=invoiceRemaining>0?`${invoiceRemaining} invoice ${invoiceRemaining===1?"unit":"units"} expected`:`${unresolvedUnits} ${unresolvedUnits===1?"Unit":"Units"}`;
                    el("siPartialExplanation").hidden=false;
                    el("siPartialExplanation").textContent=invoiceRemaining>0?`${invoiceRemaining} invoice units are still expected. Resume this same Stock Inward when they arrive.${unresolvedBarcodes?` ${unresolvedBarcodes} scanned ${unresolvedBarcodes===1?"barcode remains":"barcodes remain"} unresolved.`:""}`:`${unresolvedBarcodes} ${unresolvedBarcodes===1?"barcode remains":"barcodes remain"} unresolved. Resume this Stock Inward after the barcode is reviewed.`;
                } else {
                    el("siSuccessMessage").hidden=false;
                    el("siSuccessMessage").textContent=`${added} ${added===1?"unit":"units"} posted to inventory`;
                    el("siSuccessUnresolved").hidden=true;
                    el("siPartialSummary").hidden=true;
                    el("siPartialExplanation").hidden=true;
                }
                const printSucceeded=await printReceipt(movementId,"immediate",documentData.postedLineIds||[]);
                el("siPrintMessage").textContent=printSucceeded?"":"⚠ Receipt could not be printed";
                el("siPrintMessage").classList.toggle("is-warning",!printSucceeded);
                el("siSuccessOverlay").hidden=false;
                el("siSuccessDone").focus();
            } else {
                showMessage("Stock Inward is ready for the next posting step.");
            }
        } catch(error) {
            if(/already received|already assigned|duplicate/i.test(error.message || "")) {
                if(isDismissedPersistedDuplicate(documentData.document.supplier_id,documentData.document.invoice_number_snapshot || documentData.document.invoice_no)) { duplicateClear=false; updateScannerGate(); return; }
                const duplicateRequest=++duplicateCheckSequence;
                const duplicate=await api().stockInwardFindDuplicateInvoice({supplierId:Number(documentData.document.supplier_id),invoiceNumber:documentData.document.invoice_number_snapshot || documentData.document.invoice_no,excludeMovementId:documentData.document.id}).catch(()=>null);
                if(duplicateRequest!==duplicateCheckSequence)return;
                if(duplicate?.duplicate){duplicateClear=false;openDuplicateModal(duplicate);}
                else showMessage("Stock Inward could not be posted. No stock was changed. Please try again.",true);
            } else showMessage("Stock Inward could not be posted. No stock was changed. Please try again.",true);
        }
        finally { authInProgress=false;if(duplicateDialog)el("siDuplicateClose")?.focus();else if(el("siSuccessOverlay")?.hidden&&!el("siScanner")?.disabled)el("siScanner")?.focus(); }
    }
    async function exportUnknown(movementId = documentData?.document.id) { try { const result=await api().stockInwardExportUnknown(movementId); if(result.cancelled)return; if(result.success)showMessage("Unknown barcode workbook saved."); else if(result.empty)showMessage("There are no unresolved barcodes to export.", "warning"); else showMessage(result.error || "Export could not be completed.",true); } catch(error){showMessage(error.message,true);} }
    async function printReceipt(movementId,mode,postedLineIds=[]) {
        if(!movementId||printInProgress)return false;
        printInProgress=true;
        try {
            const result=await api().stockInwardPrintReceipt({movementId,mode,postedLineIds});
            return Boolean(result?.success);
        } catch {
            return false;
        } finally {
            printInProgress=false;
        }
    }
    async function printHistoricalReceipt(movementId) {
        if(!await printReceipt(movementId,"history"))showMessage("Receipt could not be printed. Check the printer and retry.", "warning");
        else showMessage("Receipt printed.");
    }
    async function finishPostingSuccess() {
        if(printInProgress)return;
        el("siSuccessOverlay").hidden=true;
        await showResumeList();
    }
    async function deleteDraft(movementId = documentData?.document.id) {
        if (!movementId) return;
        try {
            const target = movementId === documentData?.document.id ? documentData : await api().stockInwardLoad(movementId);
            if (!target.meaningful || !["DRAFT","PENDING_MASTER"].includes(target.document.status) || Number(target.summary.postedUnits) > 0) return;
            if (!confirm("Delete this Stock Inward draft? Scanned items in this draft will not be added to stock.")) return;
            await api().stockInwardCancel({movementId}); await showResumeList();
        }
        catch(error){showMessage(error.message,true);}
    }
    async function archiveCancelled(movementId) {
        const row = [...el("stockInwardResume").querySelectorAll("[data-archive]")].find(button=>Number(button.dataset.archive)===Number(movementId));
        const movementNo = row?.closest("tr")?.querySelector(".si-history-number")?.textContent || `Stock Inward ${movementId}`;
        el("siArchiveMovementNo").textContent = movementNo;
        el("siArchiveOverlay").hidden = false;
        el("siArchiveOverlay").classList.add("si-dialog-visible");
        el("siArchiveCancel").focus();
        el("siArchiveConfirm").dataset.movementId = String(movementId);
        archiveConfirmationOpener = row;
    }
    let archiveConfirmationOpener = null;
    function closeArchiveConfirmation() {
        el("siArchiveOverlay").classList.remove("si-dialog-visible");
        el("siArchiveOverlay").hidden = true;
        const opener = archiveConfirmationOpener;
        archiveConfirmationOpener = null;
        if (opener?.isConnected) opener.focus();
    }
    async function confirmArchiveCancelled() {
        const movementId = Number(el("siArchiveConfirm").dataset.movementId);
        if (!Number.isSafeInteger(movementId) || movementId <= 0) return;
        el("siArchiveConfirm").disabled = true;
        try {
            await api().stockInwardArchiveCancelled({movementId});
            closeArchiveConfirmation();
            await showResumeList();
            showMessage("Cancelled Stock Inward removed from the Recent list.");
        } catch(error) {
            showMessage(error.message,true);
            closeArchiveConfirmation();
        } finally { el("siArchiveConfirm").disabled = false; }
    }
    function showMessage(text, stateOption = false) {
        const workspace=el("stockInwardWorkspace"),target=workspace&&!workspace.hidden?el("siMessage"):el("siPageMessage");
        if(!target)return;
        clearTimeout(messageTimeout);
        for(const other of [el("siPageMessage"),el("siMessage")])if(other&&other!==target){other.textContent="";other.classList.remove("error", "warning");}
        const state = stateOption === true ? "error" : stateOption === "warning" ? "warning" : "";
        target.textContent=text;target.classList.remove("error", "warning");if(state)target.classList.add(state);
        if(text)messageTimeout=setTimeout(()=>{if(target.textContent===text){target.textContent="";target.classList.remove("error", "warning");}},stateOption===true?6500:4000);
    }
    async function returnToHome() {
        if (pageMode === "active" && documentData) {
            if (!isDismissedPersistedDuplicate(el("siSupplier").value,el("siInvoiceNumber").value) && !await saveContext()) return;
            try { await api().stockInwardAbandonEmpty(documentData.document.id); }
            catch (error) { showMessage(error.message, true); return; }
        }
        closeUnresolvedDrawer();
        await showResumeList();
    }
    async function leavePage() {
        if (!active) return;
        if (pageMode !== "home") { await returnToHome(); return; }
        clearTimeout(historySearchTimer);
        historyRequestSequence++;
        active=false; documentData=null; readOnly=false;
        if (escHandler) document.removeEventListener("keydown",escHandler,true);
        escHandler=null;
        try { await api().stockInwardExit(); } catch (error) { console.error("Stock Inward workspace exit failed", error); }
        if (returnDestination === "exportData") showExportDataPage();
        else showInventory();
        const globalBack=el("settingsPageBackBtn");
        globalBack.hidden = previousBackHidden;
        globalBack.textContent = previousBackText;
        globalBack.onclick = previousBackOnclick;
        el("siPageTitle")?.remove();
        globalBack.parentElement.className = previousTopbarClass;
        const returnFocusId = returnDestination === "exportData" ? "supplierInvoiceConverterCard" : "stockInwardBtn";
        requestAnimationFrame(() => document.getElementById(returnFocusId)?.focus());
    }
    window.openStockInwardPage = enterStockInwardPage;
})();
