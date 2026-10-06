"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const read = relative => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

const html = read("src/renderer/index.html");
const app = read("src/renderer/app.js");
const shortcuts = read("src/renderer/modules/shortcuts.js");
const reportsModule = read("src/renderer/modules/reports.js");
const reportService = read("src/database/reportService.js");
const main = read("src/main/main.js");
const preload = read("src/main/preload.js");

const dashboard = html.match(/<div id="dashboardScreen"[\s\S]*?<div class="dashboard-grid">([\s\S]*?)<\/div>/)?.[1];
assert(dashboard, "Dashboard primary action grid exists");
const dashboardButtonIds = [...dashboard.matchAll(/<button id="([^"]+)"/g)].map(match => match[1]);
assert.deepStrictEqual(dashboardButtonIds, ["newBillBtn", "billHistoryBtn", "reportsBtn", "settingsBtn"], "Dashboard retains exactly four primary actions in the original order");
assert.match(dashboard, /<button id="reportsBtn">\s*BUSINESS\s*<\/button>/, "the existing Reports action is relabelled Business");

for (const id of ["businessScreen", "customersScreen", "accountingDataScreen"]) {
    assert(html.includes(`id="${id}"`), `${id} full-page destination exists`);
}
for (const id of ["businessReportsBtn", "businessCustomersBtn", "businessAccountingBtn"]) {
    assert(html.includes(`id="${id}"`), `${id} is an implemented Business section action`);
}
for (const [id, icon, title, description] of [
    ["businessReportsBtn", "📊", "REPORTS", "Sales, inventory, payments and<br>business reports"],
    ["businessCustomersBtn", "👥", "CUSTOMERS", "Customer directory, profiles and<br>purchase history"],
    ["businessAccountingBtn", "🧾", "ACCOUNTING &amp; DATA", "Expenses, management accounts,<br>GST and data exports"]
]) {
    const card = html.match(new RegExp(`<button id="${id}"[\\s\\S]*?<\\/button>`))?.[0] || "";
    assert(card.includes(icon) && card.includes(title) && card.includes(description), `${title} card has its icon and approved concise copy`);
}
assert.match(html, /id="customersScreen"[\s\S]*?CUSTOMERS[\s\S]*?Customer directory and purchase history[\s\S]*?customerDirectorySearch[\s\S]*?customerDirectoryRows[\s\S]*?customerManagementProfile/);
assert.match(html, /id="accountingDataScreen"[\s\S]*?ACCOUNTING &amp; DATA[\s\S]*?This workspace is being prepared\./);

for (const route of [
    /reportsBtn\.addEventListener\("click", async[\s\S]*?businessScreen\.style\.display = "block"/,
    /businessReportsBtn[\s\S]*?openExistingReportsFromBusiness/,
    /businessCustomersBtn[\s\S]*?customersScreen\.style\.display = "block"/,
    /businessAccountingBtn[\s\S]*?accountingDataScreen\.style\.display = "block"/,
    /reportsDashboardBtn\.addEventListener\("click", returnFromReports/,
    /customersBusinessBtn[\s\S]*?showBusinessWorkspace/,
    /accountingBusinessBtn[\s\S]*?showBusinessWorkspace/,
    /function hideAllScreens\(\)[\s\S]*?businessScreen\.style\.display = "none"[\s\S]*?customersScreen\.style\.display = "none"[\s\S]*?accountingDataScreen\.style\.display = "none"/
]) assert.match(app, route, `navigation contract ${route}`);

assert.match(shortcuts, /function openBusinessWorkspace\(\)[\s\S]*?abandonNewBillDraftBeforeNavigation\(\)[\s\S]*?getElementById\("reportsBtn"\)\?\.click\(\)/, "F4 enters Business through the existing Dashboard button and preserves draft abandonment");
assert.match(shortcuts, /case "F4":[\s\S]*?openBusinessWorkspace\(\)/, "F4 routes to Business");
assert.match(shortcuts, /reportsScreen[\s\S]*?reportsDashboardBtn[\s\S]*?customersScreen[\s\S]*?customersBusinessBtn[\s\S]*?accountingDataScreen[\s\S]*?accountingBusinessBtn[\s\S]*?businessScreen[\s\S]*?businessDashboardBtn/, "Escape returns through deterministic parent routes");
for (const key of ["F2", "F3", "F5", "F10", "F12"]) assert(shortcuts.includes(`case "${key}"`), `${key} shortcut remains present`);

// Reports page controls and service wiring are preserved in the existing view/module.
const reportsMarkup = html.slice(html.indexOf('id="reportsScreen"'), html.indexOf("<!-- =====================================\n     APPLICATION LOCK OVERLAY"));
for (const id of ["reportsDashboardBtn", "reportDateRange", "customDateRange", "fromDate", "toDate", "reportDescription", "exportReportBtn"]) {
    assert(reportsMarkup.includes(`id="${id}"`), `existing Reports control ${id} is retained`);
}
const reportTypes = ["business", "gst", "product", "customer", "billSummary"];
for (const type of reportTypes) {
    assert(reportsMarkup.includes(`value="${type}"`), `${type} report option remains available`);
    assert(reportsModule.includes(`${type}:`), `${type} report definition remains in the original module`);
    assert(reportService.includes(`case "${type}"`), `${type} still dispatches to the existing report service`);
    assert(main.includes(`case "${type}"`), `${type} remains handled by the existing IPC export route`);
}
assert.match(reportsMarkup, /value="today"[\s\S]*?value="yesterday"[\s\S]*?value="thisMonth"[\s\S]*?value="lastMonth"[\s\S]*?value="currentFY"[\s\S]*?value="previousFY"[\s\S]*?value="custom"/);
assert.match(reportsModule, /window\.electronAPI\.exportReport\(request, grant\)/);
assert.match(main, /requireSecurityGrant\(grant, "CUSTOMER_REPORT_EXPORT"\)/);
assert.match(main, /requireSecurityGrant\(grant, "BILL_SUMMARY_REPORT_EXPORT"\)/);
assert.match(preload, /exportReport:\s*\(request, grant\)\s*=>\s*ipcRenderer\.invoke\([\s\S]*?"export-report"[\s\S]*?request[\s\S]*?grant/);
assert(read("src/renderer/style.css").includes('@import "./styles/reports.css";'), "existing Reports stylesheet remains loaded");
assert(read("src/renderer/style.css").includes('@import "./styles/business.css";'), "Business styles are isolated in their own stylesheet");
const businessCss = read("src/renderer/styles/business.css");
assert.match(businessCss, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, "Business cards occupy a three-column desktop row");
assert.match(businessCss, /min-height:\s*300px/);
assert.match(businessCss, /border-radius:\s*24px/);
assert.match(businessCss, /background:\s*#fff/);
assert.match(businessCss, /box-shadow:\s*0 10px 30px rgba\(0, 0, 0, \.08\)/);
assert.match(businessCss, /align-items:\s*center[\s\S]*?text-align:\s*center/);
assert.match(businessCss, /transform:\s*translateY\(-8px\)/, "Business hover follows the existing System elevation convention");
assert.match(read("src/renderer/styles/settings.css"), /\.settings-card\{[\s\S]*?border-radius:\s*24px[\s\S]*?box-shadow:\s*0 10px 30px/, "System visual reference remains intact");

// Legacy Bill History, settings and Export Data routes remain present.
assert.match(app, /historyBackBtn[\s\S]*?dashboardScreen\.style\.display = "block"/);
assert.match(app, /settingsDashboardBtn[\s\S]*?dashboardScreen\.style\.display = "block"/);
assert.match(read("src/renderer/modules/system.js"), /showComingSoon\("Export Data"\)/, "legacy System Export Data card remains untouched");
assert.match(read("src/renderer/modules/system/exportData.js"), /function showExportDataPage\(\)/, "existing Export Data page implementation remains available");

console.log("V21-03A Business workspace/navigation and Reports preservation contracts: PASS");
