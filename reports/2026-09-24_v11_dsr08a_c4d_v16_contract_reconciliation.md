# KLBS V1.1.0 DSR-08A
## C4D / V16 58-Column Contract Reconciliation Audit

Audit date: 2026-09-24
Repository: `D:\KLBS\kaira-luxe-billing-system`
Scope: read-only reconciliation. No source, tests, Google Apps Script, configuration, or database was modified. No application was launched and no HTTP, email, retry, Day Closing, or database operation was executed.

## 1. Worktree state

Captured before audit:

```text
## main...origin/main
 M scripts/v1-history-pagination-regression-test.js
 M src/database/activityService.js
 M src/renderer/modules/system/activitylog.js
?? reports/2026-09-22_c4d_single_row_idempotency_defect.md
?? reports/2026-09-22_c4d_v16_postcleanup_idempotency_verifier.md
?? reports/2026-09-22_c4e_consolidated_email_architecture_audit.md
?? reports/2026-09-22_v11_complete_pin_popup_cosmetic_audit.md
?? reports/2026-09-22_v11_manager_pin_popup_cosmetic_installment1.md
?? reports/2026-09-22_v11_manager_pin_popup_cosmetic_installment2.md
?? reports/2026-09-22_v11_modal_escape_and_nav01_audit_fix.md
?? reports/2026-09-22_v11_nav01_second_pass.md
?? reports/2026-09-24_v11_dsr08_single_reporting_pipeline_audit.md
?? reports/2026-09-24_v11_log01_activity_category_taxonomy_audit.md
?? reports/2026-09-24_v11_log01_activity_log_search_final.md
?? reports/2026-09-24_v11_log01_activity_log_search_fix.md
?? scripts/c4d-job2-unchanged-repair-electron.js
?? scripts/c4d-job2-unchanged-repair-test.js
?? scripts/c4d-job2-unchanged-repair.js
?? scripts/c4d-v16-job2-idempotency-verifier-electron.js
?? scripts/c4d-v16-job2-idempotency-verifier-test.js
?? scripts/c4d-v16-job2-idempotency-verifier.js
?? scripts/v11-log01-activity-log-search-test.js
```

HEAD:

```text
995cfd6735a4d8d9e6155cb4d7654b0df7694a62
```

`git diff --name-only` and `git diff --stat` showed only the three pre-existing LOG-01-modified tracked files. They were not edited. The C4D/V16 scripts and reports were preserved.

## 2. C4D/V16 artifacts located

### Windows source

- `src/shared/consolidatedDsrBuilder.js`
- `src/services/consolidatedReportingPersistenceService.js`
- `src/services/consolidatedReportingTransport.js`
- `src/services/consolidatedSheetDeliveryWorker.js`
- `src/database/dayClosingService.js`
- `src/database/dayClosingMigration.js`
- `src/main/main.js`
- `src/services/emailService.js`
- `src/services/integrationConfigService.js`
- `src/services/dayClosingEmail.js`

### C4D/V16 scripts and tests

- `scripts/v1-c1b-c1c-consolidated-payload-test.js`
- `scripts/v1-c2-c3-durable-reporting-day-closing-test.js`
- `scripts/v1-c4a-consolidated-transport-foundation-test.js`
- `scripts/v1-c4b-consolidated-reporting-recovery-migration-test.js`
- `scripts/v1-c4c-consolidated-sheet-delivery-worker-test.js`
- `scripts/v1-c4d-failed-job-retry-test.js`
- `scripts/v1-c4d-auth-compatibility-test.js`
- `scripts/c4d-v16-job2-idempotency-verifier.js`
- `scripts/c4d-v16-job2-idempotency-verifier-test.js`
- `scripts/c4d-v16-job2-idempotency-verifier-electron.js`
- `scripts/c4d-job2-unchanged-repair.js`
- `scripts/c4d-job2-unchanged-repair-test.js`
- `scripts/c4d-job2-unchanged-repair-electron.js`

The C4D/V16 verifier and repair scripts contain the fixed Job 2 identity/hash fixture, require receiver action `UNCHANGED`, assert one mocked POST, and reject `INSERTED`, `UPDATED`, `STALE`, `CONFLICT`, duplicate-business-date, rejected, authentication, malformed, timeout, and network outcomes for that specific unchanged-verification procedure. They were inspected statically only in this audit.

### Reports and deployment artifacts

- `reports/2026-09-22_c4d_single_row_idempotency_defect.md`
- `reports/2026-09-22_c4d_v16_postcleanup_idempotency_verifier.md`
- `reports/KLBS_V1.1_C4C_Windows_Consolidated_Sheet_Delivery_Worker.md`
- `reports/KLBS_V1.1_C4C_PreCommit_Comprehensive_Reporting_Data_Contract_Audit.md`
- `reports/2026-09-22_c4e_consolidated_email_architecture_audit.md`
- `codex-reports/KLBS_V1.1_C4_Consolidated_Transport_Contract_Design.md`
- `codex-reports/KLBS_V1.1_C4D_Controlled_Failed_Job_Retry_Audit.md`
- `deployment/google-apps-script/KLBS_DSR_WebApp.gs`
- `deployment/google-apps-script/KLBS_Segment_DSR_WebApp.gs`

The prior C4D/V16 report records the approved/tested result as `UNCHANGED`, with no duplicate row and no database mutation in that controlled verification. This audit did not repeat that live or database operation.

## 3. Frozen V2 payload and exact 58-column mapping

The frozen payload is created by `createFrozenJobWithinTransaction()` in `src/services/consolidatedReportingPersistenceService.js`. It passes Day Closing snapshot totals through `snapshotOverall()`, reads the authoritative bill population and bill items, builds the V2 payload with `buildConsolidatedPayload()`, canonicalizes the payload, and stores both `payload_json` and `payload_hash` in `consolidated_reporting_jobs`.

The following mapping reconciles every locked C4D/V16 column. Monetary fields in the frozen payload are named `*Paise` and are canonical decimal integer strings after builder normalization. The later receiver’s cell/display representation is not implemented in the checked-in Windows source; no unproved rupee conversion is asserted here.

| # | 58-column field | Frozen V2 source path | Classification | Transformation / audit result |
|---:|---|---|---|---|
| 1 | Business Date | `payload.businessDate` | DIRECT | Canonical string from `snapshot.business_date`; Day Closing supplies `YYYY-MM-DD`. |
| 2 | Closing ID | `payload.closingId` | DIRECT | String form of `snapshot.id`; identity-bound to `consolidated_reporting_jobs.closing_id`. |
| 3 | Closing Sequence | `payload.closeSequence` | DIRECT | String form of `snapshot.close_sequence`; identity-bound to the job sequence. |
| 4 | Contract Version | `payload.contractVersion` | DIRECT | Builder constant `2`; transport validates semantic version 2. |
| 5 | Snapshot Version | `payload.snapshotVersion` | DIRECT | Builder constant `2`; transport validates semantic version 2. |
| 6 | Payload Hash | `consolidated_reporting_jobs.payload_hash` / validated job `payloadHash` | TRANSPORT METADATA | Lowercase SHA-256 of the exact stored canonical `payload_json`; not recalculated from mutable business tables at delivery time. |
| 7 | Closed At | `payload.closedAt` | DIRECT | Copied from the closed snapshot and canonicalized as metadata text; the transport identity does not replace it. |
| 8 | Received At | Not in frozen payload; generated by C4D receiver | RECEIVER METADATA | Receiver-side timestamp. It cannot be derived from the frozen V2 payload and must not be fabricated by Windows. |
| 9 | KLBS Version | `payload.klbsVersion` | DIRECT | Supplied from `app.getVersion()` during frozen-job creation; builder stringifies it. |
| 10 | Report Status | `payload.reportStatus` | DIRECT | Builder derives `FINAL` only when payload quality/reconciliation conditions pass; transport requires `FINAL`. |
| 11 | Data Quality Status | `payload.dataQuality.status` | DIRECT | Builder value `COMPLETE`, `INCOMPLETE`, or `UNAVAILABLE`; the consolidated worker accepts only `COMPLETE`. |
| 12 | Reconciliation Status | `payload.paymentReconciliation.cash/upi/card/storeCreditRedeemed/giftVoucherRedeemed.status` | DERIVED | A single sheet status is derived from the five mode statuses: all `PASS` means reconciliation pass; any non-pass is not a valid deliverable. The V2 payload has per-mode statuses, not a separate scalar field. |
| 13 | Backup Status | `payload.overall.backupStatus` | DIRECT | Copied from `snapshot.backup_status`; successful frozen delivery requires the Day Closing backup to be `SUCCESS` through the existing snapshot/payload validation path. |
| 14 | Email Status | `payload.overall.emailStatus` | DIRECT | Copied from `snapshot.email_status`; it is operational status, not proof that a future consolidated email has been sent. |
| 15 | Overall Bills | `payload.overall.totalBills` | DIRECT | Snapshot total. |
| 16 | Overall Qty | `payload.overall.qtySold` | DIRECT | Snapshot quantity. |
| 17 | Overall Gross Sales | `payload.overall.grossSalesPaise` | DIRECT | Snapshot paise value; receiver-side display/unit formatting is outside current Windows source. |
| 18 | Overall Discount | `payload.overall.totalDiscountPaise` | DIRECT | Snapshot paise value. |
| 19 | Overall Net Billing | `payload.overall.netBillingPaise` | DIRECT | Snapshot paise value. |
| 20 | Overall Credit Notes | `payload.overall.creditNoteCount` | DIRECT | Snapshot count. |
| 21 | Overall Qty Returned | `payload.overall.qtyReturned` | DIRECT | Snapshot quantity. |
| 22 | Overall Return Value | `payload.overall.returnCnValuePaise` | DIRECT | Snapshot paise value. |
| 23 | Overall Net Sales After Returns | `payload.overall.netSalesAfterReturnsPaise` | DIRECT | Snapshot paise value. |
| 24 | Overall Cash | `payload.overall.cashPaise` | DIRECT | Snapshot paise value. |
| 25 | Overall UPI | `payload.overall.upiPaise` | DIRECT | Snapshot paise value. |
| 26 | Overall Card | `payload.overall.cardPaise` | DIRECT | Snapshot paise value. |
| 27 | Overall Store Credit Redeemed | `payload.overall.storeCreditRedeemedPaise` | DIRECT | Snapshot paise value. |
| 28 | Overall Gift Voucher Redeemed | `payload.overall.giftVoucherRedeemedPaise` | DIRECT | Snapshot paise value. |
| 29 | Overall Total Settlement | `payload.overall.settlementTotalPaise` | DIRECT | Snapshot paise value. |
| 30 | Overall Actual Money Collection | `payload.overall.actualMoneyCollectionPaise` | DIRECT | Snapshot paise value. |
| 31 | Overall Store Credit Issued | `payload.overall.storeCreditIssuedPaise` | DIRECT | Snapshot paise value. |
| 32 | Overall Settlement Difference | `payload.overall.settlementDifferencePaise` | DIRECT | Snapshot paise value; negative values are permitted by the builder for this field. |
| 33 | Overall Store Credit Ledger Redeemed | `payload.overall.storeCreditLedgerRedeemedPaise` | DIRECT | Snapshot ledger value copied by `snapshotOverall()`. |
| 34 | Overall Store Credit Ledger Difference | `payload.overall.storeCreditLedgerDifferencePaise` | DIRECT | Snapshot ledger difference copied by `snapshotOverall()`. |
| 35 | KL Net Sales | `payload.segments.KL.netContributionPaise` | DIRECT semantic value | Segment allocation result from authoritative bill/item population; nullable when the allocation cannot be authoritative. A valid deliverable requires complete allocation. |
| 36 | KL Qty | `payload.segments.KL.qtySold` | DIRECT semantic value | Segment item quantity. |
| 37 | KL Bills | `payload.segments.KL.bills` | DIRECT semantic value | Count of allocated bills. |
| 38 | KL Cash | `payload.segments.KL.cashPaise` | DIRECT semantic value | Per-bill allocation result; canonical paise string. |
| 39 | KL UPI | `payload.segments.KL.upiPaise` | DIRECT semantic value | Per-bill allocation result. |
| 40 | KL Card | `payload.segments.KL.cardPaise` | DIRECT semantic value | Per-bill allocation result. |
| 41 | KL Store Credit Redeemed | `payload.segments.KL.storeCreditRedeemedPaise` | DIRECT semantic value | Per-bill allocation result. |
| 42 | KL Gift Voucher Redeemed | `payload.segments.KL.giftVoucherRedeemedPaise` | DIRECT semantic value | Per-bill allocation result. |
| 43 | MENS Net Sales | `payload.segments.MENS.netContributionPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 44 | MENS Qty | `payload.segments.MENS.qtySold` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 45 | MENS Bills | `payload.segments.MENS.bills` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 46 | MENS Cash | `payload.segments.MENS.cashPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 47 | MENS UPI | `payload.segments.MENS.upiPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 48 | MENS Card | `payload.segments.MENS.cardPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 49 | MENS Store Credit Redeemed | `payload.segments.MENS.storeCreditRedeemedPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 50 | MENS Gift Voucher Redeemed | `payload.segments.MENS.giftVoucherRedeemedPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 51 | KIDS Net Sales | `payload.segments.KIDS.netContributionPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 52 | KIDS Qty | `payload.segments.KIDS.qtySold` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 53 | KIDS Bills | `payload.segments.KIDS.bills` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 54 | KIDS Cash | `payload.segments.KIDS.cashPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 55 | KIDS UPI | `payload.segments.KIDS.upiPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 56 | KIDS Card | `payload.segments.KIDS.cardPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 57 | KIDS Store Credit Redeemed | `payload.segments.KIDS.storeCreditRedeemedPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |
| 58 | KIDS Gift Voucher Redeemed | `payload.segments.KIDS.giftVoucherRedeemedPaise` | DIRECT semantic value | Same frozen allocation semantics as KL. |

### Mapping conclusion

All 58 required semantic columns have a safe source path when the frozen payload is `FINAL` and `dataQuality.status = COMPLETE`. Two columns are not payload fields: `Received At` is receiver metadata and `Payload Hash` is persisted transport metadata. One column, scalar `Reconciliation Status`, is derived from the five frozen payment reconciliation statuses. No required financial or segment field is unavailable in the V2 payload.

The source repository does not contain the later 58-column receiver implementation, so exact receiver-side numeric cell formatting and header verification are not independently reproducible from Windows source. The locked external C4D/V16 fact and existing verifier/report artifacts establish that this is the approved/tested receiver contract for Phase 2.

## 4. 28-column versus 58-column receiver

### The older artifact

`deployment/google-apps-script/KLBS_DSR_WebApp.gs` is the older checked-in receiver. Its `KLBS_DSR_HEADERS` array defines 28 columns, including `Contract Version`, `Business Date`, `Closing ID`, `Close Sequence`, snapshot/accounting/payment fields, `Backup Status`, `Email Status`, `KLBS Version`, and `Synced At`. Its normal handler builds a flat V1 payload using `meaningfulRow_()` and upserts by business date.

That file is still referenced by the active Windows `dsrSyncService` path conceptually: `src/main/main.js` passes `readClosedDsrPayload()` into `dsrSyncService.sync()`, and the configuration is `KLBS_DSR_WEB_APP_URL`/`KLBS_DSR_SYNC_SECRET`. This is the older flat DSR path identified in the DSR-08 architecture audit.

### The later C4D/V16 artifact set

The C4D/V16 reports and verifier scripts refer to a later receiver that stores the locked 58-column row and validates the V2 identity/hash contract. The current repository does not contain that later receiver source. The existing C4D/V16 report records a controlled `UNCHANGED` result for the already-existing authoritative test row and the expected 58 semantic values.

The older Apps Script therefore explains the apparent contradiction: it is a checked-in legacy deployment artifact, while the approved/tested C4D/V16 receiver contract is external to this Windows repository. It must not be treated as evidence that the 58-column receiver is absent.

### Current tests and Windows compatibility

- C4D/V16 tests and reports use V2, payload hash, `INSERTED`, `UPDATED`, `UNCHANGED`, `STALE`, and conflict outcomes; they do not establish the 28-column contract as the C4D target.
- Older DSR tests and `deployment/google-apps-script/KLBS_DSR_WebApp.gs` still describe the flat 28-column path.
- `consolidatedReportingTransport.js` is envelope-compatible with the C4D/V16 contract: transport version 1, HMAC signature, V2/Snapshot V2 payload validation, payload hash binding, and identity-bound response validation.
- The Windows transport expects action strings `INSERTED` and `UPDATED`, not the shorthand `INSERT` and `UPDATE`. The C4D/V16 reports use the same full action names. The shorthand in the locked requirement is semantic terminology, not a source-level action mismatch.
- Transport compatibility does not equal production readiness: `consolidatedSheetDeliveryWorker` is still not instantiated or drained by `main.js`, and its default configuration currently falls back to the ordinary DSR runtime.

## 5. Receiver action contract

The source and C4D/V16 artifacts establish this semantic matrix:

| Situation | Receiver action / outcome | Windows meaning |
|---|---|---|
| No row for the business date | `INSERTED` (semantic INSERT) | New authoritative daily row created; successful delivery. |
| Existing row, incoming sequence higher | `UPDATED` (semantic UPDATE) | Existing business-date row replaced by the newer authoritative sequence; successful delivery. |
| Existing row, same sequence and same identity/hash-bound content | `UNCHANGED` | Idempotent success; no duplicate row and no semantic rewrite. |
| Existing row, incoming sequence lower | `STALE` | Incoming close is superseded; terminal non-delivery for that job, not a retry. |
| Same sequence with changed hash/content | `CONFLICT` | Integrity conflict; terminal failure and no write. |
| More than one existing row for the business date | `DUPLICATE_BUSINESS_DATE` / duplicate integrity conflict | Receiver must fail before write; no automatic row choice or repair. |

The older checked-in receiver expresses some failures as thrown/error messages such as `STALE_IGNORED`, `Equal-sequence integrity conflict`, and `Duplicate Business Date integrity conflict`. The later C4D/V16 receiver contract reports structured action/error results. The C4D worker validates structured responses with transport version, action, business date, closing ID, close sequence, payload hash, and valid UTC `receivedAt`.

`consolidatedReportingTransport.validateReceiverResponse()` accepts successful actions `INSERTED`, `UPDATED`, `UNCHANGED`, and `STALE`; `STALE` is converted to terminal `STALE_SUPERSEDED`, while the other three are delivered. It accepts terminal structured error actions `REJECTED`, `AUTHENTICATION_FAILED`, and `CONFLICT` with a safe error code/message. HTTP 409 is classified as `CONFLICT`.

## 6. Hash and identity contract

The verified chain is:

```text
authoritative Day Closing snapshot + authoritative bills/items
    -> buildConsolidatedPayload()
    -> stable key ordering / canonical JSON
    -> sha256(canonical payload JSON)
    -> consolidated_reporting_jobs.payload_json + payload_hash
    -> validateFrozenJob()
    -> HMAC envelope containing identity and payloadHash
    -> receiver validation and row action
    -> response identity/hash validation
    -> worker status persistence
```

Specific findings:

- `canonicalizeSemanticPayload()` recursively sorts object keys, preserves the preferred `KL/MENS/KIDS` segment order, and JSON-serializes the semantic payload.
- `hashSemanticPayload()` hashes those canonical bytes with SHA-256. `validateFrozenJob()` independently hashes the exact stored `payload_json` and compares it to `payload_hash`.
- The worker reads `payload_json` and `payload_hash` from the claimed row. It does not call the builder, read bills, recalculate accounting, or rebuild values at delivery/retry time.
- The HMAC signed message includes transport version, timestamp, business date, closing ID, close sequence, and payload hash. The full payload is included in the envelope but is not recomputed by the worker.
- The worker requires the response to echo business date, closing ID, close sequence, payload hash, transport version, and a valid UTC received timestamp.
- A higher-sequence re-close creates a new `day_closing_snapshots` row, a new frozen job, a new canonical payload identity, and normally a new payload hash. It is not an in-place mutation of the older job.
- Equal-sequence retry reuses the same frozen JSON/hash. Delivery-time financial drift is therefore prevented at the Windows worker layer.

## 7. Email-data availability

### Available in the frozen V2 payload

The locked single Daily DSR email can obtain all required business content from the frozen payload:

- overall bills, quantity, sales, discount, billing, returns, credit notes, settlement, payment modes, Store Credit issued, and ledger values;
- KL, MENS, and KIDS net contribution, quantity, bill count, and five payment allocation values;
- report status and data-quality status;
- five payment reconciliation statuses and their overall/segment/delta values;
- business date, closing ID, close sequence, closed time, contract/snapshot version, and KLBS version;
- backup and current snapshot email status metadata.

The payload is therefore suitable as the business-data authority for the locked email, subject to rendering the segment/payment fields according to the approved 58-column semantics. It does not contain MTD, which is explicitly out of scope for the Windows email.

### Not in the frozen payload and required separately

| Email requirement | Current source | Phase 2 use |
|---|---|---|
| Verified backup file attachment | `dayClosingService.executeClose()` creates and validates the backup, then stores `backup_reference` in `day_closing_snapshots`; main provides `getBackupPath()` to the current outbox | Use the existing `backup_reference` from the same closing snapshot and resolve it through the existing backup folder. Do not create a second backup. Validate the file before SMTP send. |
| Recipient configuration | `integrationConfig.resolveEmailRuntime().recipients` | Read existing configured recipients. |
| SMTP host/port/security/sender/secret | `integrationConfigService` and `emailService.js` | Reuse existing email service; no backup or SMTP semantic change. |
| Display-only store identity | No required frozen payload field found | Use existing configured application/store display source only if explicitly approved; do not invent a new authority. |

The existing verified Day Closing backup can be attached to the future consolidated email without creating another backup. The snapshot is closed only after backup creation and validation succeeds, and `backup_reference` is already persisted. The email worker must treat an unavailable/mismatched attachment as a visible delivery failure, not fabricate success or regenerate a backup.

## 8. Re-close and supersession design

### Sequence N already delivered, then N+1 closes

The existing schema can represent both frozen jobs using unique `(closing_id)` and `(business_date, close_sequence)`. The receiver’s higher-sequence `UPDATED` action makes N+1 authoritative in `KLBS_Daily_Data`. N+1 needs one revised email whose subject/body identifies the newer close sequence.

### Sequence N pending, then N+1 closes

The existing consolidated job table has independent `sheet_status` and `email_status`, attempt counts, errors, timestamps, and closing/sequence identity. It can represent a terminal superseded state for Sheet by using the existing `FAILED` state plus a specific supersession reason, as the current worker already treats receiver `STALE` as terminal. However, the existing worker does not locally inspect the newest closed sequence before claiming a pending job, and the table has no explicit `SUPERSEDED` status.

For email, the existing columns can represent `PENDING`, `PROCESSING`, `DELIVERED`, and `FAILED`, but there is no current email worker and no `STALE/SUPERSEDED` email state. A Phase 2 email processor must perform a latest-sequence check before SMTP and mark older pending/processing work as terminally superseded without sending it.

### Schema decision

No schema migration is strictly required if Phase 2 uses existing statuses with a stable, machine-readable supersession error/reason and adds guarded latest-sequence checks before claim/send. This is less expressive than a dedicated `SUPERSEDED` state. A dedicated status would improve observability but is not necessary for the locked behavior and would expand migration scope.

The important rule is that no old pending job may reach SMTP after a newer closed sequence exists. A stale Sheet job may be sent to the receiver only if the receiver returns `STALE` and the worker records terminal supersession; local pre-send suppression is preferred. The old job must never overwrite N+1.

### SMTP exactly-once limitation

Even with a persisted email state, literal exactly-once external email cannot be mathematically guaranteed if SMTP accepts the message and the process dies before recording `DELIVERED`. A stable Message-ID/idempotency key may reduce duplicates when the provider honors it, but the provider behavior is external. Phase 2 must document this crash window and ensure no duplicate is created after a recorded success.

## 9. Exact Phase 2 file/change plan

The following is the smallest expected implementation scope. No file below was modified in this audit.

| File | Function(s) | Change | Why required | Risk |
|---|---|---|---|---|
| `src/main/main.js` | service construction; `startIntegrationOutboxDrain()`; startup/restore lifecycle | Instantiate a consolidated reporting dispatcher/Sheet worker and start its controlled retry drain; select the V1.1 consolidated mode; stop creating/draining old flat DSR and Segment jobs for new closes; preserve rollback mode for legacy. | Current worker is not wired and both legacy paths are active. | High if mode gating is scattered or if old pending jobs are silently sent. |
| `src/database/dayClosingService.js` | `executeClose()` | Keep frozen-job creation inside the close transaction; in consolidated mode do not call `segmentDsrOutbox.enqueue()` or `integrationOutbox.enqueue()`; retain backup, snapshot, close, reopen, audit, and return semantics. | Prevents new legacy Segment and `DSR_DAY_CLOSING` jobs. | High because post-commit enqueue behavior changes; must preserve close validity. |
| `src/services/consolidatedSheetDeliveryWorker.js` | `claimNext()`, `processNext()`, `persistOutcome()` | Add/retain local latest-sequence supersession check before HTTP; wire actual production drain; preserve stored JSON/hash; record diagnostic outcome for INSERTED/UPDATED/UNCHANGED/STALE/conflict. | Makes frozen V2 job the authoritative Sheet path and prevents obsolete local sends. | High around claim races and status persistence. |
| `src/services/consolidatedReportingEmailWorker.js` (new) | new claim/send/persist functions | Implement one email channel against the same `consolidated_reporting_jobs` row/payload; latest-sequence check before SMTP; render all locked daily/segment/reconciliation content; attach validated `backup_reference`; persist independent email status. | No consolidated email worker currently exists. | High because SMTP acknowledgement crash window cannot be eliminated. |
| `src/services/consolidatedReportingEmailService.js` (new, if separation is preferred) | new frozen-payload body builder | Keep email rendering pure and sourced only from validated frozen payload; include revised sequence identity. | Avoids using the older snapshot-only email builder for the authoritative email. | Medium; no accounting calculations may be introduced. |
| `src/services/integrationConfigService.js` | `resolveDsrRuntime()`, `resolveEmailRuntime()` only if needed | Add a dedicated consolidated endpoint/secret or explicit reporting-mode feature control only if existing configuration cannot safely distinguish modes. | Current consolidated worker falls back to ordinary DSR runtime and no Segment-only flag exists. | Medium; shared email settings must remain compatible. |
| `src/services/integrationOutboxService.js` | stale/legacy status handling only if needed | Do not create new `DSR_DAY_CLOSING` jobs in consolidated mode; provide controlled terminal handling for pre-existing old rows using the existing stale/superseded convention. | Prevents old flat delivery from continuing or accumulating. | Medium; `SUCCESS` historically also represents stale suppression, so diagnostics must be explicit. |
| `src/services/businessSegmentDsrOutboxService.js` | optional explicit pause/supersession helper | Prefer no normal-path change if main/day-closing creation and drain are gated; add only a narrow helper if pre-existing Segment pending rows require controlled terminalization. | Keeps legacy implementation for rollback while preventing sends/accumulation. | Medium; do not alter historical Segment records. |
| `src/database/dayClosingMigration.js` | none initially | No schema change recommended for first implementation; reuse existing consolidated email/sheet status columns and timestamps. | Existing fields are sufficient with guarded status transitions. | Low now; a migration becomes necessary only if explicit `SUPERSEDED` status is chosen. |
| `src/database/dayClosingDsrService.js` / `src/main/main.js` | `retryDsrSync()`, `day-closing:retry-dsr-sync` | Redirect authoritative manual retry to the consolidated job by closing ID/job ID, or disable the old flat retry in consolidated mode; never reconstruct/send the V1 flat snapshot. | Current manual retry bypasses the frozen job. | High if the old IPC remains reachable in production mode. |
| Activity/diagnostic logging call sites | existing logging helpers | Add explicit consolidated Sheet/email queued, delivered, retryable, terminal, stale, superseded, and conflict events without changing audit-history semantics. | Provides visibility for one-pipeline operations and rollback. | Low if additive only. |

Pre-existing pending legacy jobs must be handled before enabling consolidated mode: stop their drain, classify them as superseded/paused using existing state conventions, record an Activity/diagnostic event, and verify no legacy job remains eligible for automatic send. Do not delete jobs or mark them as delivered. The exact terminal-state representation should be finalized before implementation because the legacy integration schema has no `FAILED` status, while the Segment schema does.

## 10. Automated Phase 2 test plan

Required fixture-only tests:

1. Normal close creates one closed snapshot and exactly one frozen V2 job.
2. Frozen job contains contract version 2, snapshot version 2, canonical payload, and matching hash.
3. One Sheet delivery produces `INSERTED`/`UPDATED`/`UNCHANGED` success as appropriate.
4. One consolidated Daily DSR email is sent from the same stored frozen payload.
5. Email includes the existing verified backup attachment by `backup_reference`; no second backup is created.
6. New close creates zero `segment_dsr_outbox` rows.
7. New close creates zero `DSR_DAY_CLOSING` rows.
8. Startup/restart before delivery recovers pending Sheet and email claims.
9. Restart after recorded Sheet/email success does not send another delivery.
10. Temporary Sheet failure returns to controlled pending retry.
11. Temporary email failure returns to controlled pending retry.
12. Permanent auth/config/schema/contract failure is terminal and visible, not an infinite retry loop.
13. Same-sequence same-payload retry is receiver-idempotent and does not create a duplicate row.
14. Same-sequence changed hash is a conflict and performs no write.
15. Re-close after N was delivered creates N+1, updates the Sheet row, and sends one clearly revised N+1 email.
16. Re-close while N is pending supersedes N before email; N cannot later send.
17. Older Sheet job cannot overwrite N+1; receiver `STALE` is terminally recorded if reached.
18. Explicit/manual retry operates on the frozen consolidated job and never calls the flat `readClosedDsrPayload()` route in consolidated mode.
19. Duplicate email is not sent after a recorded `DELIVERED`/success state.
20. SMTP crash-window behavior is documented and tested with a mock: process failure after send and before persistence must not mutate frozen data, and recovery policy must be deterministic.
21. Activity/diagnostic events identify job ID, business date, close sequence, payload hash, action/classification, and supersession without exposing secrets.
22. Existing backup creation, Day Closing close/reopen/re-close, payments, inventory, reporting, and Activity Log semantics remain unchanged.

The current isolated C4A/C4C/C4D tests prove transport and worker primitives, not the final main-process cutover. They must be supplemented by end-to-end mocked dispatcher tests for the exact one-Sheet/one-email/zero-legacy contract.

## 11. Remaining risks

- The 58-column receiver source is not present in this Windows repository. Its contract is accepted here from the locked external fact and existing C4D/V16 verification artifacts; live receiver source/header verification remains outside this read-only Windows audit.
- The checked-in 28-column Apps Script is still the apparent endpoint artifact used by the active legacy DSR configuration. Phase 2 must explicitly switch/configure the endpoint or prove that the configured deployment is the later 58-column receiver before disabling the old path.
- The current `consolidatedSheetDeliveryWorker` is not wired into `main.js`.
- The current worker’s success action set uses `INSERTED`/`UPDATED`, while requirement shorthand says INSERT/UPDATE. Phase 2 must retain the full tested action names.
- The V2 payload has per-mode reconciliation statuses, not one scalar `reconciliationStatus`; the 58-column scalar is a safe derivation only when all five modes are present and pass.
- Email exactly-once delivery cannot be proven across SMTP acceptance followed by process failure before local persistence.
- Existing legacy pending rows need a controlled non-send disposition; simply stopping new creation is insufficient if the common drain continues to process old rows.
- No Windows MTD field is available or required for the locked email; Google remains responsible for MTD.

## 12. Go/no-go conclusion

### Contract conclusion

The frozen V2 payload provides safe semantic mappings for all 58 required columns. `Payload Hash` and `Received At` are respectively transport and receiver metadata, and scalar reconciliation status is derived from the five frozen mode statuses. No required financial, payment, ledger, or KL/MENS/KIDS field is missing from a complete V2 frozen payload.

The 28-column checked-in Apps Script is the older flat DSR receiver artifact still associated with the active legacy Windows path. C4D/V16 artifacts represent the later externally approved/tested 58-column receiver. The Windows consolidated transport is compatible with the later envelope/identity/hash contract but is not yet production-wired.

The frozen payload is suitable for the single Daily DSR email. The existing verified Day Closing backup can be attached through the persisted `backup_reference` without creating another backup or changing backup semantics. Re-close supersession can be implemented without a schema migration, provided guarded latest-sequence checks and explicit terminal supersession reasons are added for both Sheet and email channels.

### Final recommendation

Proceed to DSR-08 Phase 2 implementation only with the locked 58-column receiver endpoint/contract selected explicitly in configuration, the consolidated worker wired into startup/retry, a new frozen-payload email channel, centralized legacy-job suppression, and the required end-to-end tests.

### TASK

Reconcile the approved C4D/V16 58-column contract with the current Windows frozen payload, transport, receiver artifacts, and reports before DSR-08 Phase 2.

### FILES INSPECTED

Frozen V2 builder/persistence/transport/worker, Day Closing/migration/main wiring, email/backup/configuration services, C4D/V16 scripts and tests, C4C reports, C4D/V16 reports, C4E email audit, and both checked-in Google Apps Script receiver artifacts.

### FINDINGS

All 58 semantic fields map to the frozen V2 payload or persisted transport/receiver metadata. The checked-in 28-column receiver is legacy; the approved C4D/V16 58-column receiver is represented by external locked evidence and repository verifier/report artifacts, not by checked-in receiver source. The consolidated transport is compatible, but the worker remains unwired.

### FILES MODIFIED

Only this report was created. No source, test, deployment, configuration, or existing report was modified.

### DATABASE CHANGES

None. Neither protected database was opened or touched.

### BUSINESS LOGIC CHANGES

None. Audit only.

### TESTS RUN

No runtime tests, verifier scripts, database scripts, HTTP requests, email, or application launch were performed. Static repository search and source/report inspection only.

### TEST RESULTS

Existing C4D/V16 artifacts were reconciled statically. The prior reported controlled `UNCHANGED` result was not repeated. The Phase 2 test plan is specified above.

### SPECIFICATION CHECK

The locked 58-column contract is semantically reconcilable to the frozen V2 payload. Production cutover is not yet implemented and the active Windows path remains legacy.

### RISKS / REMAINING ISSUES

The later receiver source is external to this repository; the active configuration still points to the legacy DSR runtime; consolidated worker and consolidated email wiring are absent; and SMTP has an unavoidable acknowledgement crash window.

### FINAL STATUS

READY FOR DSR-08 PHASE 2 IMPLEMENTATION
