"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

const root=path.resolve(__dirname,"..");
const prefix="V21_INV_02B_OUTWARD_LAYOUT:";
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

function sourceChecks(){
    const renderer=read("src/renderer/modules/stockOutward.js");
    const css=read("src/renderer/styles/stockOutward.css");
    const html=read("src/renderer/index.html");
    const productMaster=read("src/renderer/modules/productMasterTemplate.js");
    const inventory=read("src/renderer/modules/inventory.js");
    const main=read("src/main/main.js");
    const preload=read("src/main/preload.js");
    const schema=read("src/database/schemaVersion.js");
    assert.match(schema,/CURRENT_DB_SCHEMA_VERSION = 16/,"guarded deletion migration is authoritative schema V16");
    assert.match(schema,/from: 15, to: 16, name: "v2_1_stock_outward_document_lifecycle"/);
    assert.equal((productMaster.match(/id="stockOutwardV21Btn"/g)||[]).length,1,"one V2.1 Stock Outward Product Master entry point");
    assert(!productMaster.includes('id="stockOutwardBtn"'),"legacy single-product outward button is retired");
    assert.match(productMaster,/id="stockOutwardV21Btn"[\s\S]*?Stock Outward\s*</);
    assert.match(productMaster,/id="stockOutwardV21Btn"[\s\S]*?class="dashboard-btn"/);
    assert(!inventory.includes('openStockTransaction("OUTWARD"'),"legacy outward modal is unreachable through inventory navigation");
    assert(!preload.includes('stockOutward: (data)'),"legacy single-product outward preload API is retired");
    assert(!main.includes('ipcMain.handle(\n    "stock-outward"'),"legacy single-product outward IPC handler is retired");
    const deleteHandler=main.slice(main.indexOf('ipcMain.handle("stock-outward:delete"'),main.indexOf('ipcMain.handle("stock-outward:print-receipt"'));
    assert.match(deleteHandler,/requireStockOutwardWorkspace\(event, token\)/,"deletion IPC revalidates the manager workspace token");
    assert.match(deleteHandler,/authorization: stockOutwardDeletionAuthorization/,"IPC supplies only the main-process deletion capability");
    assert.match(renderer,/STOCK OUTWARD NO<\/th><th>DATE<\/th><th>REASON<\/th><th>ITEMS<\/th><th>TOTAL QTY<\/th><th>VIEW<\/th><th>PRINT<\/th>/);
    assert.match(renderer,/class="so-history-actions"><button[^>]+data-view/);
    assert.match(renderer,/row\.status==="CANCELLED"\?`<button[^>]+data-delete/);
    assert.match(renderer,/<th>VIEW<\/th><th>PRINT<\/th>/);
    assert.match(renderer,/Enter a valid Outward Date and select a reason before scanning/);
    assert.match(renderer,/Scan at least one product before saving the draft/);
    assert.match(renderer,/Product not found\. Contact ADMINISTRATOR\./);
    assert(!renderer.includes("Review is available after the current business date"),"permanent review guidance is removed");
    assert.match(renderer,/STOCK_OUTWARD_ZERO_STOCK/);
    assert.match(renderer,/STOCK_OUTWARD_PRODUCT_INACTIVE/);
    assert.match(renderer,/Cannot add product\. Current available stock: 0 units\./);
    assert.match(renderer,/Insufficient stock\. Available:/);
    assert.match(renderer,/class="so-draft-field so-draft-number"/);
    assert.match(renderer,/activeIsNew\?"NEW STOCK OUTWARD":"EDIT STOCK OUTWARD"/);
    assert.match(renderer,/stockOutwardSaveDraft/);
    assert.match(renderer,/data-delete[^>]*>DELETE/);
    assert.match(css,/\.so-history-table \.so-history-actions \{ white-space: nowrap; text-align: center; vertical-align: middle; \}/);
    assert.match(css,/\.so-history-table \.so-history-actions button \{ min-width: 70px; \}/);
    assert.match(css,/\.so-actions \.so-review-btn \{ background: #198754/);
    assert.match(html,/styles\/stockOutward\.css/);
}

function progress(stage){process.stdout.write(`${prefix}STAGE:${stage}\n`);}

async function rendererEval(win,source,label,timeoutMs=5000){
    let timer;
    try{
        return await Promise.race([
            win.webContents.executeJavaScript(source),
            new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error(`Renderer query timed out after ${timeoutMs}ms: ${label}`)),timeoutMs);})
        ]);
    }finally{clearTimeout(timer);}
}

async function waitForRenderer(win,source,predicate,label,timeoutMs=5000){
    const deadline=Date.now()+timeoutMs;
    let last;
    while(Date.now()<deadline){
        last=await rendererEval(win,source,label,1000);
        if(predicate(last))return last;
        await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw new Error(`Renderer state did not reach ${label} within ${timeoutMs}ms. Last value: ${JSON.stringify(last)}`);
}

function cssBundle(){
    const expand=file=>read(file).replace(/@import\s+["']([^"']+)["'];/g,(_match,reference)=>expand(path.posix.normalize(path.posix.join(path.posix.dirname(file),reference))));
    return `${expand("src/renderer/style.css")}\n${read("src/renderer/styles/stockInward.css")}\n${read("src/renderer/styles/stockOutward.css")}`;
}

async function child(){
    const {app,BrowserWindow}=require("electron");
    await app.whenReady();
    const win=new BrowserWindow({show:false,frame:false,width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on("console-message",(_event,_level,message)=>console.error("renderer:",message));
    win.webContents.on("unresponsive",()=>console.error("layout-electron:renderer-unresponsive"));
    win.webContents.on("render-process-gone",(_event,details)=>console.error("layout-electron:renderer-gone",JSON.stringify(details)));
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),"klbs-v21-inv02b-layout-"));
    try{
        const moduleSource=read("src/renderer/modules/stockOutward.js").replace(/<\/script/gi,"<\\/script");
    const html=`<!doctype html><html><head><meta charset="utf-8"><style>${cssBundle()}</style><style>html{width:100%;height:100%;margin:0;overflow-x:hidden;overflow-y:auto}body{width:100%;height:auto;min-height:100%;margin:0;padding:40px;overflow-x:hidden}#settingsScreen{display:none}#settingsPage{display:block}.topbar{display:flex;align-items:center;gap:15px;width:min(1440px,calc(100% - 56px));margin:0 auto}.bill-top-bar{min-height:44px}#settingsPageContent{width:min(1440px,calc(100% - 56px));margin:0 auto}#soPageTitle{margin:0}.si-status-badge{display:inline-flex}button{font:inherit}</style></head><body><div id="settingsScreen"></div><div id="settingsPage"><div class="bill-top-bar"><button id="settingsPageBackBtn" class="back-btn">BACK</button></div><main id="settingsPageContent"></main></div><script>
          window.__calls={posts:0,prints:0,deletes:[],emptyDeletes:[],creates:0,saves:0,cancels:0,contextUpdates:0,scans:[]};
        window.__drafts=[{id:20,movement_no:"KLOUT000020",status:"DRAFT",business_date:"2026-10-08",reason:"DAMAGE",item_count:1,total_units:1,updated_at:"2026-10-08T06:00:00Z"},{id:19,movement_no:"KLOUT000019",status:"DRAFT",business_date:"2026-10-07",reason:"SUPPLIER_RETURN",item_count:3,total_units:7,updated_at:"2026-10-07T06:00:00Z"}];
          window.__history=[{id:21,status:"COMPLETE",movement_no:"KLOUT000021",business_date:"2026-10-08",reason:"DAMAGE",item_count:3,total_units:7},{id:22,status:"COMPLETE",movement_no:"KLOUT000022",business_date:"2026-10-07",reason:"SUPPLIER_RETURN",item_count:1,total_units:2}];
          window.confirm=()=>true;
          const draftDetail={document:{id:100,movement_no:"KLOUT000100",status:"DRAFT",business_date:"2026-10-09",reason:"DAMAGE",remarks:"Test remarks"},lines:[{id:501,barcode:"00123",scanned_quantity:1,recognized_quantity:1,product_id:1,product_state:"READY",posting_state:"UNPOSTED",posted_quantity:0,sku_snapshot:"SKU-1",product_name_snapshot:"Kurti One",colour_snapshot:"Blue",size_snapshot:"M",available_stock:5}],summary:{totalItems:1,totalUnits:1}};
          const postedDetail={document:{...draftDetail.document,status:"COMPLETE",posted_at:"2026-10-09T06:00:00.000Z"},lines:[{...draftDetail.lines[0],posting_state:"POSTED",posted_quantity:1}],summary:{totalItems:1,totalUnits:1}};
          window.electronAPI={
            stockOutwardEnter:async()=>true,stockOutwardExit:async()=>({success:true}),
            stockOutwardListDrafts:async()=>window.__drafts,
            stockOutwardHistory:async()=>({rows:window.__history,totalCount:window.__history.length,page:1,totalPages:1,pageSize:50}),
            stockOutwardDelete:async({movementId,emptyOnly})=>{window.__calls.deletes.push(movementId);if(emptyOnly)window.__calls.emptyDeletes.push(movementId);window.__drafts=window.__drafts.filter(row=>row.id!==movementId);window.__history=window.__history.filter(row=>row.id!==movementId);return {success:true,movementNo:"KLOUT"+String(movementId).padStart(6,"0")};},
          stockOutwardCreate:async()=>{window.__calls.creates++;window.__hasScanned=false;return {movementId:100};},
            stockOutwardLoad:async id=>Number(id)===19?draftDetail:({document:{...draftDetail.document,reason:null,remarks:null},lines:[],summary:{totalItems:0,totalUnits:0}}),
            stockOutwardUpdateContext:async({businessDate,reason,remarks})=>{window.__calls.contextUpdates++;const detail=window.__hasScanned?draftDetail:{document:{...draftDetail.document,reason:null,remarks:null},lines:[],summary:{totalItems:0,totalUnits:0}};return {...detail,document:{...detail.document,business_date:businessDate,reason,remarks}};},
            stockOutwardSaveDraft:async()=>{window.__calls.saves++;return {success:true};},
            stockOutwardCancel:async({movementId})=>{window.__calls.cancels++;const row=window.__drafts.find(item=>item.id===movementId);if(row){window.__drafts=window.__drafts.filter(item=>item.id!==movementId);window.__history.push({...row,status:"CANCELLED"});}return {cancelled:true,hadLines:true};},
            stockOutwardScan:async({barcode})=>{window.__calls.scans.push(barcode);if(barcode==="UNKNOWN")throw Object.assign(new Error("Stock Outward scan failed."),{code:"STOCK_OUTWARD_PRODUCT_NOT_FOUND"});if(barcode==="ZERO")throw Object.assign(new Error("Stock Outward scan failed."),{code:"STOCK_OUTWARD_ZERO_STOCK"});if(barcode==="SHORT")throw Object.assign(new Error("Stock Outward scan failed."),{code:"STOCK_OUTWARD_INSUFFICIENT_STOCK",available:2,requested:3});if(barcode==="INACTIVE")throw Object.assign(new Error("Stock Outward scan failed."),{code:"STOCK_OUTWARD_PRODUCT_INACTIVE"});if(barcode==="FAIL")throw new Error("SQLITE_ERROR at /private/internal/database.js");window.__hasScanned=true;return {...draftDetail,duplicate:false};},
            stockOutwardPost:async()=>{window.__calls.posts++;return postedDetail;},
            stockOutwardPrintReceipt:async()=>{window.__calls.prints++;return {success:false,error:"offline"};}
          };
          window.__alerts=[];window.showNativeAlert=async message=>{window.__alerts.push(message);return {response:0};};
          window.showInventory=()=>{};
        </script><script>${moduleSource}</script><script>window.__outwardReady=window.openStockOutwardPage("layout-test");</script></body></html>`;
        const file=path.join(temp,"layout.html");fs.writeFileSync(file,html,"utf8");await win.loadFile(file);await win.webContents.executeJavaScript("window.__outwardReady");
        const results=[];
        for(const width of [1920,1400,1280,980]){
            win.setContentSize(width,width===1920?1080:width===1280?720:900);await new Promise(resolve=>setTimeout(resolve,80));
            const value=await win.webContents.executeJavaScript(`(()=>{const table=document.querySelector('.so-history-table'),wrap=document.querySelector('.so-history-table-wrap'),rows=[...table.tBodies[0].rows],heads=[...table.tHead.rows[0].cells],row=rows[0],view=row.querySelector('[data-view]'),print=row.querySelector('[data-reprint]'),drafts=[...document.querySelectorAll('.so-draft-card')],draft=drafts[0],draftActions=draft?.querySelector('.so-actions-inline'),rect=x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};const overflow=table.scrollWidth-wrap.clientWidth;if(innerWidth<1280)wrap.scrollLeft=wrap.scrollWidth;return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,container:wrap.clientWidth,tableWidth:table.clientWidth,tableScrollWidth:table.scrollWidth,headCount:heads.length,rowCells:row.cells.length,cellDisplays:[...row.cells].map(c=>getComputedStyle(c).display),viewIndex:view.parentElement.cellIndex,printIndex:print.parentElement.cellIndex,view:rect(view),print:rect(print),viewCell:rect(row.cells[6]),printCell:rect(row.cells[7]),headerView:rect(heads[6]),headerPrint:rect(heads[7]),headerText:getComputedStyle(heads[0]).color,headerBackground:getComputedStyle(heads[0]).backgroundColor,viewColor:getComputedStyle(view).backgroundColor,printColor:getComputedStyle(print).backgroundColor,rowHeight:rect(row).height,printReachable:print.getBoundingClientRect().right<=wrap.getBoundingClientRect().right+1,overflow,draftCount:drafts.length,draftFields:draft?.querySelectorAll('.so-draft-field').length||0,draftActionsRight:draftActions?rect(draftActions).right:0,draftRight:draft?rect(draft).right:0,draftRows:drafts.map(card=>({right:rect(card).right,actionsRight:rect(card.querySelector('.so-actions-inline')).right,fields:card.querySelectorAll('.so-draft-field').length}))};})()`);
            assert.equal(value.headCount,8,`8 header columns at ${width}`);assert.equal(value.rowCells,8,`8 body cells at ${width}`);assert(value.cellDisplays.every(display=>display==="table-cell"));
            assert.equal(value.viewIndex,6);assert.equal(value.printIndex,7);assert(Math.abs(value.view.top-value.print.top)<=1,"VIEW and REPRINT are on one row");
            assert(Math.abs((value.view.left+value.view.right)/2-(value.headerView.left+value.headerView.right)/2)<24,"VIEW remains within VIEW column");assert(Math.abs((value.print.left+value.print.right)/2-(value.headerPrint.left+value.headerPrint.right)/2)<24,"REPRINT remains within PRINT column");
            assert(value.view.left>=value.viewCell.left&&value.view.right<=value.viewCell.right);assert(value.print.left>=value.printCell.left&&value.print.right<=value.printCell.right);
            assert.equal(value.headerText,"rgb(255, 255, 255)");assert.notEqual(value.headerBackground,"rgba(0, 0, 0, 0)");assert.equal(value.viewColor,"rgb(13, 110, 253)");assert.equal(value.printColor,"rgb(25, 135, 84)");
            assert(value.rowHeight<=60,`compact history row ${value.rowHeight}px`);assert(value.pageWidth<=value.viewport,`no page overflow at ${width}`);assert(value.printReachable,`PRINT button reachable inside the table scroller at ${width}`);
            assert.equal(value.draftCount,2,`multiple open outward drafts at ${width}`);assert.equal(value.draftFields,6,`open draft row exists at ${width}`);assert(value.draftRows.every(card=>card.fields===6&&card.actionsRight<=card.right+1),"all draft actions stay aligned inside full-width rows");assert(value.draftActionsRight<=value.draftRight+1,"draft actions stay aligned inside the full-width row");
            if(width>=1280){assert(value.overflow<=1,`no history horizontal scrolling required at ${width}: ${value.overflow}px`);assert(value.printReachable,`PRINT visible without horizontal scrolling at ${width}`);}
            else assert(value.overflow>=0,"narrow fallback remains contained");
            results.push(value);
        }
        await win.webContents.executeJavaScript(`window.__history.push({id:23,status:"CANCELLED",movement_no:"KLOUT000023",business_date:"2026-10-06",reason:"ADJUSTMENT",item_count:1,total_units:2});document.getElementById('soHistorySearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);await new Promise(resolve=>setTimeout(resolve,80));
        const actions=await win.webContents.executeJavaScript(`(()=>({draftDelete:Boolean(document.querySelector('[data-delete="20"]')),cancelledDelete:Boolean(document.querySelector('[data-delete="23"]')),completeDelete:document.querySelector('[data-view="21"]')?.closest('tr')?.querySelector('[data-delete]')||null}))()`);
        assert(actions.draftDelete&&actions.cancelledDelete,"Draft and Cancelled rows expose deletion");assert.equal(actions.completeDelete,null,"Complete rows never expose deletion");
        await win.webContents.executeJavaScript("document.querySelector('[data-resume=\"19\"]').click()");
        const resumed=await waitForRenderer(win,"document.getElementById('soPageTitle')?.textContent||''",value=>value==="EDIT STOCK OUTWARD","resume open Stock Outward draft");assert.equal(resumed,"EDIT STOCK OUTWARD");
        await win.webContents.executeJavaScript("document.getElementById('settingsPageBackBtn').click()");
        await waitForRenderer(win,"document.getElementById('soPageTitle')?.textContent||''",value=>value==="STOCK OUTWARD","return from resumed Stock Outward draft");
        await win.webContents.executeJavaScript("document.querySelector('[data-cancel=\"19\"]').click()");
        await waitForRenderer(win,"JSON.stringify({cancels:window.__calls.cancels,title:document.getElementById('soPageTitle').textContent})",value=>JSON.parse(value).cancels===1&&JSON.parse(value).title==="STOCK OUTWARD","cancel open Stock Outward draft");
        await win.webContents.executeJavaScript(`document.querySelector('[data-delete="20"]').click()`);await new Promise(resolve=>setTimeout(resolve,60));
        await win.webContents.executeJavaScript(`document.querySelector('[data-delete="23"]').click()`);await new Promise(resolve=>setTimeout(resolve,60));
        const deletion=await win.webContents.executeJavaScript("JSON.stringify(window.__calls.deletes)");
        assert.deepEqual(JSON.parse(deletion),[20,23],"confirmation path calls deletion and refreshes history for Draft and Cancelled documents");
        win.setContentSize(1280,720);await win.webContents.executeJavaScript("document.getElementById('soNew').click()");await new Promise(resolve=>setTimeout(resolve,100));
        const gated=await win.webContents.executeJavaScript(`(()=>({disabled:document.getElementById('soScanner').disabled,title:document.getElementById('soPageTitle').textContent}))()`);
        assert.equal(gated.title,"NEW STOCK OUTWARD");assert.equal(gated.disabled,true,"new outward scan remains gated until reason is selected");
        assert.equal(await win.webContents.executeJavaScript("document.getElementById('soReview').disabled"),true,"Review & Post is disabled with no scanned products");
        await win.webContents.executeJavaScript("document.getElementById('soReview').click()");
        assert.equal(await win.webContents.executeJavaScript("window.__calls.posts"),0,"disabled Review & Post cannot invoke posting");
        await win.webContents.executeJavaScript("document.getElementById('soDate').value='';document.getElementById('soDate').dispatchEvent(new Event('input',{bubbles:true}));");
        assert.equal(await win.webContents.executeJavaScript("document.getElementById('soScanner').disabled"),true,"missing date keeps barcode scanning disabled");
        await win.webContents.executeJavaScript("document.getElementById('soDate').value='2026-10-09';document.getElementById('soDate').dispatchEvent(new Event('input',{bubbles:true}));");
        await win.webContents.executeJavaScript("document.getElementById('soDate').dispatchEvent(new Event('change',{bubbles:true}));");await new Promise(resolve=>setTimeout(resolve,30));
        assert.equal(await win.webContents.executeJavaScript("window.__calls.contextUpdates"),0,"incomplete date/reason context does not invoke the update-context IPC");
        assert.match(await win.webContents.executeJavaScript("document.getElementById('soMessage').textContent"),/select a Stock Outward reason/i,"incomplete context receives cashier language");
        await win.webContents.executeJavaScript("document.getElementById('soSave').click()");await new Promise(resolve=>setTimeout(resolve,30));
        assert.equal(await win.webContents.executeJavaScript("document.getElementById('soMessage').textContent"),"Scan at least one product before saving the draft.");
        await win.webContents.executeJavaScript("document.getElementById('soSave').click()");
        const emptySaves=await win.webContents.executeJavaScript("JSON.stringify({saves:window.__calls.saves,creates:window.__calls.creates})");
        assert.deepEqual(JSON.parse(emptySaves),{saves:0,creates:1},"repeated empty Save Draft creates no saved or duplicate documents");
        await win.webContents.executeJavaScript("const reason=document.getElementById('soReason');reason.value='DAMAGE';reason.dispatchEvent(new Event('input',{bubbles:true}));reason.dispatchEvent(new Event('change',{bubbles:true}));");await new Promise(resolve=>setTimeout(resolve,80));
        await win.webContents.executeJavaScript("document.getElementById('settingsPageBackBtn').click();document.getElementById('settingsPageBackBtn').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");await new Promise(resolve=>setTimeout(resolve,80));
        const cleanup=await win.webContents.executeJavaScript("JSON.stringify({emptyDeletes:window.__calls.emptyDeletes,drafts:window.__drafts.length,title:document.getElementById('soPageTitle').textContent})");
        assert.deepEqual(JSON.parse(cleanup),{emptyDeletes:[100],drafts:0,title:"STOCK OUTWARD"},"Back safely removes the untouched internal draft after Draft and Cancelled lifecycle checks");
        await win.webContents.executeJavaScript("document.getElementById('soNew').click()");await new Promise(resolve=>setTimeout(resolve,80));
        await win.webContents.executeJavaScript("document.getElementById('soCancel').click()");await new Promise(resolve=>setTimeout(resolve,80));
        assert.equal(await win.webContents.executeJavaScript("window.__calls.cancels"),2,"open draft Cancel and new-document Cancel follow the existing cancellation API");
        assert.equal(await win.webContents.executeJavaScript("document.getElementById('soPageTitle').textContent"),"STOCK OUTWARD","empty Cancel returns to the Stock Outward landing page");
        await win.webContents.executeJavaScript("document.getElementById('soNew').click()");await new Promise(resolve=>setTimeout(resolve,80));
        await win.webContents.executeJavaScript("const r=document.getElementById('soReason');r.value='DAMAGE';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));");await new Promise(resolve=>setTimeout(resolve,80));
        await win.webContents.executeJavaScript("document.getElementById('soScanner').value='UNKNOWN';document.getElementById('soScanner').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");await new Promise(resolve=>setTimeout(resolve,80));
        const unknown=await win.webContents.executeJavaScript(`(()=>({alerts:window.__alerts,rows:document.querySelectorAll('.so-items-table tbody tr').length,scannerValue:document.getElementById('soScanner').value,scannerFocused:document.activeElement===document.getElementById('soScanner')}))()`);
        assert.deepEqual(unknown.alerts,["Product not found. Contact ADMINISTRATOR."]);assert.equal(unknown.rows,1);assert.equal(unknown.scannerValue,"");assert(unknown.scannerFocused);
        await win.webContents.executeJavaScript("document.getElementById('soScanner').value='00123';document.getElementById('soScanner').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");await new Promise(resolve=>setTimeout(resolve,80));
        await win.webContents.executeJavaScript("document.getElementById('soScanner').value='UNKNOWN';document.getElementById('soScanner').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");await new Promise(resolve=>setTimeout(resolve,80));
        const preserved=await win.webContents.executeJavaScript("JSON.stringify({alerts:window.__alerts.length,lines:document.querySelectorAll('.so-items-table tbody tr [data-qty]').length,scannerValue:document.getElementById('soScanner').value})");
        assert.deepEqual(JSON.parse(preserved),{alerts:2,lines:1,scannerValue:""},"unknown barcode alerts once per scan and preserves earlier valid items");
        await win.webContents.executeJavaScript("document.getElementById('soScanner').value='ZERO';document.getElementById('soScanner').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));document.getElementById('soScanner').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");await new Promise(resolve=>setTimeout(resolve,80));
        assert.equal(await win.webContents.executeJavaScript("document.getElementById('soMessage').textContent"),"Cannot add product. Current available stock: 0 units.");
        assert.equal(await win.webContents.executeJavaScript("window.__calls.scans.filter(value=>value==='ZERO').length"),1,"rapid duplicate Enter while request is pending invokes one scan");
        assert.equal(await win.webContents.executeJavaScript("document.activeElement===document.getElementById('soScanner')"),true,"scanner focus returns after zero-stock rejection");
        await win.webContents.executeJavaScript("document.getElementById('soScanner').value='SHORT';document.getElementById('soScanner').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");await new Promise(resolve=>setTimeout(resolve,80));
        assert.equal(await win.webContents.executeJavaScript("document.getElementById('soMessage').textContent"),"Insufficient stock. Available: 2 units. Requested: 3 units.");
        await win.webContents.executeJavaScript("document.getElementById('soScanner').value='INACTIVE';document.getElementById('soScanner').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");await new Promise(resolve=>setTimeout(resolve,80));
        assert.equal(await win.webContents.executeJavaScript("document.getElementById('soMessage').textContent"),"This product is inactive. Contact ADMINISTRATOR.");
        await win.webContents.executeJavaScript("document.getElementById('soScanner').value='FAIL';document.getElementById('soScanner').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");await new Promise(resolve=>setTimeout(resolve,80));
        const unexpected=await win.webContents.executeJavaScript("JSON.stringify({message:document.getElementById('soMessage').textContent,scannerFocused:document.activeElement===document.getElementById('soScanner')})");
        assert.deepEqual(JSON.parse(unexpected),{message:"Unable to add product. Please contact ADMINISTRATOR.",scannerFocused:true},"unexpected IPC details are hidden and cashier feedback remains safe");
        assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.so-items-table tbody tr [data-qty]').length"),1,"all rejected scans preserve previously scanned valid lines");
        const entry=await win.webContents.executeJavaScript(`(()=>({title:document.getElementById('soPageTitle').textContent,date:Boolean(document.getElementById('soDate')),reason:Boolean(document.getElementById('soReason')),remarks:Boolean(document.getElementById('soRemarks')),scanner:Boolean(document.getElementById('soScanner')),scannerDisabled:document.getElementById('soScanner').disabled,columns:document.querySelectorAll('.so-items-table thead th').length,pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,save:Boolean(document.getElementById('soSave')),review:Boolean(document.getElementById('soReview')),validLines:document.querySelectorAll('.so-items-table tbody tr [data-qty]').length}))()`);
        assert.equal(entry.title,"NEW STOCK OUTWARD");assert(entry.date&&entry.reason&&entry.remarks&&entry.scanner);assert.equal(entry.scannerDisabled,false);assert.equal(entry.columns,8);assert(entry.save&&entry.review);assert.equal(entry.validLines,1);assert(entry.pageWidth<=entry.viewport,"entry page has no page-level horizontal overflow at production-equivalent width");
        assert.equal(await win.webContents.executeJavaScript("document.getElementById('soReview').disabled"),false,"valid scanned line enables Review & Post");
        const footerGeometries=[];
        for(const [width,height] of [[1920,1080],[1400,900],[1280,720],[980,900]]){
            win.setContentSize(width,height);await new Promise(resolve=>setTimeout(resolve,60));
            const geometry=await rendererEval(win,`(()=>{const summary=document.querySelector('.so-summary'),footer=document.getElementById('soActions'),scroller=document.scrollingElement;scroller.scrollTop=scroller.scrollHeight;const s=summary.getBoundingClientRect(),f=footer.getBoundingClientRect(),buttons=[...footer.querySelectorAll('button')].map(button=>button.getBoundingClientRect());return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,summaryBottom:s.bottom,footerTop:f.top,footerBottom:f.bottom,buttonBottom:Math.max(...buttons.map(r=>r.bottom)),documentHeight:scroller.scrollHeight,summaryText:summary.innerText};})()`,`Stock Outward footer at ${width}x${height}`);
            assert(geometry.pageWidth<=geometry.width,`no page horizontal overflow at ${width}px`);
            assert(geometry.summaryBottom<=geometry.footerTop+1,`outward total summary remains above the footer at ${width}x${height}: ${JSON.stringify(geometry)}`);
            assert(geometry.buttonBottom<=geometry.height+1,`footer actions remain visible after scroll at ${width}x${height}: ${JSON.stringify(geometry)}`);
            assert.match(geometry.summaryText,/TOTAL ITEMS[\s\S]*TOTAL OUTWARD UNITS/);
            footerGeometries.push(geometry);
        }
        win.setContentSize(1280,720);
        process.stdout.write(`${prefix}FOOTER:${JSON.stringify(footerGeometries)}\n`);
        process.stdout.write(`${prefix}ENTRY:${JSON.stringify(entry)}\n`);
        const reviewColor=await win.webContents.executeJavaScript("getComputedStyle(document.getElementById('soReview')).backgroundColor");assert.equal(reviewColor,"rgb(25, 135, 84)");
        await win.webContents.executeJavaScript("(()=>{const q=document.querySelector('[data-qty]');q.value='6';q.dispatchEvent(new Event('input',{bubbles:true}));})()");
        assert.equal(await win.webContents.executeJavaScript("document.getElementById('soReview').disabled"),true,"excess quantity disables Review & Post before backend invocation");
        assert.equal(await win.webContents.executeJavaScript("window.__calls.posts"),0,"invalid quantity does not invoke posting");
        await win.webContents.executeJavaScript("(()=>{const q=document.querySelector('[data-qty]');q.value='1';q.dispatchEvent(new Event('input',{bubbles:true}));})()");
        assert.equal(await win.webContents.executeJavaScript("document.getElementById('soReview').disabled"),false,"restoring a valid quantity re-enables review");
        await win.webContents.executeJavaScript("document.getElementById('soReview').click()");
        const reviewState=await waitForRenderer(win,"JSON.stringify({post:document.getElementById('soPost')?.textContent||'',title:document.getElementById('soPageTitle').textContent,message:document.getElementById('soMessage').textContent,actions:document.getElementById('soActions').textContent,qty:document.querySelectorAll('[data-qty]').length})",value=>JSON.parse(value).post==="POST STOCK OUTWARD","Review & Post transition");
        assert.equal(JSON.parse(reviewState).post,"POST STOCK OUTWARD",`review state exposes the post action: ${reviewState}`);
        await win.webContents.executeJavaScript("document.getElementById('soPost').click()");
        const printFailure=await waitForRenderer(win,`(()=>({posts:window.__calls.posts,prints:window.__calls.prints,message:document.getElementById('soMessage').textContent,reprint:Boolean(document.getElementById('soReprint')),readOnly:Boolean(document.querySelector('.si-read-only-banner'))}))()`,value=>value.posts===1&&value.prints===1&&value.readOnly,"posted document and receipt attempt");
        assert.equal(printFailure.posts,1);assert.equal(printFailure.prints,1);assert.match(printFailure.message,/posted.*could not be printed/i);assert(printFailure.reprint,"committed document remains available for reprint after printer failure");
        const inwardModule=read("src/renderer/modules/stockInward.js");
        const inwardHtml=`<!doctype html><html><head><meta charset="utf-8"><style>${cssBundle()}</style><style>html,body{min-height:100%;margin:0}body{padding:40px;overflow-x:hidden}#settingsPage:has(.stock-inward-page)>.bill-top-bar{width:calc(100% - 56px);margin:0 auto 18px;padding:20px 0 0}#settingsPageContent:has(.stock-inward-page){width:calc(100% - 56px);max-width:none;margin:0 auto}</style></head><body><div id="settingsScreen"></div><div id="settingsPage" style="display:none"><div class="topbar"><button id="settingsPageBackBtn" class="back-btn">BACK</button></div><main id="settingsPageContent"></main></div><script>
          window.requestAdminAuthorization=async purpose=>purpose==="INVENTORY_INWARD"?"isolated-test-grant":null;window.setSettingsPageBackToSettings=()=>{};window.discardStockAuthorization=()=>{};window.initializeStyleExplorer=()=>{};window.showNativeAlert=async()=>{};window.confirm=()=>true;window.alert=message=>{window.__unexpectedAlerts=(window.__unexpectedAlerts||[]).concat(String(message))};window.KLBSDrawer={create:()=>({open(){},close(){},destroy(){}})};
          const detail={document:{id:101,movement_no:"KLINW000101",direction:"INWARD",status:"DRAFT",business_date:"2026-10-10",created_at:"2026-10-10T01:00:00.000Z",supplier_id:null,supplier_invoice_id:null,invoice_number_snapshot:null,invoice_no:null,invoice_date:null,invoice_total_quantity:null,reference_text:null},lines:[],meaningful:false,currentBusinessDate:"2026-10-10",summary:{knownSkus:0,knownUnits:0,unresolvedBarcodes:0,unresolvedUnits:0,scannedQty:0,eligibleToPost:0,postedUnits:0,reconciliation:{state:"NO_INVOICE_QTY",difference:null,text:"SCANNED QTY 0"}}};
          window.electronAPI={getLastImport:async()=>null,getInventorySummary:async()=>({total_inventory:0,products:0,brands:0,segments:0,categories:0,seasons:0,collections:0,latest_sku:"-"}),getProducts:async()=>({products:[],page:1,totalCount:0,totalPages:1}),stockInwardEnter:async()=>true,stockInwardListDrafts:async()=>[{id:102,movement_no:"KLINW000102",business_date:"2026-10-10",supplier_name:"A Supplier With an Exceptionally Long Supplier Name for Responsive Layout Checks",invoice_no:"SUPPLIER-INVOICE-REFERENCE-2026-EXTREMELY-LONG-000102",status:"DRAFT",sku_count:2,units:4,posted_units:0,unresolved_count:1,updated_at:"2026-10-10T01:00:00Z"},{id:103,movement_no:"KLINW000103",business_date:"2026-10-09",supplier_name:"Second Supplier",invoice_no:"INV-103",status:"PARTIALLY_POSTED",sku_count:1,units:2,posted_units:1,unresolved_count:0,updated_at:"2026-10-09T01:00:00Z"}],stockInwardHistory:async()=>({rows:[],page:1,totalCount:0,totalPages:1,pageSize:100}),stockInwardCreate:async()=>({movementId:101,movementNo:"KLINW000101"}),stockInwardLoad:async()=>detail,stockInwardSuppliers:async()=>[],stockInwardInvoices:async()=>[],stockInwardFindDuplicateInvoice:async()=>({duplicate:false})};
          </script><script>${read("src/renderer/modules/productMasterTemplate.js")}</script><script>${inwardModule}</script><script>${read("src/renderer/modules/inventory.js")}</script><script>window.showInventory();window.__inwardReady=new Promise(resolve=>setTimeout(resolve,80));</script></body></html>`;
        const inwardFile=path.join(temp,"inward-navigation.html");fs.writeFileSync(inwardFile,inwardHtml,"utf8");await win.loadFile(inwardFile);await win.webContents.executeJavaScript("window.__inwardReady");
        assert.match(await win.webContents.executeJavaScript("document.getElementById('stockInwardBtn').textContent"),/Stock Inward/i);
        await win.webContents.executeJavaScript("document.getElementById('stockInwardBtn').click()");
        const inwardLanding=await waitForRenderer(win,"JSON.stringify({title:document.getElementById('siPageTitle')?.textContent||'',drafts:document.querySelectorAll('.si-current-card').length,alerts:window.__unexpectedAlerts||[]})",value=>JSON.parse(value).title==="STOCK INWARD"&&JSON.parse(value).drafts===2,"Product Master → Stock Inward navigation");assert.equal(JSON.parse(inwardLanding).title,"STOCK INWARD");
        const inwardGeometry=[];
        for(const width of [1920,1400,1280,980]){
            win.setContentSize(width,width===1920?1080:width===1280?720:900);await new Promise(resolve=>setTimeout(resolve,80));
            const measured=await rendererEval(win,`(()=>{const rows=[...document.querySelectorAll('.si-current-card')],rect=x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};return {viewport:innerWidth,page:document.documentElement.scrollWidth,rows:rows.map(row=>{const fields=[...row.querySelectorAll('.si-open-field')],actions=row.querySelector('.si-card-actions'),buttons=[...actions.querySelectorAll('button')];return {row:rect(row),fieldCount:fields.length,fieldRects:fields.map(rect),actions:rect(actions),buttons:buttons.map(button=>({text:button.textContent.trim(),...rect(button)})),status:row.querySelector('.si-status-badge')?.textContent.trim(),supplier:row.querySelector('.si-open-supplier span')?.textContent,invoice:row.querySelector('.si-open-invoice span')?.textContent};})};})()`,`Stock Inward geometry at ${width}px`);
            assert.equal(measured.rows.length,2,`multiple open inward drafts render at ${width}px`);
            assert(measured.page<=measured.viewport,`no horizontal overflow at ${width}px: ${measured.page}/${measured.viewport}`);
            assert.equal(measured.rows[0].fieldCount,7);assert.equal(measured.rows[1].fieldCount,7);
            assert(measured.rows.every(row=>row.actions.right<=row.row.right+1&&row.buttons.every(button=>button.left>=row.row.left&&button.right<=row.row.right+1)),`draft actions stay within rows at ${width}px`);
            assert.deepEqual(measured.rows.map(row=>row.buttons.length),[2,2],"Resume/Delete and Resume/Reprint actions remain available");
            assert.equal(measured.rows[0].status,"DRAFT");assert.equal(measured.rows[1].status,"PARTIALLY POSTED");
            assert.match(measured.rows[0].supplier,/Exceptionally Long Supplier Name/);assert.match(measured.rows[0].invoice,/EXTREMELY-LONG/);
            for(const row of measured.rows)for(let i=0;i<row.fieldRects.length;i++)for(let j=i+1;j<row.fieldRects.length;j++){const a=row.fieldRects[i],b=row.fieldRects[j];if(a.top<b.bottom&&b.top<a.bottom&&a.left<b.right&&b.left<a.right)assert.fail(`Stock Inward columns overlap at ${width}px: ${i}/${j}`);}
            inwardGeometry.push(measured);
        }
        const inwardAlerts=await rendererEval(win,"JSON.stringify(window.__unexpectedAlerts||[])","Stock Inward unexpected alert check");assert.deepEqual(JSON.parse(inwardAlerts),[],"Stock Inward navigation has no hidden error dialog");
        await win.webContents.executeJavaScript("document.getElementById('siNewDraft').click()");
        const inwardTitle=await waitForRenderer(win,"JSON.stringify({heading:document.getElementById('siPageTitle').textContent,workspaceVisible:!document.getElementById('stockInwardWorkspace').hidden,number:document.getElementById('siCode').textContent})",value=>JSON.parse(value).heading==="NEW STOCK INWARD"&&JSON.parse(value).workspaceVisible,"new Stock Inward document screen");
        assert.deepEqual(JSON.parse(inwardTitle),{heading:"NEW STOCK INWARD",workspaceVisible:true,number:"KLINW000101"},"Product Master → Stock Inward → New retains the correct visible heading after the renderer rerender");
        process.stdout.write(`${prefix}INWARD:${inwardTitle}\n`);
        process.stdout.write(`${prefix}INWARD_GEOMETRY:${JSON.stringify(inwardGeometry)}\n`);
        process.stdout.write(`${prefix}PRINT:${JSON.stringify(printFailure)}\n`);
        process.stdout.write(`${prefix}${JSON.stringify(results)}\n`);
    }finally{if(!win.isDestroyed())win.close();fs.rmSync(temp,{recursive:true,force:true});setTimeout(()=>app.quit(),50);}
}

async function parent(){
    sourceChecks();
    const electron=require("electron");
    const result=spawnSync(electron,["--disable-gpu","--no-sandbox",__filename,"--child"],{cwd:root,encoding:"utf8",timeout:30000,windowsHide:true});
    if(result.error)throw new Error(`Electron layout harness failed (signal=${result.signal||"none"}, error=${result.error.message}).\n--- child stdout ---\n${result.stdout||result.error.stdout||""}\n--- child stderr ---\n${result.stderr||result.error.stderr||""}`);
    assert.equal(result.status,0,`Electron layout harness failed (signal=${result.signal||"none"}).\n${result.stdout}\n${result.stderr}`);
    const line=result.stdout.split(/\r?\n/).find(value=>value.startsWith(`${prefix}[`));assert(line,`geometry output missing\n${result.stdout}\n${result.stderr}`);
    const entryLine=result.stdout.split(/\r?\n/).find(value=>value.startsWith(`${prefix}ENTRY:`));assert(entryLine,`entry output missing\n${result.stdout}\n${result.stderr}`);
    const entry=JSON.parse(entryLine.slice(`${prefix}ENTRY:`.length));
    const printLine=result.stdout.split(/\r?\n/).find(value=>value.startsWith(`${prefix}PRINT:`));assert(printLine,`print-failure output missing\n${result.stdout}\n${result.stderr}`);
    const printFailure=JSON.parse(printLine.slice(`${prefix}PRINT:`.length));
    const results=JSON.parse(line.slice(prefix.length));
    console.log("PASS Stock Outward renderer-derived history geometry at 1400×900, 1280×720, and 980×900 CSS viewport sizes");
    for(const value of results)console.log(`${value.viewport}px: table ${value.tableWidth}/${value.tableScrollWidth}px, 8 columns, VIEW cell ${value.viewIndex}, PRINT cell ${value.printIndex}, row ${value.rowHeight}px, page ${value.pageWidth}px`);
    console.log(`Entry at ${entry.viewport}px: date/reason/remarks/scanner and 8 item columns present; print failure left document posted (${printFailure.posts} post, ${printFailure.prints} print attempt)`);
    const inwardLine=result.stdout.split(/\r?\n/).find(value=>value.startsWith(`${prefix}INWARD:`));assert(inwardLine,`Stock Inward Electron evidence missing\n${result.stdout}\n${result.stderr}`);console.log(`Electron navigation: ${inwardLine.slice(`${prefix}INWARD:`.length)}`);
    const inwardGeometryLine=result.stdout.split(/\r?\n/).find(value=>value.startsWith(`${prefix}INWARD_GEOMETRY:`));assert(inwardGeometryLine,`Stock Inward geometry evidence missing\n${result.stdout}\n${result.stderr}`);for(const value of JSON.parse(inwardGeometryLine.slice(`${prefix}INWARD_GEOMETRY:`.length)))console.log(`Stock Inward ${value.viewport}px: ${value.rows.length} drafts × 7 fields; Resume/Delete and Resume/Reprint remain in-row; page ${value.page}px; long supplier and invoice retained`);
}

if(process.versions.electron&&process.argv.includes("--child"))child().catch(error=>{console.error(error);try{require("electron").app.quit();}catch(_){}process.exitCode=1;});
else parent().catch(error=>{console.error(error);process.exitCode=1;});
