# KLBS V1.1 C4E Consolidated Daily + MTD Email
## Phase 1 architecture / business-rule audit

## 1. Executive verdict

**READY FOR C4E IMPLEMENTATION DESIGN REVIEW**

The repository has a usable Windows-owned Day Closing email/outbox architecture and a frozen consolidated payload that is sufficient for a conservative consolidated Daily email. It does not contain a proven consolidated Daily + MTD email implementation, a `Hybrid_Daily_Data` implementation, or a persisted exactly-once email identity. Those are implementation-design items, not reasons to alter C4D.

The safest implementation direction is to extend the existing Windows integration outbox and `emailService`, use the frozen consolidated job as the Daily source, and add an explicitly designed MTD snapshot/aggregation contract before sending MTD values. The current dashboard query is a mutable UI read and is not by itself a sufficient exactly-once reporting source.

## 2. Current Day Closing email architecture

The production path is in `src/main/main.js`, `src/database/dayClosingService.js`, and `src/services/integrationOutboxService.js`.

1. `main.js` creates the SQLite database, integration configuration service, `integrationOutbox`, segment outbox, consolidated reporting persistence, and `createDayClosingService` (approximately lines 366–416).
2. `dayClosingService.executeClose()` reserves the close, creates and validates the mandatory Windows backup (approximately lines 575–609), then starts a transaction.
3. Inside that transaction it marks the snapshot `CLOSED`, stores backup success/reference, closes business-day state, and calls `consolidatedReportingPersistence.createFrozenJobWithinTransaction()` (approximately lines 611–643). The close transaction commits before integration delivery.
4. After commit, it enqueues legacy segment DSR work and the two `integration_outbox` deliveries (`EMAIL_DAY_CLOSING` and `DSR_DAY_CLOSING`) (approximately lines 717–734).
5. `main.js` starts an online poll after Electron readiness and drains both outboxes at 15-second intervals (approximately lines 607–625 and the `app.whenReady()` startup path).
6. `integrationOutboxService.processOne()` claims one item, increments its attempt count, sends the email or DSR, and persists success; failures return the item to `PENDING`. Its cooldown is 60 seconds and the drain blocks a failed item for the current drain, allowing later retry/restart recovery.

With the normal outbox present, email is therefore attempted after the close/frozen-job commit. Day Closing success does not wait for SMTP or DSR success. If the outbox is absent in a test/legacy construction, `dayClosingService` has a direct fallback send path (approximately lines 664–703), but the normal application supplies the outbox.

The mandatory backup is created and validated before close finalization. Email failure does not reopen or roll back a committed close; it is represented by outbox/snapshot status and retried later.

## 3. Current legacy segment DSR/email architecture

The legacy segment path remains active and was not changed.

`dayClosingService` calls `segmentDsrOutbox.enqueue(snapshotId)` after a successful close. `src/services/businessSegmentDsrOutboxService.js` calculates a segment report from local `bills`, `bill_items`, `returns`, and `return_items`; creates a `FINAL` or `REVISED` payload; and stores it in `segment_dsr_outbox`.

The segment outbox has separate email and Sheets delivery states, cooldown/recovery handling, and uniqueness on `closing_id` and `(business_date, close_sequence)`. Its email path uses the existing `sendEmail`, configured recipients, and `buildBusinessSegmentDsrEmailText()`; its Sheets path uses the existing segment DSR sync service. The email contains Business Date, Close Sequence, report status, KL/MENS/KIDS sales, quantity, bills, ATV, UPT, data quality, reconciliation, version, and generation time. It has no backup ZIP attachment.

The intended future pause control point is the post-close enqueue/drain boundary shared by the segment DSR outbox and its email path, preferably behind one reversible configuration/feature flag checked before automatic segment enqueue/drain. The flag is not implemented in this audit. Existing code, configuration, Sheet data, and historical records remain untouched.

## 4. Current working Daily + MTD email architecture

No repository source proves a working consolidated Daily + MTD email. The exact search found:

- `src/services/dayClosingEmail.js`: a working Overall Daily Day Closing text builder, not MTD.
- `src/database/billService.js:getDashboardSummary()` (approximately lines 1793–1960): UI dashboard values for today and month-to-date.
- no Windows `Hybrid_Daily_Data` table, exporter, email builder, or consumer.
- no Windows Party Accounting source or proven Google-side Daily + MTD email source in this repository.

The existing C4C reporting audit in this worktree also records that Hybrid/Party Accounting and downstream Google headers/semantics are not proven by the Windows source. Therefore this audit does not claim that an external “working” Daily + MTD ecosystem can be safely reused without inspecting that external component and its contract in a later design review.

## 5. `emailService.js` audit

`src/services/emailService.js` is a transport wrapper around `nodemailer`. It obtains SMTP settings from the injected `integrationConfigService.resolveEmailRuntime()`; it does not read credentials directly from a database or print them. The runtime includes host, port, TLS mode, username, decrypted password, sender, recipients, and the automatic-email setting.

It currently provides:

- `sendEmail({to, subject, text, html, attachments})`;
- `verifyEmailConnection()`;
- `sendTestEmail(recipient)`;
- classified SMTP error reporting;
- service injection/accessors for the integration configuration service.

The service itself does not generate Daily, MTD, segment, XLSX, PDF, or ZIP content. It sends whatever subject/body/attachments the caller supplies. Credentials are held by the existing encrypted integration configuration mechanism and are not exposed in this report.

Recipients and SMTP settings are therefore authoritative from `resolveEmailRuntime()`, with the existing stored encrypted configuration taking precedence over environment fallback. There is no application-level idempotency key or persisted SMTP message ID in `emailService.js`.

## 6. Existing attachment architecture

The normal Overall Day Closing email is assembled by `integrationOutboxService` with one attachment:

`{ filename: snapshot.backup_reference, path: await getBackupPath(snapshot.backup_reference) }`

The direct fallback in `dayClosingService` uses the same Windows backup file. The backup is created and validated before the close commits. The segment email has no attachment. No current email path was found that attaches XLSX or PDF output.

The locked ownership rule is consistent with this code: the Windows consolidated email path should own the Windows backup ZIP. Google should receive no backup bytes and should not manufacture or attach a Windows backup. A future consolidated email may retain the ZIP and optionally add a separately designed report attachment only if that report is already generated by an authoritative Windows component; adding a new XLSX/PDF generator is not part of this audit.

## 7. Consolidated payload suitability for Daily email

`src/services/consolidatedReportingPersistenceService.js` freezes the Day Closing payload inside the same transaction that closes the snapshot. Its `overall` object contains the authoritative daily totals: bills, quantity, gross sales, discount, net billing, credit notes, returned quantity/value, net sales after returns, Cash, UPI, Card, Store Credit redeemed, Gift Voucher redeemed, settlement total, actual money collection, Store Credit issued, settlement difference, Store Credit ledger redeemed/difference, backup status/reference, and email status.

The payload also contains identity and controls: Business Date, Closing ID, Close Sequence, Contract Version, Snapshot Version, Closed At, KLBS Version, Report Status, Data Quality, reconciliation/payment status, the frozen payload hash, and KL/MENS/KIDS segment fields available in the contract. Segment `qtySold` and `netContributionPaise` can be null; null means unavailable and must not be rendered as zero.

This is sufficient for a conservative Daily email without querying mutable accounting tables after close. The email should use the frozen JSON/job row and preserve its null/zero semantics. It must omit or label unavailable segment metrics; it must not invent segment gross, discount, GST, taxable, return/CN, or refund-mode values absent from the frozen contract.

## 8. Recommended authoritative MTD source

The current dashboard query is not sufficient as the final email authority. `billService.getDashboardSummary()` computes MTD bills and net sales using mutable `bills` rows where `substr(bill_date, 1, 7) = ?`; it also returns today payment values. It does not consume `consolidated_reporting_jobs`, does not return KL/MENS/KIDS, and does not bind results to the latest closed sequence or a persisted email identity.

For production C4E, the recommended authority is a Windows-side, persisted, sequence-aware MTD aggregation built from authoritative closed snapshots/frozen consolidated jobs, with one canonical row/job per Business Date and explicit replacement of an older close by a newer close sequence. It should not query Google Sheet data for routine sending, and it should not silently merge mutable open-day bills into a final MTD email.

The design must first resolve whether the existing frozen payload has complete enough historical rows for the requested MTD fields. If it does not, the implementation must either calculate from the authoritative closed local snapshots under an explicit definition or mark unavailable; it must not infer missing segment metrics or convert null to zero. A persisted MTD snapshot/hash should be part of the email outbox identity so a legitimate re-close can replace the pending/superseded result deterministically.

## 9. September testing vs October 1 production boundary

September remains a testing/cutover period. Historical `2858` migration is not planned, and no repository evidence proves a complete Hybrid_Daily_Data migration or compatible MTD source. September test closes should remain clearly identified as test data and should not be silently mixed into a production MTD total.

October 1 is the clean consolidated boundary: begin authoritative consolidated MTD accumulation from the first accepted October close, with explicit handling for missing/unavailable prior-period values. Before October production, the design review must decide whether October MTD starts at zero and which closed consolidated rows are eligible. The implementation must not backfill September by guessing from Google or legacy segment outputs.

## 10. Proposed consolidated email contents

The smallest safe first version is plain text or the existing email format, generated from the frozen Daily payload plus a separately persisted authoritative MTD summary:

**Daily:** Business Date, Closing ID/Sequence, Report/Data Quality/Reconciliation/Backup status; bills, quantity, gross sales, discount, net billing, returns/credit notes, net sales after returns; Cash, UPI, Card, Store Credit redeemed, Gift Voucher redeemed, actual money collection, settlement total/difference, and ledger difference; plus KL/MENS/KIDS fields only where present in the frozen contract. `null` remains “unavailable”, not zero.

**MTD:** total sales and the exact defined bills/quantity/payment/returns metrics available from the persisted MTD source; KL/MENS/KIDS totals only if the source has authoritative values for them. The email must state the covered business-date range and source/status. Metrics not available for the chosen authority must be omitted or explicitly marked unavailable.

ATV/AUV/UPT may remain presentation-only where already validly calculated, but they must not become new authoritative DSR/Hybrid fields. No DSR/Hybrid sheet schema changes are needed for presentation-only email values.

## 11. Proposed attachment contents

Retain the Windows-generated backup ZIP as the primary attachment, using the existing backup reference/path ownership. Do not attach it from Google. Do not add PDF/XLSX until an existing authoritative generator and exact contents are identified. If a future report attachment is required, it should be generated in Windows from the same frozen Daily/MTD snapshot and be covered by the same email identity.

## 12. Exactly-once/idempotency design

The current `integration_outbox` uniqueness `(closing_id, delivery_type)` prevents duplicate queue rows for the same snapshot and delivery type, but it does not prove exactly-once email delivery. A process can send successfully and crash before marking the outbox row `SUCCESS`; restart recovery can then send again. SMTP `messageId` is returned by `emailService` but is not persisted by the outbox.

For C4E, add a persisted email delivery identity such as `(business_date, close_sequence, report_kind, payload_hash/MTD_hash)` and explicit states `PENDING`, `PROCESSING`, `SUCCESS`, `FAILED`, `STALE/SUPERSEDED`, with attempt count, last attempt, completed/sent timestamp, last error, and payload hash. This gives durable at-most-one logical send attempt per accepted report identity, but literal exactly-once external email cannot be guaranteed across an SMTP success/process crash without provider idempotency support. The design should therefore use a stable Message-ID/idempotency key where the provider supports it and make recovery policy explicit.

## 13. Re-close semantics

- First successful close: freeze Daily payload, create one email job bound to its closing ID/sequence/hash, and send after commit.
- Same-sequence repeated processing: do not enqueue a second logical email; if the existing identity is already successful, no send. If pending, resume according to retry policy.
- Higher close sequence: mark the earlier email job superseded if not sent, create one replacement identity for the new frozen payload, and label the email as revised/correction if business policy requires sending it. Do not silently send both as unrelated Daily emails.
- Lower sequence: stale/no send.
- Same sequence with different payload hash: conflict/no send.

The correction-email policy for a higher sequence is a business decision that must be locked before implementation: either suppress the earlier pending email and send only the latest, or send a clearly labelled correction only when the earlier email was already sent. The latter must not be implemented as an unlabelled duplicate.

## 14. Retry/restart recovery design

The existing outbox already supplies the right foundation: post-commit enqueue, persistent status, attempt count, cooldown, stale-processing recovery, and startup/15-second draining. Temporary SMTP/network failure returns the item to `PENDING`; permanent configuration/auth/schema failures must be classified and surfaced as terminal/visible rather than retried forever.

The future consolidated email worker should retain this architecture, add deterministic payload/identity binding, avoid mutable-table reconstruction, and make startup recovery safe after a machine restart. The close itself should remain committed once the backup and frozen payload transaction succeeds; email failure must not reopen the day.

## 15. Sheet-success/email-failure behavior

C4D Sheet delivery and email are separate integrations. A successful Sheet delivery must not mark email successful. If email fails, the email outbox remains pending/failed according to classification and retries independently. The frozen Daily payload remains authoritative; no Sheet resend or Day Closing rerun is required merely to retry SMTP.

## 16. Email-success/Sheet-failure behavior

Email success must not mark Sheet delivery successful. C4D remains in its own controlled worker/outbox state and can retry/recover independently. The email should not be resent solely because Sheet delivery later fails. A future status view should show the two independent outcomes without changing either business close state.

## 17. Legacy pause control point

The safest later control is one reversible feature/config flag evaluated at the automatic post-close integration boundary, covering both legacy segment DSR enqueue/drain and legacy segment email execution. It must default enabled throughout September parallel testing. After consolidated Daily+MTD E2E acceptance, setting the flag false should pause automatic legacy execution while retaining source code, stored configuration, Sheets, and historical data. Rollback is one configuration change. This flag is not implemented in this audit.

## 18. Rollback strategy

Keep C4D and legacy code/configuration unchanged. Enable consolidated email in a feature-gated path, observe persisted status and test recipients, then switch the legacy flag only after acceptance. If consolidated email fails, disable the consolidated flag and re-enable/retain the legacy path; do not delete data, rewrite Sheet rows, or alter frozen jobs. Any already-sent correction needs an explicit business-approved correction policy.

## 19. Files/functions likely requiring modification in implementation phase

Likely scope, subject to a separate approved design:

- `src/services/integrationOutboxService.js`: consolidated email job identity, frozen Daily/MTD rendering, terminal/retry classification, and status persistence.
- `src/services/emailService.js`: only if stable provider Message-ID or an equivalent safe transport option is required; preserve existing credential handling.
- `src/services/dayClosingEmail.js`: reuse/extend the existing text builder without changing the frozen payload contract.
- `src/services/consolidatedReportingPersistenceService.js`: only if an MTD snapshot/hash or explicit email source must be frozen transactionally.
- `src/database/dayClosingMigration.js`: only for a reviewed additive email/MTD state schema and indexes.
- `src/database/dayClosingService.js`: only to enqueue the reviewed consolidated email identity after the close/frozen-job commit.
- `src/main/main.js`: only to inject the reviewed service and preserve startup drain/recovery.
- focused tests/scripts for the new email contract and restart/re-close cases.

Google Apps Script should be inspected separately if it is proposed as an email sender, but current Windows evidence does not justify moving email authority to Google.

## 20. Files/functions that must not be modified in C4E email implementation

Do not redesign C4D V16 receiver semantics or the consolidated Sheet worker for email. Do not modify the legacy segment DSR/email implementation merely to implement the consolidated path; only the later reversible pause control should gate it. Do not modify billing/payment/return accounting to create presentation KPIs. Do not alter the frozen payload hash/canonicalization contract, Google Sheet rows, historical data, production backup contents, or the existing encrypted credential store.

## 21. Proposed implementation stages

**C4E.1 — contract/design lock:** inspect the external Google/DSR reporting consumer if it is claimed to be the current Daily+MTD authority; lock metric definitions, September/October boundary, null semantics, recipient policy, correction policy, and attachment list.

**C4E.2 — frozen source and identity:** define Daily payload hash binding and an authoritative MTD snapshot/range, including replacement by higher close sequence and stale/conflict handling.

**C4E.3 — persistence/outbox:** add the smallest additive email state/identity schema and recovery classification; preserve the existing post-commit outbox model.

**C4E.4 — renderer/transport:** reuse `emailService`, build Daily+MTD text/HTML from frozen sources, retain Windows ZIP ownership, and add credential-free diagnostics.

**C4E.5 — controlled testing:** use test recipients/mocks for success, transient failure, permanent auth failure, restart, crash-window duplicate risk, same sequence, higher sequence, stale sequence, Sheet/email independence, and null-vs-zero.

**C4E.6 — parallel E2E and cutover:** run consolidated email in parallel while the legacy flag remains enabled; review persisted statuses and recipient output; then pause legacy automatic execution with one reversible flag and retain rollback.

## 22. Risks, blockers, and open questions

- The repository cannot prove the claimed external working Daily+MTD email or `Hybrid_Daily_Data` authority.
- The frozen consolidated payload has Daily overall data and limited segment data, but not all segment accounting/return metrics; missing values must not become zero.
- Dashboard MTD is mutable and not sequence-bound; it should not be promoted to final email authority without a design change.
- Literal exactly-once SMTP delivery is not guaranteed by the current outbox because send and status persistence are separate operations.
- Higher-sequence correction-email behavior needs a business decision.
- Recipient/test-recipient policy and the October 1 initial MTD scope need explicit approval.
- Google must not be selected as the sender merely because it owns the Sheet; no current repository evidence supports that architecture.

## 23. Confirmation no live action or mutation occurred

During this audit:

- no source code was modified;
- no SQLite database was opened or changed;
- the production database was not accessed;
- no email or HTTP request was sent;
- no Google Sheet or Apps Script was accessed or modified;
- no Day Closing, C4D verifier, backup, retry, or deployment action was invoked;
- no commit, push, reset, restore, checkout, clean, or stash was performed.

The only file added by this task is this report. Existing dirty C4D files and reports were preserved.

## 24. Required AGENTS.md reporting format

### TASK

Read-only architecture and business-rule audit for a future consolidated Windows Daily + MTD email, preserving C4D and legacy fallback behavior.

### FILES INSPECTED

Key files inspected include:

- `src/database/dayClosingService.js`
- `src/database/dayClosingMigration.js`
- `src/database/dayClosingDsrService.js`
- `src/database/businessSegmentReportService.js`
- `src/database/billService.js`
- `src/services/emailService.js`
- `src/services/dayClosingEmail.js`
- `src/services/integrationConfigService.js`
- `src/services/integrationOutboxService.js`
- `src/services/businessSegmentDsrOutboxService.js`
- `src/services/businessSegmentDsrEmailService.js`
- `src/services/consolidatedReportingPersistenceService.js`
- `src/services/consolidatedSheetDeliveryWorker.js` (preserved; not redesigned)
- `src/main/main.js`
- relevant C4A/C4B/C4C/C4D reports and focused test scripts.

### FINDINGS

The exact Windows lifecycle is post-commit asynchronous integration delivery. The current Overall email is a backup-attached Daily text email. Segment DSR/email is a separate retained outbox. No proven consolidated Daily+MTD email or Hybrid source exists in this repository. Frozen C4D data is a safe Daily source; MTD requires a reviewed persistent authority and identity.

### FILES MODIFIED

Only `reports/2026-09-22_c4e_consolidated_email_architecture_audit.md` was created. No source file was modified.

### DATABASE CHANGES

None. No database was opened, queried, migrated, or changed.

### BUSINESS LOGIC CHANGES

None. This is audit/design only.

### TESTS RUN

- `node --check src/database/dayClosingService.js`
- `node --check src/services/emailService.js`
- `node --check src/services/integrationOutboxService.js`
- `node --check src/services/businessSegmentDsrOutboxService.js`
- `node --check src/database/businessSegmentReportService.js`
- `node --check src/services/integrationConfigService.js`
- `node scripts/r09-dsr-phase2-test.js`
- `node scripts/v1-c2-c3-durable-reporting-day-closing-test.js`
- `node scripts/v1-business-segment-dsr-stage3b-test.js`
- `git diff --check`

### TEST RESULTS

All listed syntax checks passed. R09 DSR Phase 2 passed. Durable C2/C3 Day Closing tests passed with 41 focused assertions/case groups. Business Segment Stage 3B outbox/email tests passed. `git diff --check` passed; Git emitted only existing line-ending warnings for dirty files.

### SPECIFICATION CHECK

The audit-only scope was followed. C4D, legacy segment DSR/email, databases, configuration, Google, email transport, and deployment were not changed or invoked. The requested architecture questions and implementation boundaries are documented above.

### RISKS / REMAINING ISSUES

The MTD authority, external Google/Hybrid contract, correction-email policy, and literal exactly-once provider behavior require design review before implementation. These are explicitly recorded; no unsupported implementation assumption was made.

### FINAL STATUS

READY FOR C4E IMPLEMENTATION DESIGN REVIEW

## Git status at completion

The completion status from `git status --short` is:

```text
 M src/services/consolidatedSheetDeliveryWorker.js
 M src/services/emailService.js
?? reports/2026-09-22_c4d_single_row_idempotency_defect.md
?? reports/2026-09-22_c4d_v16_postcleanup_idempotency_verifier.md
?? reports/2026-09-22_c4e_consolidated_email_architecture_audit.md
?? scripts/c4d-job2-unchanged-repair-electron.js
?? scripts/c4d-job2-unchanged-repair-test.js
?? scripts/c4d-job2-unchanged-repair.js
?? scripts/c4d-v16-job2-idempotency-verifier-electron.js
?? scripts/c4d-v16-job2-idempotency-verifier-test.js
?? scripts/c4d-v16-job2-idempotency-verifier.js
```

The modified/untracked C4D files above predate this audit and were preserved.
