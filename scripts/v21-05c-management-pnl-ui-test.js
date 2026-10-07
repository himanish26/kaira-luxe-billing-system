"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

const html = read("src/renderer/index.html");
const app = read("src/renderer/app.js");
const shortcuts = read("src/renderer/modules/shortcuts.js");
const renderer = read("src/renderer/modules/managementPnl.js");
const main = read("src/main/main.js");
const preload = read("src/main/preload.js");
const service = read("src/database/managementPnlService.js");
const css = read("src/renderer/styles/management-pnl.css");

const screenStart = html.indexOf('id="managementPnlScreen"');
const screenEnd = html.indexOf('id="expenseTrackerScreen"');
assert(screenStart >= 0 && screenEnd > screenStart, "Management P&L screen markup is present");
const screenHtml = html.slice(screenStart, screenEnd);
assert.match(app, /accountingManagementPLBtn[^\n]*window\.openManagementPnl/, "Accounting & Data card opens Management P&L");
assert.match(screenHtml, /managementPnlBackBtn" class="back-btn"[^>]*>← Accounting &amp; Data/, "back destination remains Accounting & Data");
assert.match(shortcuts, /\["managementPnlScreen", "managementPnlBackBtn"\]/, "ESC navigation returns to Accounting & Data");
assert.match(screenHtml, /managementPnlExportBtn[^>]*title="Export the selected Financial Year and Business Segment to Excel\."/,
    "P&L export is available with a clear tooltip");
const exportButton = screenHtml.match(/<button[^>]*id="managementPnlExportBtn"[^>]*>/)?.[0] || "";
assert(exportButton && !/\bdisabled\b/.test(exportButton), "P&L export button is enabled for the selected FY and segment");

for (const oldControl of ["managementPnlPeriod", "managementPnlComparison", "managementPnlMonth", "managementPnlFrom", "managementPnlKpis", "managementPnlWarnings"]) {
    assert(!screenHtml.includes(`id="${oldControl}"`), `${oldControl} old presentation is removed`);
}
assert.match(screenHtml, /managementPnlPreviousFy/);
assert.match(screenHtml, /managementPnlNextFy/);
assert.match(screenHtml, /managementPnlFyLabel/);
assert.match(screenHtml, /managementPnlSegment/);
assert.match(screenHtml, /managementPnlAsOf/);
for (const segment of ["ALL", "KL", "MENS", "KIDS"]) assert(screenHtml.includes(`value="${segment}"`), `segment selector contains ${segment}`);
assert(!screenHtml.includes('value="COMMON"'), "COMMON is not a selectable sales segment");

assert.match(preload, /getManagementPnlFinancialYear: options => ipcRenderer\.invoke\("management-pnl:get-financial-year"/,
    "read-only FY API uses narrow preload exposure");
assert.match(main, /management-pnl:get-financial-year[\s\S]*managementPnlService\.getManagementPnlFinancialYear/,
    "main IPC delegates FY accounting to the central service");
assert.match(preload, /exportManagementPnlFinancialYear: options => ipcRenderer\.invoke\("management-pnl:export-financial-year"/,
    "export uses a narrow preload method");
assert.match(main, /requireManagementPnlRenderer[\s\S]*event\.sender !== mainWindow\.webContents/,
    "P&L IPC validates the calling renderer");
assert.match(service, /async function getManagementPnlFinancialYear[\s\S]*buildFinancialYearVariances/,
    "FY ranges and variance calculations remain in the accounting service");
assert.match(service, /HISTORICAL_GROSS_COMPATIBILITY_APPLIED[\s\S]*severity: "INFO"/,
    "validated legacy gross reconstruction is informational");
assert.match(service, /function compactWarnings[\s\S]*grouped\.set/,
    "repeated data quality warnings are deduplicated in the service contract");

assert.match(renderer, /\["APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "JAN", "FEB", "MAR"\]/,
    "FY month columns use April through March order");
assert.match(renderer, /managementPnlPreviousFy[\s\S]*financialYearStart -= 1/);
assert.match(renderer, /managementPnlNextFy[\s\S]*financialYearStart < state\.currentFinancialYearStart/,
    "next FY cannot navigate beyond current FY");
assert.match(renderer, /month\.future \? "—"/,
    "future months display em dash rather than zero");
assert.match(renderer, /displayMonthAmount\s*=\s*value\s*=>\s*value\s*===\s*null\s*\|\|\s*value\s*===\s*undefined\s*\?\s*"N\/A"/,
    "monthly unavailable amounts use compact N/A");
assert.match(renderer, /displayMonthPercent\s*=\s*value\s*=>[\s\S]*\?\s*"N\/A"/,
    "monthly unavailable percentages use compact N/A");
assert.match(renderer, /month\.future \? "—" : descriptor\.percentValue \? displayMonthPercent\(monthValue\) : displayMonthAmount\(monthValue\)/,
    "month cells use compact unavailable formatting while future months remain dashes");
assert.match(renderer, /operatingProfitAvailable === true \? operating\.operatingProfitPaise[\s\S]*segmentDirectOperatingResultAvailable === true \? operating\.segmentDirectOperatingResultPaise : null/,
    "renderer preserves service availability and does not convert unavailable Operating Profit to zero");
assert.match(renderer, /fullGrossProfitAvailable \? cogs\.fullGrossProfitPaise : null/,
    "renderer preserves unavailable Gross Profit as null");
assert.match(renderer, /fullGrossProfitAvailable \? cogs\.fullGrossMarginPercent : null/,
    "renderer preserves unavailable Gross Margin as null");
assert.match(renderer, /managementPnlTableBody[\s\S]*management-pnl-group-toggle/,
    "management groups support expand/collapse category details");
assert.match(renderer, /expandedGroups: new Set\(\)/,
    "a new Management P&L renderer session starts with every group collapsed");
assert.match(renderer, /if \(state\.expandedGroups\.has\(group\)\) state\.expandedGroups\.delete\(group\); else state\.expandedGroups\.add\(group\)/,
    "groups expand/collapse only in the current screen-session state");
assert.match(renderer, /function resetScreenSession\(\)\s*\{\s*state\.expandedGroups\.clear\(\);[\s\S]*wrap\.scrollTop = 0;[\s\S]*wrap\.scrollLeft = 0;/,
    "leaving/re-entering resets expanded groups and both matrix scroll axes");
assert.match(renderer, /async function open\(\)[\s\S]*resetScreenSession\(\)/,
    "every P&L entry starts collapsed at the matrix top-left");
assert.match(renderer, /managementPnlBackBtn"\)\.addEventListener\("click", \(\) => \{\s*resetScreenSession\(\);/,
    "Back clears screen-session expansion and matrix scroll state");
assert.match(renderer, /managementPnlPreviousFy[\s\S]*financialYearStart -= 1; load\(\)/);
assert.match(renderer, /managementPnlSegment"\)\.addEventListener\("change", load\)/,
    "FY and segment reloads retain expansion state while remaining on screen");
assert.match(screenHtml, /<colgroup>[\s\S]*<col style="width:310px">[\s\S]*<col span="12"/,
    "table reserves a hard 310px Particular column before monthly data columns");
assert.match(renderer, /aria-expanded/);
assert.match(renderer, /variance-favorable|varianceClass/);
assert.match(renderer, /formatVariance\(variance, true/,
    "variance amount and variance percent are rendered in separate cells");
for (const diagnostic of ["Captured-cost Net Sales", "Unknown-cost Net Sales", "VVP / Cost Pending Net Sales", "Cost Coverage"]) {
    const row = renderer.split("\n").find(sourceLine => sourceLine.includes(`line("${diagnostic}"`));
    assert(row && /diagnostic:\s*true/.test(row), `${diagnostic} is marked as a diagnostic row`);
}
assert.match(renderer, /descriptor\.diagnostic\s*\?\s*"variance-neutral"\s*:\s*varianceClass\(variance\)/,
    "diagnostic variances bypass financial impact colours");
assert.match(renderer, /function varianceClass\(variance\)[\s\S]*variance-favorable[\s\S]*variance-unfavorable/,
    "financial rows retain favourable/unfavourable variance classes");
assert.match(renderer, /value === null \|\| value === undefined[\s\S]*return "—"/,
    "unavailable variance percentages render as an em dash");
assert.match(renderer, /getManagementPnlFinancialYear\(\{/,
    "one FY service response populates the statement");
assert(!/SELECT\s+.+\s+FROM|database\.(?:all|get|run)\(|\.reduce\s*\(/i.test(renderer),
    "renderer contains no SQL, database access, or accounting aggregation");

assert.match(css, /\.management-pnl-table thead th[\s\S]*position:\s*sticky[\s\S]*top:\s*0/,
    "table header remains frozen vertically");
assert.match(css, /\.management-pnl-table \.management-pnl-sticky-column[\s\S]*position:\s*sticky[\s\S]*left:\s*0/,
    "Particular column remains frozen horizontally");
assert.match(css, /\.management-pnl-table thead \.management-pnl-sticky-header\s*\{[^}]*z-index:\s*6/,
    "Particular header is the top-left freeze intersection");
const ordinaryHeaderRule = css.match(/\.management-pnl-table thead th\s*\{([^}]*)\}/)?.[1] || "";
assert.match(ordinaryHeaderRule, /position:\s*sticky[\s\S]*top:\s*0/);
assert(!/left\s*:/.test(ordinaryHeaderRule), "month and summary headers move horizontally with their data columns");
assert.match(css, /management-pnl-sticky-header[\s\S]*z-index:\s*6/,
    "top-left frozen pane has an explicit elevated stacking order");
assert.match(css, /\.management-pnl-table thead th\s*\{[\s\S]*z-index:\s*3/,
    "scrolling month headers sit below the top-left frozen header");
assert.match(css, /\.management-pnl-table \.management-pnl-sticky-column\s*\{[\s\S]*z-index:\s*2[\s\S]*background-color:\s*#fff/,
    "sticky body labels are above scrolling body cells and opaque");
assert.match(css, /\.management-pnl-table \.management-pnl-sticky-column\s*\{[^}]*color:\s*#51464c/,
    "ordinary Particular labels have explicit dark neutral text");
assert.match(css, /\.management-pnl-table \.management-pnl-total-row \.management-pnl-sticky-column[^}]*color:\s*var\(--primary\)/,
    "total/result Particular labels retain burgundy styling");
assert.match(css, /\.management-pnl-group-row \.management-pnl-sticky-column\s*\{\s*background-color:\s*#fcfafb/,
    "sticky group labels retain their opaque group-row background");
assert.match(css, /\.management-pnl-total-row \.management-pnl-sticky-column\s*\{\s*background-color:\s*#fff/,
    "sticky total labels retain an opaque total-row background");
assert.match(css, /\.management-pnl-category-row \.management-pnl-sticky-column\s*\{[^}]*background-color:\s*#fff/,
    "sticky category labels retain an opaque category-row background");
assert.match(css, /\.management-pnl-sticky-column\s*\{[^}]*width:\s*310px[\s\S]*min-width:\s*310px[\s\S]*max-width:\s*310px/,
    "Particular column uses the expanded fixed width");
assert.match(css, /box-shadow:\s*2px 0 3px -2px/);
assert.match(css, /border-right:\s*1px solid/,
    "frozen edge uses a narrow separator without a broad faded overlay");
assert(!/box-shadow:\s*5px 0/.test(css), "broad frozen-edge shadow is absent");
assert.match(css, /scroll-snap-type:\s*x mandatory/);
assert.match(css, /scroll-padding-inline:\s*310px 8px/);
assert.match(css, /tr > :not\(:first-child\)\s*\{[^}]*scroll-snap-align:\s*start/,
    "horizontal snap aligns whole data columns after the frozen pane");
assert.match(css, /\.management-pnl-table\s*\{[^}]*table-layout:\s*fixed/,
    "fixed table geometry prevents long labels from widening into data columns");
assert.match(renderer, /management-pnl-section-label/);
assert.match(renderer, /fill\.colSpan = 16/);
assert.match(css, /\.management-pnl-section-row td \{ background: #f8f3f5; \}/,
    "section backgrounds span the table while the label remains frozen");
assert.match(css, /\.management-pnl-table \.management-pnl-sticky-column\s*\{[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis[\s\S]*white-space:\s*nowrap/,
    "Particular labels are clipped at the frozen boundary");
assert.match(css, /\.management-pnl-group-toggle\s*\{[\s\S]*max-width:\s*100%[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis[\s\S]*white-space:\s*nowrap/,
    "nested OPEX labels remain inside the Particular cell");
assert.match(renderer, /const viewport = preserveViewport \? \{ top: wrap\.scrollTop, left: wrap\.scrollLeft, pageX: window\.scrollX, pageY: window\.scrollY \}/,
    "expand/collapse captures matrix and page scroll positions");
assert.match(renderer, /renderStatement\(state\.result, \{ preserveViewport: true, focusGroup: group \}\)/,
    "expand and collapse restore both scroll axes");
assert.match(renderer, /currentButton\?\.focus\(\{ preventScroll: true \}\)/,
    "restored focus cannot trigger automatic scrolling");
assert(!/scrollIntoView\s*\(/.test(renderer), "expand/collapse does not force scrollIntoView");
const viewportCss = css.match(/\.management-pnl-table-wrap\s*\{([^}]*)\}/)?.[1] || "";
assert.match(viewportCss, /padding:\s*0/);
assert.match(viewportCss, /overflow:\s*auto/,
    "scroll viewport does not inset or clip table values with internal padding");
assert(!/overscroll-behavior(?:-y)?\s*:\s*(?:contain|none)/.test(viewportCss),
    "matrix boundary permits native vertical scroll chaining to the page");
assert.match(viewportCss, /max-height:\s*calc\(100vh\s*-\s*275px\)/,
    "natural scroll chaining fix preserves the existing matrix height");
assert(!/scrollbar-gutter:\s*stable/.test(css), "reserved scrollbar gutter does not reduce the visible table viewport");
assert.match(screenHtml, /<colgroup>[\s\S]*<col style="width:310px">[\s\S]*<col span="12"/,
    "table geometry reserves a fixed 310px Particular column before all data columns");
assert.match(renderer, /management-pnl-section-label/);
assert.match(renderer, /fill\.colSpan = 16/);
assert.match(css, /\.management-pnl-section-row td \{ background: #f8f3f5; \}/,
    "section fill remains visually continuous while its label is frozen");
assert.match(css, /\.management-pnl-table \.management-pnl-sticky-column\s*\{[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis[\s\S]*white-space:\s*nowrap/,
    "Particular labels are hard-clipped inside their frozen cell");
assert.match(css, /\.management-pnl-group-toggle\s*\{[\s\S]*max-width:\s*100%[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis[\s\S]*white-space:\s*nowrap/,
    "nested OPEX group labels remain contained inside Particular");
assert.match(renderer, /const viewport = preserveViewport \? \{ top: wrap\.scrollTop, left: wrap\.scrollLeft, pageX: window\.scrollX, pageY: window\.scrollY \}/,
    "expand/collapse captures matrix and page scroll positions");
assert.match(renderer, /renderStatement\(state\.result, \{ preserveViewport: true, focusGroup: group \}\)/,
    "expand/collapse rerender restores the matrix viewport and clicked group");
assert.match(renderer, /currentButton\?\.focus\(\{ preventScroll: true \}\)/,
    "restored group focus does not trigger automatic scrolling");
assert(!/scrollIntoView\s*\(/.test(renderer), "group expansion never forces scrollIntoView");
const qualityCss = css.match(/\.management-pnl-quality-strip\s*\{([^}]*)\}/)?.[1] || "";
assert(!/position\s*:\s*sticky/.test(qualityCss), "Data Quality strip is not sticky");
assert.match(css, /overflow:\s*auto/);
assert.match(renderer, /management-pnl-group-toggle/);
assert.match(app, /accountingExpenseTrackerBtn[\s\S]*openExpenseTracker/);
assert.match(app, /accountingSupplierAccountsBtn[^\n]*showComingSoon\("Supplier \/ Distributor Accounts"\)/);

console.log("V21-05C5 Management P&L matrix freeze/scroll/expand contracts: PASS");
