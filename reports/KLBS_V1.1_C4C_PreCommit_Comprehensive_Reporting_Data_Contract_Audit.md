# KLBS V1.1 C4C Pre-Commit Comprehensive Reporting Data Contract Audit

Audit date/time: 2026-09-21T20:00:32.1421273+05:30 (Asia/Kolkata)

This is a read-only audit. No implementation, test, database, configuration, staging, commit, push, HTTP request, Google request, or email operation was performed by this audit.

## Baseline and worktree

- Branch: main
- Full HEAD: 96d0f7f6203db9c22d003b9cdefa934874b261c1
- Short HEAD: 96d0f7f
- origin/main: 96d0f7f6203db9c22d003b9cdefa934874b261c1
- Package version: 1.1.0
- Initial status: ## main...origin/main
- Initial uncommitted C4C files preserved exactly:
  - src/services/consolidatedSheetDeliveryWorker.js
  - scripts/v1-c4c-consolidated-sheet-delivery-worker-test.js
  - reports/KLBS_V1.1_C4C_Windows_Consolidated_Sheet_Delivery_Worker.md

No production database was opened. In particular, C:\Users\USER\AppData\Roaming\KAIRA LUXE BILLING SYSTEM\billing.db was not accessed.

## Files inspected

- AGENTS.md
- package.json
- src/shared/businessSegment.js
- src/shared/consolidatedDsrBuilder.js
- src/shared/segmentPaymentAllocator.js
- src/shared/paymentSettlement.js
- src/services/consolidatedReportingTransport.js
- src/services/consolidatedSheetDeliveryWorker.js
- src/services/consolidatedReportingPersistenceService.js
- src/services/integrationOutboxService.js
- src/services/integrationConfigService.js
- src/services/dsrSyncService.js
- src/services/businessSegmentDsrOutboxService.js
- src/services/businessSegmentDsrSyncService.js
- src/services/dayClosingEmail.js
- src/services/businessSegmentDsrEmailService.js
- src/services/backupService.js
- src/database/dayClosingMigration.js
- src/database/dayClosingService.js
- src/database/dayClosingDsrService.js
- src/database/dayClosingHistoryService.js
- src/database/businessDate.js
- src/database/businessSegmentReportService.js
- src/database/reportService.js
- src/database/billService.js
- src/database/returnService.js
- src/database/importProducts.js
- src/database/productService.js
- src/database/database.js
- src/database/excelExporter.js
- src/main/main.js
- src/renderer/app.js
- src/renderer/modules/reports.js
- deployment/google-apps-script/KLBS_DSR_WebApp.gs
- deployment/google-apps-script/KLBS_Segment_DSR_WebApp.gs
- existing C4A/C4B/C4C/consolidated payload/allocator fixture tests

Repository-wide search found no Windows implementation for Party Accounting, Hybrid_Daily_Data, or a Dashboard New Google consumer. This absence is material and is recorded below rather than filled by inference.

## A. Date and time audit

| Field | Representation | Authority/evidence | Finding |
|---|---|---|---|
| day_closing_snapshots.business_date | TEXT, YYYY-MM-DD | dayClosingMigration CREATE_DAY_CLOSING_SNAPSHOTS_SQL line 6; dayClosingService.reserveClose | Correct identity string. |
| consolidated_reporting_jobs.business_date | TEXT NOT NULL | dayClosingMigration consolidated table lines 123-125 | Preserves snapshot business date. |
| payload.businessDate | String copied from snapshot | consolidatedReportingPersistenceService lines 94-103; builder lines 228-231 | Current close path supplies canonical date; C4A compares it exactly to the job column. |
| closedAt / day_closing_snapshots.closed_at | UTC ISO | dayClosingService.executeClose lines 611-624 | Produced by now().toISOString(). |
| consolidated_reporting_jobs.created_at | close timestamp in current path | dayClosingService lines 637-640 and persistence lines 107-124 | Current close path uses UTC ISO; historical migration can retain older timestamp forms. |
| sheet_last_attempt_at | UTC ISO | consolidatedSheetDeliveryWorker.claimNext | Correct. |
| sheet_processing_started_at | same UTC ISO claim timestamp | C4B schema and C4C worker | Correct. |
| sheet_delivered_at | UTC ISO | C4C persistOutcome | Correct. |
| email attempt/processing/delivered fields | nullable TEXT | dayClosingMigration lines 142-148 | C4C does not write them. |

businessDate is an identity string. The business-date helper uses Asia/Kolkata only when deriving a date from a real instant. addBusinessCalendarDays operates on a validated date string with UTC calendar arithmetic and returns a date string.

Date risks:

1. consolidatedReportingTransport.payloadIdentity checks only that businessDate is a non-empty string, not the YYYY-MM-DD pattern. Current Day Closing supplies the canonical form and C4C does not transform it, but a malformed manually inserted frozen job is not rejected by this check. C4D must validate the pattern.
2. dayClosingService.calculateAccounting lines 200-209 appends Z to legacy SQLite timestamps in YYYY-MM-DD HH:mm:ss form before deriving the business date. SQLite datetime('now') is UTC, so this is correct for that source; a legacy/local timestamp in the same format could shift the date.
3. reportService and businessSegmentReportService use SQLite DATE(bill_date) and DATE(r.business_date). Current values are date strings, but C4D must use exact identity string comparison.
4. The legacy Google script converts spreadsheet Date cells through the spreadsheet timezone and uses a noon-UTC cell workaround. C4D must verify the new receiver and live sheet behavior before writing.
5. Renderer/report presentation code uses locale dates. Those are display-only and must not be reused for persisted transport dates.

No C4C code parses or timezone-converts businessDate.

## B. Business Segment authority audit

src/shared/businessSegment.js defines exactly:

- KL = Kaira Luxe
- MENS = Mens Wear
- KIDS = Kids Wear

importProducts.js lines 156-164 accepts those codes and friendly labels, normalizes them, and rejects missing/invalid values. The product-master validation fixture rejects Men and SIS and accepts Mens Wear and Kids Wear aliases.

billService.js reads products.business_segment, calls normalizeBusinessSegment with allowLabels false at lines 378-379, and copies the result into bill_items.business_segment at lines 401-415. Renderer segment input is not the authority.

segmentPaymentAllocator.js accepts only SEGMENT_ORDER KL, MENS, KIDS. Missing or alternative values produce MISSING_SEGMENT or INVALID_SEGMENT diagnostics. consolidatedDsrBuilder skips incomplete allocations, records diagnostics and affected bills, and marks the payload INCOMPLETE. No invalid value silently defaults to another segment.

Accepted reporting identities are exactly KL, MENS, KIDS. MEN, KID, JOCKEY MEN, JOCKEY KIDS, blank, null, and arbitrary defaults are not accepted codes. Kaira Luxe, Mens Wear, and Kids Wear are import-time labels that become the codes.

## C. Segment reporting audit

consolidatedDsrBuilder.emptySegment lines 63-73 defines the same eight fields for KL, MENS, and KIDS:

| Field | Type/unit | Zero/null behavior | Authority |
|---|---|---|---|
| bills | integer count | starts at 0; zero valid | complete bill participation |
| qtySold | integer count or null | starts null; null means quantity unavailable/no participating quantity | authoritative bill item quantities |
| netContributionPaise | decimal integer string or null | null means unavailable/non-exact conversion; zero is valid | final item net contribution |
| cashPaise | integer string in paise | always present; zero valid | allocator from bills.cash_amount |
| upiPaise | integer string in paise | always present; zero valid | allocator from bills.upi_amount |
| cardPaise | integer string in paise | always present; zero valid | allocator from bills.card_amount |
| storeCreditRedeemedPaise | integer string in paise | always present; zero valid | allocator from bills.store_credit_amount |
| giftVoucherRedeemedPaise | integer string in paise | always present; zero valid | allocator from bills.gift_voucher_amount |

segments.KL, segments.MENS, and segments.KIDS always exist in a builder payload with the same keys. A non-participating segment has bills 0, qtySold null, netContributionPaise null, and five payment strings equal to 0.

The frozen consolidated contract does not contain segment gross, discount, taxable value, GST, net billing/net sales after returns, credit notes, returned quantity, return value, or ATV/UPT. sourceAudit.deferredSegmentMetrics is exactly gross, discount, returns, creditNotes. businessSegmentReportService can calculate many of these from mutable tables, but those calculations are not frozen into V1.1. They are deferred from the frozen contract, not unavailable in all Windows reporting code.

## D. Complete frozen payload field inventory

The following is the complete field inventory produced by the current builder. All included fields are stored in payload_json, hash-bound, and transported inside the C4A envelope. klbsVersion is conditional at builder level.

### Root and quality

| JSON path | Type/unit | Nullable/zero | Source/purpose |
|---|---|---|---|
| contractVersion | integer version | required, 2 | builder constant |
| snapshotVersion | integer version | required, 2 | builder constant |
| businessDate | YYYY-MM-DD string | required in current close; no zero | snapshot identity |
| closingId | string | required | snapshot id |
| closeSequence | string | required | snapshot sequence |
| closedAt | UTC ISO string | required current close | snapshot close timestamp |
| klbsVersion | string | optional builder field | application version |
| reportStatus | FINAL/INCOMPLETE/UNAVAILABLE | required | builder result |
| dataQuality.status | COMPLETE/INCOMPLETE/UNAVAILABLE | required | builder result |
| dataQuality.diagnostics | diagnostic-object array | required; can be empty | quality diagnostics |
| dataQuality.affectedBills | string array | required; can be empty | affected bill identities |

### Overall

| JSON path | Type/unit | Source |
|---|---|---|
| overall.totalBills | integer count | snapshot total_bills |
| overall.qtySold | integer count | snapshot qty_sold |
| overall.grossSalesPaise | integer-string paise | snapshot gross_sales_paise |
| overall.totalDiscountPaise | integer-string paise | snapshot total_discount_paise |
| overall.netBillingPaise | integer-string paise | snapshot net_billing_paise |
| overall.creditNoteCount | integer count | completed credit notes |
| overall.qtyReturned | integer count | completed return items |
| overall.returnCnValuePaise | integer-string paise | completed credit-note reversal value |
| overall.netSalesAfterReturnsPaise | integer-string paise | net billing minus CN value |
| overall.cashPaise | integer-string paise | bills.cash_amount |
| overall.upiPaise | integer-string paise | bills.upi_amount |
| overall.cardPaise | integer-string paise | bills.card_amount |
| overall.storeCreditRedeemedPaise | integer-string paise | bills.store_credit_amount |
| overall.giftVoucherRedeemedPaise | integer-string paise | bills.gift_voucher_amount |
| overall.settlementTotalPaise | integer-string paise | five-mode settlement sum |
| overall.actualMoneyCollectionPaise | integer-string paise | Cash + UPI + Card |
| overall.storeCreditIssuedPaise | integer-string paise | positive RETURN_CREDIT ledger movement |
| overall.settlementDifferencePaise | signed integer-string paise | net billing minus settlement |
| overall.storeCreditLedgerRedeemedPaise | integer-string paise | absolute CREDIT_REDEEMED ledger movement |
| overall.storeCreditLedgerDifferencePaise | signed integer-string paise | bill redeemed minus ledger redeemed |
| overall.backupStatus | status string | snapshot backup status |
| overall.backupReference | string or null | Windows-local ZIP filename/reference |
| overall.emailStatus | status string | snapshot email status |

All Overall count fields have zero as a valid value. Overall money fields use integer paise strings; zero is valid. A malformed input can become null in builder normalization and then fail quality/reconciliation rather than become an authoritative zero, although upstream Day Closing has its own null-to-zero risks documented in section M.

### Segment paths

For each S in KL, MENS, KIDS:

| JSON path | Type/unit | Nullable/zero |
|---|---|---|
| segments.S.bills | integer count | zero valid, not null in builder |
| segments.S.qtySold | integer count or null | nullable; do not coerce null to zero |
| segments.S.netContributionPaise | integer-string paise or null | nullable; do not coerce null to zero |
| segments.S.cashPaise | integer-string paise | required, zero valid |
| segments.S.upiPaise | integer-string paise | required, zero valid |
| segments.S.cardPaise | integer-string paise | required, zero valid |
| segments.S.storeCreditRedeemedPaise | integer-string paise | required, zero valid |
| segments.S.giftVoucherRedeemedPaise | integer-string paise | required, zero valid |

### Payment reconciliation

For each mode in cash, upi, card, storeCreditRedeemed, giftVoucherRedeemed:

| JSON path | Type/unit | Nullable/zero |
|---|---|---|
| paymentReconciliation.mode.overallPaise | integer-string paise or null | null if Overall authority unavailable; zero valid |
| paymentReconciliation.mode.segmentSumPaise | integer-string paise | zero valid |
| paymentReconciliation.mode.deltaPaise | integer-string paise or null | null if Overall unavailable; zero means pass |
| paymentReconciliation.mode.status | PASS/FAIL/NOT_APPLICABLE | required; C4A requires PASS |

### Source audit

| JSON path | Type/value |
|---|---|
| sourceAudit.billPopulation | explicit supplied authoritative bills |
| sourceAudit.allocationUnit | INDIVIDUAL_BILL |
| sourceAudit.itemWeightSource | bill_items.net_amount |
| sourceAudit.operationalSegmentSource | bill_items.business_segment |
| sourceAudit.paymentSources.cash | bills.cash_amount |
| sourceAudit.paymentSources.upi | bills.upi_amount |
| sourceAudit.paymentSources.card | bills.card_amount |
| sourceAudit.paymentSources.storeCreditRedeemed | bills.store_credit_amount |
| sourceAudit.paymentSources.giftVoucherRedeemed | bills.gift_voucher_amount |
| sourceAudit.deferredSegmentMetrics | gross, discount, returns, creditNotes |

Source audit fields are hash-bound/transported diagnostics, not normal accounting columns.

## E. Payment and allocation audit

The authority chain is billService final payment persistence -> consolidatedReportingPersistenceService.readAuthoritativeBills -> consolidatedDsrBuilder.allocateBill -> frozen segment allocations -> C4A transport. C4C does not recalculate.

segmentPaymentAllocator.js confirms:

- PROPORTIONAL_MODES is cash, upi, card.
- allocateProportionally uses final item-net weights, integer quotient allocation, largest remainders, and SEGMENT_ORDER KL, MENS, KIDS as the tie order.
- Store Credit and Gift Voucher use allocateEqually across participating segments; residual paise are assigned in KL, MENS, KIDS order among participants.
- Positive payment with no positive contribution is ZERO_ALLOCATION_WEIGHT, not a fallback.
- Zero tenders remain zero and reconcile.
- Malformed/missing payment, item, segment, or net data produces an incomplete allocation.

modeReconciliation sums all three segments and compares exactly with the authoritative bill payment. buildReconciliation repeats the check for all five Overall modes. A C4A-eligible payload therefore requires KL + MENS + KIDS = Overall for Cash, UPI, Card, Store Credit Redeemed, and Gift Voucher Redeemed, each with status PASS.

Mixed-segment bills are allocated bill by bill. Cash/UPI/Card are proportional to final item net contribution. Store Credit/Gift Voucher are equal among participating segments. Returns are not passed into the allocator and do not retroactively change sale payment allocation.

paymentSettlement.js and billService.validateBillSettlement confirm Store Credit and Gift Voucher can coexist with Cash/UPI/Card subject to stored-value and settlement checks. Cash/UPI/Card whole-rupee validation occurs at billing; internal calculations use integer paise. The allocator accepts decimal item net only when exactly representable in paise.

## F. Returns, credit, Store Credit, and Gift Voucher audit

Frozen Overall values:

- creditNoteCount: overall.creditNoteCount
- returned quantity: overall.qtyReturned
- return/CN value: overall.returnCnValuePaise
- net after returns: overall.netSalesAfterReturnsPaise
- Store Credit issued: overall.storeCreditIssuedPaise
- Store Credit redeemed from bills: overall.storeCreditRedeemedPaise
- Store Credit ledger redeemed: overall.storeCreditLedgerRedeemedPaise
- Store Credit ledger difference: overall.storeCreditLedgerDifferencePaise
- Gift Voucher redeemed: overall.giftVoucherRedeemedPaise
- five-mode reconciliation includes Store Credit/Gift Voucher redeemed.

Not present in frozen segment blocks:

- segment credit notes, return quantity, return value, net sales after returns;
- segment Store Credit issued;
- refund/payment mode;
- Store Credit numbers, customers, ledger transaction identifiers, or individual credit note identifiers.

businessSegmentReportService proves that older mutable-table reporting attributes returns to the original bill item business_segment through return_items.original_bill_item_id and bill_items. It records unclassified returns rather than inventing a segment. That result is not copied into the V1.1 frozen payload.

Day Closing overall returns use completed credit-note returns with accounting_snapshot_version 1. Store Credit ledger totals use customer_credit_transactions transaction types RETURN_CREDIT and CREDIT_REDEEMED, filtered for the business date by timestamp. No refund mode is represented.

## G. Google DSR data requirement audit

The Windows-side contract can supply these future semantic destinations:

| Destination semantic | Exact payload path | Type/unit | Zero/null/required | Authority |
|---|---|---|---|---|
| Contract Version | contractVersion | integer | required 2 | builder |
| Business Date | businessDate | YYYY-MM-DD string | required, never null | snapshot identity |
| Closing ID | closingId | string | required | snapshot id |
| Close Sequence | closeSequence | string | required | snapshot sequence |
| Snapshot Version | snapshotVersion | integer | required 2 | builder |
| Closed At | closedAt | UTC ISO string | required current close | snapshot |
| Overall Bills/Qty | overall.totalBills / overall.qtySold | counts | zero valid | snapshot |
| Overall Gross/Discount/Net | overall.grossSalesPaise / totalDiscountPaise / netBillingPaise | integer paise strings | zero valid; complete job required | snapshot |
| Overall returns | overall.creditNoteCount / qtyReturned / returnCnValuePaise / netSalesAfterReturnsPaise | counts and integer paise | zero valid | returns/Day Closing |
| Overall Cash/UPI/Card | overall.cashPaise / upiPaise / cardPaise | integer paise strings | zero valid | bills |
| Overall SC/GV | overall.storeCreditRedeemedPaise / giftVoucherRedeemedPaise | integer paise strings | zero valid | bills |
| Settlement | overall.settlementTotalPaise / actualMoneyCollectionPaise / settlementDifferencePaise | integer paise strings | zero and signed difference valid | Day Closing |
| Store Credit ledger | overall.storeCreditIssuedPaise / storeCreditLedgerRedeemedPaise / storeCreditLedgerDifferencePaise | integer paise strings | zero and signed difference valid | credit ledger |
| Segment S Bills/Qty/Net | segments.S.bills / qtySold / netContributionPaise | count, nullable count, nullable paise string | preserve nulls | allocator |
| Segment S five payments | segments.S.cashPaise, upiPaise, cardPaise, storeCreditRedeemedPaise, giftVoucherRedeemedPaise | integer paise strings | always present, zero valid | allocator |
| Reconciliation | paymentReconciliation.mode | object | all five PASS for delivery | builder |
| Quality | reportStatus, dataQuality.status | enums | FINAL/COMPLETE for delivery | builder |
| Backup/email operations | overall.backupStatus, backupReference, emailStatus | status/string/null | operational only | snapshot |

The checked-in legacy Google script defines Overall headers including Business Date, Closing ID, Close Sequence, Gross Sales, Cash, and the other Overall fields. It nevertheless requires contractVersion 1, snapshotVersion 1, a flat payload, and a three-key envelope. It cannot accept C4C. Every actual new C4D header and receiver mapping REQUIRES LIVE GOOGLE HEADER VERIFICATION IN C4D. No Google write may occur before that receiver exists and is tested.

## H. Future one-email consolidated DSR audit

The future email can use only the frozen job and show:

- controls: businessDate, closingId, closeSequence, contractVersion, snapshotVersion, closedAt, klbsVersion;
- quality: reportStatus, dataQuality.status, summarized diagnostics and affected-bill count;
- Overall: all fields under overall;
- KL/MENS/KIDS: their eight exact available fields;
- payment reconciliation: all five mode objects;
- backup status/reference for the Windows-local ZIP attachment.

It cannot truthfully show segment gross, discount, GST, taxable value, net billing after returns, credit notes, return quantity/value, or refund mode. Those must be omitted or explicitly marked unavailable/deferred, never rendered as zero. The email worker must not query mutable accounting tables to fill these holes.

## I. Hybrid data requirement audit

No Hybrid_Daily_Data implementation or Windows-side Hybrid schema exists in this repository. The raw KLBS inputs available for a Manual + KLBS merge are Overall bills/qty/accounting/payments, KL/MENS/KIDS bills, nullable quantities and net contributions, five segment payment modes, identity, quality, and reconciliation.

Not verifiable from Windows: actual Hybrid headers, whether it uses netContributionPaise or another sales definition, paise/rupee storage, Manual row identity, and whether returns/Store Credit/Gift Voucher are retained. These require Mac/Google C4G verification and do not justify changing C4C.

## J. Dashboard, MTD, and monthly audit

billService.getDashboardSummary lines 1793-1953 reads mutable bills for current-day and month-to-date bills, net sales, qty, Cash/UPI/Card/Store Credit/Gift Voucher. It does not consume consolidated_reporting_jobs and does not return KL/MENS/KIDS.

Future Google raw inputs required are Overall bills/qty/net accounting, available segment bills/nullable qty/nullable net contribution, five-mode payment fields, identity/sequence, reconciliation/quality, and Overall returns if reports are net-of-returns. ATV/AUV/UPT are not frozen payload fields. They may be derived only from genuinely available raw inputs with an explicit definition; they must not be stored as authoritative KLBS fields. Segment ATV/UPT cannot be reconstructed as the legacy segment accounting contract from the frozen payload.

## K. Party Accounting audit

No Windows Party Accounting source, schema, exporter, email builder, or test was found. The repository therefore cannot prove exact Party Accounting headers, sales definition, return/adjustment rules, payment fields, Qty/Bills use, email fields, or XLSX fields.

The supplied conceptual grouping is compatible with the available codes:

- KAIRA LUXE = Manual KL + KLBS segments.KL
- SIS = Manual MENS + Manual KIDS + KLBS segments.MENS + segments.KIDS

Windows can provide KLBS segment net contribution, bills, nullable qty, and all five allocated payment modes. It cannot provide frozen segment gross/discount/return/CN metrics. Sufficiency is NOT PROVEN FROM CURRENT WINDOWS SOURCE.

Mac/Google checklist:

1. Identify live Party Accounting headers and metric definitions.
2. Confirm whether the KLBS amount is netContributionPaise or another amount.
3. Confirm paise/rupee and null handling.
4. Confirm whether segment returns/CNs are required.
5. Confirm payment fields and email/XLSX requirements.
6. Confirm missing segment metrics are not silently converted to zero.

The decision not to add physical Party Accounting Store Credit/Gift Voucher columns cannot be proven safe from this Windows repository because Party Accounting is absent. Those fields remain available in the KLBS/Hybrid raw contract.

## L. Completeness matrix

S means each of KL, MENS, and KIDS. Exact live consumer headers require C4D/C4G verification.

| Metric | Frozen path | Google DSR | Hybrid | Email | Dashboard/MTD/Monthly | Party outputs | Status |
|---|---|---|---|---|---|---|---|
| Business Date | businessDate | required | required | required | required | required | AVAILABLE |
| Closing ID/Sequence | closingId/closeSequence | required | control | required | control | control | AVAILABLE |
| Contract/Snapshot/Quality | root versions, reportStatus, dataQuality.status | validate/status | validate | display | validate | verify | AVAILABLE |
| Overall Bills/Qty | overall.totalBills/qtySold | required | required | required | required | not proven | AVAILABLE |
| Overall Gross/Discount/Net | overall.grossSalesPaise/totalDiscountPaise/netBillingPaise | required | verify | required | raw inputs | not proven | AVAILABLE |
| Overall Credit Notes/Returns | overall.creditNoteCount/qtyReturned/returnCnValuePaise/netSalesAfterReturnsPaise | required | verify | required | verify | not proven | AVAILABLE |
| Overall Cash/UPI/Card | overall.cashPaise/upiPaise/cardPaise | required | required | required | required | likely, verify | AVAILABLE |
| Overall SC/GV | overall.storeCreditRedeemedPaise/giftVoucherRedeemedPaise | available/verify | verify | available | current dashboard uses | decision excludes physical columns | AVAILABLE |
| Settlement/reconciliation | overall settlement fields and paymentReconciliation | required/validate | validate | useful | checks | verify | AVAILABLE |
| Store Credit ledger | overall storeCreditIssuedPaise/storeCreditLedgerRedeemedPaise/storeCreditLedgerDifferencePaise | optional audit | verify | useful | verify | not proven | AVAILABLE |
| S Bills | segments.S.bills | required for segment layer | likely | available | required | if used | AVAILABLE |
| S Qty | segments.S.qtySold | nullable | likely | available when non-null | raw input | verify | AVAILABLE WITH NULL |
| S Net Contribution | segments.S.netContributionPaise | nullable | likely | available when non-null | raw input | likely, verify | AVAILABLE WITH NULL |
| S Cash/UPI/Card | segments.S payment fields | required for segment layer | likely | available | verify | likely, verify | AVAILABLE |
| S SC/GV | segments.S Store Credit/Gift Voucher fields | verify | optional | available | verify | not physical by decision | AVAILABLE |
| S Gross/Discount/GST/Taxable | no frozen path | unavailable | verify | unavailable | unavailable | unknown | DEFERRED |
| S Returns/Credit Notes | no frozen path | unavailable | verify | unavailable | unavailable | unknown | DEFERRED |
| Refund/payment mode | none | unavailable | verify | unavailable | unavailable | unknown | MISSING FROM FROZEN CONTRACT |
| Backup status/reference | overall.backupStatus/backupReference | validate only | no bytes | attachment requirement | no | verify | AVAILABLE WINDOWS-LOCAL |
| Diagnostics/sourceAudit | dataQuality and sourceAudit | validate/audit | validate | summarized warning | status | unknown | AVAILABLE DIAGNOSTIC ONLY |

## M. Zero, null, and unit audit

Correct frozen behavior:

- canonicalInteger preserves zero and signed settlement values as decimal strings;
- empty segments use numeric zero for bills, string zero for payment paise, and null for unavailable quantity/net contribution;
- buildReconciliation preserves unavailable Overall values as null and NOT_APPLICABLE;
- allocator parsing rejects malformed/non-integer-paise data;
- C4A hashes exact stored JSON and does not normalize nulls or zeros.

Relevant defaulting risks:

| Location | Pattern | Assessment |
|---|---|---|
| dayClosingService.js line 9 | Number(value || 0) in toPaise | Missing/blank accounting values become zero; unsafe if nullable data reaches Day Closing. |
| dayClosingService.js lines 166,190 | Number(total_qty || 0), Number(qty_returned || 0) | Missing quantity becomes zero. |
| businessSegmentReportService.js lines 17,65,91 | Number(value || 0) | Legacy report fallback can hide missing values. |
| reportService.js lines 18,515,541,876-888 | Number(value || 0) | Presentation/export fallback, not C4C authority. |
| allocator lines 101,106,235,239 | || 0n | Safe internal map default after validation, not source-value coercion. |

Paise/rupee boundaries are explicit: bills use rupee REAL values, Day Closing converts to integer paise, frozen JSON uses paise strings, and legacy Google divides by 100 only for presentation. Counts remain counts. C4D must preserve nullable segment values.

## N. Field and header naming audit

| Windows name | Other name | C4D mapping requirement |
|---|---|---|
| businessDate/business_date | Business Date, sometimes Business Day | explicit date identity mapping |
| closingId/closing_id | Closing ID | explicit identity mapping |
| closeSequence/close_sequence | Close Sequence, UI Close # | explicit sequence mapping |
| qtySold/qty_sold | Qty Sold, legacy segment qty | do not infer nullable segment quantity |
| totalBills/total_bills | Bills Generated, segment bills | Overall vs segment mapping |
| grossSalesPaise | Gross Sales, legacy segment grossSales | Overall available; segment deferred |
| totalDiscountPaise | Total Discount, legacy segment discountAmount | Overall available; segment deferred |
| netBillingPaise | Net Billing, legacy segment netBilling/net_sales | Overall available; segment meaning differs |
| returnCnValuePaise | Return / CN Value, legacy returnValue | Overall available; segment deferred |
| creditNoteCount | Credit Notes, legacy creditNotes | Overall available; segment deferred |
| netContributionPaise | no equivalent frozen Overall field | do not relabel as Net Billing without definition |
| settlementDifferencePaise | Payment Round Off in legacy Google, Settlement Difference in KLBS | deliberate semantic mapping |
| MENS | Mens Wear; rejected MEN | persist code, label only presentation |
| KIDS | Kids Wear; rejected KID | persist code, label only presentation |
| KL | Kaira Luxe | persist code, label only presentation |

No renaming was performed.

## O. C4C worker audit

The worker:

- consumes a consolidated_reporting_jobs row and never calls payload/accounting reconstruction;
- reuses C4A preflight, exact hash, envelope, HMAC, response identity, and transport classification;
- uses dedicated consolidated endpoint/secret names and HTTPS only;
- uses POST JSON, 30-second timeout, disabled redirects, and no secret logging;
- writes claim/recovery timestamps through toISOString and leaves businessDate unchanged;
- claims with BEGIN IMMEDIATE, increments exactly once, commits before HTTP, then persists with a claim guard;
- recovers only stale PROCESSING rows with valid UTC ISO timestamps;
- represents retryable transport results as PENDING and terminal results as FAILED;
- maps INSERTED/UPDATED/UNCHANGED to DELIVERED and STALE to terminal non-delivered;
- does not update email fields;
- has no Day Closing/startup/scheduler/legacy route/backup/email invocation.

Coverage observation: the C4C fixture explicitly tests 401 but not a separate 403 case. The implementation's classifier handles 401 and 403 in one AUTHENTICATION_FAILED branch. This is a test coverage gap, not an observed worker logic defect.

## P. Legacy non-regression audit

No C4C module is referenced by main.js. Existing legacy Overall DSR, Segment DSR, Overall Day Closing email/backup, Segment email, backup creation, billing, payment, inventory, Product Master, returns, and reporting paths remain unchanged. The three existing uncommitted C4C files were preserved exactly.

## Q. C4D GOOGLE IMPLEMENTATION INPUT CONTRACT

C4D may receive only the frozen payload described in section D inside the exact C4A envelope:

1. transportVersion is 1.
2. timestamp is UTC ISO and participates in HMAC.
3. payloadHash is lowercase SHA-256 of exact stored payload_json.
4. businessDate is an untouched YYYY-MM-DD identity string.
5. closedAt and machine timestamps are UTC ISO.
6. Overall money and segment money are integer paise decimal strings; counts are numeric integers.
7. segments.S.qtySold and netContributionPaise may be null and must not become zero.
8. Segment gross/discount/GST/taxable/net-after-returns/returns/CNs/refund mode are not supplied and must not be invented.
9. Receiver identity is Business Date + Close Sequence, with Closing ID and Payload Hash retained for idempotency/conflict verification.
10. Same date/sequence/hash is idempotent; same sequence/different hash is conflict; lower sequence is stale; higher sequence updates the date row.
11. All five payment reconciliation statuses must be PASS for C4C delivery.
12. Diagnostics, affectedBills, sourceAudit are audit data, not normal KPI columns unless separately retained.
13. backupReference is Windows-local only; Google receives no backup bytes.
14. Hybrid and Party Accounting headers/semantics require Mac/Google verification.
15. The new live Google receiver and header spelling require actual live verification in C4D; the checked-in legacy receiver is incompatible.

## R. Final conclusion

### C4C worker result

No C4C worker logic defect was found. The worker correctly consumes the frozen job, uses C4A, isolates endpoint/secret, claims safely, uses UTC timestamps, persists only Sheet state, and does not activate production routing.

### Reporting completeness result

- Overall accounting: AVAILABLE.
- Five-mode payment/reconciliation: AVAILABLE.
- KL/MENS/KIDS available segment contract: AVAILABLE, with nullable quantity/net contribution preserved.
- Segment gross/discount/returns/CNs/GST/taxable: DEFERRED from frozen payload.
- Consolidated email: AVAILABLE for frozen fields; deferred metrics must be omitted/labeled unavailable.
- Google DSR: Windows payload contract available; new receiver/header verification required.
- Hybrid: NOT PROVEN FROM CURRENT WINDOWS SOURCE.
- Dashboard/MTD/monthly raw inputs: AVAILABLE for Overall and available segment/payment fields; KPI definitions remain downstream.
- Party Accounting: NOT PROVEN FROM CURRENT WINDOWS SOURCE.
- Zero/null/unit handling: frozen builder explicit; upstream defaulting risks documented.
- Naming: deliberate mismatches documented; no C4C rename required.

The deferred downstream fields do not require changing C4C because C4C only transports the already-frozen contract. They do prevent claiming that Windows has a complete Party Accounting or segment-accounting data model.

## Tests executed

All were fixture-only and safe:

- node scripts/v1-c4c-consolidated-sheet-delivery-worker-test.js — PASS
- node scripts/v1-c4a-consolidated-transport-foundation-test.js — PASS
- node scripts/v1-c4b-consolidated-reporting-recovery-migration-test.js — PASS
- node scripts/v1-c2-c3-durable-reporting-day-closing-test.js — PASS, 41 focused assertion/case groups
- node scripts/v1-c1b-c1c-consolidated-payload-test.js — PASS, 50 focused assertion/case groups
- node scripts/v1-c1a-segment-payment-allocator-test.js — PASS, 50 focused assertion/case groups
- git diff --check — PASS

No source/test file was modified by this audit. No HTTP request, Google contact, email, database access, stage, commit, or push occurred.

## Required project status

### TASK

Completed the read-only pre-commit reporting data contract audit for C4C and the downstream KLBS reporting chain.

### FILES INSPECTED

Listed above.

### FINDINGS

The frozen V1.1 payload is internally coherent for Overall accounting, five-mode payment allocation/reconciliation, and the available segment contract. It deliberately omits segment accounting/return metrics. Windows contains no Party Accounting or Hybrid consumer implementation.

### FILES MODIFIED

Only this mandatory audit report was created:

reports/KLBS_V1.1_C4C_PreCommit_Comprehensive_Reporting_Data_Contract_Audit.md

Existing C4C source/test/report files were preserved exactly.

### DATABASE CHANGES

None. No database was opened.

### BUSINESS LOGIC CHANGES

None.

### SPECIFICATION CHECK

Audit-only requirements were followed. No implementation, staging, commit, push, Google contact, email, or production database access occurred.

### RISKS / REMAINING ISSUES

New Google receiver/header contract and Party Accounting/Hybrid consumer contracts require Mac/Google verification. C4A does not independently enforce the businessDate regex, and the C4C focused test lacks a separate 403 case; neither produced an observed C4C delivery logic failure.

### FINAL STATUS

AUDIT ONLY - NO IMPLEMENTATION FILES CHANGED

## FINAL VERDICT

READY FOR C4C COMMIT  C4D HEADER VERIFICATION REQUIRED

This verdict is limited to C4C transport correctness. It is not approval to send to the checked-in legacy Google receiver, and it is not a claim that Party Accounting or Hybrid downstream completeness has been proven.

## Final git status

The mandatory new report is untracked alongside the preserved pre-existing C4C files. No files were staged.
