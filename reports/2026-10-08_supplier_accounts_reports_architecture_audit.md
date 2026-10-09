# Supplier Accounts Report — Existing Reports Architecture Audit

**KLBS V2.1.0 · Business → Reports · Read-only pre-implementation audit**  
**Date:** 2026-10-08  
**Disposition:** AUDIT PASS — Supplier Accounts Report can be added to existing Reports architecture.

## 1. Executive Summary

The existing Business → Reports page can accommodate a Supplier Accounts Report additively. It already provides a Report Type selector, shared Date Range, Report Information panel, and Excel export action. A new report does not require a separate screen, supplier selector, or new IPC channel.

The current implementation is distributed across static HTML report choices, a renderer metadata object, backend report dispatch, filename selection, and Activity Log mapping. A future report must be added at each applicable point. The current ExcelJS workbook conventions are usable, though not entirely consistent between reports.

Supplier reporting needs a period-aware all-Supplier data query. Existing Supplier account readers provide authoritative field and event semantics, but are mostly single-Supplier or current-state functions. For reconciliation, the Supplier Statement’s ledger dates should govern: Opening Outstanding uses `as_on_date`; invoices, Credit Notes, and payments use `posting_date`. Supplier Invoice Date, Credit Note Date, and Payment Date should remain separately visible document dates where useful.

Before implementation, confirm authorization role/purpose and Store scope. The existing date selector can be reused, but its preset calculations use host-local dates while its maximum date uses Asia/Kolkata. If those can differ in production, correct the shared date handling rather than creating Supplier-specific date logic.

No source code, tests, database/schema, or report implementation files were modified in this audit.

## 2. Current Reports Architecture

### UI and report definitions

- Report Type options are static radio controls in `src/renderer/index.html` around lines 2500–2628.
- Report descriptions, feature bullets, admin-only flags, purpose IDs, and labels are in the `reports` object in `src/renderer/modules/reports.js` around lines 5–159.
- Selecting a type updates the Report Information panel using `updateReportDescription()` in `reports.js` around lines 625–659.
- `exportFunction` and `serviceFunction` fields exist in the renderer object, but export dispatch is not dynamically invoked from those properties. The actual dispatch uses `reportType` in the service switch.
- The Report Type definitions therefore are not a single registry. A new report is additive but requires updates to the static UI and multiple dispatch/configuration maps.

### Date Range UI

The existing options in `src/renderer/index.html` around lines 2632–2692 are:

1. Today
2. Yesterday
3. This Month (MTD)
4. Last Month
5. Current Financial Year
6. Previous Financial Year
7. Custom Date Range

`validateReportRequest()` in `src/renderer/modules/reports.js` around lines 438–623 produces `reportType`, `dateRange`, `fromDate`, and `toDate`.

- Today: local calendar date for both bounds.
- Yesterday: local calendar date minus one day for both bounds.
- This Month: first day of current local month through the current local date.
- Last Month: first through last day of the previous local month.
- Current FY: 1 April of the current FY through the current local date.
- Previous FY: 1 April through 31 March of the previous FY.
- Custom: selected date input values; both are required and start must not follow end.

The Report Information card shows “Selected Report Period.” MTD and Current FY display “to Till Date”; closed ranges show formatted dates. The actual `toDate` sent is the current local calendar date.

Backend sales queries generally filter with `DATE(column) BETWEEN ? AND ?`; this makes both selected date endpoints inclusive. Existing sales reports use `bill_date`; completed Supplier-independent Credit Note/return data uses `returns.business_date`.

**Date handling caveat:** preset calculations and displayed dates use host-local `new Date()` and local date formatting. `setMaximumReportDate()` alone explicitly uses `Asia/Kolkata`. Some workbook date formatting also constructs JavaScript `Date` values from date-only strings and formats them locally. The selected ISO bounds are reusable, but a machine configured outside the business timezone could calculate or display a different calendar day. Any correction should be shared by Reports, not Supplier-specific.

## 3. Existing Report Types

| Visible report | Description/features | Authorization | Backend data and date semantics | Workbook sheets |
|---|---|---|---|---|
| Business Report | Complete sales register; bill-wise sales, product details, GST breakup, payment summary | Direct export | `getBusinessReport()` reads `bills`, `bill_items`, and `products`, filtered by bill date. Returns/Credit Note items are separately queried from completed returns by `business_date`. | `Business Report`; `Returns & Credit Notes`; `Summary` |
| GST Report | GST summary for accounting/tax filing; taxable amount, GST rate, CGST, SGST, HSN summary | Direct export | Bill and bill-item tax data by bill date; completed return/Credit Note tax reversals by return business date; bill payment breakdown for reconciliation. | `GST Report`; `Credit Note GST Reversal`; `GST Summary`; `Payment Reconciliation` |
| Product Sales Report | Product-wise sales and inventory analysis; product sales, quantities, brand/category summary, revenue | Direct export | Bill items joined to bills/products, plus completed return items. Sales use bill date; returns use return business date; results are grouped by product dimensions. | `Product Sales Report` |
| Customer Purchase Report | Customer purchase history and spending; summary, purchase history, average bill, first/last purchase | Administrator, `CUSTOMER_REPORT_EXPORT` | Bills and bill-item quantities grouped by customer mobile; completed return/Credit Note reversals are included. | `Customer Purchase Report` |
| Bill Summary Report | Bill-wise transaction and customer data; bill/date, customer, quantity/value, payment breakdown | Administrator, `BILL_SUMMARY_REPORT_EXPORT` | One row per bill from `bills`, filtered by bill date. | `Bill Summary Report` |

UI metadata: `src/renderer/modules/reports.js`. Static choices and visible access copy: `src/renderer/index.html`. Retrieval/dispatch: `src/database/reportService.js`. Workbook generators: `src/database/excelExporter.js`.

## 4. Export and IPC Flow

1. The user chooses a Report Type and Date Range and selects EXPORT TO EXCEL.
2. `startReportExport()` in `src/renderer/modules/reports.js` validates the request and calls `window.electronAPI.exportReport(request, grant)`.
3. `exportReport` in `src/main/preload.js` invokes `export-report` with the request and optional authorization grant.
4. The `export-report` handler in `src/main/main.js` enforces grants for Customer Purchase and Bill Summary, chooses the date-stamped default filename, and opens Electron’s native Save dialog.
5. After the user selects a path, the main process calls `exportReport(request, filePath)` from `src/database/reportService.js`.
6. `reportService.js` obtains current Store Identity, retrieves report data, dispatches by `request.reportType`, and invokes the generator in `src/database/excelExporter.js`.
7. The ExcelJS generator writes the `.xlsx` workbook at the chosen path.
8. The main process records an Activity Log export event. It returns success/path and may include a warning if Activity Log writing fails. The renderer displays a generic success alert or an error alert; it does not display the returned path.

The existing IPC contract is generic, so a new type does not inherently require a preload API addition. Backend support requires a new report-service branch and the applicable main-process filename and audit mappings.

## 5. Excel Workbook Conventions

- Library: ExcelJS (`exceljs`, package dependency version range `^4.4.0`).
- Filenames use `KL_<Report Name>_DD_MM_YYYY.xlsx`. The date is generated in the host-local timezone; the selected report period is not part of the filename.
- Report worksheets commonly place store/business metadata in rows 1–9 and table headers on row 11. Payment Reconciliation uses row 1 headers.
- Main report sheets commonly include fixed Store Name, Address, Contact, Email, and GSTIN values. Store Code is inserted from the current Store Identity. Some auxiliary sheets, such as Payment Reconciliation, have fewer metadata rows.
- Header styling is not uniform. The shared `styleNewRegister()` helper uses bold white text, a dark brown fill, and centered/wrapped alignment. It is used on selected Credit Note, payment reconciliation, and Bill Summary sheets, but not consistently on all primary report sheets.
- Column widths are explicitly assigned in each generator. There is no common report-wide column sizing framework.
- Rupee number formats are explicitly applied in several reports, often using two decimals, negative red parentheses, and a dash for zero. Currency formatting is not applied uniformly to every monetary column in every workbook.
- Totals may be numeric values or formulas with cached results. Business and GST reports include Summary sheets; others have totals or summary rows appropriate to the report.
- Freeze panes are used selectively, including Credit Note sheets, Customer Purchase, and Bill Summary. Not every main worksheet freezes its header.
- Empty-state handling varies. Credit Note detail sheets have explicit “No Credit Notes for selected period” text; primary sheets do not share one consistent empty-data treatment.
- No shared autofilter convention was found. Worksheet names are fixed in code; there is no report-specific sheet-name sanitization path.
- Data retrieval and workbook generation materialize full result sets in memory. No streaming/pagination approach was found in this report pipeline.

These conventions are adequate for a small Supplier report. Reuse existing ExcelJS and metadata/header patterns rather than adding a styling framework.

## 6. Authorization Model

Business, GST, and Product Sales exports do not request PIN authorization. Customer Purchase and Bill Summary request Administrator authorization when selected and again at export if the renderer has no corresponding active grant. The main-process handler independently validates their exact purposes. The canonical authorization service maps both purposes to Administrator.

A Supplier Accounts export would expose broad supplier financial information. Administrator authorization is a reasonable recommendation consistent with the existing protected report pattern. The source does not establish that policy for a new purpose, so the owner must choose the role and purpose before implementation. Do not infer or change policy silently.

## 7. Output Location and Save Behavior

The Reports UI says reports are saved “in the System,” but `src/main/main.js` passes a date-stamped **filename only** as `defaultPath` to `dialog.showSaveDialog()`. No fixed output folder is supplied. The user chooses the location in the native Save dialog. The application does not automatically open the file. The generic success alert does not show the path, although the response contains it. Repeated exports default to the same name for the same report and day; collision/overwrite handling is left to the native save dialog. Retention is controlled by the user’s chosen location.

## 8. Supplier Data Sources and Existing APIs

Supplier facts are persisted in the V10–V13 Supplier tables and exposed by `src/database/supplierDistributorService.js`:

| Report field | Authoritative source / existing read path |
|---|---|
| Supplier Code, Name, lifecycle status | `supplier_master`; posted invoice/payment/opening/Credit Note rows also retain code/name snapshots. |
| Opening Outstanding, As On Date, reference, due date | `supplier_opening_balances`; `listOpeningBalances()` and Statement event construction. |
| Invoice identity, Supplier Invoice Number, Invoice Date, Posting Date, Business Segment, Invoice Total, Due Date | `supplier_invoices`; `getInvoice()` / `listInvoices()`. |
| Capture Mode and Total Quantity | V13 `supplier_invoices.capture_mode` / `total_quantity`, exposed by invoice readers. |
| Payments, Payment Date, Posting Date, mode, reference | `supplier_payments`; `getPayment()` / `listPayments()`. |
| Payment allocations | `supplier_payment_allocations` and `supplier_payment_opening_allocations`. |
| Credit Notes, Credit Note Date, Posting Date, reason/reference | `supplier_credit_notes`; `getCreditNote()` / `listCreditNotes()`. |
| Credit Note allocations | `supplier_credit_note_invoice_allocations` and `supplier_credit_note_opening_allocations`. |
| Outstanding | Invoice/opening gross amount less linked payment and Credit Note allocations. |
| Open invoices, overdue, current aging | `getSupplierSummary()` and `listOpenLiabilities()`; these use current KLBS business date and current balances. |

`getSupplierExportData()` returns lifetime data for one Supplier for the existing Supplier Account export. It does not accept a period or return all Suppliers. Existing `getSupplierSummary()` is all-time/current-state, not date-bounded. A period report therefore needs a report-specific all-Supplier query/retrieval function; existing read paths are useful for field definitions but cannot alone produce period balances.

Supplier financial facts include `store_id`, while several current account aggregates are by Supplier ID without Store filtering. The future report should define whether it is current-Store or cross-Store. Current Store scope is a sensible default, but should be confirmed before implementation.

## 9. Period and Reconciliation Semantics

`listSupplierStatement()` builds signed events in this order/source:

- Opening Outstanding: positive amount on `as_on_date`.
- Supplier Invoice: positive `invoice_total_paise` on `posting_date`.
- Supplier Credit Note: negative amount on Credit Note `posting_date`.
- Supplier Payment: negative amount on payment `posting_date`.

Thus a date-bounded reconciliation consistent with the existing Statement is:

```text
Opening Outstanding at start date
+ Supplier invoices posted during period
- Supplier Credit Notes posted during period
- Supplier payments posted during period
= Closing Outstanding at end date
```

Both selected endpoints should be inclusive. Opening balance at the start is the cumulative signed event balance before the start date; closing balance is the cumulative event balance through the end date. Invoice Date, Payment Date, and Credit Note Date are distinct document dates, but they are not the event dates used by the Statement. The report can show document dates while filtering liability movements by Posting / Business Date. For reconciliation clarity, label the period measure “Invoices posted during period” or define “Purchases” explicitly as posted invoice liability.

Outstanding details at the end date must apply only payment and Credit Note allocations whose parent transaction Posting Date is on or before that end date. Existing current-summary functions include all current allocations and cannot be reused for a historical cutoff unchanged.

The Statement reconstructs balances by effective event dates, not `posted_at`. A later-posted fact with a backdated Posting / Business Date can alter a regenerated report for an earlier period. The report would represent the current ledger reconstructed by business dates, not what was known at the time.

## 10. V13 DETAILED and SUMMARY Compatibility

Both DETAILED and SUMMARY invoices are valid Supplier liabilities represented by `invoice_total_paise`; both must contribute to period invoice liability and closing balances. Include capture mode in invoice details. Total Quantity is document-level context and may be unknown for historical detailed invoices where it could not be truthfully derived.

For SUMMARY invoices, GST/tax and product details are uncaptured/unknown. Do not put zero tax, fabricated product lines, SKU acquisition cost, or stock movement into this account report. DETAILED mode remains a legitimate liability and can be included without expanding this report into GST/CA or inventory analysis.

## 11. Minimum Recommended Workbook

Provisional, not a finalized workbook design:

- **SUMMARY:** one row per applicable Supplier, with start outstanding, invoices posted, Credit Notes posted, payments posted, and closing outstanding.
- **INVOICES:** period invoices with invoice number, Invoice Date, Posting Date, capture mode, Business Segment, quantity where known, Due Date, and gross liability.
- **PAYMENTS:** Payment Date, Posting Date, mode, reference, amount.
- **CREDIT NOTES:** Credit Note Date, Posting Date, reason/reference, amount.
- **OUTSTANDING:** liabilities still open at period end, with Supplier, document type/identity, due date, and outstanding value.

The Reports UI should export all applicable Suppliers for the selected period. Excel can handle later supplier filtering, sorting, search, and pivots. Workbook details and exact tab names remain to be designed during implementation. The report must stay separate from Stock Inward, inventory movement, Product Master cost reconciliation, and COGS reconstruction.

## 12. Future-Impact Review

### BUILD NOW

- One Supplier Accounts Report Type in the existing Reports page.
- Period-aware all-Supplier retrieval based on Supplier Statement event dates.
- One ExcelJS generator using existing workbook conventions.
- A small reconciliation summary and supporting financial details.

### DESIGN FOR LATER

- Supplier Invoice to one-or-many Stock Inward linkage.
- Mixed Business Segment invoice allocation.
- Detailed purchase GST/CA reporting.
- Invoice attachment/import and Supplier Accounts Excel analysis enhancements.

### IGNORE FOR NOW

- Separate Supplier report page, Supplier selector, custom date controls, report builder, or on-screen analytics.
- OCR, supplier-specific parsers, inventory/COGS reconciliation, or speculative tax logic.

### Eight-factor review

- **Addition:** adds one report choice and one generator/data path.
- **Subtraction:** no existing report or workflow needs removal.
- **Multiplication:** several explicit dispatch maps need one consistent new entry; this does not require restructuring the Reports page.
- **Division:** preserves the boundary between financial liability and physical Stock Inward.
- **Change over time:** immutable financial facts allow reconstruction by effective event date, subject to later backdated postings.
- **Scale:** current report flow reads full datasets and creates ExcelJS workbooks in memory; qualify realistic Supplier counts and transaction volumes.
- **Integration:** uses existing Reports UI, date range, generic IPC, Store Identity, Supplier data, Activity Log, and ExcelJS.
- **Rollback:** report-only changes can be removed without schema or financial-data rollback.
- **Cost of future-proofing:** no schema, new framework, OCR, or speculative linkage is warranted.

## 13. Eventual Files and Tests

Likely implementation files:

- `src/renderer/index.html` — new Report Type option.
- `src/renderer/modules/reports.js` — report description/features and authorization metadata.
- `src/main/main.js` — backend grant enforcement if required, default filename, and export Activity Log mapping.
- `src/database/reportService.js` — report dispatch and period-aware data retrieval integration.
- `src/database/excelExporter.js` or a focused Supplier report exporter — workbook generation.
- `src/database/supplierDistributorService.js` — if the period query belongs with the authoritative Supplier read service.
- `src/services/administratorSecurityService.js` — only if owner selects protected authorization and a new purpose is added.

The existing generic `src/main/preload.js` report IPC likely needs no change. No schema migration is indicated. Future tests should cover date boundaries and event-date semantics, reconciliation, SUMMARY and DETAILED invoices, allocations through the end date, Store scope, empty data, output dispatch, and authorization as decided.

## 14. Risks, Decisions, and Recommendation

No structural blocker prevents this report from fitting the existing Reports architecture. Confirm two policy/scope choices before implementation:

1. **Authorization:** Administrator is a reasonable recommendation for an all-Supplier financial export, but the owner must decide and authorize the purpose explicitly.
2. **Store scope:** current Store is a sensible default because financial facts carry Store IDs; confirm whether cross-Store reporting is intended.

Reuse the existing Reports screen, Date Range, generic export IPC, native Save dialog, ExcelJS, and current Supplier financial facts. Add one period-aware all-Supplier retrieval path and one workbook generator. Use Statement Posting / Business Date semantics for reconciliation, preserve separate document dates, and address timezone consistency centrally if host-local dates can diverge from Asia/Kolkata.

**AUDIT PASS — SUPPLIER ACCOUNTS REPORT CAN BE ADDED TO EXISTING REPORTS ARCHITECTURE**
