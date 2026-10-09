"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const resultPrefix = "V21_UX_01B_HISTORY_LAYOUT:";

async function expenseSourceChecks() {
    const css = fs.readFileSync(path.join(root, "src/renderer/styles/expense.css"), "utf8");
    const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
    const renderer = fs.readFileSync(path.join(root, "src/renderer/modules/expenseTracker.js"), "utf8");
    assert.match(html, /id="expenseHistoryTableWrap"[^>]*>[\s\S]*?<table class="expense-table expense-history-table"/);
    for (const name of ["id", "batch-id", "header", "amount", "remarks"]) {
        assert(renderer.includes(`"expense-history-${name}"`), `Expense History renderer marks ${name} cells`);
    }
    assert(css.includes("#expenseHistoryTableWrap { box-sizing: border-box; width: 100%; max-width: 100%; overflow-x: auto;"));
    assert(css.includes(".expense-history-id,\n#expenseHistoryTableWrap .expense-history-batch-id { min-width: 132px; font-variant-numeric: tabular-nums; }"));
    assert(css.includes("#expenseHistoryScreen .expense-header-summary[hidden] { display: none; }"));
    assert.match(renderer, /historySummaryVisible = !historySummaryVisible;[\s\S]*?\.hidden = !historySummaryVisible;[\s\S]*?textContent = historySummaryVisible \? "HIDE SUMMARY" : "VIEW SUMMARY"/);
    assert.match(renderer, /if \(historySummaryVisible\) await renderHeaderSummary\(options\);/);
    const handlerStart = renderer.indexOf('$("expenseHistorySummaryBtn").addEventListener("click", async () => {');
    const handlerEnd = renderer.indexOf('$("expenseHistoryExportBtn")', handlerStart);
    assert(handlerStart >= 0 && handlerEnd > handlerStart, "actual summary toggle listener is extractable");
    let clickHandler = null, renderCalls = 0;
    const button = { textContent: "VIEW SUMMARY", addEventListener: (name, handler) => { if (name === "click") clickHandler = handler; } };
    const summary = { hidden: true };
    const sandbox = { historySummaryVisible: false, $: id => id === "expenseHistorySummaryBtn" ? button : summary, renderHeaderSummary: async () => { renderCalls += 1; } };
    vm.runInNewContext(renderer.slice(handlerStart, handlerEnd), sandbox);
    await clickHandler(); assert.equal(summary.hidden, false); assert.equal(button.textContent, "HIDE SUMMARY");
    await clickHandler(); assert.equal(summary.hidden, true); assert.equal(button.textContent, "VIEW SUMMARY");
    await clickHandler(); assert.equal(summary.hidden, false); assert.equal(button.textContent, "HIDE SUMMARY");
    assert.equal(renderCalls, 2, "summary content refreshes each time the summary is expanded");
}

function expenseMarkup() {
    const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
    const draft = html.match(/<div id="expenseDraftTableWrap"[\s\S]*?<\/table>\s*<\/div>/)?.[0];
    const history = html.match(/<div id="expenseHistoryTableWrap"[\s\S]*?<\/table>\s*<\/div>/)?.[0];
    assert(draft && history, "expense table markup comes from the renderer document");
    const draftRow = "<tr><td>1</td><td>09/10/2026</td><td>Professional Fees</td><td>COMMON</td><td>Bank Transfer</td><td>LONG-REFERENCE-2026-00001</td><td>₹1,234,567.89</td><td>Representative remarks</td><td><button class=\"expense-delete-btn\">DELETE</button></td></tr>";
    const historyRow = "<tr><td class=\"expense-history-row-number\">1</td><td class=\"expense-history-date\">09/10/2026</td><td class=\"expense-history-id\">KLXEXP000000000001</td><td class=\"expense-history-batch-id\">KLBAT000000000001</td><td class=\"expense-history-header\">Professional Fees</td><td class=\"expense-history-segment\">COMMON</td><td class=\"expense-history-type\">Bank Transfer</td><td class=\"expense-history-reference\">LONG-REFERENCE-2026-00001</td><td class=\"expense-history-amount\">₹1,234,567.89</td><td class=\"expense-history-remarks\">Representative long remarks that wrap within the contained table.</td></tr>";
    return `<div class="expense-screen-harness"><section class="expense-panel">${draft.replace(' hidden>', '>').replace("</tbody>", `${draftRow}</tbody>`)}</section><section class="expense-panel">${history.replace(' hidden>', '>').replace("</tbody>", `${historyRow}</tbody>`)}</section><div id="expenseHeaderSummary" class="expense-header-summary" hidden><span class="expense-header-summary-item"><strong>Rent: </strong><span class="expense-header-summary-amount">₹1,234.00</span></span><span class="expense-header-summary-item"><strong>Electricity: </strong><span class="expense-header-summary-amount">₹5,678.00</span></span></div></div>`;
}

function sourceHistoryHtml() {
    const source = fs.readFileSync(path.join(root, "src/renderer/modules/stockInward.js"), "utf8");
    const rowStart = source.indexOf("const historyRows = history.map(row =>");
    const rowsEnd = source.indexOf("const historyEmpty", rowStart);
    const tableStart = source.indexOf('<table class="si-history-table">', rowsEnd);
    const theadStart = source.indexOf("<thead>", tableStart);
    const theadEnd = source.indexOf("</thead>", theadStart) + "</thead>".length;
    assert(rowStart >= 0 && rowsEnd > rowStart && tableStart > rowsEnd && theadEnd > theadStart, "history renderer source is locatable");
    const rowRenderer = `${source.slice(rowStart, rowsEnd)}\nhistoryRows;`;
    const rows = [
        { id: 71, status: "COMPLETE", movement_no: "KLINW000071", business_date: "2026-10-08", supplier_name: "JPS & CO", supplier_code_snapshot: "KLSUP000001", invoice_no: "EXT-2026-00071", posted_units: 24 },
        { id: 72, status: "CANCELLED", movement_no: "KLINW000072", business_date: "2026-10-07", supplier_name: "A Long Supplier Name for Wrapping", supplier_code_snapshot: "KLSUP000002", invoice_no: "EXT-2026-00072", posted_units: 0 }
    ];
    const tbody = vm.runInNewContext(rowRenderer, {
        history: rows,
        escapeHtml: value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch])),
        formatBusinessDate: value => value
    });
    const tableHead = source.slice(theadStart, theadEnd);
    return `<table class="si-history-table">${tableHead}<tbody>${tbody}</tbody></table>`;
}

function bundledCss() {
    const styleRoot = path.join(root, "src/renderer");
    const css = ["variables.css", "base.css", "billing.css", "expense.css"].map(file => fs.readFileSync(path.join(styleRoot, "styles", file), "utf8")).join("\n");
    const stock = fs.readFileSync(path.join(styleRoot, "styles/stockInward.css"), "utf8");
    return `${css}\n${stock}`;
}

async function child() {
    const { app, BrowserWindow } = require("electron");
    await app.whenReady();
    const win = new BrowserWindow({ show: false, frame: false, width: 1440, height: 850, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-v21-ux01b-layout-"));
    try {
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>${bundledCss()}</style><style>html,body{margin:0;min-height:100%;overflow-x:hidden}body{padding:0 24px}#settingsPageContent{width:min(1440px,calc(100% - 48px));margin:0 auto}.stock-inward-page{width:100%;min-width:0}.si-recent-history{min-width:0}.expense-screen-harness{width:min(1440px,calc(100% - 48px));margin:32px auto}</style></head><body><div id="settingsPage"><div class="bill-top-bar"></div><main id="settingsPageContent"><section class="stock-inward-page"><div class="stock-inward-resume"><section class="si-recent-history"><h2>RECENT STOCK INWARDS</h2><div class="table-container si-history-table-wrap">${sourceHistoryHtml()}</div></section></div></section></main><div id="expenseHistoryScreen" class="screen" style="display:block">${expenseMarkup()}</div></div></body></html>`;
        const htmlPath = path.join(temp, "history-layout.html");
        fs.writeFileSync(htmlPath, html, "utf8");
        await win.loadFile(htmlPath);
        const results = [];
        for (const width of [1440, 1280, 980, 800, 700]) {
            win.setContentSize(width, 850);
            await new Promise(resolve => setTimeout(resolve, 60));
            const result = await win.webContents.executeJavaScript(`(() => {
                const table=document.querySelector('.si-history-table'),wrap=document.querySelector('.si-history-table-wrap'),heads=[...table.tHead.rows[0].cells],rows=[...table.tBodies[0].rows],out=[];
                const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
                for(const row of rows){const cells=[...row.cells],view=row.querySelector('[data-history]'),reprint=row.querySelector('[data-reprint]'),archive=row.querySelector('[data-archive]');out.push({cellCount:cells.length,height:rect(row).height,displays:cells.map(cell=>getComputedStyle(cell).display),viewParentIndex:view?.parentElement.cellIndex,reprintParentIndex:reprint?.parentElement.cellIndex,view:view&&rect(view),reprint:reprint&&rect(reprint),archive:archive&&rect(archive),viewCell:rect(cells[6]),printCell:rect(cells[7]),headers:heads.map(rect)});}
                const pageWidth=document.documentElement.scrollWidth,viewport=innerWidth;wrap.scrollLeft=wrap.scrollWidth;
                const lastReprint=table.querySelector('[data-reprint]'),r=lastReprint?.getBoundingClientRect(),w=wrap.getBoundingClientRect();
                const draftWrap=document.querySelector('#expenseDraftTableWrap'),historyWrap=document.querySelector('#expenseHistoryTableWrap'),draft=draftWrap.querySelector('table'),history=historyWrap.querySelector('table'),summary=document.querySelector('#expenseHeaderSummary'),draftAmount=draft.tBodies[0].rows[0].cells[6],historyRow=history.tBodies[0].rows[0],deleteButton=draft.querySelector('.expense-delete-btn');
                draftWrap.scrollLeft=draftWrap.scrollWidth;historyWrap.scrollLeft=historyWrap.scrollWidth;
                const dr=draftWrap.getBoundingClientRect(),hr=historyWrap.getBoundingClientRect(),del=deleteButton.getBoundingClientRect();
                summary.hidden=true;
                const expense={columns:[draft.tHead.rows[0].cells.length,history.tHead.rows[0].cells.length],draftAmountAlign:getComputedStyle(draftAmount).textAlign,historyAmountAlign:getComputedStyle(historyRow.cells[8]).textAlign,ids:[historyRow.cells[2],historyRow.cells[3]].map(cell=>({text:cell.textContent,wrap:getComputedStyle(cell).whiteSpace,height:cell.getBoundingClientRect().height})),categoryWrap:getComputedStyle(historyRow.cells[4]).whiteSpace,referenceWrap:getComputedStyle(historyRow.cells[7]).whiteSpace,remarksWrap:getComputedStyle(historyRow.cells[9]).whiteSpace,historyRowHeight:historyRow.getBoundingClientRect().height,summaryHiddenDisplay:getComputedStyle(summary).display,draftWrapper:{left:dr.left,right:dr.right,client:draftWrap.clientWidth,scroll:draftWrap.scrollWidth,deleteVisible:del.left>=dr.left-1&&del.right<=dr.right+1},historyWrapper:{left:hr.left,right:hr.right,client:historyWrap.clientWidth,scroll:historyWrap.scrollWidth}};
                summary.hidden=false;expense.summaryExpandedDisplay=getComputedStyle(summary).display;
                const summaryRows=[...summary.querySelectorAll('.expense-header-summary-item')];
                expense.summaryValues=summaryRows.map(row=>{const label=row.querySelector('strong').getBoundingClientRect(),amount=row.querySelector('.expense-header-summary-amount').getBoundingClientRect();return {labelRight:label.right,amountLeft:amount.left,amountRight:amount.right,rowRight:row.getBoundingClientRect().right};});
                return {viewport,pageWidth,headerCount:heads.length,rows:out,wrap:{left:w.left,right:w.right,clientWidth:wrap.clientWidth,scrollWidth:wrap.scrollWidth,scrollLeft:wrap.scrollLeft},lastReprintVisible:!!r&&r.left>=w.left-1&&r.right<=w.right+1,colors:{view:getComputedStyle(table.querySelector('.view-btn')).backgroundColor,reprint:getComputedStyle(table.querySelector('.print-btn')).backgroundColor},expense};
            })()`);
            assert.equal(result.headerCount,8,`8 headers at ${width}px`);
            assert(result.rows.every(row=>row.cellCount===8),`8 body cells at ${width}px`);
            assert(result.rows.every(row=>row.displays.every(display=>display==="table-cell")),`native table-cell display is preserved at ${width}px`);
            const posted=result.rows[0];
            assert.equal(posted.viewParentIndex,6,`VIEW belongs to column 7 at ${width}px`);
            assert.equal(posted.reprintParentIndex,7,`REPRINT belongs to column 8 at ${width}px`);
            assert(Math.abs((posted.view.top+posted.view.bottom)/2-(posted.reprint.top+posted.reprint.bottom)/2)<=1,`VIEW and REPRINT share a baseline at ${width}px`);
            assert(Math.abs((posted.view.left+posted.view.right)/2-(posted.headers[6].left+posted.headers[6].right)/2)<=1,`VIEW aligns under VIEW header at ${width}px`);
            assert(Math.abs((posted.reprint.left+posted.reprint.right)/2-(posted.headers[7].left+posted.headers[7].right)/2)<=1,`REPRINT aligns under PRINT header at ${width}px`);
            assert(posted.view.left>=posted.viewCell.left&&posted.view.right<=posted.viewCell.right,`VIEW is contained by its cell at ${width}px`);
            assert(posted.reprint.left>=posted.printCell.left&&posted.reprint.right<=posted.printCell.right,`REPRINT is contained by its cell at ${width}px`);
            assert(posted.height<=58,`posted history row is compact (${posted.height}px) at ${width}px`);
            const cancelled=result.rows[1];
            assert.equal(cancelled.viewParentIndex,6,`cancelled VIEW belongs to column 7 at ${width}px`);
            assert(Math.abs((cancelled.view.top+cancelled.view.bottom)/2-(cancelled.archive.top+cancelled.archive.bottom)/2)<=1,`cancelled row VIEW and REMOVE remain on one line at ${width}px`);
            assert(result.pageWidth<=result.viewport,`no page-level horizontal overflow at ${width}px`);
            assert(result.lastReprintVisible,`PRINT is reachable within contained scroller at ${width}px`);
            assert.equal(result.colors.view,"rgb(13, 110, 253)");
            assert.equal(result.colors.reprint,"rgb(25, 135, 84)");
            assert.deepEqual(result.expense.columns,[9,10],`Expense table column counts at ${width}px`);
            assert.equal(result.expense.draftAmountAlign,"right");
            assert.equal(result.expense.historyAmountAlign,"right");
            assert.deepEqual(result.expense.ids.map(item=>item.wrap),["nowrap","nowrap"]);
            assert.equal(result.expense.categoryWrap,"nowrap");
            assert.equal(result.expense.referenceWrap,"normal");
            assert.equal(result.expense.remarksWrap,"normal");
            assert(result.expense.historyRowHeight<60,`Expense History row is compact (${result.expense.historyRowHeight}px) at ${width}px`);
            assert.equal(result.expense.summaryHiddenDisplay,"none",JSON.stringify(result.expense));
            assert.equal(result.expense.summaryExpandedDisplay,"grid");
            assert.equal(result.expense.summaryValues.length,2);
            assert(result.expense.summaryValues.every(value=>value.labelRight<=value.amountLeft&&value.amountRight<=value.rowRight+1),`summary labels and currency totals stay separated and aligned at ${width}px`);
            assert(result.expense.draftWrapper.deleteVisible,`current-batch action remains accessible at ${width}px`);
            assert(result.expense.draftWrapper.left>=0&&result.expense.draftWrapper.right<=width+1,`current-batch wrapper stays within viewport at ${width}px`);
            assert(result.expense.historyWrapper.left>=0&&result.expense.historyWrapper.right<=width+1,`history wrapper stays within viewport at ${width}px`);
            assert(result.pageWidth<=width,`no page-level horizontal overflow with Expense tables at ${width}px`);
            results.push({width,bodyColumns:posted.cellCount,viewCell:posted.viewParentIndex,printCell:posted.reprintParentIndex,rowHeight:posted.height,view:posted.view,reprint:posted.reprint,wrapper:result.wrap,visible:result.lastReprintVisible,pageWidth:result.pageWidth,colors:result.colors,expense:result.expense});
        }
        process.stdout.write(`${resultPrefix}${JSON.stringify(results)}\n`);
    } finally { if (!win.isDestroyed()) win.close(); fs.rmSync(temp, { recursive: true, force: true }); setTimeout(() => app.quit(), 50); }
}

async function parent() {
    await expenseSourceChecks();
    const electron = require("electron");
    const result = spawnSync(electron, ["--disable-gpu", "--no-sandbox", __filename, "--child"], { cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Rendered Stock Inward history check failed (signal=${result.signal || "none"}, error=${result.error?.message || "none"}).\n${result.stdout}\n${result.stderr}`);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith(resultPrefix));
    assert(line, `Rendered geometry result missing.\n${result.stdout}\n${result.stderr}`);
    const results = JSON.parse(line.slice(resultPrefix.length));
    assert.deepEqual(results.map(item => item.width), [1440, 1280, 980, 800, 700]);
    console.log("V21-UX-01B renderer-derived Stock Inward and Expense layout harness: PASS at 1440, 1280, 980, 800, and 700 CSS px");
    for (const result of results) console.log(`${result.width}px: VIEW cell ${result.viewCell}, PRINT cell ${result.printCell}, row ${result.rowHeight}px; Expense IDs no-wrap, amounts right-aligned, summary hidden state and contained tables pass; stock wrapper ${result.wrapper.clientWidth}/${result.wrapper.scrollWidth}px`);
}

if (process.versions.electron && process.argv.includes("--child")) child().catch(error => { console.error(error); try { require("electron").app.quit(); } catch (_) {} process.exitCode = 1; });
else parent().catch(error => { console.error(error); process.exitCode = 1; });
