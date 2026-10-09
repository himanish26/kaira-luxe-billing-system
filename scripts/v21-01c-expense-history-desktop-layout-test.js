"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const resultPrefix = "V21_UX_01C_EXPENSE_HISTORY_LAYOUT:";

function extractMarkup(html, startText, endText) {
    const start = html.indexOf(startText);
    const end = html.indexOf(endText, start);
    assert(start >= 0 && end > start, `markup range found: ${startText}`);
    return html.slice(start, end + endText.length);
}

function extractFunction(source, signature, nextSignature) {
    const start = source.indexOf(signature);
    const end = source.indexOf(nextSignature, start);
    assert(start >= 0 && end > start, `renderer function found: ${signature}`);
    return source.slice(start, end);
}

function actualPageMarkup() {
    const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
    const topbar = extractMarkup(html, '<div class="bill-top-bar expense-page-topbar">', "</div>");
    const header = extractMarkup(html, '<header class="business-page-header expense-page-header">', "</header>");
    const panel = extractMarkup(html, '<section class="expense-panel expense-history-panel">', "</section>");
    assert.match(panel, /<th>#<\/th>[\s\S]*?<th>Remarks<\/th>/);
    assert.equal((panel.match(/<th>/g) || []).length, 10, "actual Expense History markup has ten headers");
    return `<div id="expenseHistoryScreen" class="screen" style="display:block">${topbar}<div class="business-page expense-page business-page-after-topbar">${header}${panel}</div></div>`;
}

function actualRowRenderer() {
    const renderer = fs.readFileSync(path.join(root, "src/renderer/modules/expenseTracker.js"), "utf8");
    return [
        extractFunction(renderer, "function formatMoney(paise) {", "function formatDate(value) {"),
        extractFunction(renderer, "function formatDate(value) {", "function makeCell(row, value, className = \"\") {"),
        extractFunction(renderer, "function makeCell(row, value, className = \"\") {", "function appendOptions(select, values) {"),
        extractFunction(renderer, "function renderHistoryRows(rows, page) {", "async function renderHistory() {")
    ].join("\n");
}

function beforeCorrectionCss() {
    return `
        #expenseHistoryTableWrap .expense-history-table { width:max-content; min-width:100%; table-layout:auto; }
        #expenseHistoryTableWrap .expense-history-table th,
        #expenseHistoryTableWrap .expense-history-table td { padding:9px 10px; white-space:nowrap; overflow-wrap:normal; }
        #expenseHistoryTableWrap .expense-history-row-number { min-width:44px; text-align:center; }
        #expenseHistoryTableWrap .expense-history-date { min-width:88px; }
        #expenseHistoryTableWrap .expense-history-id,
        #expenseHistoryTableWrap .expense-history-batch-id { min-width:132px; font-variant-numeric:tabular-nums; }
        #expenseHistoryTableWrap .expense-history-header { min-width:145px; }
        #expenseHistoryTableWrap .expense-history-segment { min-width:110px; }
        #expenseHistoryTableWrap .expense-history-type { min-width:122px; }
        #expenseHistoryTableWrap td.expense-history-reference { min-width:150px; max-width:230px; white-space:normal; overflow-wrap:anywhere; }
        #expenseHistoryTableWrap .expense-history-amount { min-width:115px; text-align:right; font-variant-numeric:tabular-nums; }
        #expenseHistoryTableWrap td.expense-history-remarks { min-width:190px; max-width:300px; white-space:normal; overflow-wrap:anywhere; }
        #expenseHistoryTableWrap .expense-history-table th:nth-child(1), #expenseHistoryTableWrap .expense-history-table td:nth-child(1) { width:4%; }
        #expenseHistoryTableWrap .expense-history-table th:nth-child(2), #expenseHistoryTableWrap .expense-history-table td:nth-child(2) { width:8%; }
        #expenseHistoryTableWrap .expense-history-table th:nth-child(3), #expenseHistoryTableWrap .expense-history-table td:nth-child(3),
        #expenseHistoryTableWrap .expense-history-table th:nth-child(4), #expenseHistoryTableWrap .expense-history-table td:nth-child(4) { width:10%; }
        #expenseHistoryTableWrap .expense-history-table th:nth-child(5), #expenseHistoryTableWrap .expense-history-table td:nth-child(5) { width:13%; }
        #expenseHistoryTableWrap .expense-history-table th:nth-child(6), #expenseHistoryTableWrap .expense-history-table td:nth-child(6) { width:8%; }
        #expenseHistoryTableWrap .expense-history-table th:nth-child(7), #expenseHistoryTableWrap .expense-history-table td:nth-child(7) { width:9%; text-align:left; }
        #expenseHistoryTableWrap .expense-history-table th:nth-child(8), #expenseHistoryTableWrap .expense-history-table td:nth-child(8) { width:13%; }
        #expenseHistoryTableWrap .expense-history-table th:nth-child(9), #expenseHistoryTableWrap .expense-history-table td:nth-child(9) { width:9%; text-align:right; }
        #expenseHistoryTableWrap .expense-history-table th:nth-child(10), #expenseHistoryTableWrap .expense-history-table td:nth-child(10) { width:16%; }
        @media (max-width:1200px) { #expenseHistoryTableWrap .expense-history-table { width:max-content; min-width:100%; table-layout:auto; } }
    `;
}

const records = [
    {
        expense_date: "2026-10-09", expense_code: "KLEXP000001", batch_code: "KLEXPB000001",
        category: "Repairs and Maintenance", business_segment: "COMMON", payment_mode: "Bank Transfer",
        reference: "INV-2026-10-0000123456", amount_paise: 987654321,
        remarks: "Monthly maintenance payment for store equipment."
    },
    {
        expense_date: "2026-10-08", expense_code: "KLEXP000002", batch_code: "KLEXPB000001",
        category: "Cleaning & Housekeeping", business_segment: "MENS", payment_mode: "UPI",
        reference: "RECEIPT-2026-10-VERY-LONG-REFERENCE-0000456789", amount_paise: 1234567890,
        remarks: "Service and materials supplied for routine store maintenance across the premises."
    },
    {
        expense_date: "2026-10-07", expense_code: "KLEXP000003", batch_code: "KLEXPB000002",
        category: "Rent", business_segment: "KL", payment_mode: "Cash",
        reference: "", amount_paise: 10000, remarks: ""
    }
];

async function child() {
    const { app, BrowserWindow } = require("electron");
    await app.whenReady();
    const win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    win.webContents.on("console-message", (_event, _level, message) => console.error(`RENDERER_CONSOLE: ${message}`));
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-v21-ux01c-layout-"));
    try {
        const stylesheet = pathToFileURL(path.join(root, "src/renderer/style.css")).href;
        const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${stylesheet}"></head><body>${actualPageMarkup()}</body></html>`;
        const htmlPath = path.join(temp, "expense-history-layout.html");
        fs.writeFileSync(htmlPath, html, "utf8");
        await win.loadFile(htmlPath);
        await win.webContents.executeJavaScript("document.fonts.ready");
        await new Promise(resolve => setTimeout(resolve, 100));

        const moduleSource = actualRowRenderer();
        const renderFunctionBody = `
            ${moduleSource}
            const $ = id => document.getElementById(id);
            function openExpenseDetails() {}
            renderHistoryRows([], 1);
            window.__v21Ux01cEmptyRows = document.getElementById("expenseHistoryRows").rows.length;
            renderHistoryRows(records, 1);
            document.getElementById("expenseHistoryTableWrap").hidden = false;
            document.getElementById("expenseHistoryPagination").hidden = false;
        `;
        const js = `(() => { try { const render = new Function("records", ${JSON.stringify(renderFunctionBody)}); render(${JSON.stringify(records)}); return {ok:true}; } catch (error) { return {ok:false,error:String(error),stack:error.stack}; } })()`;
        const rendered = await win.webContents.executeJavaScript(js);
        if (!rendered.ok) throw new Error(`Actual Expense History renderer failed: ${rendered.error}\n${rendered.stack}`);

        const metricsScript = `(() => {
            const table=document.querySelector(".expense-history-table"), wrap=document.getElementById("expenseHistoryTableWrap"),
                screen=document.getElementById("expenseHistoryScreen"), page=document.querySelector(".business-page"), panel=document.querySelector(".expense-history-panel"),
                heads=[...table.tHead.rows[0].cells], rows=[...table.tBodies[0].rows], pagination=document.getElementById("expenseHistoryPagination"),
                summaryButton=document.getElementById("expenseHistorySummaryBtn"), filters=[...document.querySelectorAll(".expense-history-filters input,.expense-history-filters select")];
            const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
            const cells=rows.map(row=>[...row.cells]); const first=cells[0]||[]; const last=cells.at(-1)||[]; const wrapper=rect(wrap), tableRect=rect(table);
            return {
                windowInnerWidth:window.innerWidth,windowInnerHeight:window.innerHeight,documentClientWidth:document.documentElement.clientWidth,pageScrollWidth:document.documentElement.scrollWidth,
                screenWidth:screen.clientWidth,pageWidth:page.clientWidth,panelWidth:panel.clientWidth,tableWrapperClientWidth:wrap.clientWidth,
                tableClientWidth:table.clientWidth,tableScrollWidth:table.scrollWidth,overflow:Math.max(0,table.scrollWidth-wrap.clientWidth),
                tableRect,wrapper,headerCount:heads.length,bodyCellCounts:cells.map(row=>row.length),
                headerRects:heads.map(rect),firstRowCellRects:first.map(rect),rowHeights:rows.map(row=>rect(row).height),
                emptyRows:window.__v21Ux01cEmptyRows,headerOverflow:heads.map(cell=>({scrollWidth:cell.scrollWidth,clientWidth:cell.clientWidth})),
                headers:heads.map(cell=>cell.textContent.trim()),ids:[first[2]?.textContent,first[3]?.textContent],
                typography:{body:getComputedStyle(first[0]).fontSize,header:getComputedStyle(heads[0]).fontSize,family:getComputedStyle(first[0]).fontFamily},
                amounts:first.map((cell,index)=>index===8?{text:cell.textContent,align:getComputedStyle(cell).textAlign,scrollWidth:cell.scrollWidth,clientWidth:cell.clientWidth}:null).filter(Boolean),
                textOverflow:first.map((cell,index)=>({index,scrollWidth:cell.scrollWidth,clientWidth:cell.clientWidth,whiteSpace:getComputedStyle(cell).whiteSpace})),
                pagination:{visible:!pagination.hidden,rect:rect(pagination)},summaryButton:{visible:!summaryButton.hidden,rect:rect(summaryButton)},
                paginationOutsideScroller:pagination.parentElement===wrap.parentElement&&rect(pagination).top>=wrapper.bottom-1,
                filterRects:filters.map(rect),filterValues:filters.map(el=>el.value),
                pageHasHorizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
                rows:rows.map(row=>[...row.cells].map(cell=>cell.textContent))
            };
        })()`;

        const results = [];
        for (const [width,height] of [[1400,900],[1280,720],[1024,720],[900,720]]) {
            win.setContentSize(width, height);
            await new Promise(resolve => setTimeout(resolve, 80));
            await win.webContents.executeJavaScript(`(() => { const style=document.createElement("style"); style.id="v21-ux01c-before-css"; style.textContent=${JSON.stringify(beforeCorrectionCss())}; document.head.appendChild(style); })()`);
            const before = await win.webContents.executeJavaScript(metricsScript);
            await win.webContents.executeJavaScript(`document.getElementById("v21-ux01c-before-css").remove()`);
            const after = await win.webContents.executeJavaScript(metricsScript);
            assert.equal(after.windowInnerWidth, width);
            assert.equal(after.windowInnerHeight, height);
            assert.equal(after.documentClientWidth, width);
            assert.equal(after.headerCount, 10, `all ten actual headers exist at ${width}px`);
            assert(after.bodyCellCounts.every(count => count===10), `all body rows have ten actual renderer cells at ${width}px`);
            assert.equal(after.pageHasHorizontalOverflow, false, `no page-wide overflow at ${width}px`);
            assert(after.pagination.visible&&after.summaryButton.visible, `pagination and summary action remain present at ${width}px`);
            assert(after.paginationOutsideScroller, `pagination remains outside the scrolling table region at ${width}px`);
            assert(after.filterRects.every(r=>r.width>0&&r.height>0), `filters remain laid out at ${width}px`);
            assert.equal(after.emptyRows,0, `actual renderer supports empty history rows at ${width}px`);
            assert(after.headerOverflow.every(cell=>cell.scrollWidth<=cell.clientWidth+1), `header text wraps without clipping at ${width}px`);
            assert(after.textOverflow.every(cell=>cell.scrollWidth<=cell.clientWidth+1), `body text fits or wraps within its cell at ${width}px`);
            assert.equal(after.typography.body,"14px");
            assert.equal(after.typography.header,"13px");
            assert.deepEqual(after.ids,["KLEXP000001","KLEXPB000001"], "actual Expense and Batch IDs remain complete");
            assert.equal(after.amounts[0].align,"right");
            assert(after.headerRects.every((r,index)=>index===0||after.headerRects[index-1].right<=r.left+1), `headers do not overlap at ${width}px`);
            assert(after.firstRowCellRects.every((r,index)=>index===0||after.firstRowCellRects[index-1].right<=r.left+1), `body cells do not overlap at ${width}px`);
            assert.equal(after.rows[0][7],records[0].reference);
            assert.equal(after.rows[0][9],records[0].remarks);
            if(width>=1280){
                assert(after.overflow<=1, `no meaningful table horizontal overflow at desktop width ${width}px (overflow ${after.overflow}px)`);
                assert(after.tableRect.left>=after.wrapper.left-1&&after.tableRect.right<=after.wrapper.right+1, `all columns fit the visible table wrapper at ${width}px`);
                assert(before.overflow>0, `before-correction CSS reproduces horizontal scrolling at ${width}px: ${JSON.stringify(before)}`);
            }else{
                assert(after.overflow>0, `narrow viewport uses contained horizontal fallback at ${width}px`);
                assert(after.wrapper.left>=0&&after.wrapper.right<=width+1, `narrow fallback stays within page at ${width}px`);
            }
            results.push({width,before:{wrapper:before.tableWrapperClientWidth,table:before.tableScrollWidth,overflow:before.overflow},after:{window:after.windowInnerWidth,windowInnerHeight:after.windowInnerHeight,document:after.documentClientWidth,screen:after.screenWidth,page:after.pageWidth,panel:after.panelWidth,wrapper:after.tableWrapperClientWidth,table:after.tableClientWidth,scroll:after.tableScrollWidth,overflow:after.overflow,pageScroll:after.pageScrollWidth,columns:after.headerCount,rowHeights:after.rowHeights,headers:after.headers,ids:after.ids,amount:after.amounts[0],pagination:after.pagination.visible,summaryButton:after.summaryButton.visible}});
        }
        process.stdout.write(`${resultPrefix}${JSON.stringify(results)}\n`);
    } finally {
        if (!win.isDestroyed()) win.close();
        fs.rmSync(temp, { recursive: true, force: true });
        setTimeout(() => app.quit(), 50);
    }
}

function parent() {
    const electron = require("electron");
    const result = spawnSync(electron, ["--disable-gpu", "--no-sandbox", __filename, "--child"], { cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Expense History rendered layout failed (signal=${result.signal||"none"}).\n${result.stdout}\n${result.stderr}`);
    const line = result.stdout.split(/\r?\n/).find(value=>value.startsWith(resultPrefix));
    assert(line, `Rendered geometry missing.\n${result.stdout}\n${result.stderr}`);
    const results=JSON.parse(line.slice(resultPrefix.length));
    console.log("V21-UX-01C actual Expense History markup, renderer, and production CSS: PASS");
    for(const r of results) console.log(`${r.width}x${r.after.windowInnerHeight}px: window/document width ${r.after.window}/${r.after.document}px, screen/page/panel ${r.after.screen}/${r.after.page}/${r.after.panel}px, wrapper ${r.after.wrapper}px, table client/scroll ${r.after.table}/${r.after.scroll}px, before table ${r.before.table}px, overflow before/after ${r.before.overflow}/${r.after.overflow}px, columns ${r.after.columns}, row heights ${r.after.rowHeights.map(v=>v.toFixed(1)).join(",")}px, page scroll ${r.after.pageScroll}px`);
}

if (process.versions.electron && process.argv.includes("--child")) child().catch(error=>{console.error(error);try{require("electron").app.quit();}catch(_){}process.exitCode=1;});
else { try { parent(); } catch(error) { console.error(error); process.exitCode=1; } }
