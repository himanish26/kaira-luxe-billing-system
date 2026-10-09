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
    let contextSaveTimer = null;
    let duplicateClear = true;
    let contextSaved = false;
    let unresolvedMovementId = null;
    let previousTopbarClass = "";
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

    async function enterStockInwardPage() {
        if (active) return;
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
                <section class="si-document-head" aria-label="Stock Inward document identity"><strong id="siCode">—</strong><span id="siStatus" class="si-status-badge">DRAFT</span><span id="siReadOnlyBanner" class="si-read-only-banner" hidden>READ ONLY</span><span class="si-business-date-label">BUSINESS DATE</span><time id="siBusinessDate">—</time><button id="siHistoricalUnresolved" type="button" class="klbs-cancel-btn" hidden>VIEW UNRESOLVED BARCODES</button><button id="siHistoricalPrint" type="button" class="klbs-primary-btn si-history-print" hidden>REPRINT RECEIPT</button></section>
                <section class="si-context-grid expense-entry-grid" aria-label="Supplier and invoice details">
                  <label>SUPPLIER<select id="siSupplier"><option value="">No Supplier</option></select></label>
                  <label>LINK KLBS INVOICE<select id="siInvoice" disabled><option value="">Select Supplier first</option></select></label>
                  <label>INVOICE NUMBER<input id="siInvoiceNumber" maxlength="120"></label>
                  <label>INVOICE DATE<input id="siInvoiceDate" type="date"></label>
                  <label>INVOICE TOTAL QTY<input id="siInvoiceQty" type="number" min="1" step="1" inputmode="numeric"></label>
                  <label class="si-remarks-field">REMARKS<input id="siRemarks" type="text" maxlength="500" placeholder="Optional remarks"></label>
                </section>
                <section id="siReconciliation" class="si-reconciliation si-neutral" aria-live="polite"></section>
                <section class="si-scan-area"><label for="siScanner">SCAN PRODUCT</label><input id="siScanner" type="tel" inputmode="numeric" autocomplete="off" placeholder="Scan Barcode Here" aria-label="Scan product barcode" disabled><small id="siScanGateHint">Complete receiving details to start scanning.</small></section>
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
                <div class="klbs-drawer-body"><div id="siUnresolvedContext" class="si-unresolved-context"></div><div id="siUnknownLines"></div></div>
                <footer class="klbs-drawer-footer"><button id="siExport" type="button" class="si-export-btn">EXPORT UNKNOWN BARCODES</button></footer>
              </aside>
            </div>
          </section>`;
        content.insertAdjacentHTML("beforeend", `<div id="siDuplicateOverlay" class="modal si-duplicate-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="siDuplicateTitle"><section class="modal-content si-duplicate-dialog"><header><h2 id="siDuplicateTitle"></h2><button id="siDuplicateExit" type="button" class="klbs-cancel-btn">CLOSE</button></header><div id="siDuplicateBody"></div><footer id="siDuplicateActions"></footer></section></div>`);
        content.insertAdjacentHTML("beforeend", `<div id="siArchiveOverlay" class="modal si-archive-overlay" hidden role="alertdialog" aria-modal="true" aria-labelledby="siArchiveTitle" aria-describedby="siArchiveDescription"><section class="modal-content si-archive-dialog"><h2 id="siArchiveTitle">REMOVE CANCELLED STOCK INWARD</h2><strong id="siArchiveMovementNo" class="si-archive-movement"></strong><p id="siArchiveDescription">Remove this cancelled Stock Inward from the list?</p><div class="modal-buttons si-archive-actions"><button id="siArchiveCancel" type="button" class="klbs-cancel-btn">CANCEL</button><button id="siArchiveConfirm" type="button" class="klbs-primary-btn">REMOVE</button></div></section></div>`);
        content.insertAdjacentHTML("beforeend", `<div id="siSuccessOverlay" class="modal si-success-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="siSuccessTitle" aria-describedby="siSuccessMessage"><section class="modal-content si-success-dialog"><h2 id="siSuccessTitle">STOCK INWARD COMPLETE</h2><strong id="siSuccessCode"></strong><p id="siSuccessMessage"></p><p id="siSuccessUnresolved" class="si-success-unresolved" hidden></p><p id="siPrintMessage" class="si-print-message" role="status" aria-live="polite"></p><div class="modal-buttons si-success-actions"><button id="siSuccessDone" type="button" class="klbs-primary-btn">DONE</button></div></section></div>`);
        unresolvedDrawer = window.KLBSDrawer.create({
            root: el("siUnresolvedOverlay"), panel: el("siUnresolvedDrawer"),
            labelledBy: "siUnresolvedTitle", exitButtons: [el("siUnresolvedExit")],
            initialFocus: () => el("siUnresolvedExit"), closeOnOverlay: true,
            restoreFocus: () => el("siScanner"),
            onExit: closeUnresolvedDrawer, onEscape: () => { closeUnresolvedDrawer(); return true; }
        });
        escHandler = event => {
            if (event.key !== "Escape" || !active || authInProgress) return;
            if (!el("siArchiveOverlay")?.hidden) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); closeArchiveConfirmation(); return; }
            if (!el("siSuccessOverlay")?.hidden) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); if (!printInProgress) finishPostingSuccess(); return; }
            if (el("siVvpQuantityDialog")?.style.display === "flex" || !el("siDuplicateOverlay")?.hidden) return;
            event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
            if(pageMode === "home") leavePage(); else returnToHome();
        };
        document.addEventListener("keydown", escHandler, true);
        el("siDuplicateExit").onclick = closeDuplicateModal;
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
        readOnly = false; documentData = null; reviewOpen = false;
        clearTimeout(messageTimeout);
        el("siPageMessage").textContent="";el("siMessage").textContent="";
        const request = ++historyRequestSequence;
        const [drafts, historyResult] = await Promise.all([api().stockInwardListDrafts(),api().stockInwardHistory({page:historyPage,pageSize:HISTORY_PAGE_SIZE,keyword:historyKeyword})]);
        if (!active || request !== historyRequestSequence) return;
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
        const draftCard = row => `<article class="si-current-card"><div class="si-open-top"><div class="si-open-document"><strong>${escapeHtml(row.movement_no)}</strong><span class="si-status-badge ${escapeHtml(row.status.toLowerCase())}">${escapeHtml(row.status.replaceAll("_"," "))}</span></div><span class="si-open-supplier">${escapeHtml(row.supplier_name || "No Supplier")}${row.invoice_no?` · Invoice ${escapeHtml(row.invoice_no)}`:" · Receiving details pending"}</span><small>Updated ${escapeHtml(formatUpdated(row.updated_at))}</small></div><div class="si-open-bottom"><div class="si-current-stats"><span><b>${Number(row.sku_count)||0}</b> SKUs</span><span><b>${Number(row.units)||0}</b> Scanned Units</span>${Number(row.posted_units)>0?`<span><b>${Number(row.posted_units)}</b> Posted</span>`:""}<span><b>${Number(row.unresolved_count)||0}</b> Unresolved</span></div><div class="si-card-actions">${Number(row.posted_units)>0?`<button type="button" class="print-btn si-open-reprint" data-reprint="${Number(row.id)}">🖨 REPRINT RECEIPT</button>`:""}<button type="button" class="klbs-primary-btn" data-id="${row.id}">RESUME STOCK INWARD</button>${["DRAFT","PENDING_MASTER"].includes(row.status)?`<button type="button" class="klbs-cancel-btn si-delete-btn" data-delete-draft="${row.id}">DELETE DRAFT</button>`:""}</div></div></article>`;
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
        resume.innerHTML=`<button type="button" id="siNewDraft" class="klbs-primary-btn si-new-btn">+ NEW STOCK INWARD</button>${drafts.length?`<section class="si-current-draft"><h2>OPEN STOCK INWARDS</h2>${drafts.map(draftCard).join("")}</section>`:""}<section class="si-recent-history"><h2>RECENT STOCK INWARDS</h2><label class="si-history-search-label" for="siHistorySearch">Search Stock Inward history</label><input id="siHistorySearch" class="si-history-search" type="search" placeholder="Search Stock Inward / Supplier / Invoice..." value="${escapeHtml(historyKeyword)}"><div class="table-container si-history-table-wrap"><table class="si-history-table"><thead><tr><th>STATUS</th><th>STOCK INWARD NO</th><th>DATE</th><th>SUPPLIER</th><th>INVOICE NO</th><th>POSTED UNITS</th><th>VIEW</th><th>PRINT</th></tr></thead><tbody>${historyRows || historyEmpty}</tbody></table></div><div id="siHistoryPagination" class="history-pagination" ${historyTotalCount ? "" : "hidden"}><div class="pagination-controls"><button type="button" id="siHistoryPrevious" class="pagination-nav-btn" ${historyPage<=1?"disabled":""}>Previous</button><span id="siHistoryPageLabel">Page ${historyPage.toLocaleString("en-US")} of ${historyTotalPages.toLocaleString("en-US")}</span><label for="siHistoryPageJump">Jump to page:</label><input id="siHistoryPageJump" type="number" min="1" step="1" inputmode="numeric" value="${historyPage}" max="${historyTotalPages}" aria-label="Jump to Stock Inward history page"><button type="button" id="siHistoryNext" class="pagination-nav-btn" ${historyPage>=historyTotalPages?"disabled":""}>Next</button></div><span id="siHistoryRangeLabel">Showing ${rangeFirst.toLocaleString("en-US")}–${rangeLast.toLocaleString("en-US")} of ${historyTotalCount.toLocaleString("en-US")} Stock Inwards</span></div></section>`;
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
            documentData = await api().stockInwardLoad(id);
            contextSaved = true; duplicateClear = true; currentMasterResults = [];
            reviewOpen = false;
            pageMode = historical ? "view" : "active";
            activeIsNew = Boolean(options.isNew);
            readOnly = historical || ["COMPLETE","CANCELLED"].includes(documentData.document.status);
            const [suppliers] = await Promise.all([api().stockInwardSuppliers()]);
            if (!active) return;
            el("stockInwardResume").hidden = true;
            el("stockInwardWorkspace").hidden = false;
            el("siActions").hidden = readOnly;
            el("siPageTitle").textContent = "STOCK INWARD";
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
            el("siSupplier").onchange = async () => { contextSaved=false; await populateInvoices(); await saveContext(); };
            el("siInvoice").onchange = () => {
                const option=el("siInvoice").selectedOptions[0];
                if(option?.dataset.invoiceNumber && !el("siInvoiceNumber").value.trim()) el("siInvoiceNumber").value=option.dataset.invoiceNumber;
                contextSaved=false; saveContext();
            };
            ["siInvoiceNumber","siInvoiceDate","siInvoiceQty","siRemarks"].forEach(id => {
                el(id).oninput = () => { contextSaved=false; updateScannerGate(); if(id === "siInvoiceNumber") checkDuplicateInvoice(); clearTimeout(contextSaveTimer); contextSaveTimer=setTimeout(saveContext,250); };
                el(id).onchange = saveContext;
            });
            el("siInvoiceQty").addEventListener("input", updateLiveReconciliation);
            el("siScanner").onbeforeinput = event => {
                if(event.data && event.inputType.startsWith("insert") && !/^[0-9]+$/.test(event.data)) {
                    event.preventDefault();
                }
            };
            el("siScanner").onkeydown = event => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const scanner = el("siScanner");
                const barcode = scanner.value.trim();
                if (!barcode) { showMessage("Scan a product barcode."); return; }
                if (!/^[0-9]+$/.test(barcode)) {
                    showMessage("Barcode must contain numbers only.", true);
                    scanner.focus();
                    scanner.select();
                    return;
                }
                el("siScanner").value = "";
                scanQueue = scanQueue.then(() => scanBarcode(barcode)).catch(error => showMessage(error.message, true));
            };
            el("siScanner").oninput = () => {
                const scanner=el("siScanner"), original=scanner.value;
                scanner.value=original.replace(/\D/g,"");
                if (el("siMessage").textContent === "Barcode must contain numbers only.") {
                    el("siMessage").textContent = "";
                    el("siMessage").classList.remove("error");
                }
            };
            el("siDeleteDraft").onclick = () => deleteDraft();
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
        try {
            const context = { movementId:documentData.document.id,supplierId:el("siSupplier").value || null,supplierInvoiceId:el("siInvoice").value || null,invoiceNumber:el("siInvoiceNumber").value,invoiceDate:el("siInvoiceDate").value,invoiceTotalQuantity:el("siInvoiceQty").value,reference:el("siRemarks").value };
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
            if (documentData.splitDeliveryWarning) showMessage("THIS SUPPLIER INVOICE IS ALREADY LINKED TO ANOTHER STOCK INWARD. THIS MAY BE A SPLIT DELIVERY.");
            return true;
        } catch (error) { showMessage(error.message, true); return false; }
    }
    async function checkDuplicateInvoice() {
        const request=++duplicateCheckSequence;
        if(!documentData || !el("siSupplier").value || !el("siInvoiceNumber").value.trim()) { duplicateClear=true; updateScannerGate(); return; }
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
        if(!doc) return;
        const summary=data.summary, activeDuplicate=doc.status === "DRAFT";
        duplicateDialog=data;
        el("siDuplicateTitle").textContent=activeDuplicate ? "INVOICE ALREADY IN PROGRESS" : "INVOICE ALREADY RECEIVED";
        const resumable=["DRAFT","PENDING_MASTER","PARTIALLY_POSTED"].includes(doc.status);
        const master=data.currentMasterSummary || {checked:0,nowFound:0,stillUnresolved:0};
        const masterPanel=summary.unresolvedBarcodes?`<p class="si-duplicate-state ${master.checked>0&&master.stillUnresolved===0?"success":"warning"}">${master.checked>0&&master.stillUnresolved===0?`✓ ALL ${master.nowFound} UNRESOLVED BARCODES NOW RESOLVABLE`:master.nowFound>0?`⚠ PARTIALLY RESOLVED IN PRODUCT MASTER · ${master.nowFound} NOW FOUND · ${master.stillUnresolved} STILL UNRESOLVED`:`⚠ ${master.stillUnresolved} BARCODE(S) STILL UNRESOLVED`}</p>`:"";
        const copy=doc.status === "COMPLETE"?`All ${summary.postedUnits} units were posted to inventory. This invoice cannot be received again.`:`${summary.postedUnits} of ${summary.scannedQty} scanned units were posted to inventory. ${summary.unresolvedUnits} physical units remain unresolved/unposted. Current Product Master matches do not post stock; resume the original Stock Inward to retry and review.`;
        const duplicateStatus=doc.status === "COMPLETE"?"✓ FULLY RECEIVED":doc.status === "DRAFT"?"⚠ IN PROGRESS":master.nowFound>0&&master.stillUnresolved>0?"⚠ PARTIALLY RESOLVED IN PRODUCT MASTER":doc.status === "PARTIALLY_POSTED"?"⚠ PARTIALLY POSTED":"⚠ PENDING MASTER";
        el("siDuplicateBody").innerHTML=`<div class="si-duplicate-party"><strong>${escapeHtml(doc.supplier_name || "Supplier")}</strong><span>${escapeHtml(doc.invoice_number_snapshot || doc.invoice_no || "—")}</span></div><p class="si-duplicate-document">Stock Inward <strong>${escapeHtml(doc.movement_no)}</strong><span class="si-status-badge ${escapeHtml(doc.status.toLowerCase())}">${escapeHtml(doc.status.replaceAll("_"," "))}</span><span>${escapeHtml(formatBusinessDate(doc.business_date))}</span></p><div class="si-duplicate-metrics"><div><small>INVOICE QTY</small><strong>${doc.invoice_total_quantity ?? "—"}</strong></div><div><small>SCANNED</small><strong>${summary.scannedQty}</strong></div><div><small>POSTED</small><strong>${summary.postedUnits}</strong></div><div><small>UNRESOLVED</small><strong>${summary.unresolvedUnits}</strong></div></div><p class="si-duplicate-state ${doc.status === "COMPLETE"?"success":"warning"}">${duplicateStatus}</p>${masterPanel}<p class="si-duplicate-copy">${copy}</p>${summary.unresolvedBarcodes?`<button id="siDuplicateUnresolved" class="klbs-cancel-btn" type="button">VIEW UNRESOLVED BARCODES</button>`:""}`;
        el("siDuplicateActions").innerHTML=`${resumable?`<button id="siDuplicateResume" class="klbs-primary-btn" type="button">${doc.status==="DRAFT"?"RESUME STOCK INWARD":"VIEW / RESUME STOCK INWARD"}</button>`:`<button id="siDuplicateView" class="klbs-primary-btn" type="button">VIEW STOCK INWARD</button>`}<button id="siDuplicateClose" class="klbs-cancel-btn" type="button">CLOSE</button>`;
        el("siDuplicateOverlay").hidden=false; el("siDuplicateOverlay").classList.add("si-dialog-visible");
        el("siDuplicateClose").onclick=closeDuplicateModal;
        el("siDuplicateExit").onclick=closeDuplicateModal;
        el("siDuplicateResume")?.addEventListener("click",async()=>{closeDuplicateModal();await openDraft(doc.id);});
        el("siDuplicateView")?.addEventListener("click",async()=>{closeDuplicateModal();await openDraft(doc.id,{historical:true});});
        el("siDuplicateUnresolved")?.addEventListener("click",async()=>{closeDuplicateModal();await openDraft(doc.id);await openUnresolvedDrawer(el("siUnresolved"),doc.id);});
        el("siDuplicateClose")?.focus();
    }
    function closeDuplicateModal(){el("siDuplicateOverlay").classList.remove("si-dialog-visible");el("siDuplicateOverlay").hidden=true;duplicateDialog=null;updateScannerGate();if(active){const target=el("siScanner")?.disabled?el("siInvoiceNumber"):el("siScanner");target?.focus();}}
    async function scanBarcode(barcode) {
        barcode = String(barcode ?? "").trim();
        if (!barcode) { showMessage("Scan a product barcode."); return; }
        if (!/^[0-9]+$/.test(barcode)) { showMessage("Barcode must contain numbers only.",true); el("siScanner")?.focus(); el("siScanner")?.select(); return; }
        if (!await saveContext() || !scannerHeaderIsValid() || !duplicateClear) { updateScannerGate(); showMessage("Complete receiving details before scanning.",true); return; }
        try {
            const resolution = await api().stockInwardResolveBarcode(barcode);
            let quantity = 1;
            if (resolution.resolution === "UNIQUE" && Number(resolution.product?.variable_value) === 1) {
                quantity = await captureVvpQuantity(resolution.product, barcode);
            }
            if (quantity == null) showMessage("Variable Value quantity entry cancelled.");
            else {
                documentData = await api().stockInwardScan({ movementId:documentData.document.id,barcode,quantity });
                showMessage(documentData.lastResolution === "AMBIGUOUS" ? "Barcode matches more than one Product. It is retained for review." : documentData.lastResolution === "NOT_FOUND" ? "Product not found. Barcode retained as unresolved." : "Product added to Stock Inward.");
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
    function render() {
        if (!documentData || !el("siCode")) return;
        const doc = documentData.document, lines = documentData.lines, summary = documentData.summary;
        readOnly = ["COMPLETE","CANCELLED"].includes(doc.status) || readOnly;
        el("siCode").textContent = doc.movement_no;
        el("siStatus").textContent = doc.status.replaceAll("_", " ");
        el("siStatus").className = `si-status-badge ${doc.status.toLowerCase()}`;
        el("siPageTitle").textContent = "STOCK INWARD";
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
        const known = lines.filter(line => line.product_state === "READY");
        const unknown = lines.filter(line => line.product_state === "PENDING_MASTER");
        el("siKnownLines").innerHTML = known.length ? `<div class="table-container si-received-table-container"><table class="si-table"><thead><tr><th>BARCODE</th><th>PRODUCT / SKU</th><th>COLOUR</th><th>SIZE</th><th>QTY</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${known.map(line => `<tr><td>${escapeHtml(line.barcode)}</td><td>${escapeHtml(line.product_name_snapshot)}<small>${escapeHtml(line.sku_snapshot)}</small>${line.resolution_note === "PRODUCT IS INACTIVE" ? `<b class="si-inactive">PRODUCT IS INACTIVE</b>` : ""}</td><td>${escapeHtml(line.colour_snapshot)}</td><td>${escapeHtml(line.size_snapshot)}</td><td>${line.posting_state === "POSTED" || readOnly ? line.posted_quantity || line.scanned_quantity : `<input class="si-qty" type="number" min="1" step="1" inputmode="numeric" value="${line.scanned_quantity}" data-edit="${line.id}" aria-label="Quantity for ${escapeHtml(line.sku_snapshot || line.barcode)}">`}</td><td>${line.posting_state}</td><td>${line.posting_state === "POSTED" || readOnly ? "—" : `<button data-remove="${line.id}">REMOVE</button>`}</td></tr>`).join("")}</tbody></table></div>` : `<p class="si-empty">No recognized products scanned yet.</p>`;
        el("siUnresolvedContext").textContent = `${doc.movement_no} · ${summary.unresolvedBarcodes} unresolved barcode${summary.unresolvedBarcodes === 1 ? "" : "s"} · ${summary.unresolvedUnits} unit${summary.unresolvedUnits === 1 ? "" : "s"}`;
        el("siUnknownLines").innerHTML = unknown.length ? `<div class="si-unresolved-table" role="table" aria-label="Unresolved barcode lines"><div class="si-unresolved-row si-unresolved-heading" role="row"><span role="columnheader">BARCODE</span><span role="columnheader">QTY</span><span role="columnheader">STATUS</span><span role="columnheader">ACTIONS</span></div>${unknown.map(line => `<div class="si-unresolved-row ${line.discarded_at ? "si-discarded" : ""}" role="row"><strong class="si-unresolved-barcode" role="cell">${escapeHtml(line.barcode)}</strong><strong class="si-unresolved-qty" role="cell">${line.scanned_quantity}</strong><span class="si-unresolved-status" role="cell">${line.discarded_at ? "DISCARDED" : escapeHtml(line.resolution_note || "PRODUCT NOT FOUND")}</span><div class="si-unresolved-actions" role="cell">${line.discarded_at || readOnly ? "—" : `<button class="si-retry-btn" data-retry="${line.id}">RETRY MATCH</button><button class="si-remove-btn" data-remove="${line.id}">REMOVE</button><button class="si-discard-btn" data-discard="${line.id}">DISCARD</button>`}</div></div>`).join("")}</div>` : `<p class="si-empty si-unresolved-empty">NO UNRESOLVED BARCODES</p>`;
        el("siSummary").innerHTML = `<span>KNOWN SKUs <b>${summary.knownSkus}</b></span><span>KNOWN UNITS <b>${summary.knownUnits}</b></span><span>UNRESOLVED BARCODES <b>${summary.unresolvedBarcodes}</b></span><span>UNRESOLVED UNITS <b>${summary.unresolvedUnits}</b></span><span>ELIGIBLE TO POST <b>${summary.eligibleToPost}</b></span><span>POSTED UNITS <b>${summary.postedUnits}</b></span>`;
        el("siKnownLines").querySelectorAll("[data-edit]").forEach(input => {
            const restore = () => { input.value = String(lines.find(line => Number(line.id) === Number(input.dataset.edit))?.scanned_quantity ?? ""); };
            input.addEventListener("input", () => {
                if(input.value===""||(/^\d+$/.test(input.value)&&Number.isSafeInteger(Number(input.value)))) {
                    const message=el("siMessage");
                    if(message.textContent==="Quantity must be a positive whole number."){message.textContent="";message.classList.remove("error");}
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
        el("siUnknownLines").querySelectorAll("[data-remove]").forEach(button => button.onclick = () => removeLine(button.dataset.remove));
        el("siUnknownLines").querySelectorAll("[data-retry]").forEach(button => button.onclick = async () => { documentData = await api().stockInwardRetryMatching(doc.id); render(); });
        el("siUnknownLines").querySelectorAll("[data-discard]").forEach(button => button.onclick = () => discardLine(button.dataset.discard));
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
        unresolvedMovementId=Number(movementId);
        currentMasterResults = await api().stockInwardCurrentMasterUnresolved(movementId);
        const doc=target.document, rows=target.lines.filter(line=>line.product_state==="PENDING_MASTER" && !line.discarded_at);
        const masters=new Map(currentMasterResults.map(row=>[Number(row.id),row]));
        el("siUnresolvedContext").textContent=`${doc.movement_no} · ${target.summary.unresolvedBarcodes} unresolved barcode${target.summary.unresolvedBarcodes===1?"":"s"} · ${target.summary.unresolvedUnits} unit${target.summary.unresolvedUnits===1?"":"s"}`;
        el("siUnknownLines").innerHTML=rows.length?`<div class="si-unresolved-table ${historical?"is-historical":""}" role="table" aria-label="Unresolved barcode lines"><div class="si-unresolved-row si-unresolved-heading ${historical?"is-historical":""}" role="row"><span>BARCODE</span><span>QTY</span><span>${historical?"ORIGINAL STATUS":"STATUS"}</span><span>${historical?"PRODUCT MASTER NOW":"ACTIONS"}</span></div>${rows.map(line=>{const master=masters.get(Number(line.id));const state=master?.currentResolution;const stateText=state==="UNIQUE"?`✓ NOW FOUND · ${[master.currentProduct?.sku,master.currentProduct?.product_name,master.currentProduct?.colour,master.currentProduct?.size].filter(Boolean).map(escapeHtml).join(" · ")}`:state==="AMBIGUOUS"?"⚠ AMBIGUOUS":"✕ STILL NOT FOUND";return `<div class="si-unresolved-row ${historical?"is-historical":""}" role="row"><strong class="si-unresolved-barcode">${escapeHtml(line.barcode)}</strong><strong class="si-unresolved-qty">${line.scanned_quantity}</strong><span class="si-unresolved-status">${escapeHtml(line.resolution_note||"PRODUCT NOT FOUND")}</span>${historical?`<span class="si-master-state ${state===`UNIQUE`?"found":state===`AMBIGUOUS`?"ambiguous":"missing"}">${stateText}</span>`:`<div class="si-unresolved-actions">${line.discarded_at?"DISCARDED":`<button data-retry="${line.id}">RETRY MATCH</button><button data-remove="${line.id}">REMOVE</button><button class="si-discard-btn" data-discard="${line.id}">DISCARD</button>`}</div>`}</div>`;}).join("")}</div>`:`<p class="si-empty si-unresolved-empty">NO UNRESOLVED BARCODES</p>`;
        el("siExport").disabled=rows.length===0;
        el("siUnknownLines").querySelectorAll("[data-retry]").forEach(button=>button.onclick=async()=>{documentData=await api().stockInwardRetryMatching(doc.id);render();await openUnresolvedDrawer(el("siUnresolved"),doc.id);});
        el("siUnknownLines").querySelectorAll("[data-remove]").forEach(button=>button.onclick=()=>removeLine(button.dataset.remove));
        el("siUnknownLines").querySelectorAll("[data-discard]").forEach(button=>button.onclick=()=>discardLine(button.dataset.discard));
        if(!alreadyOpen) unresolvedDrawer?.open({ opener });
    }
    function closeUnresolvedDrawer() { unresolvedDrawer?.close(); }
    function updateLiveReconciliation() {
        if (!documentData || !el("siReconciliation")) return;
        const invoiceQty=el("siInvoiceQty").value;
        currentReconciliation=calculateReconciliation(documentData.summary.scannedQty,invoiceQty);
        el("siReconciliation").className=`si-reconciliation ${reconciliationClass(currentReconciliation.state)}`;
        el("siReconciliation").innerHTML=reconciliationMarkup(currentReconciliation,documentData.summary.scannedQty,invoiceQty===""?null:invoiceQty);
        updatePrimaryAction();
        if(reviewOpen)renderReviewCard();
    }
    async function removeLine(id) { if (!confirm("Remove this unposted line?")) return; try { documentData = await api().stockInwardRemoveLine({movementId:documentData.document.id,lineId:Number(id)}); render(); } catch(error){showMessage(error.message,true);} }
    async function discardLine(id) {
        const reason = prompt("Reason for discarding this unresolved barcode:");
        if (!reason) return;
        authInProgress = true;
        try { const grant = await requestAdminAuthorization("INVENTORY_INWARD"); if (!grant) return; documentData = await api().stockInwardDiscardLine({movementId:documentData.document.id,lineId:Number(id),reason,authorizationGrant:grant}); render(); }
        catch(error){showMessage(error.message,true);} finally{authInProgress=false;el("siScanner")?.focus();}
    }
    async function handlePrimaryAction() { if(reviewOpen)await post(); else await showPostReview(); }
    async function showPostReview() {
        if (!await saveContext()) return;
        if (!scannerHeaderIsValid()) { showMessage("Complete all receiving details before Review / Post.",true); updateScannerGate(); return; }
        const duplicate=await api().stockInwardFindDuplicateInvoice({supplierId:Number(el("siSupplier").value),invoiceNumber:el("siInvoiceNumber").value,excludeMovementId:documentData.document.id});
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
            const postedBefore=Number(documentData.summary.postedUnits)||0;
            const duplicate=await api().stockInwardFindDuplicateInvoice({supplierId:Number(documentData.document.supplier_id),invoiceNumber:documentData.document.invoice_number_snapshot || documentData.document.invoice_no,excludeMovementId:documentData.document.id});
            if(duplicate.duplicate){duplicateClear=false;openDuplicateModal(duplicate);updateScannerGate();return;}
            documentData = await api().stockInwardPost({movementId});
            render();
            if (documentData.pendingMaster) {
                showMessage("No recognized units were posted. Unresolved barcodes remain saved.");
            } else if (documentData.posted) {
                const added=Math.max(0,Number(documentData.summary.postedUnits)-postedBefore);
                el("siSuccessTitle").textContent=documentData.document.status==="COMPLETE"?"STOCK INWARD COMPLETE":"STOCK INWARD PARTIALLY POSTED";
                el("siSuccessCode").textContent=documentData.document.movement_no;
                el("siSuccessMessage").textContent=`${added} ${added===1?"unit":"units"} posted to inventory`;
                const unresolvedUnits=Number(documentData.summary.unresolvedUnits)||0;
                el("siSuccessUnresolved").hidden=documentData.document.status==="COMPLETE";
                el("siSuccessUnresolved").textContent=`⚠ ${unresolvedUnits} unresolved ${unresolvedUnits===1?"unit":"units"} remain`;
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
                const duplicate=await api().stockInwardFindDuplicateInvoice({supplierId:Number(documentData.document.supplier_id),invoiceNumber:documentData.document.invoice_number_snapshot || documentData.document.invoice_no,excludeMovementId:documentData.document.id}).catch(()=>null);
                if(duplicate?.duplicate){duplicateClear=false;openDuplicateModal(duplicate);}
                else showMessage("Stock Inward could not be posted. No stock was changed. Please try again.",true);
            } else showMessage("Stock Inward could not be posted. No stock was changed. Please try again.",true);
        }
        finally { authInProgress=false;if(duplicateDialog)el("siDuplicateClose")?.focus();else if(el("siSuccessOverlay")?.hidden&&!el("siScanner")?.disabled)el("siScanner")?.focus(); }
    }
    async function exportUnknown(movementId = documentData?.document.id) { try { const result=await api().stockInwardExportUnknown(movementId); if(result.cancelled)return; if(result.success)showMessage("Unknown barcode workbook saved."); else if(result.empty)showMessage("There are no unresolved barcodes to export."); else showMessage(result.error || "Export could not be completed.",true); } catch(error){showMessage(error.message,true);} }
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
        if(!await printReceipt(movementId,"history"))showMessage("Receipt could not be printed. Check the printer and retry.",true);
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
    function showMessage(text, error = false) {
        const workspace=el("stockInwardWorkspace"),target=workspace&&!workspace.hidden?el("siMessage"):el("siPageMessage");
        if(!target)return;
        clearTimeout(messageTimeout);
        for(const other of [el("siPageMessage"),el("siMessage")])if(other&&other!==target){other.textContent="";other.classList.remove("error");}
        target.textContent=text;target.classList.toggle("error",error);
        if(text)messageTimeout=setTimeout(()=>{if(target.textContent===text){target.textContent="";target.classList.remove("error");}},error?6500:4000);
    }
    async function returnToHome() {
        if (pageMode === "active" && documentData) {
            if (!await saveContext()) return;
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
        showInventory();
        const globalBack=el("settingsPageBackBtn");
        globalBack.hidden = previousBackHidden;
        globalBack.textContent = previousBackText;
        globalBack.onclick = previousBackOnclick;
        el("siPageTitle")?.remove();
        globalBack.parentElement.className = previousTopbarClass;
        requestAnimationFrame(() => document.getElementById("stockInwardBtn")?.focus());
    }
    window.openStockInwardPage = enterStockInwardPage;
})();
