# V21-06 Supplier / Distributor Module

## OWNER CORRECTION 05 — BRAND MAPPING MODAL UX REDESIGN

### Owner review and root UX problem

Owner visual acceptance of Correction 04 failed. The inline Brand Mapping editor expanded inside the already-large Supplier drawer, squeezed the three mapping fields beside permanent vocabulary controls, and created competing ADD BRAND MAPPING actions. This crowded the drawer and obscured the main Supplier form hierarchy.

### Implementation approach

- Removed the nested mapping editor from the Supplier drawer. The drawer now shows a compact empty state or compact mapping rows, with one `+ ADD BRAND MAPPING` action.
- Added a focused, vertically arranged Brand Mapping modal layered above the Supplier drawer. The drawer remains open behind it.
- Brand and Product Segment suggestions remain searchable. A contextual add action appears only for unmatched text and invokes the existing explicit Supplier-side vocabulary API.
- New Supplier mappings remain local draft state until the existing Supplier create/update service persists the Supplier and relationships together. Draft mappings can be edited or removed.
- Existing mappings retain the current V12 relationship edit/end flows. Ending a mapping retains its history and requires confirmation.
- Business Segment remains explicitly selected from KL, MENS, or KIDS. Duplicate normalized tuples remain blocked in the renderer and by existing service/database validation.
- Escape handling closes an active native suggestion/select first, then the mapping modal, then follows the existing Supplier edit/drawer/navigation hierarchy. Existing global KLBS modal priority remains in place.

### Files changed for Correction 05

- `src/renderer/index.html`
- `src/renderer/modules/supplierManagement.js`
- `src/renderer/styles/business.css`
- `scripts/v21-06-supplier-distributor-module-test.js`
- `reports/2026-10-08_v21-06_supplier-distributor_module.md` (created because the requested report path was not present in this worktree)

### Authority boundaries

Schema remains V12. No V13 was introduced. No Supplier financial/accounting authority changed. `supplier_relationships`, `supplier_brand_master`, `supplier_product_segment_master`, relationship identities, effective dating, and lifecycle service authority remain unchanged. Product Master schema, data, and contracts remain unchanged; Product Master values continue to be suggestions only. Customer drawer behavior remains unchanged.

### Tests executed and results

- `node --check` for every modified or added JavaScript file: PASS.
- `node scripts/v21-06-supplier-distributor-module-test.js`: PASS.
- `node scripts/v21-03a-business-workspace-navigation-test.js`: PASS.
- `node scripts/v21-03c-store-identity-test.js`: PASS.
- `node scripts/v1-schema-version-compatibility-test.js`: PASS.
- `node scripts/v21-v5-clean-startup-test.js`: FAILED before a test result; child process terminated with SIGABRT (exit signal, reported as null).
- `node scripts/r09-manager-admin-separation-test.js`: PASS.
- `node scripts/v21-03b-f3-customer-drawer-test.js`: FAILED before a test result; Electron computed-style child process terminated with SIGABRT (exit signal, reported as null).
- `node scripts/v21-02-customer-profile-billing-test.js`: PASS (exit 0).
- `git diff --check`: PASS.

The two SIGABRT outcomes are reported as technical runtime failures, not passing qualifications. Owner visual and workflow retest remains necessary.

### Final worktree status

Branch: `main`. Package remains `2.0.0`. Existing uncommitted Module #9 and other worktree changes were preserved. The known excluded Dropbox-looking artifact was left untouched. Nothing was staged, committed, or pushed.

### Disposition

V21-06 CORRECTION 05 IMPLEMENTED — FOCUSED QUALIFICATION PARTIAL; OWNER RETEST PENDING

The requested V21-06 pass disposition was not claimed at the close of Correction 05 because two requested Electron child-runtime checks terminated with SIGABRT and visual viewport acceptance had not been performed. Later Correction 06 retests and diagnosis are recorded below. This does not claim Module #9 closure.

## OWNER CORRECTION 06 — SUPPLIER ACCOUNT UI / TABLE RESPONSIVENESS

### Owner findings and root causes

- Owner reported collisions among dense headers in Invoices, Opening Balances, Credit Notes, Outstanding, and Supplier Statement. The shared customer table styling forced fixed-width tables, large no-wrap headers, and page-width compression across these Supplier financial tables.
- The account directory could display both empty messages while rows existed because `.customer-directory-empty` sets `display:flex`, overriding the browser's default hidden rendering. The account API also exposed only the filtered result count, which could not distinguish a database with no suppliers from a search with no matches.
- Account tabs did not expose a sufficiently strong selected state. Supplier identity text appended status after a middle-dot separator that the owner no longer wanted. The five account actions shared one wrapping row, and the aging summary rendered as a dense sequence.

### Implementation

- Added one reusable `supplier-financial-table` architecture with a bounded, rounded `overflow-x:auto` wrapper and semantic minimum-width classes for IDs, external document numbers, dates, segments, categories, statuses, currency, references, and particulars. The table retains all six tab columns. Currency columns are right-aligned; long reference values retain a title tooltip.
- Added measured responsive geometry coverage at 1440×900, 1920×1080, and 1024×768. It checks wrapper/page bounds, table-only horizontal scrolling, header separation, and body/header alignment.
- Account directory rendering now selects exactly one of empty, no-results, or results using filtered and total supplier counts. Hidden empty panels are explicitly removed from display in the Supplier page. Request IDs prevent an older asynchronous search response from replacing newer results.
- Active account tab uses a filled KLBS accent and `aria-pressed` state. Supplier ID is rendered without an orphan separator. Secondary actions and primary Invoice/Payment actions are grouped for intentional wrapping. Aging and due values use a compact responsive label/amount grid and retain all eight values.
- Contextual empty rows remain; their `colSpan` is still derived from the active tab's full column count.
- No Supplier financial semantics, amounts, calculations, persistence, or accounting authority changed. `listSupplierAccounts` only gained an additive `totalSupplierCount` display-state field; existing filtered counts and row/account results are unchanged.

### Files changed for Correction 06

- `src/renderer/index.html`
- `src/renderer/modules/supplierManagement.js`
- `src/renderer/styles/business.css`
- `src/database/supplierDistributorService.js` (additive total supplier count for UI empty-state distinction only)
- `scripts/v21-06-supplier-distributor-module-test.js`
- `scripts/v21-06-supplier-account-layout-test.js` (added)
- `reports/2026-10-08_v21-06_supplier-distributor_module.md`

### Authority boundaries

Schema remains V12; no V13 was introduced. Supplier Invoice, Opening Outstanding, Payment, Credit Note, allocation, FIFO/manual allocation, outstanding, aging, Supplier Statement arithmetic, immutable-fact, and business-date behavior were not changed. Product Master, Inventory, COGS, Management P&L, Expense Tracker, Customer, Billing, Day Closing, DSR, Store Identity, and Correction 05 Brand Mapping lifecycle behavior remain unchanged.

### Focused tests and results

- `node --check` for every modified or added JavaScript file: PASS.
- `node scripts/v21-06-supplier-distributor-module-test.js`: PASS.
- `node scripts/v21-06-supplier-account-layout-test.js`: PASS at 1440×900, 1920×1080, and 1024×768.
- `node scripts/v21-03a-business-workspace-navigation-test.js`: PASS.
- `node scripts/v21-03c-store-identity-test.js`: PASS.
- `node scripts/v1-schema-version-compatibility-test.js`: PASS.
- `node scripts/r09-manager-admin-separation-test.js`: PASS.
- `node scripts/v21-02-customer-profile-billing-test.js`: PASS.
- `node scripts/v21-v5-clean-startup-test.js`: PASS on the escalated retry; actual Electron clean and repeated startup verified schema V12.
- `node scripts/v21-03b-f3-customer-drawer-test.js`: PASS twice on escalated retries, including Electron Chromium computed-style/geometry checks.
- `git diff --check`: PASS.

### Electron SIGABRT investigation

Sandboxed Electron starts intermittently terminated with SIGABRT before test output. macOS diagnostic reports show `EXC_CRASH`, `SIGABRT`, and the stack at `___RegisterApplication` / `NSApplication init`, before the relevant renderer or Supplier code ran. The same requested startup and Customer drawer checks pass when run outside the sandbox, and the new Supplier layout check passes there as well. Evidence indicates a sandboxed macOS AppKit/Electron startup condition, not a Supplier regression. The diagnostic reports were read-only; no host artifacts were changed.

### Final worktree status

Branch remains `main`; package remains `2.0.0`; schema remains V12. Existing uncommitted Module #9 and other worktree changes remain untouched. The known Dropbox-looking artifact and JPS & CO development fixture/data were left untouched. Nothing was staged, committed, or pushed.

### Disposition

V21-06 CORRECTION 06 PASS — READY FOR OWNER VISUAL / WORKFLOW RETEST

This disposition covers Correction 06 focused qualification only. It does not claim Module #9 closure.

## OWNER CORRECTION 07 — CONTACT PERSON VALIDATION

### Owner finding and root cause

Owner entered `1234567890wdfwfw` as Contact Person and `2423434343242fwfw` as Primary Mobile. The renderer rejected the invalid Primary Mobile inline but accepted Contact Person because Supplier profile validation checked only that Contact Person was nonblank. The authoritative Supplier service likewise required a nonblank Contact Person but accepted arbitrary characters.

### Validation rule and normalization

- Contact Person remains required and is validated as a human name in both renderer and service paths.
- Allowed content consists of Unicode letters, spaces, periods, ASCII or typographic apostrophes, and hyphens. Unicode combining marks are supported after NFC normalization.
- Before validation, leading/trailing whitespace is trimmed and repeated whitespace is collapsed to one space. Valid normalized names are saved in this form. Invalid characters are rejected and are never stripped to create a different saved value.
- The inline field error is `Enter a valid contact person name.`; invalid Contact Person receives the existing `aria-invalid` highlighting and the form summary.
- Create and update service calls both use `normalizeSupplier`, so the validation applies at the authoritative service boundary too.
- Supplier Name remains business-name capable, including `JPS & CO` and `RNM & CO`. Legal / Billing Name remains unrestricted as a business/legal name.
- Existing Primary and Alternate Mobile validation was preserved. Primary Mobile remains required; Alternate Mobile remains optional and validated when supplied.

### Files modified for Correction 07

- `src/database/supplierDistributorService.js`
- `src/renderer/modules/supplierManagement.js`
- `scripts/v21-06-supplier-distributor-module-test.js`
- `reports/2026-10-08_v21-06_supplier-distributor_module.md`

### Database and protected boundaries

No database schema, migration, or persisted fixture/data changes. Schema remains V12; no V13 was introduced. No Supplier financial/accounting behavior, Supplier V12 relationship authority, Product Master, Customer, Billing, Inventory, or other protected module was changed. Correction 05/06 UI behavior is unchanged.

### Tests and results

- `node --check` for every modified JavaScript file: PASS.
- `node scripts/v21-06-supplier-distributor-module-test.js`: PASS. Coverage includes all requested valid and invalid Contact Person values, Unicode name acceptance, whitespace normalization, valid business Supplier Names, Legal / Billing Name preservation, create rejection with no persisted Supplier, update rejection with existing record unchanged, and existing mobile validation.
- `git diff --check`: PASS.

### Source control

Branch remains `main`. Existing uncommitted work was preserved. Nothing was staged, committed, or pushed. The known Windows-looking Dropbox artifact was ignored and untouched.

### Disposition

V21-06 CORRECTION 07 PASS — READY FOR OWNER CONTACT VALIDATION RETEST

This does not claim OWNER PASS, MODULE #9 CLOSED, or production readiness.

## OWNER CORRECTION 08 — SUPPLIER DIRECTORY + PAYMENT ALLOCATION UI

### Owner findings and root causes

- Owner screenshots showed the Supplier Profiles `VIEW PROFILE` button clipped at the right edge. The profile directory used a fixed-layout table with the ACTION column at 10%, 10px cell padding, and a wrapper set to `overflow-x:hidden`. The column's content area was narrower than the full button, so the wrapper concealed the excess.
- The Payment Allocation Method fieldset forced its choices into a vertical column. Its radio inputs also inherited the general Supplier form input rule (`width:100%`, minimum 42px high, padding and border), making the native controls oversized and the labels visually uneven.

### Supplier directory correction

- Scoped the profile directory table to a 1120px minimum width and allocated 15.5% to its ACTION column. Increased the final cell's right padding to 18px.
- The directory table wrapper now permits horizontal scrolling inside the table region. It remains within the page; at the standard 1440×900 and 1920×1080 geometries the table fits without horizontal scrolling. At 1024×768 and 390×844 the table scroll is contained in its wrapper, keeping the button within the table and avoiding page-level horizontal overflow.
- Preserved all eight columns, full `VIEW PROFILE` label, search/navigation behavior, row action, and existing directory visual treatment.

### Payment Allocation Method correction

- Reorganized the two existing native radio choices as one labeled group. At desktop widths they appear on one row; at narrow widths they stack as matching full-width options. Both retain an 18px control, aligned label text, a clear click target, visible keyboard focus, and the same radio `name` for native single-selection behavior.
- Preserved `OLDEST_INVOICE_FIRST` as the checked default. The existing change handler still reveals manual allocation fields only when `MANUAL` is selected, and switching back hides them. Geometry qualification clicks both labels and verifies selection, field visibility, and re-entry to Manual.
- Updated the helper text to: “Oldest Invoice First automatically applies payment to the oldest outstanding liabilities first, including Opening Outstanding and Supplier Invoices.” This describes the existing accepted allocation behavior without exposing implementation details.
- Payment allocation ordering, validation, persistence, allocation values, outstanding arithmetic, service code, and manual allocation workflow were not changed. Existing consolidated Supplier qualification continues exercising both Manual and Oldest Invoice First posting paths.

### Files changed for Correction 08

- `src/renderer/styles/business.css`
- `src/renderer/index.html`
- `scripts/v21-06-supplier-distributor-module-test.js`
- `scripts/v21-06-supplier-account-layout-test.js`
- `reports/2026-10-08_v21-06_supplier-distributor_module.md`

`src/renderer/modules/supplierManagement.js` and Supplier financial services were not changed for this correction. Schema remains V12; no V13 or database changes were introduced. Administrator/Manager PIN modals, authorization services, purpose routing, TTL, and security modal CSS were not changed. Brand Mapping and accepted Supplier relationship behavior remain unchanged.

### Tests and results

- `node scripts/v21-06-supplier-distributor-module-test.js`: PASS. Existing financial allocation checks pass, and UI contracts cover all directory columns/action, profile navigation, scoped action width/padding, one native allocation radio group, checked Oldest Invoice First default, Manual option, helper semantics, and unchanged mode handler/service ordering.
- `node scripts/v21-06-supplier-account-layout-test.js`: PASS at 1440×900, 1920×1080, 1024×768, and 390×844. The Electron geometry fixture verified full Action button fit, contained directory overflow, no page horizontal overflow, equal 18px radios, one-row desktop choices, stacked narrow choices, and both label-driven mode transitions.
- `node --check scripts/v21-06-supplier-distributor-module-test.js`: PASS.
- `node --check scripts/v21-06-supplier-account-layout-test.js`: PASS.
- `git diff --check`: PASS.

### Source control and owner acceptance

The pre-existing uncommitted Module #9 worktree and the known excluded Dropbox-looking artifact were left untouched. Nothing was staged, committed, or pushed. Automated qualification passes; owner visual retest remains pending for Supplier Profiles at the supported widths and the Payment Allocation Method layout/Manual workflow. This does not claim Module #9 closure, owner pass, or production readiness.

### Disposition

V21-06 CORRECTION 08 PASS — READY FOR OWNER SUPPLIER UI RETEST

## OWNER CORRECTION 09 — SUPPLIER ACCOUNT STATUS + MOBILE VALIDATION

### 1. Owner findings and root causes

- The Supplier Accounts table gave `OPEN INVOICES` 10% of the table while applying ellipsis to every directory heading. At the available table width, its text content box was too narrow and rendered `OPEN INVOI...`.
- Supplier Accounts reused compact directory typography: 14px body cells and a 15px Supplier name. That was too small and light for the owner-facing summary.
- The directory rendered Outstanding and overdue count as plain text without account-condition cues.
- Existing renderer and service mobile normalization removed spaces, punctuation, and `91` / `0091` prefixes. That could turn invalid input into a different stored value and did not enforce the newly locked canonical input rule.

### 2. Future-impact review

- **Addition:** added display-only CLEARED / DUE / OVERDUE labels and one shared mobile format validator; no financial fields or calculations added.
- **Subtraction:** removed silent mobile punctuation/country-prefix stripping. Historical rows are not rewritten.
- **Multiplication:** presentation uses the same existing summary values for every Supplier row; no per-Supplier status engine or extra data model.
- **Division:** renderer formatting and service authority remain separate responsibilities but use the same pure validation helper.
- **Change over time:** status is derived on each directory refresh from current `outstanding_paise` and `overdue_invoice_count`; no stored color/state.
- **Scale:** desktop account table proportions reserve enough width for the full heading and readable values; narrow layouts scroll only inside its existing wrapper.
- **Integration:** renderer and service import the same `src/shared/supplierContactValidation.js` rule; no IPC changes.
- **Rollback:** rollback is source-only; no data conversion or migration needs reversal.
- **Design for later:** richer account-health metrics, overdue monetary amount, Supplier dashboard KPIs, and multiple contacts/numbers if business requirements warrant them.
- **Ignore for now:** contact CRM, arbitrary phone tables, credit/risk scoring, new financial status engine, and schema fields for colors.

### 3. Supplier Accounts table and heading correction

- Preserved all seven columns: Supplier, Total Purchases, Total Paid, Outstanding, Open Invoices, Overdue, and Status.
- Supplier Accounts now has a bounded 1100px table minimum, with a revised semantic column allocation. `OPEN INVOICES` receives 13% and no ellipsis, enough for the full label at owner desktop widths.
- At 1024×768 and 390×844, horizontal scrolling stays within the Supplier Accounts table wrapper. Desktop layouts at 1440×900 and 1920×1080 fit without table scrolling. The page itself does not horizontally scroll.
- Supplier name is 18px semibold, code remains secondary at 13px, purchase/payment values are 17px semibold, count/status values remain balanced, and headings stay 14px. No Customer or legacy table styling was changed.

### 4. CLEARED / DUE / OVERDUE presentation

- **CLEARED:** when existing Outstanding is zero, keep its formatted monetary amount visible and show `CLEARED` in green.
- **DUE:** when Outstanding is positive and the existing overdue count is zero, keep the amount visible and show `DUE` in amber.
- **OVERDUE:** when Outstanding is positive and the existing overdue count is nonzero, keep the amount visible and show `OVERDUE` in red. The nonzero overdue count is also red.
- The overdue field remains a count from the existing service. It is not shown as currency and no overdue amount, due-date rule, count, aging, or calculation was added or changed.
- Financial colors apply to the Outstanding cell and nonzero Overdue count only. The whole row is not colored. ACTIVE / INACTIVE stays in the separate lifecycle Status column.
- Total Purchases, Total Paid, Open Invoices, Outstanding, overdue count, and all account arithmetic continue to come from existing service values.

### 5. Primary and Alternate Mobile rules

Both renderer and service use the shared canonical pattern `^[6-9][0-9]{9}$` after trimming only surrounding whitespace.

- Primary Mobile remains visibly required and must be exactly ten digits, beginning 6–9.
- Alternate Mobile has no required attribute. Blank/whitespace-only Alternate Mobile is accepted; a supplied value must satisfy the same exact ten-digit rule.
- Both fields use numeric input mode and `maxlength=10`. Renderer handling blocks normal overlength insertion, accepts valid digit paste, and rejects invalid pasted characters/length without inserting a truncated or transformed value. Inline errors use `Enter a valid 10-digit mobile number.`, set `aria-invalid`, and clear when the value becomes valid (including blank Alternate Mobile).
- Browser attributes are UX only. The Supplier service calls the same shared validator during create and update. Invalid creates persist no Supplier; invalid updates leave the existing Supplier row unchanged.
- Only basic trim normalization is applied. `+91`, `0091`, internal spaces, hyphens, letters, and punctuation are rejected rather than rewritten. Contact Person Correction 07 validation and error handling are unchanged.

### 6. Mobile uniqueness and historical values

Inspection of the V12 Supplier master definition found uniqueness on Supplier Code only; `mobile` and `alternate_mobile` are not unique keys. This correction adds no phone identity rule, index, or table. No historical Supplier values or development fixtures were changed. An existing invalid historical Primary/Alternate Mobile will fail a profile update if submitted unchanged; the edit needs a valid number. No actual development Supplier record was inspected or rewritten.

### 7. Financial, database, and security boundaries

- **No database/schema change, migration, or V13.** Schema remains V12.
- No Supplier financial or accounting semantics/calculations changed: invoice, payment, allocation, opening, credit-note, outstanding, overdue count, aging, statement, GST, inventory, COGS, and P&L paths remain as before.
- No Administrator/Manager PIN, authorization policy, purpose route, TTL, modal, or security CSS changed. V21-SEC-02 remains untouched.
- Product Master, Customer, Billing, Day Closing, DSR, Remote Dashboard, Push Notifications, Store Identity, Brand Mapping lifecycle, and V12 relationship architecture remain untouched.

### 8. Files changed for Correction 09

- `src/shared/supplierContactValidation.js` — shared trim-only format validator.
- `src/database/supplierDistributorService.js` — service-side use of the shared validator.
- `src/renderer/modules/supplierManagement.js` — inline validation, input/paste handling, and directory state/value rendering.
- `src/renderer/index.html` — Primary/Alternate mobile attributes and shared validator script load.
- `src/renderer/styles/business.css` — Supplier Accounts column allocation, typography, semantic colors, and narrow wrapper sizing.
- `scripts/v21-06-supplier-distributor-module-test.js` — create/update, valid/invalid, rollback, renderer, and boundary contracts.
- `scripts/v21-06-supplier-account-layout-test.js` — account heading, state colors/labels, typography, collision, and viewport coverage.
- `reports/2026-10-08_v21-06_supplier-distributor_module.md` — this correction record.

### 9. Tests and results

- `node scripts/v21-06-supplier-distributor-module-test.js` — PASS. Covers all four valid prefixes; invalid prefix, lengths, country code, spaces, hyphens, letters, and blank Primary; optional blank Alternate; supplied invalid Alternate; shared renderer/service validator; rejected create with no row; rejected update with unchanged row; and valid create/update data. Existing Contact Person, relationship, financial, and Product Master assertions still pass.
- `node scripts/v21-06-supplier-account-layout-test.js` — PASS at 1440×900, 1920×1080, 1024×768, and 390×844. Verifies full `OPEN INVOICES`, no header collisions, wrapper-only narrow scrolling, no page horizontal overflow, 18px Supplier name / 17px financial values, amount-plus-label visibility, green CLEARED, amber DUE, red OVERDUE and count, and lifecycle Status independence.
- `node --check` passed for `src/database/supplierDistributorService.js`, `src/shared/supplierContactValidation.js`, `src/renderer/modules/supplierManagement.js`, and both modified Supplier test scripts.
- `git diff --check` — PASS.
- No security regression test was run because no security contract or file was changed. No full KLBS regression was run.

### 10. Owner retest and source control

Owner visual/workflow retest remains required: confirm the complete OPEN INVOICES heading, readable financial values, each green/amber/red state, nonzero count coloring, and independent ACTIVE/INACTIVE status; verify Primary required and Alternate optional, ten-digit limit, rejection of invalid prefixes/lengths/characters/country formats, and acceptance of a blank Alternate. Retest at desktop and narrower geometry. Automated results do not establish owner acceptance.

Branch remains `main`, package `2.0.0`, schema V12. Existing uncommitted V2.1 Supplier/security work and the known excluded artifact were preserved. Nothing was staged, committed, or pushed.

### Disposition

V21-06 CORRECTION 09 PASS — READY FOR OWNER SUPPLIER ACCOUNT / MOBILE RETEST

This does not claim Module #9 closure, Owner Pass, or production readiness.

## OWNER CORRECTION 10 — SIMPLIFIED PURCHASE INVOICE + MAPPING ENFORCEMENT

### Pre-implementation audit and disposition

Owner testing identified the missing explicit Supplier Accounts action, a newly truncated OVERDUE heading, the need to constrain invoice Business Segment by active V12 relationships, and excessive line-level purchase invoice entry. The supplied supplier documents establish that Supplier Purchase Invoice posting should record the gross financial liability while physical SKU receipt remains a separate future Stock Inward workflow.

**Implementation stopped before code changes.** The current V12/V11 invoice persistence contract cannot safely represent the requested simplified invoice as specified. No partial directory or invoice UI changes were made because the requested correction is a consolidated workflow and must not imply that gross-only posting is supported when the authoritative service/database contract cannot preserve its financial meaning.

### Future-impact review

- **Addition:** Build the compact financial liability invoice, active-mapping segment choices, explicit VIEW ACCOUNT action, and complete account headings after the V12 persistence contract is resolved.
- **Subtraction:** Remove product/tax line entry from the cashier workflow only when the replacement stores gross liability and total quantity truthfully.
- **Multiplication:** Supplier document formats vary; replicating each format in the posting screen would multiply maintenance and training burden.
- **Division:** Supplier Invoice is the financial liability document; Stock Inward is the later physical SKU movement.
- **Change over time:** Invoice identity, dates, liability, payments, credits, and historical invoice records must remain stable across the workflow change.
- **Scale:** A gross financial posting should not require staff to recreate every supplier invoice line.
- **Integration:** Future one-to-many Stock Inward linkage and mixed-segment allocation need explicit later design; neither is added here.
- **Rollback:** No source or data changes were made, so the current workflow remains intact pending a safe V12-compatible decision.
- **Cost of future-proofing:** Do not add speculative tables or an invoice parser now; establish only the persistence needed for gross amount and total quantity when authorized.

### V12/V11 blocker findings

1. `supplier_invoices` has `invoice_total_paise`, but the V11 trigger `trg_supplier_invoice_components_valid` requires it to equal `taxable_paise - discount_paise + cgst_paise + sgst_paise + igst_paise + other_charges_paise + rounding_adjustment_paise`. Treating the gross total as taxable would invent taxable value; putting it in tax or charges would invent those components. The owner explicitly prohibited reconstructing GST/tax components from gross total.
2. There is no invoice-level `total_quantity` field. Quantity exists only as `quantity_milli` on SKU/description invoice lines. Reusing one fabricated summary line would make invoice detail, line cost/provenance, and any downstream reconciliation represent a product line that was not captured. The service currently requires at least one line and persists those line values; the posting transition trigger also requires at least one line.
3. Therefore both requested facts cannot be persisted truthfully under the current V12 contract without a schema/financial-contract change. The correction explicitly requires stopping in that situation. No V13, migration, placeholder line, or financial workaround was introduced.

### Related contracts inspected

- Duplicate invoice protection is currently `UNIQUE(supplier_id,supplier_invoice_number_normalized)` plus a service duplicate check. It must be preserved.
- Supplier Invoice Date is required and separately stored. Posting Date is separately stored; the service currently accepts `input.postingDate` (otherwise the current KLBS business date) and validates it. The renderer currently presents Posting / Business Date as an editable date. Do not silently substitute Invoice Date for it.
- Due Date is persisted and required by the table; absent input currently defaults to Supplier Invoice Date plus the Supplier's existing default credit period. Preserve that rule.
- Active Business Segment choices can be sourced from V12 `supplier_relationships` where `status='ACTIVE' AND effective_to IS NULL`; the existing service already uses this predicate when posting. Renderer choices still include the global segment list and need filtering only after the persistence blocker is resolved. No mapping history was changed.
- Historical invoice readers use both invoice fields and invoice lines: `getInvoice`/`listInvoices`, `listInvoiceLines`, invoice detail UI, and Supplier Excel export. No historical data or line records were changed.
- The existing post path does not write `inventory_transactions`; no Stock Inward behavior was added.

### No implementation / qualification

- **Files changed for Correction 10:** None. This report section records the audit and blocker only.
- **Database/schema:** None; remains V12. No migration, data rewrite, or V13.
- **Financial, inventory, security:** No changes. Supplier financial authority and arithmetic, stock, Product Master, Manager purpose `SUPPLIER_INVOICE_POST`, authorization routing, TTL, canonical modal, and security CSS remain untouched.
- **Tests:** No implementation tests were run because implementation stopped at the schema/financial-contract blocker. Existing test files and contracts were not modified.
- **Source control:** Existing uncommitted V2.1 worktree was preserved. Nothing was staged, committed, or pushed. The known excluded artifact was left untouched.

### Required next decision

The requested gross-only Invoice Total and integer Total Quantity need truthful persisted fields/semantics. That requires an explicitly approved schema/business-contract change, which may include V13. Until the owner authorizes that contract, do not remove the current detailed posting flow or claim Correction 10 implemented. After the persistence decision, implement and qualify the directory action/header changes, mapping-driven choices and service enforcement, simplified form, and golden V11 financial regression together.

**Disposition: STOP — SCHEMA / FINANCIAL CONTRACT BLOCKER.**

## OWNER CORRECTION 10A — V13 SUPPLIER INVOICE CAPTURE CONTRACT + CORRECTION 10 RESUMPTION

### Owner decision and future-impact review

The owner approved the V13 evolution after accepting the V12/V11 blocker above. The implementation adds the minimum invoice capture contract needed for truthful SUMMARY liabilities while preserving DETAILED invoices and the existing Supplier subledger.

- **Addition:** V13 capture mode, invoice-level quantity, SUMMARY gross liability, mapping-derived segment validation, simplified posting UI, VIEW ACCOUNT, and complete account headings.
- **Subtraction:** the cashier's normal invoice entry no longer asks for SKU/product lines or a fabricated tax breakdown; historical DETAILED line capture remains supported.
- **Multiplication:** supplier document formats vary, so the workflow captures common liability facts without multiplying supplier-specific parsers or line layouts.
- **Division:** Supplier Invoice records liability; Stock Inward will record future SKU-level physical movement.
- **Change over time:** historical invoice IDs, financial components, lines, payments, allocations, credits, and posting dates remain stable; capture mode identifies the detail contract used.
- **Scale:** SUMMARY permits liability posting without manually reconstructing every document line.
- **Integration:** V12 active relationships constrain Business Segment. Future Stock Inward linkage, mixed-segment invoices, tax reporting, and exports remain future design.
- **Rollback:** migration is sequential and additive in meaning; it rebuilds the invoice table transactionally while retaining IDs, rows, and child references. No historical financial amount is rewritten.
- **Cost of future-proofing:** no OCR, speculative tax engine, inventory linkage table, or new COGS method was added.

### V13 migration and invoice contract

`src/database/supplierInvoiceCaptureMigration.js` is registered as the sequential V12→V13 migration in `src/database/schemaVersion.js`. Schema/package status is now database schema V13 and package 2.0.0. The migration adds `capture_mode` (`DETAILED` or `SUMMARY`) and nullable invoice-level `total_quantity`, and makes financial component fields nullable so unknown SUMMARY tax/components are stored as NULL rather than factual zero. It preserves the existing `invoice_total_paise` as the canonical gross liability field.

Existing invoices are marked `DETAILED`; IDs, totals, component amounts, dates, lines, and references are preserved. Historical quantity is derived only when the sum of line `quantity_milli` values converts exactly to a positive whole-unit quantity; otherwise it remains NULL. DETAILED invoices still require a valid component reconciliation and at least one line. SUMMARY invoices require a positive whole quantity and positive paise total, have no lines, and have NULL tax/component details. No summary/product placeholder line is created.

SUMMARY posting stores gross `invoice_total_paise` directly, creates the usual invoice liability and initial outstanding balance in the existing subledger, and does not create a second financial authority. Supplier Invoice Date remains distinct from Posting / Business Date. SUMMARY posting uses the service's authoritative current KLBS business date for Posting / Business Date. When Due Date is omitted, the existing Supplier credit-period default from Invoice Date is retained. Notes remain optional. Duplicate protection remains Supplier plus normalized Supplier Invoice Number, regardless of capture mode.

### Mapping enforcement and simplified posting UI

The renderer now offers only deduplicated Business Segments from the selected Supplier's valid ACTIVE V12 relationships at the authoritative posting date. A sole segment is selected; multiple choices require explicit selection. Ended mappings do not qualify, and no active mapping blocks posting with direction to add a mapping in Supplier Profile. The service independently validates Supplier plus Business Segment at post time, so a renderer bypass cannot post an unsupported segment.

The cashier form now captures Supplier context, Supplier Invoice Number, Invoice Date, mapping-derived Business Segment, integer Total Quantity, Invoice Total, optional/defaulted Due Date, read-only Posting / Business Date context, and optional Notes. The compact quantity/gross-total summary reflects the form state. Product selectors, invoice-line editor, unit acquisition costs, manual GST/tax components, discount, charges, and rounding inputs are removed from the normal SUMMARY flow. Manager authorization remains `SUPPLIER_INVOICE_POST` through the existing canonical authorization path.

SUMMARY detail/history/export output identifies the mode and states that detailed tax/product breakup was not captured. It does not display invented zero tax or product values. The existing DETAILED reader and export behavior remains available. The export includes capture mode, total quantity, and gross liability.

### Supplier Accounts directory and protected boundaries

The account directory now has a final ACTION column with a keyboard-accessible VIEW ACCOUNT action opening the same account as row interaction. Event propagation is stopped to prevent duplicate navigation. Column sizing preserves complete OPEN INVOICES and OVERDUE headings at desktop widths and uses bounded table-region horizontal scrolling at narrow widths. CLEARED/DUE/OVERDUE semantics remain unchanged.

Total Quantity is document-level information only. SUMMARY posting creates no inventory transaction, Stock Inward, Product Master update, SKU cost, or COGS. Gross Invoice Total is liability; no taxable value, GST, discount, charges, rounding, or tax rate is inferred. Future linkage is Supplier Invoice to zero/one/many Stock Inward documents. Mixed Business Segment allocation remains **DESIGN FOR LATER**; each invoice has one segment. Historical DETAILED invoice records and lines are not migrated or deleted.

### Files changed for Correction 10A

- `src/database/supplierInvoiceCaptureMigration.js` — V12→V13 invoice capture schema evolution and mode-specific integrity triggers.
- `src/database/schemaVersion.js` — schema version 13 registration, validation, and safe foreign-key-aware table rebuild migration handling.
- `src/database/supplierDistributorService.js` — SUMMARY/DETAILED posting contracts, active mapping authority, and invoice read fields.
- `src/database/supplierExcelExporter.js` — truthful SUMMARY output with uncaptured detail indicated.
- `src/renderer/modules/supplierManagement.js` — simplified SUMMARY posting, mapping-driven segments, SUMMARY detail presentation, and account action.
- `src/renderer/index.html` — simplified invoice form markup.
- `src/renderer/styles/business.css` — bounded eight-column account table and simplified invoice presentation.
- `scripts/v21-06-supplier-distributor-module-test.js` — V12 history migration, SUMMARY/DETAILED integrity, mapping, duplicate, financial, inventory, and export coverage.
- `scripts/v21-06-supplier-account-layout-test.js` — account action and four-viewport table geometry contracts.
- `scripts/v1-schema-version-compatibility-test.js`, `scripts/v21-03c-store-identity-test.js`, `scripts/v21-04-expense-tracker-test.js`, `scripts/v21-05a-return-cogs-reversal-test.js`, `scripts/v21-05e1-management-accounting-entry-test.js`, and `scripts/v21-v5-clean-startup-test.js` — expected schema version and migration-chain qualification updated to V13.
- `reports/2026-10-08_v21-06_supplier-distributor_module.md` — this implementation record.

### Qualification results

- `node scripts/v21-06-supplier-distributor-module-test.js` — PASS. Covers sequential migration and V12 historical preservation, DETAILED mode/line and component integrity, SUMMARY invoice `TEST-DORA-SUMMARY-001` with 45 units and ₹13,489.00 gross liability, exact amount/quantity persistence, unknown tax components, zero invoice lines, duplicate rejection across modes, mapping acceptance/rejection, no-mapping and ended-mapping rejection, allocation against SUMMARY liability, no inventory transaction, and SUMMARY export/detail contracts.
- `node scripts/v21-06-supplier-account-layout-test.js` — PASS at 1440×900, 1920×1080, 1024×768, and 390×844; desktop headings fit and narrow overflow remains within the table viewport.
- `node scripts/v1-schema-version-compatibility-test.js` — PASS, including fresh/legacy/current/newer refusal, rollback, repeated startup, preservation, and SQLite copy.
- `node scripts/v21-03c-store-identity-test.js` — PASS, including migration chain through V13 and adjacent Store Identity/Expense/Return/Accounting contracts.
- `node scripts/v21-04-expense-tracker-test.js` — PASS.
- `node scripts/v21-05a-return-cogs-reversal-test.js` — PASS after updating the isolated V7 migration fixture's expected terminal version from V10 to V13; Return COGS behavior passed.
- `node scripts/v21-05e1-management-accounting-entry-test.js` — PASS.
- `node scripts/v21-v5-clean-startup-test.js` — PASS; Electron clean and repeated startup reached V13.
- `node scripts/r09-manager-admin-separation-test.js` — PASS; canonical Manager/Admin separation remains intact.
- `node --check` passed for every modified JavaScript file listed above.
- `git diff --check` — PASS.

The Supplier golden allocation scenario remains covered by the consolidated Supplier test: opening balance ₹5,000, invoices XYZ ₹10,000 and ABC ₹8,000, prior XYZ payment ₹4,000, then ₹12,000 oldest-first allocation produces ₹5,000 to Opening, ₹6,000 to XYZ, and ₹1,000 to ABC; ABC remains ₹7,000, a ₹2,000 Credit Note leaves final outstanding ₹5,000. SUMMARY liability is also paid through the existing allocation path, demonstrating capture mode does not change allocation mathematics.

No authorization policy, Admin/Manager PIN, modal, purpose, TTL, or security CSS was changed. No Supplier accounting arithmetic, inventory, Product Master, COGS, or GST calculation was changed. No stage, commit, or push was performed. The worktree remains on `main`; pre-existing V2.1 dirty/untracked work remains present. The earlier Correction 10 blocker entry is retained as historical context and is resolved by this owner-approved correction.

### Owner retest

Retest the Supplier Accounts directory for VIEW ACCOUNT navigation, preserved hover, complete OPEN INVOICES/OVERDUE headings, and CLEARED/DUE/OVERDUE presentation. Open Dora Distributors' purchase invoice flow and confirm only MENS/KIDS are offered, KL is absent, required fields validate, Due Date behavior is clear, Posting / Business Date is read-only and correct, Notes are optional, and no product-line or manual GST fields remain. Post a controlled owner-approved test invoice only if desired; confirm Manager Access, ₹13,489.00 liability, Purchases/Outstanding changes, no fake detail, and no stock movement. Repeat the directory at narrow supported geometry. Automated qualification is not owner acceptance.

**Disposition: V21-06 CORRECTION 10A PASS — V13 SUPPLIER INVOICE CONTRACT IMPLEMENTED, READY FOR OWNER PURCHASE INVOICE RETEST.** This does not claim Module #9 closure, Owner Pass, or production readiness.
