(() => {
    const $ = id => document.getElementById(id);
    const screen = $("supplierManagementScreen");
    if (!screen) return;
    const overlay = $("supplierProfileOverlay");
    const editorView = $("supplierEditorView");
    overlay.append(editorView);
    editorView.classList.add("supplier-profile-drawer");
    const pageSize = 50;
    const views = ["supplierDirectoryView", "supplierEditorView", "supplierProfileView", "supplierAccountView", "supplierInvoiceFormView", "supplierInvoiceDetailView", "supplierPaymentFormView", "supplierOpeningFormView", "supplierCreditNoteFormView"];
    let currentView = "supplierDirectoryView", stack = [], page = 1, pages = 1, supplier = null, invoices = [], liabilities = [], paymentContext = null, paymentContextRequestId = 0, lastOrigin = "directory", rootMode = "directory", activeAccountTab = "invoices", searchTimer = null, directoryRequestId = 0, masterOptions = {}, draftRelationships = [], relationshipBeforeEdit = null, explicitRelationshipValues = { brand: new Map(), productSegment: new Map() }, drawerClosing = false, drawerExitEvents = new Set();
    const money = paise => `₹${(Number(paise || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const paise = value => { const raw=String(value??"").trim(); if(!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("Enter an amount with no more than two decimal places."); const [whole,fraction=""]=raw.split(".");const amount=Number(whole)*100+Number((fraction+"00").slice(0,2));if(!Number.isSafeInteger(amount))throw new Error("Amount exceeds the supported limit.");return amount; };
    const contactPersonPattern=/^\p{L}[\p{L}\p{M}]*(?:[.'’-]\p{L}[\p{L}\p{M}]*)*\.?(?: \p{L}[\p{L}\p{M}]*(?:[.'’-]\p{L}[\p{L}\p{M}]*)*\.?)*$/u;
    const normalizeContactPerson=value=>String(value??"").normalize("NFC").trim().replace(/\s+/gu," ");
    const validateIndianMobile=window.KLBSSupplierContactValidation.validateIndianMobile;
    const today = () => screen.dataset.businessDate || "";
    function message(value, error=false) { const target=$("supplierMessage");target.textContent=value||"";target.classList.toggle("is-error",Boolean(error)); }
    function updateBackLabel(){const labels={supplierDirectoryView:rootMode==="accounts"?"← Accounting & Data":"← Business",supplierEditorView:"← Supplier Profiles",supplierProfileView:"← Supplier Profiles",supplierAccountView:"← Supplier Accounts",supplierInvoiceFormView:"← Supplier Account",supplierInvoiceDetailView:"← Supplier Account",supplierPaymentFormView:"← Supplier Account",supplierOpeningFormView:"← Supplier Account",supplierCreditNoteFormView:"← Supplier Account"};$("supplierBackBtn").textContent=labels[currentView]||"← Back";}
    function showView(name, push=true) {
        if(push&&currentView!==name)stack.push(currentView);
        const previous=currentView, wasDrawer=previous==="supplierProfileView"||previous==="supplierEditorView", drawer=name==="supplierProfileView"||name==="supplierEditorView";
        currentView=name;
        for(const view of views){const keepExiting=wasDrawer&&!drawer&&(view===previous);$(view).hidden=!keepExiting&&view!==name&&!(name==="supplierProfileView"&&view==="supplierDirectoryView")&&!(name==="supplierEditorView"&&view==="supplierDirectoryView");}
        if(drawer){drawerClosing=false;drawerExitEvents.clear();overlay.hidden=false;overlay.classList.remove("is-closing");overlay.classList.add("is-open");requestAnimationFrame(()=>{if(currentView===name)overlay.classList.add("is-visible");});}
        else if(wasDrawer&&!overlay.hidden){drawerClosing=true;drawerExitEvents=new Set();overlay.classList.remove("is-visible");overlay.classList.add("is-closing");}
        else if(!drawerClosing)overlay.hidden=true;
        updateBackLabel();
    }
    overlay.addEventListener("transitionend",event=>{
        if(!drawerClosing)return;
        if(event.target===overlay&&event.propertyName==="opacity")drawerExitEvents.add("opacity");
        if(event.target===editorView&&event.propertyName==="transform")drawerExitEvents.add("transform");
        if(event.target===$("supplierProfileView")&&event.propertyName==="transform")drawerExitEvents.add("transform");
        if(drawerExitEvents.size<2)return;
        drawerClosing=false;overlay.hidden=true;overlay.classList.remove("is-open","is-closing","is-visible");$("supplierProfileView").hidden=true;editorView.hidden=true;drawerExitEvents.clear();
    });
    function back() {
        if(drawerClosing)return;
        if(currentView==="supplierDirectoryView"){window.closeSupplierManagement?.(rootMode);return;}
        if(currentView==="supplierAccountView"){rootMode="accounts";showView("supplierDirectoryView",false);loadDirectory({accounts:true});}
        else if(currentView==="supplierEditorView"){if($("supplierEditingCode").value)cancelEdit();else closeNewSupplier();}
        else if(currentView==="supplierProfileView")closeSupplierDrawer();
        else { const prior=stack.pop()||"supplierDirectoryView";showView(prior,false);if(prior==="supplierDirectoryView")loadDirectory({accounts:rootMode==="accounts"});if(prior==="supplierProfileView"&&supplier)renderProfile(supplier); }
    }
    async function enter(mode) {
        window.hideAllScreens?.();screen.style.display="block";stack=[];supplier=null;page=1;rootMode=mode;searchTimer=null;message("");
        const options=await window.electronAPI.getSupplierOptions();masterOptions=options;screen.dataset.businessDate=options.businessDate;
        const accounts=mode==="accounts";$("supplierScreenTitle").textContent=accounts?"SUPPLIER ACCOUNTS":"SUPPLIER PROFILES";$("supplierScreenSubtitle").textContent=accounts?"Invoices, payments, outstanding balances and account history":"Supplier details, contacts and brand mappings";$("supplierAddBtn").hidden=accounts;$("supplierSearch").placeholder=accounts?"Search Supplier Code, Supplier Name or Invoice Number":"Search Supplier Code, name, mobile or Brand";$("supplierSearch").value="";showView("supplierDirectoryView",false);await loadDirectory({accounts});
    }
    async function loadDirectory({accounts= $("supplierScreenTitle").textContent.includes("ACCOUNTS")}={}) {
        const requestId=++directoryRequestId;$("supplierDirectoryEmpty").hidden=true;$("supplierDirectoryNoResults").hidden=true;
        try {
            const search=$("supplierSearch").value.trim(), result=accounts?await window.electronAPI.listSupplierAccounts({search,page,pageSize}):await window.electronAPI.listSuppliers({search,page,pageSize,activeOnly:false});
            if(requestId!==directoryRequestId)return;
            pages=result.totalPages;page=result.page;const body=$("supplierRows"),table=$("supplierDirectoryTable"),wrap=$("supplierDirectoryTableWrap"),empty=$("supplierDirectoryEmpty"),noResults=$("supplierDirectoryNoResults"),pagination=$("supplierDirectoryPagination");body.replaceChildren();table.classList.toggle("supplier-accounts-table",accounts);
            table.querySelector("thead").innerHTML=accounts?"<tr><th>SUPPLIER</th><th>TOTAL PURCHASES</th><th>TOTAL PAID</th><th>OUTSTANDING</th><th class=\"supplier-account-col-open-invoices\">OPEN INVOICES</th><th class=\"supplier-account-col-overdue\">OVERDUE</th><th>STATUS</th><th>ACTION</th></tr>":"<tr><th>SUPPLIER CODE</th><th>SUPPLIER</th><th>BRANDS</th><th>CONTACT</th><th>SEGMENTS</th><th>STATUS</th><th>OUTSTANDING</th><th>ACTION</th></tr>";
            for(const row of result.rows){const tr=document.createElement("tr");tr.className=accounts?"supplier-directory-row supplier-accounts-display-row":"supplier-directory-row";if(!accounts){tr.tabIndex=0;tr.setAttribute("role","button");tr.setAttribute("aria-label",`Open profile for ${row.name}, ${row.supplier_code}`);}
                if(accounts){
                    const identity=document.createElement("td");identity.className="supplier-account-identity";const name=document.createElement("strong"),code=document.createElement("span");name.textContent=row.name;code.textContent=row.supplier_code;identity.append(name,code);tr.append(identity);
                    for(const value of [money(row.purchases_paise),money(row.payments_paise)]){const td=document.createElement("td");td.className="supplier-account-financial-value-cell";td.textContent=String(value);tr.append(td);}
                    const outstanding=Number(row.outstanding_paise||0),overdueCount=Number(row.overdue_invoice_count||0),financialState=outstanding===0?"cleared":overdueCount>0?"overdue":"due";
                    const outstandingCell=document.createElement("td"),outstandingValue=document.createElement("span"),outstandingLabel=document.createElement("span");outstandingCell.className=`supplier-account-outstanding is-${financialState}`;outstandingCell.dataset.financialState=financialState;outstandingCell.setAttribute("aria-label",`${money(outstanding)} ${financialState.toUpperCase()}`);outstandingValue.className="supplier-account-outstanding-value";outstandingValue.textContent=money(outstanding);outstandingLabel.className="supplier-account-state-label";outstandingLabel.textContent=financialState.toUpperCase();outstandingCell.append(outstandingValue,outstandingLabel);tr.append(outstandingCell);
                    const openInvoices=document.createElement("td");openInvoices.className="supplier-account-count-cell";openInvoices.textContent=String(row.open_invoice_count||0);tr.append(openInvoices);
                    const overdue=document.createElement("td");overdue.className=`supplier-account-count-cell supplier-account-overdue-count${overdueCount>0?" is-overdue":""}`;overdue.textContent=String(overdueCount);overdue.setAttribute("aria-label",`${overdueCount} overdue ${overdueCount===1?"invoice":"invoices"}`);tr.append(overdue);
                    const status=document.createElement("td");status.className="supplier-account-lifecycle-status";status.textContent=String(row.status);tr.append(status);
                    const action=document.createElement("td"),button=document.createElement("button");action.className="supplier-account-action-cell";button.type="button";button.className="supplier-view-account-button";button.textContent="VIEW ACCOUNT";button.setAttribute("aria-label","View account for "+row.name+", "+row.supplier_code);button.addEventListener("click",()=>openSupplier(row.supplier_code,"account"));action.append(button);tr.append(action);
                }
                else {const brandLabel=row.brands_summary?`${row.brands_summary}${Number(row.brand_count)>2?` +${Number(row.brand_count)-2}`:""}`:"—";for(const value of [row.supplier_code,row.name,brandLabel,row.mobile||"—",row.business_segments||"—",row.status,money(row.outstanding_paise)]){const td=document.createElement("td");td.textContent=String(value??"—");td.title=String(value??"");tr.append(td);}const action=document.createElement("td"),button=document.createElement("button");button.type="button";button.className="customer-open-profile";button.textContent="VIEW PROFILE";button.addEventListener("click",event=>{event.stopPropagation();openSupplier(row.supplier_code,"profile");});action.append(button);tr.append(action);}
                if(!accounts){const open=()=>openSupplier(row.supplier_code,"profile");tr.addEventListener("click",open);tr.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();open();}});}body.append(tr);
            }
            const hasSearch=Boolean(search),hasRows=result.rows.length>0,hasAnySuppliers=accounts?Number(result.totalSupplierCount)>0:Number(result.totalCount)>0;
            empty.textContent=accounts?"No supplier accounts yet.":"No suppliers yet. Use + New Supplier to create the first supplier.";noResults.textContent=accounts?"No supplier accounts match this search.":"No suppliers match this search.";
            if(accounts){const state=!hasAnySuppliers?"empty":hasSearch&&!hasRows?"no-results":"results";empty.hidden=state!=="empty";noResults.hidden=state!=="no-results";}
            else {empty.hidden=hasSearch||hasAnySuppliers;noResults.hidden=!hasSearch||hasRows;}
            wrap.hidden=!hasRows;pagination.hidden=!hasRows;
            const label=accounts?"supplier accounts":"suppliers";$("supplierPageLabel").textContent=`Page ${page} of ${pages}`;$("supplierPageJump").value=String(page);$("supplierPageJump").max=String(pages);$("supplierPrevious").disabled=page<=1;$("supplierNext").disabled=page>=pages;$("supplierDirectoryRangeLabel").textContent=`Showing ${result.totalCount?((page-1)*pageSize)+1:0}–${Math.min(page*pageSize,result.totalCount)} of ${result.totalCount} ${label}`;
        }catch(error){if(requestId===directoryRequestId)message(error.message||"Supplier directory could not be loaded.",true);}
    }
    async function openSupplier(code,view="profile") { try{const previous=currentView;supplier=await window.electronAPI.getSupplier(code);if(!supplier)throw new Error("Supplier profile was not found.");if(view==="account")lastOrigin=previous==="supplierDirectoryView"?"directory":"profile";showView(view==="account"?"supplierAccountView":"supplierProfileView");if(view==="account")await loadAccount();else renderProfile(supplier);}catch(error){message(error.message,true);} }
    const valueKey=value=>String(value||"").normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en-IN");
    function relationshipKey(row){return `${valueKey(row.brand)}\u0000${valueKey(row.productSegment)}\u0000${String(row.businessSegment||"").toUpperCase()}`;}
    function renderRelationshipDraft(){
        const host=$("supplierRelationshipRows");host.replaceChildren();
        if(!draftRelationships.length){const empty=document.createElement("p");empty.className="supplier-relationship-empty";empty.textContent="No brand mappings added yet.";host.append(empty);}
        else {const heading=document.createElement("div");heading.className="supplier-relationship-list-heading";for(const label of ["BRAND","PRODUCT SEGMENT","BUSINESS SEGMENT","ACTION"]){const span=document.createElement("span");span.textContent=label;heading.append(span);}host.append(heading);}
        for(const row of draftRelationships){
            const item=document.createElement("div");item.className="supplier-relationship-row";
            for(const value of [row.brand,row.productSegment,row.businessSegment]){const span=document.createElement("span");span.textContent=value;item.append(span);}
            const actions=document.createElement("div"),edit=document.createElement("button"),remove=document.createElement("button");
            edit.type=remove.type="button";edit.className=remove.className="customer-open-profile";edit.textContent=$("supplierEditingCode").value?"EDIT MAPPING":"EDIT";remove.textContent=$("supplierEditingCode").value?"END MAPPING":"REMOVE";
            edit.addEventListener("click",()=>openRelationshipEditor(row));
            remove.addEventListener("click",async()=>{
                if(!$("supplierEditingCode").value){draftRelationships=draftRelationships.filter(item=>item!==row);renderRelationshipDraft();return;}
                if(!row.relationshipCode){message("This saved mapping has no relationship identity. Refresh the Supplier profile before changing it.",true);return;}
                if(!confirm(`End Brand Mapping ${row.brand} | ${row.productSegment} | ${row.businessSegment}? The historical mapping will be retained.`))return;
                try{supplier=await window.electronAPI.endSupplierRelationship(supplier.supplier_code,row.relationshipCode,today());await loadDirectory({accounts:false});if(stack.at(-1)==="supplierProfileView")stack.pop();$("supplierEditingCode").value="";renderProfile(supplier);showView("supplierProfileView",false);message("Brand Mapping ended. Its history has been retained.");}
                catch(error){message(error.message||"Brand Mapping could not be ended.",true);}
            });
            actions.append(edit,remove);item.append(actions);host.append(item);
        }
        $("supplierRelationshipError").textContent=draftRelationships.length?"":"Add at least one Brand Mapping.";
    }
    function relationshipOptions(kind){const values=kind==="brand"?masterOptions.brands:masterOptions.productSegments;return [...new Set((values||[]).map(value=>String(value).normalize("NFKC").trim().replace(/\s+/g," ")).filter(Boolean))].sort((a,b)=>a.localeCompare(b));}
    function relationshipSuggestions(kind){const values=kind==="brand"?[...(masterOptions.brands||[]),...(masterOptions.brandSuggestions||[])]:[...(masterOptions.productSegments||[]),...(masterOptions.productSegmentSuggestions||[])];return [...new Set(values.map(value=>String(value).normalize("NFKC").trim().replace(/\s+/g," ")).filter(Boolean))].sort((a,b)=>a.localeCompare(b));}
    function loadRelationshipSuggestions(){for(const [kind,id] of [["brand","supplierBrandSuggestions"],["productSegment","supplierProductSegmentSuggestions"]]){const list=$(id);list.replaceChildren();for(const value of relationshipSuggestions(kind)){const option=document.createElement("option");option.value=value;list.append(option);}}}
    function closeRelationshipModal(){if($("supplierRelationshipModal").hidden)return false;$("supplierRelationshipModal").hidden=true;relationshipBeforeEdit=null;return true;}
    function refreshVocabularyAction(kind){const input=$(kind==="brand"?"supplierRelationshipBrand":"supplierRelationshipProductSegment"),button=$(kind==="brand"?"supplierAddBrandToggle":"supplierAddProductSegmentToggle"),normalized=String(input.value||"").normalize("NFKC").trim().replace(/\s+/g," "),known=relationshipOptions(kind).some(item=>valueKey(item)===valueKey(normalized))||explicitRelationshipValues[kind].has(valueKey(normalized));button.hidden=!normalized||known;button.textContent=kind==="brand"?`+ Add "${normalized}" as new Brand`:`+ Add "${normalized}" as new Product Segment`;}
    function openRelationshipEditor(row=null){relationshipBeforeEdit=row;$("supplierRelationshipEditorTitle").textContent=row?"EDIT BRAND MAPPING":"ADD BRAND MAPPING";$("supplierRelationshipSave").textContent=row?"SAVE MAPPING":"ADD MAPPING";$("supplierRelationshipBrand").value=row?.brand||"";$("supplierRelationshipProductSegment").value=row?.productSegment||"";$("supplierRelationshipBusinessSegment").value=row?.businessSegment||"";$("supplierRelationshipModalError").textContent="";for(const id of ["supplierBrandError","supplierProductSegmentError","supplierBusinessSegmentError"])$(id).textContent="";loadRelationshipSuggestions();refreshVocabularyAction("brand");refreshVocabularyAction("productSegment");$("supplierRelationshipModal").hidden=false;$("supplierRelationshipBrand").focus();}
    async function createRelationshipVocabulary(kind){const input=$(kind==="brand"?"supplierRelationshipBrand":"supplierRelationshipProductSegment"),value=String(input.value||"").normalize("NFKC").trim().replace(/\s+/g," ");if(!value)return;try{const result=kind==="brand"?await window.electronAPI.createSupplierBrand(value):await window.electronAPI.createSupplierProductSegment(value),approved=result.name;masterOptions[kind==="brand"?"brands":"productSegments"]=[...new Set([...(masterOptions[kind==="brand"?"brands":"productSegments"]||[]),approved])];explicitRelationshipValues[kind].set(valueKey(value),approved);input.value=approved;loadRelationshipSuggestions();refreshVocabularyAction(kind);}catch(error){$("supplierRelationshipModalError").textContent=error.message||"Vocabulary could not be created.";}}
    async function saveRelationshipDraft(){const enteredBrand=String($("supplierRelationshipBrand").value||"").normalize("NFKC").trim().replace(/\s+/g," "),enteredProductSegment=String($("supplierRelationshipProductSegment").value||"").normalize("NFKC").trim().replace(/\s+/g," "),brandKey=valueKey(enteredBrand),productKey=valueKey(enteredProductSegment),approvedBrand=relationshipOptions("brand").find(item=>valueKey(item)===brandKey)||explicitRelationshipValues.brand.get(brandKey),approvedProduct=relationshipOptions("productSegment").find(item=>valueKey(item)===productKey)||explicitRelationshipValues.productSegment.get(productKey),businessSegment=$("supplierRelationshipBusinessSegment").value;$("supplierBrandError").textContent=approvedBrand?"":"Select a known Brand or add this value explicitly.";$("supplierProductSegmentError").textContent=approvedProduct?"":"Select a known Product Segment or add this value explicitly.";$("supplierBusinessSegmentError").textContent=["KL","MENS","KIDS"].includes(businessSegment)?"":"Select KL, MENS, or KIDS.";if(!approvedBrand||!approvedProduct||!["KL","MENS","KIDS"].includes(businessSegment))return;const row={brand:approvedBrand,productSegment:approvedProduct,businessSegment},key=relationshipKey(row);if(draftRelationships.some(item=>relationshipKey(item)===key&&item!==relationshipBeforeEdit)){$("supplierRelationshipModalError").textContent="This Brand Mapping already exists.";return;}draftRelationships=draftRelationships.filter(item=>item!==relationshipBeforeEdit);draftRelationships.push(row);closeRelationshipModal();renderRelationshipDraft();}
    $("supplierRelationshipAddBtn").addEventListener("click",()=>openRelationshipEditor());$("supplierRelationshipSave").addEventListener("click",saveRelationshipDraft);$("supplierRelationshipCancel").addEventListener("click",closeRelationshipModal);$("supplierRelationshipClose").addEventListener("click",closeRelationshipModal);
    for(const [kind,id] of [["brand","supplierRelationshipBrand"],["productSegment","supplierRelationshipProductSegment"]])$(id).addEventListener("input",()=>refreshVocabularyAction(kind));$("supplierRelationshipBusinessSegment").addEventListener("change",()=>$("supplierBusinessSegmentError").textContent="");$("supplierAddBrandToggle").addEventListener("click",()=>createRelationshipVocabulary("brand"));$("supplierAddProductSegmentToggle").addEventListener("click",()=>createRelationshipVocabulary("productSegment"));
    function renderProfile(value){
        $("supplierProfileName").textContent=value.name;$("supplierProfileCode").textContent=value.supplier_code;$("supplierProfileStatus").textContent=value.status;$("supplierProfileType").textContent=value.supplier_type==="COMPANY"?"Company / Direct Brand":value.supplier_type;
        const summary=$("supplierProfileSummary");summary.replaceChildren();
        for(const [label,amount] of [["TOTAL PURCHASES",money(value.total_purchases_paise)],["TOTAL PAYMENTS",money(value.total_payments_paise)],["CURRENT OUTSTANDING",money(value.outstanding_paise)],["OPEN INVOICES",String(value.open_invoice_count||0)],["OVERDUE",String(value.overdue_invoice_count||0)]]){const card=document.createElement("article"),caption=document.createElement("span"),total=document.createElement("strong");caption.textContent=label;total.textContent=amount;card.append(caption,total);summary.append(card);}
        const details=$("supplierProfileDetails");details.replaceChildren();
        const groups=[["SUPPLIER DETAILS",{"Supplier Type":value.supplier_type==="COMPANY"?"Company / Direct Brand":value.supplier_type,"Legal / Billing Name":value.legal_name,"Contact Person":value.contact_person,"Primary Mobile":value.mobile,"Alternate Mobile":value.alternate_mobile,"Email":value.email}],["TAX & COMMERCIAL",{"GSTIN":value.gstin,"PAN":value.pan,"Default Credit Period":`${value.default_credit_period_days} days`}],["ADDRESS",{"Address Line 1":value.address_line_1,"Address Line 2":value.address_line_2,"City":value.city,"District":value.district,"State":value.state,"PIN Code":value.pin_code}]];
        for(const [heading,fields]of groups){const section=document.createElement("section"),title=document.createElement("h4"),dl=document.createElement("dl");section.className="supplier-profile-section";title.textContent=heading;dl.className="supplier-details";for(const [label,valueText]of Object.entries(fields)){const item=document.createElement("div"),dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=label;dd.textContent=valueText||"—";item.append(dt,dd);dl.append(item);}section.append(title,dl);details.append(section);}
        const mappings=document.createElement("section"),title=document.createElement("h4"),table=document.createElement("table");mappings.className="supplier-profile-section";title.textContent="BRAND MAPPING";table.className="supplier-relationship-table";const head=document.createElement("tr");for(const label of ["BRAND","PRODUCT SEGMENT","BUSINESS SEGMENT"]){const th=document.createElement("th");th.textContent=label;head.append(th);}table.append(head);
        for(const row of value.relationships||[]){const tr=document.createElement("tr");for(const field of ["brand","productSegment","businessSegment"]){const td=document.createElement("td");td.textContent=row[field];tr.append(td);}table.append(tr);}
        if(!(value.relationships||[]).length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=3;td.textContent="No active Brand Mappings.";tr.append(td);table.append(tr);}mappings.append(title,table);details.append(mappings);
        const notes=document.createElement("section"),notesTitle=document.createElement("h4"),notesBody=document.createElement("p");notes.className="supplier-profile-section";notesTitle.textContent="NOTES / REMARKS";notesBody.textContent=value.notes||"—";notes.append(notesTitle,notesBody);details.append(notes);
    }
    function clearProfileValidation(){const form=$("supplierProfileForm");form.querySelectorAll("[data-field-error]").forEach(el=>el.textContent="");form.querySelectorAll("[aria-invalid]").forEach(el=>el.removeAttribute("aria-invalid"));$("supplierProfileValidation").textContent="";}
    function setMobileFieldValidation(fieldName){
        const form=$("supplierProfileForm"),control=form.elements[fieldName],slot=form.querySelector(`[data-field-error="${fieldName}"]`);
        const result=validateIndianMobile(control?.value,fieldName==="mobile");
        if(!result.valid){control?.setAttribute("aria-invalid","true");if(slot)slot.textContent="Enter a valid 10-digit mobile number.";$("supplierProfileValidation").textContent="Review the highlighted Supplier profile fields.";return false;}
        control?.removeAttribute("aria-invalid");if(slot)slot.textContent="";
        if(!form.querySelector("[aria-invalid]"))$("supplierProfileValidation").textContent="";
        return true;
    }
    function bindMobileInputUX(){
        const form=$("supplierProfileForm");form.noValidate=true;
        for(const fieldName of ["mobile","alternateMobile"]){
            const input=form.elements[fieldName];
            input.maxLength=10;input.inputMode="numeric";
            input.addEventListener("beforeinput",event=>{
                if(!event.inputType?.startsWith("insert")||event.data===null)return;
                const start=input.selectionStart??input.value.length,end=input.selectionEnd??input.value.length;
                if(input.value.length-(end-start)+event.data.length>10)event.preventDefault();
            });
            input.addEventListener("paste",event=>{
                const pasted=String(event.clipboardData?.getData("text")||"").trim();
                const start=input.selectionStart??input.value.length,end=input.selectionEnd??input.value.length;
                const candidate=input.value.slice(0,start)+pasted+input.value.slice(end);
                if(!/^\d+$/.test(pasted)||candidate.length>10){event.preventDefault();input.setAttribute("aria-invalid","true");form.querySelector(`[data-field-error="${fieldName}"]`).textContent="Enter a valid 10-digit mobile number.";$("supplierProfileValidation").textContent="Review the highlighted Supplier profile fields.";return;}
                event.preventDefault();input.setRangeText(pasted,start,end,"end");
                input.dispatchEvent(new Event("input",{bubbles:true}));
            });
            input.addEventListener("input",()=>setMobileFieldValidation(fieldName));
        }
    }
    bindMobileInputUX();
    function validateProfileForm(form){
        clearProfileValidation();const errors={};const value=name=>String(form.elements[name]?.value||"").trim();
        if(!value("name"))errors.name="Supplier Name is required.";
        if(!value("supplierType"))errors.supplierType="Supplier Type is required.";
        const contactPerson=normalizeContactPerson(form.elements.contactPerson?.value);
        if(!contactPerson)errors.contactPerson="Contact Person is required.";
        else if(!contactPersonPattern.test(contactPerson))errors.contactPerson="Enter a valid contact person name.";
        else form.elements.contactPerson.value=contactPerson;
        const primary=validateIndianMobile(form.elements.mobile?.value,true);
        const alternate=validateIndianMobile(form.elements.alternateMobile?.value,false);
        if(!primary.valid)errors.mobile="Enter a valid 10-digit mobile number.";
        else form.elements.mobile.value=primary.value;
        if(!alternate.valid)errors.alternateMobile="Enter a valid 10-digit mobile number.";
        else if(alternate.value)form.elements.alternateMobile.value=alternate.value;
        if(!value("state"))errors.state="State is required.";
        const credit=value("defaultCreditPeriodDays");if(!/^\d+$/.test(credit)||Number(credit)>3650)errors.defaultCreditPeriodDays="Enter a whole number from 0 to 3650.";
        if(!draftRelationships.length)errors.relationships="Add at least one Brand Mapping.";
        const email=value("email"),gstin=value("gstin").toUpperCase(),pan=value("pan").toUpperCase(),pin=value("pinCode");
        if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))errors.email="Enter a valid Email address.";
        if(gstin&&!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(gstin))errors.gstin="Enter a valid GSTIN or leave it blank.";
        if(pan&&!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan))errors.pan="Enter a valid PAN or leave it blank.";
        if(pin&&!/^[1-9]\d{5}$/.test(pin))errors.pinCode="Enter a valid 6-digit Indian PIN Code or leave it blank.";
        for(const [field,error]of Object.entries(errors)){const slot=form.querySelector(`[data-field-error="${field}"]`);if(slot)slot.textContent=error;const control=form.elements[field];control?.setAttribute?.("aria-invalid","true");}
        if(Object.keys(errors).length){$("supplierProfileValidation").textContent="Review the highlighted Supplier profile fields.";(form.querySelector("input[aria-invalid],select[aria-invalid],textarea[aria-invalid]")||$("supplierRelationshipAddBtn"))?.focus();return false;}
        return true;
    }
    function fillForm(form,value={}){form.reset();clearProfileValidation();explicitRelationshipValues={brand:new Map(),productSegment:new Map()};const names={name:"name",legalName:"legal_name",supplierType:"supplier_type",status:"status",contactPerson:"contact_person",mobile:"mobile",alternateMobile:"alternate_mobile",email:"email",gstin:"gstin",pan:"pan",defaultCreditPeriodDays:"default_credit_period_days",addressLine1:"address_line_1",addressLine2:"address_line_2",city:"city",district:"district",state:"state",pinCode:"pin_code",notes:"notes"};for(const [field,key]of Object.entries(names))if(form.elements[field])form.elements[field].value=value[key]??(field==="status"?"ACTIVE":field==="defaultCreditPeriodDays"?"0":"");draftRelationships=(value.relationships||[]).map(row=>({relationshipCode:row.relationshipCode,brand:row.brand,productSegment:row.productSegment,businessSegment:row.businessSegment}));closeRelationshipModal();renderRelationshipDraft();}
    function formSupplier(form){const data=Object.fromEntries(new FormData(form).entries());data.defaultCreditPeriodDays=Number(data.defaultCreditPeriodDays||0);data.relationships=[...draftRelationships];return data;}
    async function loadAccount(){if(!supplier)return;const fresh=await window.electronAPI.getSupplier(supplier.supplier_code);supplier=fresh;$("supplierAccountName").textContent=fresh.name;$("supplierAccountCode").textContent=fresh.supplier_code;const summary=$("supplierAccountSummary");summary.replaceChildren();for(const [label,value] of [["TOTAL PURCHASES",money(fresh.total_purchases_paise)],["SUPPLIER CREDIT NOTES",money(fresh.credit_notes_paise)],["TOTAL PAYMENTS",money(fresh.total_payments_paise)],["CURRENT OUTSTANDING",money(fresh.outstanding_paise)],["OVERDUE",money(fresh.overdue_paise)],["OPEN LIABILITIES",String(fresh.open_liability_count||0)]]){const card=document.createElement("article");card.innerHTML="<span></span><strong></strong>";card.querySelector("span").textContent=label;card.querySelector("strong").textContent=value;summary.append(card);}const aging=$("supplierAgingSummary");aging.replaceChildren();for(const [label,value] of [["NOT YET DUE",fresh.aging.not_yet_due_paise],["1–30 DAYS OVERDUE",fresh.aging.overdue_1_30_paise],["31–60 DAYS OVERDUE",fresh.aging.overdue_31_60_paise],["61–90 DAYS OVERDUE",fresh.aging.overdue_61_90_paise],["90+ DAYS OVERDUE",fresh.aging.overdue_90_plus_paise],["DUE NEXT 7 DAYS",fresh.upcoming.due_next_7_days_paise],["DUE NEXT 15 DAYS",fresh.upcoming.due_next_15_days_paise],["DUE NEXT 30 DAYS",fresh.upcoming.due_next_30_days_paise]]){const item=document.createElement("div"),name=document.createElement("span"),amount=document.createElement("strong");item.className="supplier-aging-item";name.textContent=label;amount.textContent=money(value);item.append(name,amount);aging.append(item);}await renderAccountTab(activeAccountTab);}
    async function renderAccountTab(tab){activeAccountTab=tab;for(const button of document.querySelectorAll(".supplier-tabs button")){const active=button.dataset.tab===tab;button.classList.toggle("is-active",active);button.setAttribute("aria-pressed",String(active));}const head=$("supplierAccountHead"),body=$("supplierAccountRows");body.replaceChildren();let rows=[],columns=[],columnKinds=[];
        if(tab==="invoices"){invoices=await window.electronAPI.getSupplierInvoices(supplier.supplier_code);rows=invoices;columns=["INVOICE ID","SUPPLIER INVOICE","DATE","SEGMENT","TOTAL","PAID","CREDIT NOTES","OUTSTANDING","STATUS","DUE DATE"];columnKinds=["id","external-document","date","segment","money","money","money","money","status","date"];}
        else if(tab==="payments"){rows=await window.electronAPI.getSupplierPayments(supplier.supplier_code);columns=["PAYMENT ID","DATE","MODE","REFERENCE","AMOUNT"];columnKinds=["id","date","category","reference","money"];}
        else if(tab==="openings"){rows=await window.electronAPI.getSupplierOpeningBalances(supplier.supplier_code);columns=["OPENING BALANCE ID","AS ON DATE","REFERENCE","AMOUNT","DUE DATE","REMARKS"];columnKinds=["id","date","reference","money","date","particulars"];}
        else if(tab==="creditNotes"){rows=await window.electronAPI.getSupplierCreditNotes(supplier.supplier_code);columns=["CREDIT NOTE ID","EXTERNAL NUMBER","DATE","REASON","INVOICE","AMOUNT","REFERENCE"];columnKinds=["id","external-document","date","category","reference","money","reference"];}
        else if(tab==="outstanding"){rows=await window.electronAPI.getSupplierOpenLiabilities(supplier.supplier_code);columns=["TYPE","DOCUMENT / REFERENCE","DATE","DUE DATE","ORIGINAL","PAID","CREDITED","OUTSTANDING","AGE / DUE STATUS"];columnKinds=["category","reference","date","date","money","money","money","money","status"];}
        else{rows=await window.electronAPI.getSupplierStatement(supplier.supplier_code);columns=["DATE","PARTICULARS","REFERENCE","LIABILITY INCREASE","LIABILITY REDUCTION","RUNNING BALANCE"];columnKinds=["date","particulars","reference","money","money","money"];}
        head.replaceChildren();const tr=document.createElement("tr");for(const [index,col] of columns.entries()){const th=document.createElement("th");th.textContent=col;th.className=`supplier-column-${columnKinds[index]}`;tr.append(th);}head.append(tr);
        for(const row of rows){const tr=document.createElement("tr");let vals;
            if(tab==="invoices")vals=[row.invoice_code,row.supplier_invoice_number,row.supplier_invoice_date,row.business_segment,money(row.invoice_total_paise),money(row.paid_paise),money(row.credited_paise),money(row.outstanding_paise),row.overdue?"OVERDUE":row.payment_status,row.due_date];
            else if(tab==="payments")vals=[row.payment_code,row.payment_date,row.payment_mode,row.reference||"—",money(row.amount_paise)];
            else if(tab==="openings")vals=[row.opening_code,row.as_on_date,row.reference||"—",money(row.amount_paise),row.due_date||"As On Date",row.remarks||"—"];
            else if(tab==="creditNotes")vals=[row.credit_note_code,row.external_number||"—",row.credit_note_date,row.reason,row.reference_invoice_code||"—",money(row.amount_paise),row.reference||"—"];
            else if(tab==="outstanding")vals=[row.liability_type==="OPENING"?"OPENING OUTSTANDING":"SUPPLIER INVOICE",row.reference||row.document_code,row.liability_date,row.due_date,money(row.amount_paise),money(row.paid_paise),money(row.credited_paise),money(row.outstanding_paise),row.due_status];
            else vals=[row.event_date,row.event_type,row.reference||row.event_code,row.liability_increase_paise?money(row.liability_increase_paise):"—",row.liability_reduction_paise?money(row.liability_reduction_paise):"—",money(row.running_balance_paise)];
            for(const [index,val] of vals.entries()){const td=document.createElement("td");td.className=`supplier-column-${columnKinds[index]}`;const text=String(val??"—");if(columnKinds[index]==="reference"||columnKinds[index]==="particulars"||columnKinds[index]==="external-document")td.title=text;if(tab==="invoices"&&index===0){const open=document.createElement("button");open.type="button";open.className="customer-open-profile";open.textContent=text;open.addEventListener("click",()=>openInvoiceDetail(text));td.append(open);}else td.textContent=text;tr.append(td);}body.append(tr);}
        if(!rows.length){const empty=document.createElement("tr"),cell=document.createElement("td");empty.className="supplier-account-empty-row";cell.className="supplier-account-empty-cell";cell.colSpan=columns.length;cell.textContent=tab==="invoices"?"No Supplier invoices recorded.":tab==="payments"?"No Supplier payments recorded.":tab==="openings"?"No opening outstanding entries recorded.":tab==="creditNotes"?"No Supplier Credit Notes recorded.":tab==="outstanding"?"No open Supplier liabilities.":"No Supplier account activity recorded.";empty.append(cell);body.append(empty);}
    }
    async function openInvoiceDetail(code){
        try{
            const detail=await window.electronAPI.getSupplierInvoice(code);
            if(!detail)throw new Error("Purchase invoice was not found.");
            const target=$("supplierInvoiceDetail"),fields=[
                ["KLBS Invoice ID",detail.invoice_code],["Capture Mode",detail.capture_mode],
                ["Supplier Invoice Number",detail.supplier_invoice_number],
                ["Supplier",detail.supplier_name_snapshot+" · "+detail.supplier_code_snapshot],
                ["Supplier Invoice Date",detail.supplier_invoice_date],["Posting Date",detail.posting_date],
                ["Business Segment",detail.business_segment],["Total Quantity",detail.total_quantity??"Not captured"],
                ["Invoice Total",money(detail.invoice_total_paise)]
            ];
            if(detail.capture_mode==="SUMMARY")fields.push(["Detailed tax/product breakup","Not captured"]);
            else fields.push(["Legal / Billing Name",detail.legal_name_snapshot],["GSTIN Snapshot",detail.gstin_snapshot],
                ["Taxable before discount",money(detail.taxable_paise)],["Invoice Discount",money(detail.discount_paise)],
                ["CGST",money(detail.cgst_paise)],["SGST",money(detail.sgst_paise)],["IGST",money(detail.igst_paise)],
                ["Other Charges",money(detail.other_charges_paise)],["Rounding Adjustment",money(detail.rounding_adjustment_paise)]);
            fields.push(["Paid",money(detail.paid_paise)],["Credit Notes",money(detail.credited_paise)],
                ["Outstanding",money(detail.outstanding_paise)],["Due Date",detail.due_date],["Reference",detail.reference],["Notes",detail.notes]);
            target.replaceChildren();
            const dl=document.createElement("dl");dl.className="supplier-details";
            for(const [label,value] of fields){const item=document.createElement("div"),dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=label;dd.textContent=value??"—";item.append(dt,dd);dl.append(item);}
            target.append(dl);
            if(detail.capture_mode==="DETAILED"){
                const title=document.createElement("h3");title.textContent="INVOICE LINES";
                const table=document.createElement("table");table.className="customer-directory-table";
                const head=document.createElement("tr");
                for(const label of ["DESCRIPTION","BRAND","PRODUCT SEGMENT","BUSINESS SEGMENT","QUANTITY","UNIT COST","TAXABLE","TAX","LINE TOTAL","COST PROVENANCE"]){const th=document.createElement("th");th.textContent=label;head.append(th);}
                table.append(head);
                for(const line of detail.lines){const tr=document.createElement("tr"),values=[line.description_snapshot,line.brand_snapshot,line.product_segment_snapshot,line.business_segment,String(Number(line.quantity_milli)/1000),money(line.unit_cost_paise),money(line.taxable_paise),money(Number(line.cgst_paise)+Number(line.sgst_paise)+Number(line.igst_paise)),money(line.line_total_paise),line.cost_provenance_status];for(const value of values){const td=document.createElement("td");td.textContent=value??"—";tr.append(td);}table.append(tr);}
                target.append(title,table);
            }else{
                const note=document.createElement("p");note.className="supplier-summary-invoice-note";note.textContent="Detailed tax/product breakup not captured.";target.append(note);
            }
            showView("supplierInvoiceDetailView");
        }catch(error){message(error.message||"Invoice detail could not be loaded.",true);}
    }
    function addAllocationRow(){const row=document.createElement("div");row.className="supplier-allocation-row";const select=document.createElement("select"),amount=document.createElement("input");select.dataset.liability="true";select.innerHTML='<option value="">Select open Supplier liability</option>';for(const liability of liabilities){const option=document.createElement("option");option.value=liability.document_code;option.dataset.type=liability.liability_type;option.textContent=`${liability.liability_type==="OPENING"?"Opening":"Invoice"} · ${liability.document_code} · ${liability.reference||""} · ${money(liability.outstanding_paise)} open`;select.append(option);}amount.placeholder="Allocation ₹";amount.inputMode="decimal";amount.dataset.allocation="true";row.append(select,amount);$("supplierAllocationRows").append(row);}
    function paymentAmountState(){
        const input=$("supplierPaymentAmount"),error=$("supplierPaymentAmountError"),button=$("supplierPostPaymentBtn"),raw=String(input.value||"").trim();
        let amount=null,validation="";
        if(!paymentContext) validation="Payment account balance is loading.";
        else if(paymentContext.totalOutstandingPaise<=0) validation="There is no outstanding balance to pay.";
        else if(raw){try{amount=paise(raw);if(amount<=0)validation="Payment amount must be greater than zero.";else if(amount>paymentContext.totalOutstandingPaise)validation=`Payment cannot exceed outstanding balance of ${money(paymentContext.totalOutstandingPaise)}.`;}catch(error){validation=error.message;}}
        input.setAttribute("aria-invalid",validation?"true":"false");error.textContent=validation;button.disabled=Boolean(validation)||!raw||amount===null;
        return {amount,valid:!button.disabled};
    }
    function renderPaymentContext(context){
        $("supplierPaymentSupplier").textContent=`${context.supplierName} · ${context.supplierCode}`;
        $("supplierPaymentOutstanding").textContent=money(context.totalOutstandingPaise);
        $("supplierPaymentOpenInvoices").textContent=String(context.openInvoiceCount);
        $("supplierPaymentOpeningOutstanding").textContent=money(context.openingOutstandingPaise);
        liabilities=context.openLiabilities||[];
    }
    function renderPaymentAllocationPreview(rows){
        const host=$("supplierPaymentAllocationPreview"),body=$("supplierPaymentAllocationPreviewRows");body.replaceChildren();
        if($("supplierAllocationManual").checked||!rows?.length){host.hidden=true;return;}
        for(const row of rows){const line=document.createElement("div"),label=document.createElement("span"),amount=document.createElement("strong");line.className="supplier-payment-preview-row";label.textContent=row.liabilityType==="OPENING"?"Opening Outstanding":`Invoice ${row.documentCode}${row.reference?` · ${row.reference}`:""}`;amount.textContent=money(row.amountPaise);line.append(label,amount);body.append(line);}
        host.hidden=false;
    }
    async function refreshSupplierPaymentContext(){
        const requestId=++paymentContextRequestId,current=paymentAmountState(),amount=current.valid?current.amount:null;
        try{
            const context=await window.electronAPI.getSupplierPaymentContext(supplier.supplier_code,amount);
            if(requestId!==paymentContextRequestId)return;
            paymentContext=context;renderPaymentContext(context);const state=paymentAmountState();
            renderPaymentAllocationPreview(state.valid?context.allocationPreview:null);
        }catch(error){if(requestId===paymentContextRequestId){paymentContext=null;paymentAmountState();message(error.message||"Supplier payment context could not be loaded.",true);}}
    }
    function cancelEdit(){if(currentView!=="supplierEditorView"||!$("supplierEditingCode").value)return false;if(stack.at(-1)==="supplierProfileView")stack.pop();$("supplierEditingCode").value="";fillForm($("supplierProfileForm"),supplier);renderProfile(supplier);showView("supplierProfileView",false);message("");return true;}
    function closeSupplierDrawer(){if(currentView!=="supplierProfileView"&&currentView!=="supplierEditorView")return false;stack=[];$("supplierEditingCode").value="";showView("supplierDirectoryView",false);loadDirectory({accounts:false});return true;}
    function closeNewSupplier(){if(currentView!=="supplierEditorView"||$("supplierEditingCode").value)return false;return closeSupplierDrawer();}
    $("supplierBackBtn").addEventListener("click",back);$("supplierProfileCloseBtn").addEventListener("click",closeSupplierDrawer);$("supplierEditorCloseBtn").addEventListener("click",closeSupplierDrawer);$("supplierAddBtn").addEventListener("click",()=>{supplier=null;message("");fillForm($("supplierProfileForm"));$("supplierEditorHeading").textContent="NEW SUPPLIER";$("supplierEditingCode").value="";showView("supplierEditorView");});
    $("supplierCancelEdit").addEventListener("click",()=>$("supplierEditingCode").value?cancelEdit():closeNewSupplier());$("supplierSearch").addEventListener("input",()=>{page=1;clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadDirectory(),250);});$("supplierPrevious").addEventListener("click",()=>{page=Math.max(1,page-1);loadDirectory();});$("supplierNext").addEventListener("click",()=>{page=Math.min(pages,page+1);loadDirectory();});$("supplierPageJump").addEventListener("keydown",event=>{if(event.key!=="Enter")return;event.preventDefault();const target=Number(event.currentTarget.value);if(Number.isInteger(target)&&target>=1&&target<=pages){page=target;loadDirectory();}else event.currentTarget.value=String(page);});
    $("supplierProfileForm").addEventListener("submit",async event=>{event.preventDefault();try{const form=event.currentTarget;if(!validateProfileForm(form))return;const data=formSupplier(form),code=$("supplierEditingCode").value;supplier=code?await window.electronAPI.updateSupplier(code,data):await window.electronAPI.createSupplier(data);message("Supplier profile saved.");await loadDirectory({accounts:false});renderProfile(supplier);if(code&&stack.at(-1)==="supplierProfileView")stack.pop();$("supplierEditingCode").value="";showView("supplierProfileView",false);}catch(error){message(error.message||"Supplier could not be saved.",true);}});
    $("supplierEditBtn").addEventListener("click",()=>{message("");fillForm($("supplierProfileForm"),supplier);$("supplierEditingCode").value=supplier.supplier_code;$("supplierEditorHeading").textContent="EDIT SUPPLIER";showView("supplierEditorView");});
    $("supplierViewAccountBtn").addEventListener("click",()=>{lastOrigin="profile";showView("supplierAccountView");loadAccount();});
    function addDays(value,days){const [year,month,day]=value.split("-").map(Number),date=new Date(Date.UTC(year,month-1,day+days));return String(date.getUTCFullYear()).padStart(4,"0")+"-"+String(date.getUTCMonth()+1).padStart(2,"0")+"-"+String(date.getUTCDate()).padStart(2,"0");}
    let autoDueDate="";
    function updateInvoiceSummary(){const form=$("supplierInvoiceForm"),quantity=form.elements.totalQuantity.value,raw=String(form.elements.invoiceTotal.value||"").trim();let total="—";try{total=money(paise(raw));}catch{}$("supplierInvoiceSummaryQuantity").textContent=quantity&&/^[1-9]\d*$/.test(quantity)?quantity:"—";$("supplierInvoiceSummaryTotal").textContent=total;}
    function openSummaryInvoiceForm(){
        if(supplier.status!=="ACTIVE"){message("Inactive suppliers cannot be selected for a new invoice.",true);return;}
        const segments=[...new Set((supplier.relationships||[]).filter(row=>row.status==="ACTIVE"&&row.effectiveTo==null&&(!row.effectiveFrom||row.effectiveFrom<=today())).map(row=>row.businessSegment))].filter(value=>["KL","MENS","KIDS"].includes(value)).sort();
        if(!segments.length){message("No active Brand Mapping is available for this supplier. Add an active mapping in Supplier Profile before posting a purchase invoice.",true);return;}
        const form=$("supplierInvoiceForm"),select=form.elements.businessSegment;form.reset();select.replaceChildren(new Option("Select Business Segment",""));for(const segment of segments)select.add(new Option(segment,segment));if(segments.length===1)select.value=segments[0];
        $("supplierInvoiceContext").textContent=supplier.name+" · "+supplier.supplier_code;$("supplierInvoicePostingDate").textContent=today();form.elements.supplierInvoiceDate.value=today();
        autoDueDate=addDays(today(),Number(supplier.default_credit_period_days||0));form.elements.dueDate.value=autoDueDate;updateInvoiceSummary();message("");showView("supplierInvoiceFormView");
    }
    $("supplierNewInvoiceBtn").addEventListener("click",openSummaryInvoiceForm);
    $("supplierInvoiceForm").addEventListener("input",updateInvoiceSummary);
    $("supplierInvoiceForm").addEventListener("change",event=>{if(event.target.name!=="supplierInvoiceDate")return;const form=$("supplierInvoiceForm"),due=form.elements.dueDate;if(!due.value||due.value===autoDueDate){autoDueDate=addDays(event.target.value,Number(supplier?.default_credit_period_days||0));due.value=autoDueDate;}});
    $("supplierInvoiceForm").addEventListener("submit",async event=>{
        event.preventDefault();
        try{
            const form=event.currentTarget,d=Object.fromEntries(new FormData(form).entries()),quantity=Number(d.totalQuantity);
            if(!Number.isSafeInteger(quantity)||quantity<=0)throw new Error("Total Quantity must be a positive whole number.");
            const invoiceTotalPaise=paise(d.invoiceTotal);if(invoiceTotalPaise<=0)throw new Error("Invoice Total must be greater than zero.");
            if(!d.businessSegment)throw new Error("Select a Business Segment supported by an active Supplier Brand Mapping.");
            if(!confirm("Post purchase invoice "+d.supplierInvoiceNumber.trim()+" for "+money(invoiceTotalPaise)+"? This creates a financial liability and does not add stock."))return;
            const grant=await window.requestAdminAuthorization("SUPPLIER_INVOICE_POST");if(!grant)return;
            const result=await window.electronAPI.postSupplierInvoice({captureMode:"SUMMARY",supplierCode:supplier.supplier_code,supplierInvoiceNumber:d.supplierInvoiceNumber,supplierInvoiceDate:d.supplierInvoiceDate,businessSegment:d.businessSegment,totalQuantity:quantity,invoiceTotalPaise,dueDate:d.dueDate,notes:d.notes},grant);
            message("Purchase invoice "+result.invoice_code+" posted.");showView("supplierAccountView",false);await loadAccount();await renderAccountTab("invoices");
        }catch(error){message(error.message||"Invoice posting failed.",true);}
    });
    $("supplierNewPaymentBtn").addEventListener("click",async()=>{const form=$("supplierPaymentForm");form.reset();form.elements.paymentDate.value=today();paymentContext=null;$("supplierPaymentAllocationPreviewRows").replaceChildren();$("supplierPaymentAllocationPreview").hidden=true;$("supplierAllocationRows").replaceChildren();$("supplierManualAllocationFields").hidden=true;paymentAmountState();await refreshSupplierPaymentContext();$("supplierAllocationRows").replaceChildren();addAllocationRow();showView("supplierPaymentFormView");});
    $("supplierOpeningBtn").addEventListener("click",()=>{const form=$("supplierOpeningForm");form.reset();form.elements.asOnDate.value=today();showView("supplierOpeningFormView");});
    $("supplierOpeningForm").addEventListener("submit",async event=>{event.preventDefault();try{const data=Object.fromEntries(new FormData(event.currentTarget).entries()),amount=paise(data.amount);if(!confirm(`Post opening Supplier outstanding of ${money(amount)} as of ${data.asOnDate}? This does not create a purchase, GST or stock record.`))return;const grant=await window.requestAdminAuthorization("SUPPLIER_OPENING_BALANCE_POST");if(!grant)return;const result=await window.electronAPI.postSupplierOpeningBalance({supplierCode:supplier.supplier_code,asOnDate:data.asOnDate,dueDate:data.dueDate||null,reference:data.reference,remarks:data.remarks,amountPaise:amount},grant);message(`Opening outstanding ${result.opening_code} posted.`);showView("supplierAccountView",false);await loadAccount();await renderAccountTab("openings");}catch(error){message(error.message||"Opening outstanding could not be posted.",true);}});
    $("supplierCreditNoteBtn").addEventListener("click",async()=>{const form=$("supplierCreditNoteForm");form.reset();form.elements.creditNoteDate.value=today();form.elements.postingDate.value=today();const select=form.elements.referenceInvoiceCode;select.replaceChildren(new Option("Unlinked / apply oldest liability",""));for(const invoice of await window.electronAPI.getSupplierInvoices(supplier.supplier_code)){if(Number(invoice.outstanding_paise)<=0)continue;select.append(new Option(`${invoice.invoice_code} · ${invoice.supplier_invoice_number} · ${money(invoice.outstanding_paise)} open`,invoice.invoice_code));}showView("supplierCreditNoteFormView");});
    $("supplierCreditNoteForm").addEventListener("submit",async event=>{event.preventDefault();try{const data=Object.fromEntries(new FormData(event.currentTarget).entries()),amount=paise(data.amount);if(!confirm(`Post Supplier Credit Note for ${money(amount)}? This reduces Supplier liability and does not move stock.`))return;const grant=await window.requestAdminAuthorization("SUPPLIER_CREDIT_NOTE_POST");if(!grant)return;const result=await window.electronAPI.postSupplierCreditNote({supplierCode:supplier.supplier_code,...data,amountPaise:amount,referenceInvoiceCode:data.referenceInvoiceCode||null},grant);message(`Supplier Credit Note ${result.credit_note_code} posted.`);showView("supplierAccountView",false);await loadAccount();await renderAccountTab("creditNotes");}catch(error){message(error.message||"Supplier Credit Note could not be posted.",true);}});
    $("supplierExportBtn").addEventListener("click",async()=>{const result=await window.electronAPI.exportSupplierAccount(supplier.supplier_code);if(result?.error)message(result.error,true);else if(result?.success)message("Supplier account workbook exported.");});
    $("supplierAddAllocation").addEventListener("click",addAllocationRow);
    $("supplierPaymentAmount").addEventListener("input",()=>{paymentAmountState();refreshSupplierPaymentContext();});
    $("supplierPaymentForm").addEventListener("change",event=>{if(event.target.name==="allocationMethod"){$("supplierManualAllocationFields").hidden=event.target.value!=="MANUAL";refreshSupplierPaymentContext();}});
    $("supplierPaymentForm").addEventListener("submit",async event=>{event.preventDefault();try{const form=event.currentTarget,d=Object.fromEntries(new FormData(form).entries()),amount=paise(d.amount),method=d.allocationMethod||"OLDEST_INVOICE_FIRST",allocations=method==="MANUAL"?[...$("supplierAllocationRows").querySelectorAll(".supplier-allocation-row")].map(row=>({documentCode:row.querySelector("select").value,liabilityType:row.querySelector("select").selectedOptions[0]?.dataset.type,amountPaise:paise(row.querySelector("input").value)})):[];if(!paymentContext||amount>paymentContext.totalOutstandingPaise)throw new Error(paymentContext?.totalOutstandingPaise>0?`Payment cannot exceed outstanding balance of ${money(paymentContext.totalOutstandingPaise)}.`:"There is no outstanding balance to pay.");if(method==="MANUAL"&&allocations.reduce((sum,x)=>sum+x.amountPaise,0)!==amount)throw new Error("Manual allocations must equal the payment amount.");if(!confirm(`Post Supplier payment of ${money(amount)} using ${method==="MANUAL"?"manual allocation":"Oldest Invoice First"}?`))return;const grant=await window.requestAdminAuthorization("SUPPLIER_PAYMENT_POST");if(!grant)return;const result=await window.electronAPI.postSupplierPayment({supplierCode:supplier.supplier_code,...d,allocationMethod:method,amountPaise:amount,allocations},grant);if(result?.success===false||result?.error)throw Object.assign(new Error(result.error||"Supplier payment could not be posted."),{code:result.code});message(`Supplier payment ${result.payment_code} posted.`);showView("supplierAccountView",false);await loadAccount();await renderAccountTab("payments");}catch(error){message(error.message||"Payment posting failed.",true);}});
    for(const button of screen.querySelectorAll("[data-supplier-cancel]"))button.addEventListener("click",back);
    for(const button of screen.querySelectorAll(".supplier-tabs button"))button.addEventListener("click",()=>renderAccountTab(button.dataset.tab));
    function amountFieldToPaise(form,field){return paise(form.elements[field].value||"0");}
    window.handleSupplierEscape=()=>{if(screen.style.display==="none")return false;if(drawerClosing)return true;const focused=document.activeElement;if(focused&&screen.contains(focused)&&(focused.matches("select")||focused.list)){focused.blur();return true;}if(closeRelationshipModal())return true;if(currentView==="supplierEditorView"&&$("supplierEditingCode").value){cancelEdit();return true;}if(currentView==="supplierProfileView"||currentView==="supplierEditorView"){closeSupplierDrawer();return true;}if(currentView==="supplierDirectoryView"){window.closeSupplierManagement?.(rootMode);return true;}if(currentView==="supplierAccountView"){enter("accounts");return true;}back();return true;};
    window.openSupplierDirectory=()=>enter("directory");window.openSupplierAccounts=()=>enter("accounts");window.closeSupplierManagement=mode=>{screen.style.display="none";if(mode==="accounts")window.returnToAccountingDataWorkspace?.();else window.showBusinessWorkspace?.();};
})();
