# V2 Day Closing sequence/recovery patch and BILL_SAVED audit

## TASK / BASELINE

- Date/time: 2026-10-01 10:44 +05:30.
- Starting SHA: `e080cb2213a95dccbf5b7672a96c22aae7584d13`.
- Branch: main. Initial HEAD equaled origin/main; working tree clean; package 2.0.0.
- Surgical Day Closing sequencing, status propagation and recovery UX; diagnostic BILL_SAVED investigation.
- Qualification DB access mode: NOT OPENED in this task. Existing accepted qualification report and supplied runtime history were used. Automated tests use in-memory SQLite or their own disposable temporary fixtures.

## FILES INSPECTED

`AGENTS.md`; `README.md`; `src/main/main.js`, `statusService.js`, `dayClosingDeliveryCoordinator.js`, `preload.js`; `src/database/dayClosingService.js`, `dayClosingMigration.js`, `remoteDashboardMigration.js`; `src/services/consolidatedReportingPersistenceService.js`, `consolidatedReportingTransport.js`, `consolidatedSheetDeliveryWorker.js`, `consolidatedReportingEmailWorker.js`, `integrationOutboxService.js`, `remoteDashboardService.js`, `reportingMode.js`, `administratorSecurityService.js`; `src/shared/consolidatedDsrBuilder.js`; `src/renderer/modules/system/dayClosing.js`, `dayClosingLifecycleState.js`, `src/renderer/app.js`, `index.html`, `style.css`, `styles/settings.css`, `dayClosingReceipt.js`; relevant tests listed below; `reports/2026-09-24_v11_dsr08a_c4d_v16_contract_reconciliation.md`; `codex-reports/2026-10-01_v2_legacy_dsr_pipeline_retirement.md`; checked-in legacy Apps Script artifact inspected only.

## DAY CLOSING FINDINGS / EXACT IMPLEMENTATION

Previous orchestration settled Sheet before Email. The frozen job captured snapshot Email Status PENDING before Email delivery. The lifecycle also disabled CLOSE KLBS for terminal online failure and offered no retry control.

The eight actual/visible stages are now:

1. Finalizing Accounts
2. Closing Business Day
3. Creating Backup
4. Verifying Backup
5. Sending Email
6. Updating DSR
7. Completing Day Closing
8. Printing Day Closing Summary

The close IPC awaits the existing Email coordinator/worker before the existing Sheet coordinator/worker. Renderer progress reconciliation and lifecycle ordering match. Background polling uses Email before Sheet and yields while critical closing is active. Real-closing Sheet claims defer while Email is PROCESSING or has never been attempted/settled, preventing a competing poll from overtaking it. Existing stale-snapshot protection executes first.

### Email Status propagation

Within the existing Sheet claim transaction, before the first Sheet attempt only, the validated stored payload's `overall.emailStatus` is copied from durable job email state: DELIVERED -> SUCCESS, FAILED -> FAILED, otherwise PENDING. Existing canonical serialization/hash functions persist the adjusted JSON/hash together before sending. All business/financial fields, job identity, sequence, contracts, reconciliation and payload structure remain intact; no business data is rebuilt/requeried for this operation. Invalid jobs still reach the existing terminal preflight failure path.

The canonical snapshot vocabulary and the accepted 58-column mapping's Email Status field are reused. No new spreadsheet values or columns are introduced. A hash already submitted to Sheet is never changed, including after later Email retries, because lost-ack replay/idempotency must preserve the same payload. This corrects new closings' first Sheet submission; it does not retroactively rewrite old delivered rows or an already-attempted frozen payload. The deployed 58-column receiver source is external; this task relies on the existing accepted contract audit and makes no receiver changes.

### Connectivity / pending / failed

REUSED `statusService.getInternetStatus` and its existing HTTPS probe, exposed directly to avoid unrelated printer/backup status checks. The closing caller requests a 3-second wall-clock deadline covering DNS/TLS as well as the existing socket timeout; the short per-call timer is cleared on settlement and no monitoring subsystem/dependency was added. It runs after mandatory verified backup/job creation, without a ninth visible stage. A negative check leaves both workers' applicable queues PENDING without sending. A positive check only permits the existing workers; actual delivery results remain authoritative. All tests mock network operations.

PENDING retains warning/orange `Retry queued`; DELIVERED retains green Sent/Complete; terminal FAILED retains red Failed. Existing three final headings remain unchanged.

### Retry Failed Tasks / CLOSE KLBS / printing

The new lifecycle button invokes existing Administrator purpose `DSR_SYNC_RETRY`, preload `retryDayClosingDsrSync`, IPC `day-closing:retry-dsr-sync`, and the existing two workers' `retryForClosing` methods. The IPC additionally returns the exact job's durable channel states for immediate UI refresh. Existing outcome callbacks for the current lifecycle now read durable status/error together, including STALE_SUPERSEDED reasons, so late UI refresh uses current authority. Requeue predicates remain unchanged: FAILED, undelivered, non-STALE_SUPERSEDED only. Successful or queued channels are not requeued. Delivery continues through existing automatic retry/cooldown and outcome callbacks. Authorization Cancel does nothing; duplicate clicks are disabled. The high lifecycle overlay yields while the existing Administrator modal is open, and background render does not steal its focus; afterward the latest lifecycle is restored.

Retry never calls close, backup creation/verification, completion or printing. No new Cancel control is added after closure. CLOSE KLBS requires every critical local row to be complete and successful printing; online PENDING/FAILED no longer block it. Print failure remains attention/exit-disabled in this lifecycle. Main's existing CLOSED/verified-backup/in-flight checks remain intact. Printing remains last, observes durable final-known delivery state, and uses the unchanged receipt mapping. Later retry only updates state/UI; no second automatic print.

## BILL_SAVED / Outbox Forensic Audit

**Result: NO DEFECT FOUND. BILL_SAVED/push source modified: NO.**

- Successful `save-bill` IPC awaits database `saveBill`; then `remoteDashboard.queueBillSaved(billData)` reads the committed bill and creates a BILL_SAVED event.
- Persistence is `remote_dashboard_outbox`, with unique `BILL_SAVED:bill:<bill_no>` identity, immutable event payload, attempts and retry timestamps. It does not use `integration_outbox` or `consolidated_reporting_jobs`.
- Remote Dashboard's separate 30-second scheduler calls `drain` independently of `syncSnapshot`. Its `drainInFlight` and `snapshotInFlight` are distinct and neither is the legacy outbox flag. Startup queues KLBS_STARTED, drains, then syncs a snapshot.
- Normal drain selects only due PENDING/RETRYABLE_FAILURE Remote Dashboard events, `ORDER BY id LIMIT 10`, and sequentially gives every selected row a processing opportunity. A failed HTTP delivery does not break the loop. Event POST targets the existing gateway `/api/events`, uses existing signing/notification identity and an 8-second timeout.
- ACCEPTED/DUPLICATE terminate successfully; permanent failures leave future selection; retryable failures get per-row exponential backoff starting at 30 seconds with the existing cap. `finally` releases the drain flag. Remote event rows have no PROCESSING state; a legacy PROCESSING row cannot occupy this dispatcher.
- Legacy `integration_outbox` has its own drain flag, oldest business-date/ID selection, stale recovery and per-drain blocked-ID set. Failed/cooldown rows are skipped so later eligible legacy items can proceed. CONSOLIDATED_V2 suppresses that drain. Consolidated reporting has separate channel claims, cooldowns and its own 15-second main-process poll, not the Remote Dashboard event dispatcher.
- A backlog in the *Remote Dashboard's own* due-event table can delay newer Remote Dashboard events by the existing sequential batching/HTTP timeout. Legacy DSR rows cannot appear ahead of BILL_SAVED in that query, share its retry cooldown or hold its flag. All services share SQLite resources; ordinary database/process/network failures are possible, but no deterministic legacy-queue starvation mechanism is established by the inspected source.
- Accepted qualification evidence: the prior retirement report records 10 historical incomplete legacy jobs, all 10 explicitly retired without network delivery, and preservation of other business/delivery tables. The user's observed notification recovery is correlation; current source cannot attribute it to legacy retirement. Existing integration tests verify durable BILL_SAVED creation, accepted delivery and retry with mocked transport.
- Focused starvation reproduction: NOT REQUIRED/PERFORMED; inspection found no plausible legacy FIFO/dispatcher mechanism to reproduce. Existing Remote Dashboard integration test PASS; no real bills, push calls or qualification DB writes were performed.
- No BILL_SAVED functional ledger entry was added. Transient historical failure cause remains undetermined.

## FILES MODIFIED

- `src/main/main.js` — orchestration, pre-check reuse, poll order/closing guard, durable retry response.
- `src/main/statusService.js` — exported existing helper; optional short wall-clock bound.
- `src/services/consolidatedSheetDeliveryWorker.js` — pre-first-attempt operational status freeze and Email ordering guard.
- `src/renderer/modules/system/dayClosingLifecycleState.js` — stage order, retry visibility and critical-local/print exit guard.
- `src/renderer/modules/system/dayClosing.js` — matching progress order and existing-authority retry button/modal lifecycle.
- `scripts/v11-day-closing-lifecycle-ui-test.js` — locked sequence/state/exit assertions.
- `scripts/v1-dsr08-phase2-single-pipeline-test.js` — Email-first integration/status/competing-claim assertions.
- `scripts/v11-day-closing-sequence-recovery-test.js` — new actual-IPC/real-worker isolated tests.
- `scripts/v11-complete-release-regression.js` — one new focused suite registered for the later final run; runner NOT executed.
- `README.md` — existing chronological ledger.
- This report.

## TESTS RUN / RESULTS

Each command below PASS (14 distinct focused suites; zero final failures/skips):

```text
node scripts/v11-day-closing-sequence-recovery-test.js
node scripts/v11-day-closing-lifecycle-ui-test.js
node scripts/v11-day-closing-delivery-coordinator-test.js
node scripts/v11-day-closing-receipt-final-status-test.js
node scripts/v11-day-closing-post-close-backup-test.js
node scripts/v11-day-closing-embedded-backup-verification-test.js
node scripts/v1-dsr08-phase2-single-pipeline-test.js
node scripts/v1-c4c-consolidated-sheet-delivery-worker-test.js
node scripts/v1-c4d-failed-job-retry-test.js
node scripts/v1-c2-c3-durable-reporting-day-closing-test.js
node scripts/v1-c4a-consolidated-transport-foundation-test.js
node scripts/v11-remote-dashboard-integration-test.js
node scripts/r09-manager-admin-separation-test.js
node scripts/v2-ui-shortcut-modal-consistency-test.js
```

New suite: 7 scenarios (delivered, queued, terminal failure, offline, bounded pre-check, immutable retry hash, Administrator cancel/authorize). It executes extracted actual close/retry/print IPC handlers with real coordinator/workers and mocked external operations, verifies status propagation, background Sheet eligibility, no synchronous resend on requeue, successful-channel preservation, both STALE_SUPERSEDED guards, printing-last, same semantic business payload, unchanged SQLite schema and integrity/FK. Lifecycle tests separately exercise success/pending/failed headings, warning/error styling state, print and critical-local gates, retry visibility and late delivery. Initial new-test harness failed to find a handler because checkout text had CRLF; the harness normalizes line endings, and final tests pass. No application failure was waived.

Syntax: `node --check` on the 9 modified/new JavaScript files listed above: 9/9 PASS. `git diff --check`: PASS. Full release regression and all-file syntax run intentionally NOT performed. One new suite is registered; no full-run count is claimed here.

## DATABASE CHANGES / BUSINESS LOGIC / SAFETY

- Schema changed: NO. 58-column contract changed: NO.
- Production DB touched: NO. Qualification DB modified: NO (not opened). Dropbox touched: NO.
- Business/accounting/inventory/product/SKU/VVP/returns/credit rules changed: NO.
- Apps Script touched: NO. Google Sheet touched: NO. Remote Dashboard backend/frontend touched: NO.
- Push notification formats/transport changed: NO. Email transport/attachment format changed: NO. DSR HTTP transport changed: NO.
- Real network delivery/replay triggered: NO. Build/package/installer/deployment: NO.
- Changes operate on operational delivery status and ordering only; existing identity, retry cooldown, stale recovery, snapshot and backup authority preserved.

## SPECIFICATION CHECK / RISKS / FINAL STATUS

Implemented locked Email-before-DSR, existing-vocabulary status propagation, internal bounded pre-check, truthful queue/failure state, selective existing-authority retry, local-completion exit, and printing-last. BILL_SAVED diagnostic verdict is NO DEFECT FOUND and push implementation is preserved.

Windows packaged/manual Day Closing sequence, recovery button/PIN usability and thermal output acceptance remain to be performed; automated fixtures do not claim real Windows focus/printing or live delivery acceptance. The final complete release regression remains deferred by explicit instruction.

Final status: IMPLEMENTED - TESTS PASSED (focused).

## COMMIT / PUSH VERIFICATION

- Implementation commit: `09781c85d7c572d3c45e64c894e3d4b28cfcc5e4`.
- Message: `fix: settle day closing email before DSR and enable delivery recovery`.
- Push to origin/main: PASS.
- Verified after implementation push: HEAD = origin/main = `09781c85d7c572d3c45e64c894e3d4b28cfcc5e4`; `git status -sb` = `## main...origin/main` with no changes. Working-tree and staged diff checks PASS.
- This documentation follow-up records the now-existing implementation SHA and verified push evidence. The task's final response records the subsequent documentation checkpoint HEAD/origin and clean status.
