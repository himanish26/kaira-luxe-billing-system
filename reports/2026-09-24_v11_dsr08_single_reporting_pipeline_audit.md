# KLBS V1.1.0 DSR-08 Single Reporting Pipeline
## Phase 1 Architecture Audit

Audit date: 2026-09-24
Repository: `D:\KLBS\kaira-luxe-billing-system`
Scope: source audit only. No application source, tests, configuration, Google Apps Script, or database was modified.

## 1. Git/worktree pre-state

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

The pre-existing LOG-01 changes and diagnostic/report artifacts were preserved. No reset, clean, stash, restore, stage, commit, or push was performed.

## 2. Current Day Closing architecture

### Source of truth

| File | Function | Caller | Purpose |
|---|---|---|---|
| `src/main/main.js` | `close-business-day` IPC handler | Renderer Day Closing action | Calls `closeBusinessDay()` and returns the result. |
| `src/database/dayClosingService.js` | `closeBusinessDay()` | Main IPC | Serializes an in-flight close and requires consolidated persistence before a close can commit. |
| `src/database/dayClosingService.js` | `executeClose()` | `closeBusinessDay()` | Performs backup verification, finalizes the snapshot, creates the consolidated frozen job, then queues the two current integration jobs and the segment outbox job. |
| `src/database/dayClosingService.js` | `reserveClose()` | `executeClose()` | Opens a transaction, calculates the next sequence, calculates accounting, and inserts a `PREPARING` snapshot. |
| `src/database/dayClosingService.js` | `reopenBusinessDay()` | `reopen-business-day` IPC | Marks the latest closed sequence `REOPENED` and returns the business day to `OPEN`. |
| `src/database/dayClosingService.js` | `attemptDsrSync()` | `day-closing:retry-dsr-sync` IPC | Explicit/manual direct DSR retry using the legacy flat snapshot payload. |

### Transaction boundary

1. `reserveClose()` uses `BEGIN IMMEDIATE`, inserts `day_closing_snapshots`, and commits the `PREPARING` reservation.
2. Backup creation and validation occur outside the final close transaction.
3. `executeClose()` starts a second `BEGIN IMMEDIATE` transaction. It changes the snapshot to `CLOSED`, marks the backup `SUCCESS`, closes `business_day_state`, and calls `consolidatedReportingPersistence.createFrozenJobWithinTransaction()`.
4. The snapshot and `consolidated_reporting_jobs` insert commit together.
5. `segmentDsrOutbox.enqueue()` and `integrationOutbox.enqueue()` run after that commit.

Therefore the immutable consolidated job is transactionally coupled to the `CLOSED` snapshot, but the current integration and segment outbox rows are not part of that same transaction.

### Closing ID and sequence

`day_closing_snapshots.id` is the closing ID. `close_sequence` is `MAX(close_sequence) + 1` for the business date, allocated in `reserveClose()`. The active-close unique index permits only one `PREPARING` or `CLOSED` snapshot per business date.

### Reopen and re-close

Reopen marks the latest `CLOSED` row `REOPENED`; it does not cancel or supersede outbox rows at reopen time. A later close creates a new snapshot and a higher sequence. The current `integration_outbox` checks the latest closed snapshot before delivery and marks older rows stale. The current `segment_dsr_outbox` does not perform an equivalent latest-sequence check before sending either its email or Sheet request.

### Failure consequences

- Backup failure marks the reservation failed; no `CLOSED` state is committed.
- Finalization or frozen-job creation failure rolls back the final transaction and marks the reservation failed after the rollback attempt.
- Segment enqueue failure is caught and logged after close; the close remains successful.
- `integrationOutbox.enqueue()` is called after commit without an equivalent enclosing transaction. If it throws, the close has already committed and the caller may receive an error despite the valid closed snapshot and frozen job.
- The frozen consolidated job is therefore the only reporting artifact guaranteed by the final close transaction.

## 3. Consolidated `KLBS_Daily_Data` path

### Frozen snapshot path that exists in source

`src/services/consolidatedReportingPersistenceService.js` reads the closed snapshot and authoritative bill/bill-item population, builds a `CONTRACT_VERSION = 2`, `SNAPSHOT_VERSION = 2` semantic payload through `src/shared/consolidatedDsrBuilder.js`, canonicalizes it, hashes it with SHA-256, and inserts it into `consolidated_reporting_jobs`.

The table stores `closing_id`, `business_date`, `close_sequence`, payload/hash, report/data-quality status, and independent Sheet/email status columns. The creation call is inside the final Day Closing transaction.

`src/services/consolidatedSheetDeliveryWorker.js` can claim a `PENDING` consolidated job, recover stale `PROCESSING` claims after five minutes, build an HMAC envelope from the stored payload/hash, POST over HTTPS, validate the identity-bound response, and persist `DELIVERED`, `PENDING`, or `FAILED`.

### Critical current wiring finding

The worker is not imported or instantiated by `src/main/main.js`. There is no startup timer, close callback, IPC retry route, or dispatcher call to `createConsolidatedSheetDeliveryWorker().processNext()` in the main process. The existing worker report and focused tests prove the service in isolation, not production invocation.

The current main-process production path instead instantiates:

```text
integrationOutbox
  -> dsrSyncService.sync(readClosedDsrPayload(snapshot.id))
  -> current DSR web-app endpoint
  -> KLBS_Daily_Data
```

This is the legacy flat snapshot payload path, not the stored `consolidated_reporting_jobs` payload. `readClosedDsrPayload()` reads `day_closing_snapshots` directly and produces the flat contract-version-1 payload used by `src/services/dsrSyncService.js`.

### Current consolidated receiver contract

The checked-in `deployment/google-apps-script/KLBS_DSR_WebApp.gs` defines `KLBS_Daily_Data` with 28 columns, including `Synced At`. Its normal payload contains 27 reporting fields before the receiver appends the timestamp. It upserts by business date, rejects equal-sequence content changes, updates a higher sequence, and rejects a lower sequence as stale.

The source does not contain a checked-in authoritative 58-column `KLBS_Daily_Data` header or a flat 58-column consolidated transport contract. The Windows consolidated payload is a nested semantic object containing overall values, three segment allocations, reconciliation, diagnostics, and source-audit metadata. Any external “58-column” requirement must therefore be reconciled against the actual receiver before implementation; it cannot be safely inferred from this repository.

### Configuration and secret

The current `dsrSyncService` uses `integrationConfig.resolveDsrRuntime()`, backed by saved encrypted integration settings or `KLBS_DSR_WEB_APP_URL` and `KLBS_DSR_SYNC_SECRET`. The dormant consolidated worker first checks `KLBS_CONSOLIDATED_DSR_WEB_APP_URL` and `KLBS_CONSOLIDATED_DSR_SYNC_SECRET`, then falls back to the same integration DSR runtime. No separate consolidated runtime is wired in main.

### Current retry/idempotency

The active `integration_outbox` DSR row retries after failures through the 15-second online drain and a one-minute service cooldown. It has a unique `(closing_id, delivery_type)` key. Receiver-side identity/sequence checks prevent duplicate equal-sequence Sheet rows and stale lower-sequence overwrites, but a request may be repeated after a local acknowledgement failure.

The dormant consolidated worker has better explicit transport classification: retryable network/timeout/429/5xx outcomes remain `PENDING`; terminal configuration/auth/schema/invalid-response outcomes become `FAILED`; stale `PROCESSING` claims are recoverable. It is not currently part of the production path.

### Production-readiness conclusion

The consolidated persistence contract is present and transactionally created, and the worker is testable, but the end-to-end `consolidated_reporting_jobs -> worker -> KLBS_Daily_Data` production pipeline is not wired. It is not independently production-ready as the authoritative V1.1 delivery path.

## 4. Legacy Segment Sheet path

### Source and trigger

`src/database/dayClosingService.js:executeClose()` calls `segmentDsrOutbox.enqueue(snapshotId)` after the close transaction. Main constructs the service in `src/main/main.js` and calls `segmentDsrOutbox.drain()` from the common 15-second `startIntegrationOutboxDrain()` poll.

`src/services/businessSegmentDsrOutboxService.js` calculates the legacy segment report from `businessSegmentReportService`, builds a `KLBS_SEGMENT_DSR_V1` payload, and inserts one `segment_dsr_outbox` row per closing ID. The stored payload contains KL/MENS/KIDS segment metrics, data-quality state, reconciliation, and legacy detail fields.

`processSheets()` independently claims `sheets_status = 'PENDING'` and calls `businessSegmentDsrSyncService.sync(payload)`. That service signs the payload with HMAC and POSTs it to the configured DSR web-app URL. The Google receiver writes `KLBS_Segment_Daily_Data` and uses business date/close sequence as its delivery key.

### Behaviour

- The path is asynchronous and shares the configured DSR endpoint/secret source with the current DSR service.
- Email and Sheet status are independent columns and are processed independently.
- Network and ordinary send failures return to `PENDING` with a one-minute cooldown.
- Payload-unavailable and incomplete-data-quality conditions become `FAILED`.
- Stale `PROCESSING` email and Sheet claims are recovered on restart.
- There is no latest-closed-sequence/supersession check in `businessSegmentDsrOutboxService.drain()`, `processOne()`, or `processSheets()`. A pending older re-close job can therefore still be sent after a newer close.
- Email send success followed by failure to persist `SUCCESS` can cause another email attempt; there is no provider-side email idempotency key.
- Segment enqueue failure is logged without invalidating the close.

### Google receiver

`deployment/google-apps-script/KLBS_DSR_WebApp.gs:doPost()` explicitly routes a `KLBS_SEGMENT_DSR_V1` payload to `handleSegmentDsrPost_()`. The separate `deployment/google-apps-script/KLBS_Segment_DSR_WebApp.gs` contains the segment receiver implementation. The checked-in Windows code therefore expects a receiver deployment capable of routing the segment contract. The actual deployed endpoint/script topology cannot be proven from this Windows repository.

The legacy receiver writes `KLBS_Segment_Daily_Data`; the checked-in header is a separate segment contract, not the 28-column `KLBS_Daily_Data` contract. It is not coupled in source to backup creation, Day Closing completion, Dashboard reads, payment reconciliation, or Activity Log writes except through the close-triggered outbox enqueue and delivery Activity/technical diagnostics.

## 5. Complete email-path inventory

| Email purpose | Trigger | Source/function | Job type | Data source | Recipients | Retry/re-close |
|---|---|---|---|---|---|---|
| Current Day Closing email | Successful close after commit | `src/services/integrationOutboxService.js:processOne()`; fallback direct path in `dayClosingService.js` if no integration outbox | `EMAIL_DAY_CLOSING` | Closed `day_closing_snapshots` summary plus verified backup attachment | `integrationConfig.resolveEmailRuntime().recipients` | Current outbox retries pending failures; stale older sequence is marked stale. No email idempotency key if SMTP succeeds but local acknowledgement fails. |
| Legacy Segment DSR email | Segment outbox drain after close | `src/services/businessSegmentDsrOutboxService.js:processOne()` and `businessSegmentDsrEmailService.js` | `segment_dsr_outbox.status` (not `integration_outbox`) | Stored legacy segment payload calculated by `businessSegmentReportService` | Same configured email recipients | Retries pending failures; no stale-sequence guard; independent from Segment Sheet status. |
| Consolidated frozen-job email | No active implementation found | `consolidated_reporting_jobs.email_status` columns exist, but no email worker/dispatcher is wired in main and no function was found to process them | None currently | None delivered from the frozen job | None | Not active. |
| MTD/Daily report email | No separate active Day Closing path found | No Windows source function creates a separate MTD email | None | None | None | Not found as an independent V1.1 Day Closing email. |

The active current result is therefore normally two email attempts: one `EMAIL_DAY_CLOSING` email and one legacy Segment DSR email. A dormant consolidated-job email status schema does not constitute an implemented email path.

The current Day Closing email is built from the closed snapshot and contains daily accounting, returns, settlement, backup, and status information. It does not contain the legacy segment breakdown. No authoritative Windows MTD values are emitted by this email builder. Dashboard MTD values are calculated separately by mutable bill queries; they are not read from `consolidated_reporting_jobs`.

## 6. Outbox/job inventory

| Job type | Destination | Created when | Key | Retry policy | Success/failure | Restart | Re-close | Cutover disposition |
|---|---|---|---|---|---|---|---|---|
| `EMAIL_DAY_CLOSING` | SMTP recipients | After successful close commit through `integrationOutbox.enqueue()` | `(closing_id, delivery_type)` | 60-second cooldown; automatic 15-second online drain | `SUCCESS`; otherwise remains `PENDING` | `PROCESSING` rows are recovered by integration outbox | Older sequence is marked stale before send | Keep only if redesigned/retargeted as the single authoritative DSR email. |
| `DSR_DAY_CLOSING` | Current DSR web app / `KLBS_Daily_Data` | Same integration enqueue | `(closing_id, delivery_type)` | Same integration retry | `SUCCESS` after identity-validated response; failures remain pending | Recovered by integration outbox | Older sequence is marked stale | Pause/remove this duplicate path once the consolidated worker is wired; otherwise it remains a second Sheet path. |
| `segment_dsr_outbox.status` | Legacy Segment DSR email | `executeClose()` after commit | Unique `closing_id` | 60-second cooldown | `SUCCESS` or permanent `FAILED` for data-quality/payload errors | Stale processing recovered | No source-level supersession | Pause job creation before close after a controlled flag/gate is available. |
| `segment_dsr_outbox.sheets_status` | `KLBS_Segment_Daily_Data` | Same segment outbox row | Unique `closing_id` and `(business_date, close_sequence)` | 60-second cooldown | `SUCCESS` or permanent `FAILED` for data-quality/payload errors | Stale processing recovered | No source-level supersession | Pause job creation before close; do not let legacy jobs accumulate. |
| `consolidated_reporting_jobs` Sheet state | Intended consolidated `KLBS_Daily_Data` | Inside final close transaction | Unique `closing_id` and `(business_date, close_sequence)`; stored payload hash | Worker classifies retryable vs terminal; five-minute stale-claim recovery | `DELIVERED`, `PENDING`, or `FAILED` | Worker supports recovery, but main never starts it | No worker-level latest-sequence gate; receiver rejects stale sequence; local worker currently claims by date/sequence | Make this the only Sheet delivery after wiring and acceptance tests. |
| Direct `retryDsrSync(snapshotId)` | Current DSR web app / `KLBS_Daily_Data` | Explicit IPC retry | Snapshot ID; not an outbox key | One direct attempt per IPC call | Updates `day_closing_snapshots.dsr_sync_status` | No queued recovery | Can target a non-latest closed snapshot unless caller prevents it | Must be removed from the authoritative cutover route or redirected to the consolidated job worker. |

## 7. Retry, restart, idempotency, and divergence findings

- The common startup drain calls `integrationOutbox.drain()` and then `segmentDsrOutbox.drain()` every 15 seconds when the application reports online.
- The consolidated worker has no startup registration, so its restart recovery is dormant in production.
- Current Sheet and email jobs are independent. A Sheet failure does not block the current email, and an email failure does not block the current Sheet/DSR request.
- The current integration DSR and Google `KLBS_Daily_Data` receiver are sequence-aware and equal-sequence idempotent. They can safely receive a repeated request at the receiver, subject to the receiver response being acknowledged.
- SMTP has no equivalent idempotency contract in the source. An SMTP send followed by local status-write failure can result in a duplicate email on retry.
- Older `integration_outbox` jobs are explicitly stale-suppressed. Older segment jobs are not, so a re-close can produce obsolete segment email/Sheet deliveries.
- `consolidated_reporting_jobs` stores a frozen payload and hash, but that authoritative job is not the one consumed by the live DSR outbox path.
- A close can be valid with a missing segment outbox row because segment enqueue is post-commit and caught. A close can also have a frozen consolidated job but no integration outbox row if post-commit enqueue fails.
- The current architecture can therefore diverge between snapshot, frozen job, `KLBS_Daily_Data`, `KLBS_Segment_Daily_Data`, and email content.

## 8. Reopen/re-close lifecycle

Normal close creates sequence N, frozen job N, current integration email/DSR rows N, and legacy segment email/Sheet row N. Reopen marks N `REOPENED` but does not cancel those rows. Re-close creates sequence N+1 and repeats all post-commit enqueue actions.

For current integration rows, the latest-closed check prevents N from overwriting/delivering after N+1. The Google daily receiver also rejects a lower sequence and updates the higher sequence. For legacy segment rows, neither the Windows outbox processor nor the shown segment receiver provides a complete source-level guarantee that an older pending request cannot be sent after a newer close; the receiver records sequence information but the Windows sender lacks supersession control.

The explicit `day-closing:retry-dsr-sync` route reads the selected closed snapshot and sends the flat payload directly. It does not consume `consolidated_reporting_jobs`, does not use the outbox claim state, and is therefore not a safe authoritative retry path for the intended single pipeline.

## 9. Google endpoint dependencies

Windows expects:

- DSR endpoint from saved integration settings or `KLBS_DSR_WEB_APP_URL`.
- HMAC secret from saved integration settings or `KLBS_DSR_SYNC_SECRET`.
- Google script property `KLBS_SPREADSHEET_ID`.
- Google script property `KLBS_DSR_SYNC_SECRET`.
- `KLBS_DSR_WebApp.gs` normal receiver for `KLBS_Daily_Data`.
- Segment routing/receiver for `KLBS_SEGMENT_DSR_V1` and `KLBS_Segment_Daily_Data`.

The checked-in `KLBS_DSR_WebApp.gs` routes Segment payloads before normal DSR validation, while `KLBS_Segment_DSR_WebApp.gs` also contains a segment implementation. This indicates a deployment/topology dependency, but the Windows repository cannot prove which script files are combined or deployed at the configured live URL. No Google source was modified.

The dormant consolidated worker uses a distinct preferred environment-variable pair but falls back to the ordinary DSR runtime, so its endpoint contract is not currently isolated by main-process wiring. `KLBS_Daily_Data` can conceptually operate independently of the segment receiver, but the current Windows main process does not deliver the stored consolidated job to it.

## 10. Existing feature/config controls

No existing source-backed feature flag was found for pausing Segment Sheet delivery or Segment DSR email. `integrationConfigService` has automatic email/DSR configuration controls, but they are shared with the required current Day Closing email/DSR route and are not a Segment-only pause.

The only current controls are structural/dependency controls:

- whether `segmentDsrOutbox` is supplied to `createDayClosingService()`;
- whether `segmentDsrOutbox.drain()` is called from main;
- whether email/DSR integration configuration is present;
- whether the application reports online.

These are not suitable production feature controls because disabling shared email/DSR configuration would also affect required reporting.

## 11. Minimum safe pause point for Segment Sheet

Preferred cut point: a single centralized gate immediately before `segmentDsrOutbox.enqueue()` in `dayClosingService.executeClose()`, backed by an explicit reversible internal configuration/feature value that defaults to the current behavior until the cutover is enabled.

For the approved cutover, job creation must be paused rather than only delivery. If creation is disabled and the startup drain is also gated/removed for legacy rows, no new Segment jobs accumulate. Existing pending legacy jobs require an explicit, controlled migration policy (mark/supersede/pause) before deployment; silently leaving them in the outbox would violate the no-accumulation requirement.

Do not pause only `processSheets()` while continuing to enqueue rows: that leaves obsolete jobs accumulating and does not provide a clean rollback boundary.

## 12. Minimum safe pause point for Segment email

The Segment email and Segment Sheet share one outbox row but have independent statuses. The smallest reversible email-only gate is inside `businessSegmentDsrOutboxService.processOne()` before `sendEmail()`, but that would leave `status = PENDING` rows accumulating unless the job creation/drain policy also marks the email branch intentionally paused.

The safer cutover design is a centralized creation-time policy in `dayClosingService.executeClose()` that creates no legacy Segment row at all when the legacy path is paused. This pauses both Segment email and Sheet together and avoids unbounded disabled jobs. If rollback must preserve pre-existing pending legacy jobs, Phase 2 needs an explicit “paused/superseded” terminal state or a controlled drain policy; the current schema has no `PAUSED` state.

## 13. Recommended final ONE-email path

The current ordinary Day Closing email is the only active email already driven from the authoritative closed snapshot and backup. It is the closest existing source for the one required V1.1 DSR email, but it is not currently driven from the stored consolidated payload and contains no segment/MTD data.

The dormant `consolidated_reporting_jobs.email_status` columns have no email worker, and the frozen payload does not currently provide a wired email renderer. Therefore the repository does not currently prove that the final required email can be both:

1. generated exactly once, and
2. authoritative to the same frozen object delivered to `KLBS_Daily_Data`.

Recommended architecture for Phase 2: wire one consolidated reporting dispatcher around the frozen job, use its stored payload as the data authority for the single DSR email and the single `KLBS_Daily_Data` delivery, and remove the current duplicate `DSR_DAY_CLOSING`/legacy email route from normal V1.1 processing. If the existing daily email must be retained, its builder must be changed minimally to render the stored frozen payload and receive an idempotent persisted email claim/status.

MTD is not currently produced by the closed snapshot email or by the consolidated frozen payload as a Windows authoritative field. Dashboard MTD is calculated separately from mutable bills. The desired email must not silently borrow that independent calculation without an explicit contract decision.

Pausing Segment reporting would remove segment-specific data from the legacy email and Sheet only. The current ordinary Day Closing email does not consume that segment payload, so the source shows no required operational feature dependency on the legacy segment path. Whether the desired final DSR email requires segment details remains a product/data-contract decision not resolved by the current Windows implementation.

## 14. Exact minimal implementation scope for Phase 2

The following is the smallest expected source scope, subject to design review of the endpoint and email contract:

1. `src/main/main.js`: instantiate and schedule the consolidated Sheet/email dispatcher; add one centralized reversible legacy pause control; stop normal `integrationOutbox` DSR delivery and `segmentDsrOutbox` creation/drain for V1.1.
2. `src/database/dayClosingService.js`: route successful close to the consolidated dispatcher/job only; preserve snapshot creation, reopen/re-close, backup, audit logging, and business-day semantics.
3. `src/services/consolidatedSheetDeliveryWorker.js`: add only the production integration needed for startup/retry and, if approved, a persisted email branch based on the same frozen job. Do not reconstruct payloads.
4. `src/services/consolidatedReportingTransport.js` and `src/services/consolidatedReportingPersistenceService.js`: only if endpoint/config or persisted email-state adjustments are required by the approved contract.
5. `src/services/dayClosingEmail.js` or a narrowly scoped consolidated email builder: only if the existing single email must render frozen consolidated data.
6. `src/services/integrationConfigService.js`: only if a dedicated consolidated endpoint/secret or reversible legacy flag is formally approved.
7. `scripts/` focused tests for close, retry, restart, re-close supersession, one Sheet, one email, and legacy non-delivery.

No database schema change is recommended yet. The existing `consolidated_reporting_jobs.email_status` columns should first be evaluated for reuse; adding a schema state before resolving the authority/idempotency contract would be premature.

## 15. Existing regression coverage

| Test file | What it proves | What it does not prove |
|---|---|---|
| `scripts/v1-c2-c3-durable-reporting-day-closing-test.js` | Durable snapshot/consolidated-job schema, close/reopen/re-close fixture behavior, uniqueness, stored payload/hash preservation. | Does not prove main startup dispatch, one email, legacy suppression, or live receiver delivery. |
| `scripts/v1-reg02-production-db-migration-test.js` | Migration creates required reporting tables/indexes and close creates a consolidated job in a fixture database. | Does not touch or validate a production deployment; does not prove worker is wired. |
| `scripts/v1-c4a-consolidated-transport-foundation-test.js` | Envelope/transport identity, HMAC, response validation and failure classification. | Does not prove actual main-process invocation or Google deployment. |
| `scripts/v1-c4b-consolidated-reporting-recovery-migration-test.js` | Recovery migration and consolidated job state columns. | Does not prove automatic restart drain. |
| `scripts/v1-c4c-consolidated-sheet-delivery-worker-test.js` | Isolated consolidated worker claim, delivery, response validation, failure/retry, and stale-processing behavior. | Does not prove worker is instantiated by `main.js`. |
| `scripts/v1-c4d-failed-job-retry-test.js` | Explicit requeue of failed consolidated Sheet jobs. | No production IPC/startup route is shown. |
| `scripts/v1-c4d-auth-compatibility-test.js` | Auth/config compatibility cases for consolidated transport. | Does not prove one-pipeline cutover. |
| `scripts/v1-business-segment-dsr-test*` files (`v1-business-segment-dsr-sync-test.js`, `v1-business-segment-dsr-stage3b-test.js`, `v1-business-segment-dsr-apps-script-test.js`) | Segment payload, sync, and receiver contract cases. | Do not prove stale re-close suppression or that the path is paused. |
| `scripts/v1-dsr-stale-processing-recovery-test.js` | Current DSR outbox stale-processing recovery. | Does not prove consolidated worker recovery or email idempotency. |
| `scripts/v1-dsr-outbox-repair-test.js` | Current integration outbox repair behavior. | Does not prove exactly-one email/Sheet delivery. |
| `scripts/r09-dsr-phase2-test.js`, `scripts/r10-5-integrations-test.js`, `scripts/r10-5b-integrations-final-polish-test.js` | Earlier DSR/integration configuration and sync behaviors. | Do not prove V1.1 single-pipeline behavior. |
| `scripts/v1-day-closing-history-test.js`, `scripts/v1-sys02-day-reopen-reason-dropdown-test.js` | Closing history and reopen UI/service behavior. | Do not prove delivery supersession. |

Required Phase 2 additions/updates:

- main wiring test: one close creates one frozen job and exactly one active Sheet job plus one email job;
- startup/restart test: pending consolidated Sheet/email jobs resume, successful jobs do not repeat;
- temporary network failure and permanent configuration/auth/schema failure tests;
- re-close test: only the newest sequence is delivered; older jobs are terminally superseded;
- receiver acknowledgement-loss test for Sheet and email policy;
- legacy cutover test: zero `segment_dsr_outbox` creation and zero legacy Segment email/Sheet sends;
- explicit manual retry test routes through the consolidated job, not direct flat DSR sync;
- Google contract test confirming the configured endpoint and exact `KLBS_Daily_Data` headers/payload;
- email-content test proving the email reads the same stored frozen payload as the Sheet delivery;
- MTD/segment-content contract test if those fields remain required in the final DSR email.

## 16. Risk analysis

| Risk | Severity | Evidence |
|---|---|---|
| Consolidated worker is not wired, so disabling current DSR path could stop all `KLBS_Daily_Data` delivery. | BLOCKER | No `createConsolidatedSheetDeliveryWorker` reference exists in `src/main/main.js`; current DSR delivery is through `integrationOutbox`. |
| Current architecture sends ordinary Day Closing email plus legacy Segment DSR email. | HIGH | `executeClose()` queues integration outbox and segment outbox; common startup drain processes both. |
| Legacy Segment jobs can deliver stale re-close data. | HIGH | Segment outbox has no latest-sequence/supersession check. |
| Email duplicate after SMTP success/local acknowledgement failure. | HIGH | Segment and integration email processors send before persisting success and have no provider idempotency key. |
| Post-commit outbox enqueue failure leaves valid close with incomplete delivery jobs. | HIGH | Frozen job is in the close transaction; integration/segment enqueue occurs afterward. |
| Required final email data may disagree with `KLBS_Daily_Data`. | HIGH | Current email uses snapshot summary; current DSR uses flat snapshot payload; dormant frozen job is separate and not emailed. |
| Exact consolidated receiver/deployment topology is not provable from Windows source. | HIGH | Two checked-in Google script implementations and shared endpoint configuration; no live deployment inspection permitted. |
| Pausing only delivery leaves disabled legacy rows accumulating. | MEDIUM | Segment schema has no `PAUSED` status and startup drain selects pending rows. |
| Dashboard/MTD behavior changes accidentally during cutover. | MEDIUM | Dashboard MTD uses independent mutable bill queries; no direct code coupling to segment outbox was found. |
| Backup, payment reconciliation, Activity Log, or Day Closing completion breaks if the legacy outbox is paused. | LOW based on source | These are executed before/independently of segment enqueue; no source caller from segment outbox back into those operations was found. |

## 17. Proposed manual acceptance procedure for Phase 2

This was not executed in this audit. Use the approved training environment only after Phase 2 implementation and configuration review:

1. Confirm the configured endpoint, secret, and exact `KLBS_Daily_Data` receiver contract in the approved Google deployment without using production.
2. Start from a controlled training fixture with one valid business day and clear reporting-job state.
3. Perform one normal close. Verify one closed snapshot, one frozen consolidated job, one `KLBS_Daily_Data` delivery, one DSR email, and zero Segment Sheet/email attempts.
4. Restart while the consolidated job is pending; verify it resumes. Restart after success; verify no duplicate row or email.
5. Simulate a temporary network failure; verify the close remains valid, job remains pending, and later delivery succeeds once.
6. Reopen and re-close. Verify the newer sequence is authoritative, the old sequence cannot overwrite the daily row, only one final email is sent according to the approved policy, and no legacy delivery occurs.
7. Exercise missing/invalid endpoint, secret, receiver schema, and malformed response. Verify visible controlled failure, preserved frozen snapshot/job, no fabricated success, and no unbounded loop.
8. Confirm Activity Log, backup, billing, inventory, payments, reports, and Dashboard behavior is unchanged.
9. Record actual receiver response/action, close ID, close sequence, payload hash, outbox/job statuses, and email evidence.

## 18. Files that would need modification in Phase 2

Expected minimum, not changed in this phase:

- `src/main/main.js`
- `src/database/dayClosingService.js`
- `src/services/consolidatedSheetDeliveryWorker.js`
- likely `src/services/dayClosingEmail.js` or a narrowly scoped consolidated email adapter
- possibly `src/services/integrationConfigService.js` for an explicit reversible legacy/consolidated control
- focused existing/new scripts under `scripts/`
- a Phase 2 implementation report under `reports/`

The Google Apps Script files should not be modified unless endpoint/receiver contract review proves the existing receiver cannot accept the locked consolidated contract. That decision is unresolved by this Windows-only audit.

## 19. Database and safety statement

No database was opened, queried, migrated, modified, seeded, repaired, reset, or inspected for records. In particular, the production database

`C:\Users\USER\AppData\Roaming\KAIRA LUXE BILLING SYSTEM\billing.db`

and the approved training database

`D:\KLBS\KLBS_TRAINING_2026-09-21_REG02_RETEST.db`

were not touched. No email, DSR, Day Closing, retry, or application runtime was invoked.

## 20. Final recommendation

Do not cut over by merely disabling the current Segment path. The current live DSR delivery is not the consolidated worker path, and the exact one-email authority is not implemented. First approve a Phase 2 wiring change that makes the frozen consolidated job the sole Sheet and email authority, adds controlled supersession/idempotency, and gates legacy job creation centrally so disabled rows do not accumulate.

### TASK

Complete a source-derived Phase 1 DSR-08 architecture audit for a single authoritative reporting pipeline.

### FILES INSPECTED

Day Closing, migration, DSR, integration outbox, segment outbox/sync/email, consolidated persistence/builder/transport/worker, integration configuration, email, main-process wiring, Google Apps Script receiver files, reporting and Day Closing regression scripts, and prior C4C/C4D audit artifacts.

### FINDINGS

The repository currently has two active post-close reporting families: the `integration_outbox` flat DSR plus ordinary Day Closing email, and the independent legacy Segment DSR outbox for Segment Sheet plus Segment email. A consolidated frozen job is created transactionally, but its Sheet worker and email path are not wired into production main-process flow.

### FILES MODIFIED

Only this audit report was created. No application source or test file was modified.

### DATABASE CHANGES

None.

### BUSINESS LOGIC CHANGES

None. Audit only.

### TESTS RUN

No application tests or runtime scripts were run because this is a source-only audit and both approved databases were protected. Read-only repository searches and source inspection were performed. No application syntax or database integration execution was claimed.

### TEST RESULTS

Existing tests were inventoried but not executed. The isolated consolidated worker tests do not prove main-process production wiring or single-pipeline behavior.

### SPECIFICATION CHECK

The requested final contract is not currently established end-to-end in source. The repository requires a Phase 2 implementation before the single-pipeline acceptance contract can be met.

### RISKS / REMAINING ISSUES

The consolidated worker is dormant in main; current DSR and email paths are duplicated; legacy segment delivery lacks stale re-close suppression; SMTP delivery lacks idempotency; and the exact deployed Google endpoint topology/58-column contract cannot be verified from this Windows source audit.

### FINAL STATUS

STOPPED  REPORTING ARCHITECTURE AMBIGUOUS
