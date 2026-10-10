"use strict";

(() => {
    let active=false;
    let pageMode="home";
    let documentData=null;
    let readOnly=false;
    let reviewOpen=false;
    let dirty=false;
    let activeIsNew=false;
    let contextReady=false;
    let contextRevision=0;
    let scanPending=false;
    const scanQueue=[];
    let contextPending=false;
    let lineUpdatePending=0;
    let navigationPending=false;
    let previousFocus=null;
    let previousBackHidden=false;
    let previousBackText="";
    let previousBackOnclick=null;
    let previousTopbarClass="";
    let escHandler=null;
    let historyPage=1;
    let historyKeyword="";
    let historyTotalPages=1;
    let historyTotalCount=0;
    let historyPageSize=50;
    let searchTimer=null;
    let requestId=0;
    let posting=false;
    const api=()=>window.electronAPI;
    const el=id=>document.getElementById(id);
    const REASON_LABELS={DAMAGE:"Damaged",SUPPLIER_RETURN:"Return to Supplier",ADJUSTMENT:"Stock Adjustment"};
    const VALID_REASONS=new Set(Object.keys(REASON_LABELS));
    const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
    const formatDate=value=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||""));return m?`${m[3]} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m[2])-1]||m[2]} ${m[1]}`:String(value||"—");};
    const formatUpdated=value=>{if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"short",hour:"numeric",minute:"2-digit"});};

    function showMessage(message,isError=false){const target=el(pageMode==="home"?"soPageMessage":"soMessage");if(!target)return;target.textContent=message||"";target.classList.toggle("error",Boolean(isError));}
    function safeError(error,fallback){
        const raw=String(error?.message||"");
        if(error?.code==="STOCK_OUTWARD_ZERO_STOCK")return "Insufficient stock. Available: 0 units.";
        if(error?.code==="STOCK_OUTWARD_PRODUCT_NOT_FOUND")return "Unable to add product. Please contact ADMINISTRATOR.";
        if(error?.code==="STOCK_OUTWARD_PRODUCT_INACTIVE")return "This product is inactive. Contact ADMINISTRATOR.";
        if(error?.code==="STOCK_OUTWARD_REASON_REQUIRED"||/valid Stock Outward reason|reason before scanning/i.test(raw))return "Please select a Stock Outward reason.";
        if(error?.code==="STOCK_OUTWARD_DATE_INVALID"||/valid Outward Date/i.test(raw))return "Please enter a valid Outward Date.";
        if(error?.code==="STOCK_OUTWARD_DATE_FUTURE"||/cannot be in the future/i.test(raw))return "Outward Date cannot be in the future.";
        if(error?.code==="STOCK_OUTWARD_EMPTY_DRAFT"||/Scan at least one product before saving/i.test(raw))return "Scan at least one product before saving the draft.";
        if(error?.code==="STOCK_OUTWARD_INSUFFICIENT_STOCK"){
            const available=Number(error?.available),requested=Number(error?.requested);
            if(Number.isSafeInteger(available)&&available>=0&&Number.isSafeInteger(requested)&&requested>0)
                return `Insufficient stock. Available: ${available} units. Requested: ${requested} units.`;
            return fallback;
        }
        if(/Error invoking remote method|StockOutwardError:|\n\s*at\s/.test(raw)){
            console.error("Stock Outward operation failed",error);
            return fallback;
        }
        if(/SQLITE_|constraint failed|database is locked|SQL logic error/i.test(raw)){
            console.error("Stock Outward database operation failed",error);
            return fallback;
        }
        return fallback;
    }
    function validCalendarDate(value){
        const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||""));
        if(!match)return false;
        const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
        return date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()===Number(match[2])-1&&date.getUTCDate()===Number(match[3]);
    }
    function contextErrorMessage(){
        const date=el("soDate")?.value;
        if(!validCalendarDate(date))return "Please enter a valid Outward Date.";
        if(documentData?.currentBusinessDate&&date!==documentData.currentBusinessDate)return "Use the current KLBS business date for Stock Outward.";
        if(!VALID_REASONS.has(el("soReason")?.value))return "Please select a Stock Outward reason.";
        return "";
    }
    function formContextValid(){return !contextErrorMessage();}
    function syncScannerGate(){
        const scanner=el("soScanner");if(!scanner)return;
        const valid=formContextValid()&&contextReady&&!contextPending;
        scanner.disabled=!valid;
        const hint=scanner.parentElement?.querySelector("small");
        if(hint)hint.textContent=valid?"Scan a Product Master barcode. The current available quantity is checked before the item is added.":"Enter a valid Outward Date and select a reason before scanning.";
    }
    function reviewIsValid(){
        if(!documentData||readOnly||reviewOpen||posting||scanPending||contextPending||lineUpdatePending||documentData.document?.status!=="DRAFT"||!formContextValid()||!contextReady)return false;
        const lines=documentData.lines||[];
        if(!lines.length||lines.some(line=>line.product_state!=="READY"||line.posting_state!=="UNPOSTED"||!line.product_id))return false;
        const totals=new Map();
        for(const line of lines){
            const input=el("soWorkspace")?.querySelector(`[data-qty="${Number(line.id)}"]`);
            const raw=input?input.value:line.recognized_quantity;
            if(!/^\d+$/.test(String(raw??"")))return false;
            const quantity=Number(raw),available=Number(line.available_stock);
            if(!Number.isSafeInteger(quantity)||quantity<=0||!Number.isSafeInteger(available)||quantity>available)return false;
            totals.set(Number(line.product_id),(totals.get(Number(line.product_id))||0)+quantity);
        }
        return [...totals].every(([productId,quantity])=>quantity<=Math.min(...lines.filter(line=>Number(line.product_id)===productId).map(line=>Number(line.available_stock))));
    }
    function syncReviewGate(){
        const button=el("soReview");if(!button)return;
        const valid=reviewIsValid();button.disabled=!valid;button.setAttribute("aria-disabled",String(!valid));
        button.title=valid?"Review this Stock Outward":"Enter the current business date, select a reason, scan a valid in-stock product, and enter valid quantities before review.";
    }
    function setPageTitle(value){const title=el("soPageTitle");if(title)title.textContent=value;}
    async function enter(grant){
        if(active)return;
        previousFocus=document.activeElement;
        const back=el("settingsPageBackBtn");
        previousBackHidden=back.hidden;previousBackText=back.textContent;previousBackOnclick=back.onclick;previousTopbarClass=back.parentElement.className;
        if(!await api().stockOutwardEnter(grant))throw new Error("Manager authorization is required to open Stock Outward.");
        navigationPending=false;contextPending=false;lineUpdatePending=0;
        active=true;
        el("settingsScreen").style.display="none";el("settingsPage").style.display="block";
        back.hidden=false;back.textContent="← BACK";back.parentElement.classList.add("so-page-topbar","management-pnl-topbar");
        back.insertAdjacentHTML("afterend",'<h1 id="soPageTitle">STOCK OUTWARD</h1>');
        back.onclick=()=>pageMode==="home"?leavePage():returnHome();
        el("settingsPageContent").innerHTML=`
          <section class="so-page" aria-label="Stock Outward">
            <main id="soMainScroll" class="so-main-scroll">
              <div id="soPageMessage" class="so-message" role="status" aria-live="polite"></div>
              <div id="soHome"></div>
              <div id="soWorkspace" hidden></div>
            </main>
            <footer id="soActions" class="so-actions" hidden></footer>
          </section>`;
        escHandler=event=>{
            if(event.key!=="Escape"||!active||posting)return;
            if(window.isAuthorizationPresentationPending?.())return;
            if(["productNotFoundDialog","insufficientStockDialog"].some(id=>document.getElementById(id)?.style.display==="flex"))return;
            event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
            if(pageMode==="home")leavePage();else if(reviewOpen){reviewOpen=false;renderDocument();}else returnHome();
        };
        document.addEventListener("keydown",escHandler,true);
        await showHome();
    }

    async function showHome(focusTarget="settingsPageBackBtn"){
        pageMode="home";documentData=null;readOnly=false;reviewOpen=false;dirty=false;
        setPageTitle("STOCK OUTWARD");el("soWorkspace").hidden=true;el("soHome").hidden=false;el("soActions").hidden=true;
        el("soHome").innerHTML='<p class="si-empty" role="status">Loading Stock Outward history…</p>';
        showMessage("");
        const request=++requestId;
        try{
            const [drafts,result]=await Promise.all([api().stockOutwardListDrafts(),api().stockOutwardHistory({page:historyPage,pageSize:50,keyword:historyKeyword})]);
            if(!active||request!==requestId)return;
            historyPage=Number(result?.page)||1;historyPageSize=Number(result?.pageSize)||50;historyTotalPages=Number(result?.totalPages)||1;historyTotalCount=Number(result?.totalCount)||0;
            const rows=result?.rows||[];
            const draftCards=drafts.map(row=>`<article class="so-draft-card"><div class="so-draft-field so-draft-number"><small>STOCK OUTWARD NO.</small><strong>${esc(row.movement_no)}</strong></div><div class="so-draft-field"><small>OUTWARD DATE</small><span>${esc(formatDate(row.business_date))}</span></div><div class="so-draft-field"><small>REASON</small><span>${esc(REASON_LABELS[row.reason]||"Reason not selected")}</span></div><div class="so-draft-field so-draft-numeric"><small>ITEMS</small><span>${Number(row.item_count)||0}</span></div><div class="so-draft-field so-draft-numeric"><small>TOTAL QTY</small><span>${Number(row.total_units)||0}</span></div><div class="so-draft-field so-draft-status"><span class="si-status-badge">DRAFT</span></div><div class="so-actions-inline"><button type="button" class="klbs-primary-btn" data-resume="${Number(row.id)}">RESUME</button><button type="button" class="klbs-cancel-btn" data-cancel="${Number(row.id)}">CANCEL</button><button type="button" class="so-delete-action" data-delete="${Number(row.id)}" data-document-no="${esc(row.movement_no)}">DELETE</button></div></article>`).join("");
            const tableRows=rows.map(row=>`<tr><td><span class="si-status-badge ${esc(String(row.status).toLowerCase())}">${esc(String(row.status).replaceAll("_"," "))}</span></td><td class="so-number">${esc(row.movement_no)}</td><td>${esc(formatDate(row.business_date))}</td><td>${esc(REASON_LABELS[row.reason]||row.reason||"—")}</td><td class="so-numeric">${Number(row.item_count)||0}</td><td class="so-numeric">${Number(row.total_units)||0}</td><td class="so-history-actions"><button type="button" class="view-btn" data-view="${Number(row.id)}">👁 View</button></td><td class="so-history-actions">${row.status==="COMPLETE"?`<button type="button" class="print-btn" data-reprint="${Number(row.id)}">🖨 Reprint</button>`:row.status==="CANCELLED"?`<button type="button" class="so-delete-action" data-delete="${Number(row.id)}" data-document-no="${esc(row.movement_no)}">DELETE</button>`:"—"}</td></tr>`).join("");
            const empty=rows.length?"":`<tr><td class="so-empty" colspan="8">${historyKeyword?"No matching Stock Outwards found.":"No Stock Outward history found."}</td></tr>`;
            const first=historyTotalCount?((historyPage-1)*historyPageSize)+1:0,last=Math.min(historyPage*historyPageSize,historyTotalCount);
            el("soHome").innerHTML=`<button id="soNew" type="button" class="klbs-primary-btn si-new-btn">+ NEW STOCK OUTWARD</button>${draftCards?`<section class="so-drafts"><h2>OPEN STOCK OUTWARDS</h2>${draftCards}</section>`:""}<section class="so-history"><h2>RECENT STOCK OUTWARDS</h2><label class="si-history-search-label" for="soHistorySearch">Search by outward no., reason, date or barcode</label><input id="soHistorySearch" class="si-history-search" type="search" placeholder="Search Stock Outward / reason / date / barcode..." value="${esc(historyKeyword)}"><div class="table-container si-history-table-wrap so-history-table-wrap"><table class="si-history-table so-history-table"><thead><tr><th>STATUS</th><th>STOCK OUTWARD NO</th><th>DATE</th><th>REASON</th><th>ITEMS</th><th>TOTAL QTY</th><th>VIEW</th><th>PRINT</th></tr></thead><tbody>${tableRows||empty}</tbody></table></div><div id="soPagination" class="history-pagination" ${historyTotalCount?"":"hidden"}><div class="pagination-controls"><button id="soPrevious" type="button" class="pagination-nav-btn" ${historyPage<=1?"disabled":""}>Previous</button><span>Page ${historyPage} of ${historyTotalPages}</span><label for="soPageJump">Jump to page:</label><input id="soPageJump" type="number" min="1" step="1" value="${historyPage}" max="${historyTotalPages}" aria-label="Jump to Stock Outward history page"><button id="soNext" type="button" class="pagination-nav-btn" ${historyPage>=historyTotalPages?"disabled":""}>Next</button></div><span>Showing ${first}–${last} of ${historyTotalCount} Stock Outwards</span></div></section>`;
            el("soNew").onclick=createDraft;
            el("soHome").querySelectorAll("[data-resume]").forEach(button=>button.onclick=()=>openDocument(Number(button.dataset.resume)));
            el("soHome").querySelectorAll("[data-cancel]").forEach(button=>button.onclick=()=>cancelDraft(Number(button.dataset.cancel)));
            el("soHome").querySelectorAll("[data-delete]").forEach(button=>button.onclick=()=>deleteDocument(Number(button.dataset.delete),button.dataset.documentNo));
            el("soHome").querySelectorAll("[data-view]").forEach(button=>button.onclick=()=>openDocument(Number(button.dataset.view),true));
            el("soHome").querySelectorAll("[data-reprint]").forEach(button=>button.onclick=()=>printDocument(Number(button.dataset.reprint)));
            const search=el("soHistorySearch");search.oninput=()=>{historyKeyword=search.value;historyPage=1;clearTimeout(searchTimer);searchTimer=setTimeout(()=>showHome("soHistorySearch"),180);};search.onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();clearTimeout(searchTimer);historyKeyword=search.value;historyPage=1;showHome("soHistorySearch");}};
            el("soPrevious").onclick=()=>goToHistoryPage(historyPage-1);el("soNext").onclick=()=>goToHistoryPage(historyPage+1);
            el("soPageJump").onchange=()=>{const value=el("soPageJump").value;if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>historyTotalPages){el("soPageJump").value=String(historyPage);return;}goToHistoryPage(Number(value));};
            if(focusTarget)el(focusTarget)?.focus();
        }catch(error){showMessage(error.message||"Stock Outward history could not be loaded.",true);}
    }
    async function goToHistoryPage(page){historyPage=Math.min(Math.max(Number(page)||1,1),historyTotalPages);await showHome("soPageJump");}
    async function createDraft(){
        const button=el("soNew");if(button)button.disabled=true;
        showMessage("Creating Stock Outward draft…");
        try{const created=await api().stockOutwardCreate({});await openDocument(created.movementId,{isNew:true});}
        catch(error){if(button)button.disabled=false;showMessage(safeError(error,"Stock Outward draft could not be created."),true);}
    }
    async function openDocument(id,options={}){
        showMessage("Loading Stock Outward document…");
        try{
            documentData=await api().stockOutwardLoad(id);
            if(!documentData)throw new Error("Stock Outward document was not found.");
            const historical=typeof options==="boolean"?options:Boolean(options.historical);
            activeIsNew=Boolean(options&&typeof options==="object"&&options.isNew);
            readOnly=historical||documentData.document.status!=="DRAFT";pageMode="document";reviewOpen=false;dirty=false;
            contextReady=VALID_REASONS.has(documentData.document.reason)&&validCalendarDate(documentData.document.business_date)&&(!documentData.currentBusinessDate||documentData.document.business_date===documentData.currentBusinessDate);
            renderDocument();
            if(!readOnly&&contextReady)requestAnimationFrame(()=>el("soScanner")?.focus());
        }catch(error){showMessage(safeError(error,"Stock Outward could not be opened."),true);}
    }
    function renderDocument(message="",isError=false){
        if(!documentData)return;
        const doc=documentData.document,lines=documentData.lines||[];
        pageMode="document";el("soHome").hidden=true;el("soWorkspace").hidden=false;el("soActions").hidden=false;el("soPageMessage").textContent="";
        setPageTitle(readOnly?"STOCK OUTWARD DETAILS":reviewOpen?"REVIEW STOCK OUTWARD":activeIsNew?"NEW STOCK OUTWARD":"EDIT STOCK OUTWARD");
        const locked=readOnly||reviewOpen;
        const lineRows=lines.map((line,index)=>`<tr><td class="so-numeric">${index+1}</td><td>${esc(line.barcode)}</td><td><strong>${esc(line.product_name_snapshot||"Product")}</strong><small>${esc(line.sku_snapshot||"—")}</small></td><td>${esc(line.colour_snapshot||"—")}</td><td>${esc(line.size_snapshot||"—")}</td><td class="so-numeric">${Number(line.available_stock)||0}</td><td><input class="so-qty" type="number" min="1" step="1" inputmode="numeric" value="${Number(doc.status==="COMPLETE"?line.posted_quantity:line.recognized_quantity)||0}" data-qty="${Number(line.id)}" aria-label="Outward quantity for ${esc(line.barcode)}" ${locked?"disabled":""}></td><td>${readOnly?"—":`<button type="button" class="klbs-cancel-btn so-remove" data-remove="${Number(line.id)}">REMOVE</button>`}</td></tr>`).join("");
        const total=lines.reduce((sum,line)=>sum+Number(doc.status==="COMPLETE"?line.posted_quantity:line.recognized_quantity||0),0);
        el("soWorkspace").innerHTML=`<section class="so-document-head"><strong>${esc(doc.movement_no)}</strong><span class="si-status-badge ${esc(String(doc.status).toLowerCase())}">${esc(String(doc.status).replaceAll("_"," "))}</span>${readOnly?'<span class="si-read-only-banner">READ ONLY</span>':""}<span class="so-date-label">OUTWARD DATE</span><time>${esc(formatDate(doc.business_date))}</time></section>
          <section class="si-context-grid so-context-grid" aria-label="Stock Outward details"><label>OUTWARD DATE<input id="soDate" type="date" min="${esc(documentData.currentBusinessDate||doc.business_date)}" max="${esc(documentData.currentBusinessDate||doc.business_date)}" value="${esc(doc.business_date)}" ${locked?"disabled":""}></label><label>REASON<select id="soReason" required ${locked?"disabled":""}><option value="">Select reason</option>${Object.entries(REASON_LABELS).map(([value,label])=>`<option value="${value}" ${doc.reason===value?"selected":""}>${label}</option>`).join("")}</select></label><label class="so-remarks-field">REMARKS<input id="soRemarks" type="text" maxlength="2000" value="${esc(doc.remarks||"")}" placeholder="Optional remarks" ${locked?"disabled":""}></label></section>
          ${reviewOpen||readOnly?"":`<section class="si-scan-area"><label for="soScanner">SCAN BARCODE</label><input id="soScanner" type="text" autocomplete="off" placeholder="Scan barcode and press Enter" aria-label="Scan product barcode" ${contextReady?"":"disabled"}><small>${contextReady?"Scan a Product Master barcode. The current available quantity is checked before the item is added.":"Enter a valid Outward Date and select a reason before scanning."}</small></section>`}
          <div id="soMessage" class="so-message ${isError?"error":""}" role="status" aria-live="polite">${esc(message)}</div>
          <section class="so-items"><h2>${readOnly?"OUTWARD ITEMS":"SCANNED ITEMS"}</h2><div class="si-received-table-container so-items-wrap"><table class="si-table so-items-table"><thead><tr><th>#</th><th>BARCODE</th><th>PRODUCT / SKU</th><th>COLOUR</th><th>SIZE</th><th>AVAILABLE</th><th>OUTWARD QTY</th><th>ACTION</th></tr></thead><tbody>${lineRows||`<tr><td colspan="8" class="si-empty">No items scanned yet.</td></tr>`}</tbody></table></div></section>
          <section class="si-summary so-summary"><span>TOTAL ITEMS<b>${documentData.summary?.totalItems||0}</b></span><span>TOTAL OUTWARD UNITS<b>${total}</b></span></section>
          ${reviewOpen?`<section class="so-review"><h2>REVIEW STOCK OUTWARD</h2><p><b>Outward No.:</b> ${esc(doc.movement_no)}</p><p><b>Date:</b> ${esc(formatDate(doc.business_date))}</p><p><b>Reason:</b> ${esc(REASON_LABELS[doc.reason]||doc.reason||"—")}</p><p><b>Remarks:</b> ${esc(doc.remarks||"—")}</p><p><b>Total:</b> ${lines.length} item(s), ${total} unit(s)</p></section>`:""}`;
        el("soActions").innerHTML=readOnly?`<button type="button" class="klbs-cancel-btn" id="soBackHistory">BACK TO HISTORY</button>${doc.status==="COMPLETE"?'<button type="button" class="print-btn" id="soReprint">🖨 Reprint</button>':""}`:reviewOpen?'<button type="button" class="klbs-cancel-btn" id="soEdit">BACK TO EDIT</button><button type="button" class="klbs-primary-btn" id="soPost">POST STOCK OUTWARD</button>':'<button type="button" class="klbs-cancel-btn" id="soCancel">CANCEL</button><button type="button" class="klbs-cancel-btn" id="soSave">SAVE DRAFT</button><button type="button" class="klbs-primary-btn so-review-btn" id="soReview" disabled aria-disabled="true">REVIEW &amp; POST</button>';
        el("soBackHistory")?.addEventListener("click",()=>showHome("soHistorySearch"));el("soReprint")?.addEventListener("click",()=>printDocument(doc.id));el("soEdit")?.addEventListener("click",()=>{reviewOpen=false;renderDocument();});
        el("soCancel")?.addEventListener("click",()=>cancelDraft(doc.id));el("soSave")?.addEventListener("click",saveDraft);el("soReview")?.addEventListener("click",openReview);el("soPost")?.addEventListener("click",postDocument);
        if(!locked){
            el("soDate").addEventListener("input",()=>{dirty=true;contextReady=false;contextRevision++;syncScannerGate();syncReviewGate();});
            el("soReason").addEventListener("input",()=>{dirty=true;contextReady=false;contextRevision++;syncScannerGate();syncReviewGate();});
            el("soRemarks").addEventListener("input",()=>{dirty=true;});
            for(const id of ["soDate","soReason","soRemarks"])el(id).addEventListener("change",()=>handleContextChange(id));
            el("soScanner").addEventListener("keydown",event=>{if(event.key==="Enter"&&!event.repeat){event.preventDefault();const input=event.currentTarget,barcode=input.value;input.value="";if(barcode.trim())scanQueue.push(barcode);drainScanQueue();}});
            el("soWorkspace").querySelectorAll("[data-qty]").forEach(input=>{input.addEventListener("input",syncReviewGate);input.addEventListener("change",()=>editQuantity(input));});
            el("soWorkspace").querySelectorAll("[data-remove]").forEach(button=>button.addEventListener("click",()=>removeLine(Number(button.dataset.remove))));
            syncScannerGate();
            syncReviewGate();
        }
        el("soBackHistory")?.focus();
    }
    async function persistContext(){
        if(!documentData||readOnly)return;
        if(!validCalendarDate(el("soDate").value))throw new Error("Please enter a valid Outward Date.");
        if(documentData?.currentBusinessDate&&el("soDate").value!==documentData.currentBusinessDate)throw new Error("Use the current KLBS business date for Stock Outward.");
        if(!VALID_REASONS.has(el("soReason").value))throw new Error("Please select a Stock Outward reason.");
        const nextContext={businessDate:el("soDate").value,reason:el("soReason").value,remarks:el("soRemarks").value};
        const current=documentData.document;
        if(current.business_date===nextContext.businessDate&&current.reason===nextContext.reason&&(current.remarks||"")===nextContext.remarks){
            dirty=false;contextReady=true;syncScannerGate();syncReviewGate();return documentData;
        }
        const revision=contextRevision;
        contextPending=true;syncReviewGate();
        try{
            const updated=await api().stockOutwardUpdateContext({movementId:documentData.document.id,...nextContext});
            if(revision===contextRevision){documentData=updated;dirty=false;contextReady=true;syncScannerGate();}
            return updated;
        }finally{contextPending=false;syncScannerGate();syncReviewGate();}
    }
    async function handleContextChange(changedId){
        if(!formContextValid()){syncScannerGate();showMessage(contextErrorMessage(),true);return;}
        const revision=contextRevision;
        try{
            await persistContext();
            if(revision===contextRevision)showMessage("Stock Outward details updated.");
            if(changedId!=="soRemarks"&&revision===contextRevision&&document.activeElement===el(changedId))requestAnimationFrame(()=>el("soScanner")?.focus());
        }catch(error){contextReady=false;syncScannerGate();showMessage(safeError(error,"Stock Outward details could not be updated."),true);}
    }
    async function saveDraft(){
        if(!documentData?.lines?.length){showMessage("Scan at least one product before saving the draft.",true);return;}
        try{
            await persistContext();
            await api().stockOutwardSaveDraft({movementId:documentData.document.id});
            await showHome();showMessage("Stock Outward draft saved.");
        }catch(error){showMessage(safeError(error,"Stock Outward draft could not be saved."),true);}
    }
    async function drainScanQueue(){
        if(scanPending||!scanQueue.length)return;
        scanPending=true;syncReviewGate();
        try{while(scanQueue.length){
            const barcode=scanQueue.shift();
            if(!formContextValid()||!contextReady||contextPending){showMessage(contextErrorMessage()||"Please confirm the Outward Date and reason before scanning.",true);syncScannerGate();break;}
            try{
                await persistContext();
                const result=await api().stockOutwardScan({movementId:documentData.document.id,barcode,quantity:1});
                if(result?.success===false&&typeof result.error?.code==="string"&&result.error.code.startsWith("STOCK_OUTWARD_")){
                    throw Object.assign(new Error("Stock Outward scan was rejected."),result.error);
                }
                const duplicate=Boolean(result.duplicate);documentData=result;renderDocument(duplicate?"Outward quantity increased by 1.":"Item added.");
            }catch(error){
                const scanner=el("soScanner");
                if(error?.code==="STOCK_OUTWARD_PRODUCT_NOT_FOUND"&&typeof window.showStockOutwardProductNotFoundDialog==="function"){
                    await window.showStockOutwardProductNotFoundDialog(barcode,scanner);
                }else if((error?.code==="STOCK_OUTWARD_ZERO_STOCK"||error?.code==="STOCK_OUTWARD_INSUFFICIENT_STOCK")&&
                    Number.isSafeInteger(error.available)&&error.available>=0&&Number.isSafeInteger(error.alreadyAdded)&&error.alreadyAdded>=0&&
                    Number.isSafeInteger(error.requested)&&error.requested>0&&typeof error.productName==="string"&&
                    typeof window.showStockOutwardInsufficientStockDialog==="function"){
                    await window.showStockOutwardInsufficientStockDialog({
                        productName:error.productName,available:error.available,alreadyAdded:error.alreadyAdded,
                        requested:error.requested,barcode,scannerInput:scanner
                    });
                }else if(error?.code==="STOCK_OUTWARD_PRODUCT_INACTIVE"&&typeof window.showStockOutwardInactiveWarning==="function"){
                    await window.showStockOutwardInactiveWarning(scanner);
                    if(scanner?.isConnected&&!scanner.disabled)scanner.focus();
                }else{
                    console.error("Stock Outward barcode scan failed",error);
                    showMessage(safeError(error,"Unable to add product. Please contact ADMINISTRATOR."),true);
                }
            }
        }}catch(error){
            console.error("Stock Outward scan queue failed",error);
            showMessage(safeError(error,"Unable to add product. Please contact ADMINISTRATOR."),true);
        }finally{
            scanPending=false;syncReviewGate();
            if(formContextValid()&&contextReady)requestAnimationFrame(()=>el("soScanner")?.focus());
        }
    }
    async function editQuantity(input){
        const value=input.value;
        lineUpdatePending++;syncReviewGate();
        try{documentData=await api().stockOutwardEditLine({movementId:documentData.document.id,lineId:Number(input.dataset.qty),quantity:value});renderDocument("Quantity updated.");}
        catch(error){const message=safeError(error,"Quantity could not be updated.");renderDocument(message,true);const restored=el("soWorkspace")?.querySelector(`[data-qty="${Number(input.dataset.qty)}"]`);restored?.focus();restored?.select();syncReviewGate();}
        finally{lineUpdatePending=Math.max(0,lineUpdatePending-1);syncReviewGate();}
    }
    async function removeLine(id){try{documentData=await api().stockOutwardRemoveLine({movementId:documentData.document.id,lineId:id});renderDocument("Item removed.");}
        catch(error){showMessage(safeError(error,"Item could not be removed."),true);}}
    async function cancelDraft(id){
        if(!confirm("Cancel this Stock Outward draft? No inventory will be changed."))return;
        try{await api().stockOutwardCancel({movementId:id});await showHome();showMessage("Stock Outward draft cancelled. No inventory was changed.");}
        catch(error){showMessage(safeError(error,"Draft could not be cancelled."),true);}
    }
    async function deleteDocument(id,number){
        if(!confirm(`Permanently delete Stock Outward ${number}? This is allowed only for an unposted Draft or Cancelled document. Inventory will not be changed.`))return;
        try{
            showMessage(`Deleting Stock Outward ${number}…`);
            const result=await api().stockOutwardDelete({movementId:id});
            if(!result?.success)throw new Error(result?.error||"Stock Outward could not be deleted.");
            await showHome("soHistorySearch");
            showMessage(`Stock Outward ${result.movementNo} deleted. No inventory was changed.`);
        }catch(error){showMessage(safeError(error,"Stock Outward could not be deleted."),true);}
    }
    async function returnHome(){
        if(navigationPending)return;navigationPending=true;
        try{
        const doc=documentData?.document;
        const emptyDraft=doc?.status==="DRAFT"&&!(documentData.lines||[]).length;
        const hasContext=Boolean(el("soReason")?.value||String(el("soRemarks")?.value||"").trim()||doc?.reason||String(doc?.remarks||"").trim());
        if(emptyDraft&&(dirty||hasContext)&&!await confirm("No products have been scanned. Discard this empty Stock Outward draft and its entered details?"))return;
        if(dirty&&!emptyDraft){try{await persistContext();}catch(error){showMessage(safeError(error,"Draft changes could not be saved."),true);return;}}
        if(emptyDraft){
            try{await api().stockOutwardDelete({movementId:doc.id,emptyOnly:true});}
            catch(error){showMessage(safeError(error,"The empty Stock Outward could not be closed safely."),true);return;}
        }
        activeIsNew=false;contextReady=false;await showHome();
        }finally{navigationPending=false;}
    }
    async function openReview(){
        if(!reviewIsValid()){showMessage("Complete the current business date and reason, scan at least one valid product, and correct all quantities before review.",true);syncReviewGate();return;}
        try{await persistContext();reviewOpen=true;renderDocument();}
        catch(error){showMessage(safeError(error,"Review could not be opened."),true);}
    }
    async function postDocument(){
        if(posting)return;posting=true;const button=el("soPost");if(button)button.disabled=true;
        let result;
        try{
            result=await api().stockOutwardPost({movementId:documentData.document.id});
        }catch(error){
            try{
                const latest=await api().stockOutwardLoad(documentData.document.id);
                if(latest?.document?.status==="COMPLETE")result=latest;
                else{renderDocument(safeError(error,"Stock Outward could not be posted. No partial deduction was made."),true);posting=false;return;}
            }catch(readError){console.error("Stock Outward posting status could not be confirmed",readError);renderDocument("Stock Outward status could not be confirmed. Check history before retrying.",true);posting=false;return;}
        }
        try{
            documentData=result;readOnly=true;reviewOpen=false;dirty=false;renderDocument("Stock Outward posted. Preparing receipt…");
            const printed=await api().stockOutwardPrintReceipt({movementId:documentData.document.id});
            renderDocument(printed?.success?`Stock Outward ${documentData.document.movement_no} posted and receipt printed.`:"Stock Outward posted. Receipt could not be printed; use REPRINT after checking the printer.",!printed?.success);
        }catch(printError){renderDocument("Stock Outward is posted. Receipt could not be printed; use REPRINT after checking the printer.",true);}
        finally{posting=false;}
    }
    async function printDocument(id){
        try{const result=await api().stockOutwardPrintReceipt({movementId:id});showMessage(result?.success?"Receipt printed.":result?.error||"Receipt could not be printed. Check the printer and retry.",!result?.success);}
        catch(error){showMessage(safeError(error,"Receipt could not be printed."),true);}
    }
    async function leavePage(){
        if(dirty){try{await persistContext();}catch(error){showMessage(error.message||"Draft changes could not be saved.",true);return;}}
        active=false;documentData=null;readOnly=false;reviewOpen=false;dirty=false;contextReady=false;activeIsNew=false;
        if(escHandler)document.removeEventListener("keydown",escHandler,true);escHandler=null;
        try{await api().stockOutwardExit();}catch(error){console.error("Stock Outward workspace exit failed",error);}
        window.showInventory();
        const back=el("settingsPageBackBtn");back.hidden=previousBackHidden;back.textContent=previousBackText;back.onclick=previousBackOnclick;el("soPageTitle")?.remove();back.parentElement.className=previousTopbarClass;
        requestAnimationFrame(()=>document.getElementById("stockOutwardV21Btn")?.focus());
    }
    window.openStockOutwardPage=enter;
})();
