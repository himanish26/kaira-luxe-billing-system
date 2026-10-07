"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const html = read("src/renderer/index.html");
const renderer = read("src/renderer/modules/managementAccountingEntries.js");
const pnl = read("src/renderer/modules/managementPnl.js");
const shortcuts = read("src/renderer/modules/shortcuts.js");
const app = read("src/renderer/app.js");
const preload = read("src/main/preload.js");
const main = read("src/main/main.js");
const service = read("src/database/managementAccountingEntryService.js");
const css = read("src/renderer/styles/management-accounting-entries.css");
const pnlCss = read("src/renderer/styles/management-pnl.css");
const excel = read("src/database/managementPnlExcelExporter.js");
const pnlService = read("src/database/managementPnlService.js");
const migration = read("src/database/managementAccountingEntryMigration.js");
const billingCss = read("src/renderer/styles/billing.css");
const expenseCss = read("src/renderer/styles/expense.css");

function includes(source, pattern, message) { assert(pattern.test(source), message); }

// Owner-accepted page heading hierarchy: a single page title plus the subtitle.
const accountingScreen = html.slice(html.indexOf('<div id="managementAccountingEntriesScreen"'), html.indexOf('<div id="expenseTrackerScreen"'));
includes(accountingScreen, /<h1 id="managementAccountingTitle">P&amp;L ACCOUNTING ENTRIES<\/h1>/,
    "top navigation retains the Accounting Entries title");
assert(!/<h2[^>]*>P&amp;L ACCOUNTING ENTRIES<\/h2>/.test(accountingScreen),
    "duplicate large page title is removed");
includes(accountingScreen, /Controlled non-operating and management accounting entries/, "supporting subtitle remains");
includes(accountingScreen, /<h3>NEW ENTRY<\/h3>/, "New Entry section remains");

// Navigation remains a supporting action on the existing P&L card/screen.
const accountingMarkup = html.slice(html.indexOf('<div id="accountingDataScreen"'), html.indexOf('<div id="managementPnlScreen"'));
assert.strictEqual((accountingMarkup.match(/class="business-workspace-card"/g) || []).length, 3,
    "Accounting & Data retains exactly three cards");
includes(html, /id="managementPnlAccountingEntriesBtn"[^>]*>ACCOUNTING ENTRIES/, "P&L has the restrained Accounting Entries action");
includes(pnl, /managementPnlAccountingEntriesBtn[\s\S]*openManagementAccountingEntries/, "P&L action opens the supporting workflow");
includes(accountingScreen, /<button id="managementAccountingEntriesBackBtn" class="back-btn" type="button">← Management P&amp;L<\/button>/,
    "form starts with the single top-level Back action to Management P&L");
assert.strictEqual((accountingScreen.match(/class="back-btn"/g) || []).length, 1,
    "Accounting Entries and History markup contains only one Back button");
assert(!accountingScreen.includes("managementAccountingHistoryBackBtn"), "History-card duplicate Back control is absent");
includes(renderer, /function showHistory\(\)[\s\S]*managementAccountingEntriesBackBtn"\)\.textContent = "← Accounting Entries"/,
    "History changes the top-level Back label to Accounting Entries");
includes(renderer, /function showEntryForm\(\)[\s\S]*managementAccountingEntriesBackBtn"\)\.textContent = "← Management P&L"/,
    "returning from History restores the top-level Management P&L Back label");
includes(renderer, /managementAccountingEntriesBackBtn"\)\.addEventListener\("click", \(\) => \{\s*if \(!\$\("managementAccountingHistoryView"\)\.hidden\)\s*\{\s*showEntryForm\(\);[\s\S]*backToManagementPnl\(\);/,
    "the single Back control returns one level according to active subview state");
includes(renderer, /function backToManagementPnl\(\)[\s\S]*window\.openManagementPnl\?\.\(\)/,
    "form Back destination remains Management P&L");
includes(shortcuts, /isManagementAccountingEntryDetailOpen\?\.\(\)\)[\s\S]*closeManagementAccountingEntryDetail\?\.\(\)[\s\S]*managementAccountingEntriesScreen[\s\S]*managementAccountingEntriesBackBtn[\s\S]*\.click\(\)/,
    "ESC closes Entry Detail first, then delegates History/form navigation to the same top Back control");
includes(renderer, /function closeDetail\(\)[\s\S]*managementAccountingDetailOverlay"\)\.hidden = true/,
    "Entry Detail closes back to the still-active History subview");
assert(!renderer.includes("managementAccountingHistoryBackBtn") && !shortcuts.includes("managementAccountingHistoryBackBtn"),
    "no duplicate History navigation handler remains active");
includes(app, /managementAccountingEntriesScreen"\)\.style\.display = "none"/, "screen participates in normal hide-all lifecycle");

// Service-driven options, authoritative business date and Store metadata.
includes(renderer, /managementAccountingEntries\.getOptions\(\)/, "head/segment options come from service");
includes(renderer, /getManagementPnlPeriod\(\{ preset: "FYTD" \}\)/, "accounting date defaults from authoritative KLBS business date response");
includes(renderer, /getCurrentStoreIdentity\(\)/, "Store identity comes from Store Identity authority");
includes(renderer, /managementAccountingDate"\)\.max = state\.businessDate/, "future accounting date is blocked in UI as a convenience");
includes(html, /managementAccountingEffectField" hidden[\s\S]*Increases Profit[\s\S]*Reduces Profit/, "friendly conditional adjustment-effect options exist");
includes(css, /\.management-accounting-form-grid \[hidden\]\s*\{\s*display:\s*none;\s*\}/,
    "hidden conditional field wrappers are removed from the grid layout despite label display:flex");
includes(renderer, /if \(!exceptional\) \$\("managementAccountingEffect"\)\.value = ""/, "stale exceptional direction is cleared");
includes(html, /managementAccountingRemarksHint" class="management-accounting-hint" hidden/, "exceptional remarks helper starts hidden");
includes(renderer, /managementAccountingRemarksHint"\)\.hidden = !exceptional/, "exceptional remarks helper follows the selected head");
includes(renderer, /managementAccountingRemarksHint"\)\.hidden = true/, "form reset hides the exceptional remarks helper");
const heads = require("../src/database/managementAccountingEntryService").HEADS;
assert.deepStrictEqual(heads.map(head => head.label), [
    "Interest Income", "Other Non-Operating Income", "Interest / Finance Charges", "Depreciation",
    "Amortisation", "Other Non-Operating Expense", "Exceptional / Adjustment Item", "Income Tax / Tax Provision"
], "the owner-accepted accounting-head labels and order remain service-authoritative");
const headChange = renderer.slice(renderer.indexOf('$("managementAccountingHead").addEventListener("change"'), renderer.indexOf('$("managementAccountingEntryForm").addEventListener'));
includes(headChange, /const exceptional = \$\("managementAccountingHead"\)\.value === "EXCEPTIONAL_ADJUSTMENT"/, "only Exceptional Adjustment activates the conditional fields");
includes(headChange, /managementAccountingEffectField"\)\.hidden = !exceptional/, "Effect on Profit is hidden for every non-exceptional head");
includes(headChange, /managementAccountingEffect"\)\.value = ""/, "leaving Exceptional Adjustment clears the previous effect");
assert.deepStrictEqual(heads.filter(head => head.code !== "EXCEPTIONAL_ADJUSTMENT").map(head => head.code),
    ["INTEREST_INCOME", "OTHER_NON_OPERATING_INCOME", "INTEREST_FINANCE_CHARGES", "DEPRECIATION", "AMORTISATION", "OTHER_NON_OPERATING_EXPENSE", "INCOME_TAX_PROVISION"],
    "all seven non-exceptional heads use the hidden-field branch");
includes(renderer, /function resetForm\(\)[\s\S]*managementAccountingEffectField"\)\.hidden = true[\s\S]*managementAccountingEffect"\)\.value = ""/,
    "fresh entry/reset starts hidden with no retained effect value");
includes(html, /managementAccountingAmount" type="text" inputmode="decimal"/, "amount is entered as normal currency text");
includes(renderer, /managementAccountingEntries\.validate\(readForm\(\)\)/, "entry fields are authoritatively validated before posting");
includes(renderer, /post\(entry, grant\)/, "posted amount uses normalized service response");
assert(!/amount\s*\*\s*100|parseFloat\s*\(/.test(renderer), "renderer does not convert currency to paise using floating point");

// Manager posting/reversal, safe business ID display and immutable correction path.
includes(renderer, /requestAdminAuthorization\("P_AND_L_ENTRY_POST"\)/, "posting requests the E1 manager purpose");
includes(renderer, /requestAdminAuthorization\("P_AND_L_ENTRY_REVERSE"\)/, "reversal requests the E1 manager purpose");
includes(renderer, /showNativeConfirm\([\s\S]*Posted entries are immutable/, "posting has explicit immutability confirmation");
includes(renderer, /showNativeConfirm\([\s\S]*original remains unchanged[\s\S]*current business date/, "reversal confirmation explains original and correction date semantics");
includes(renderer, /managementAccountingReversalReason"\)\.value\.trim\(\)[\s\S]*Enter a reversal reason/, "reversal reason is required");
includes(renderer, /posted\.entry_code/, "success shows business entry code");
assert(!/lastID|\.id\b|rawSQLite/i.test(renderer), "renderer does not surface internal SQLite identity");
includes(service, /reversed_by_entry_code/, "service detail/list exposes the original-to-reversal relationship");
includes(renderer, /!entry\.reverses_entry_code && !entry\.reversed_by_entry_code/, "reversal UI only offers eligible original entries");
includes(renderer, /managementAccountingEntries\.list\(historyFilters\(\)\)/, "history uses the authoritative service");
includes(renderer, /managementAccountingEntries\.get\(code\)/, "detail uses the authoritative service");
includes(renderer, /managementAccountingEntries\.reverse\(entry\.entry_code/, "reversal delegates to the authoritative service");
includes(html, /No P&amp;L accounting entries recorded for this period\./, "empty history state is present without synthetic zero rows");
includes(renderer, /setTimeout\(loadHistory, 250\)/, "search requests are debounced");

// Read-only renderer/security boundary and frozen E1/P&L/Excel/schema boundaries.
assert(!/\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(renderer) && !/sqlite/i.test(renderer), "renderer has no SQL or database access");
includes(preload, /managementAccountingEntries: \{[\s\S]*getOptions[\s\S]*validate[\s\S]*post[\s\S]*reverse/, "preload exposes only the narrow E1 workflow API");
includes(main, /management-accounting-entries:post[\s\S]*postEntry\(input, grant\)/, "main process delegates posting to E1 service");
includes(main, /management-accounting-entries:reverse[\s\S]*reverseEntry\(entryCode, details \|\| \{\}, grant\)/, "main process delegates reversal to E1 service");
assert(!/management_accounting_period_status/.test(migration), "no period-certification table was introduced");
assert(!/\bPBT\b|\bPAT\b|Profit Before Tax|Profit After Tax/.test(pnlService), "P&L accounting formulas remain out of scope");
assert(!/PBT|PAT|Other Accounting Entries/.test(excel), "Management P&L Excel remains unchanged in scope");
assert(!/business-workspace-card/.test(css), "no fourth Accounting & Data card was added by workflow CSS");
includes(css, /\.management-accounting-table-wrap[\s\S]*overflow: auto/, "history table is contained and scrollable");
includes(pnlCss, /\.management-pnl-actions/, "P&L action is laid out in the existing topbar");

// Back buttons keep native KLBS dimensions but no longer stretch across their grid tracks.
includes(pnlCss, /\.management-pnl-topbar > \.back-btn\s*\{\s*justify-self:\s*start;\s*\}/,
    "Management P&L back button remains content-sized inside its topbar grid");
includes(css, /\.management-accounting-topbar > \.back-btn\s*\{\s*justify-self:\s*start;\s*\}/,
    "Accounting Entries back button uses the same content-sized layout behavior");
includes(pnlCss, /\.management-pnl-topbar\s*\{[\s\S]*grid-template-columns:\s*1fr auto 1fr;/,
    "P&L title/actions retain balanced topbar geometry");
includes(css, /\.management-accounting-topbar\s*\{[\s\S]*grid-template-columns:\s*1fr auto 1fr;/,
    "Accounting Entries title/store retain balanced topbar geometry");
includes(expenseCss, /\.expense-page-topbar\s*\{\s*justify-content:\s*space-between;\s*height:\s*42px;\s*align-items:\s*flex-start;/,
    "Expense Tracker reference layout remains intact");
includes(billingCss, /\.back-btn\{\s*background:\s*var\(--primary\);\s*color:white;\s*border:none;\s*padding:16px 30px;\s*font-size:22px;\s*font-weight:700;\s*border-radius:12px;\s*cursor:pointer;\s*transition:background-color \.18s ease;\s*\}/,
    "canonical legacy back-button rule remains unchanged");
includes(billingCss, /\.settings-home \.back-btn\{\s*margin-bottom:30px;\s*\}/,
    "legacy Settings back-button spacing remains unchanged");
includes(accountingScreen, /P&amp;L ACCOUNTING ENTRY HISTORY/, "History subsection title remains");
includes(accountingScreen, /<h3>P&amp;L ACCOUNTING ENTRY HISTORY<\/h3>/, "History subsection heading remains");
includes(accountingScreen, /Search ID \/ Reference/, "History search structure remains");

console.log("V21-05E2 Management Accounting Entry UI assertions passed.");
