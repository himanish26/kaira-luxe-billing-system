# KLBS V1.1 C4C Windows Consolidated Sheet Delivery Worker

## Baseline

- Date/time: 2026-09-21, Asia/Calcutta
- Branch: `main`
- HEAD: `96d0f7f6203db9c22d003b9cdefa934874b261c1`
- `origin/main`: `96d0f7f6203db9c22d003b9cdefa934874b261c1`
- Package version: `1.1.0`
- Initial status: `## main...origin/main` (clean)
- Baseline requirement: verified; no pull, reset, clean, stash, checkout, restore, stage, commit, or push was performed.

## Files inspected

- `AGENTS.md`
- `package.json`
- `src/services/consolidatedReportingTransport.js`
- `src/services/consolidatedReportingPersistenceService.js`
- `src/database/dayClosingMigration.js`
- `src/database/dayClosingService.js`
- `src/shared/consolidatedDsrBuilder.js`
- `src/shared/segmentPaymentAllocator.js`
- `src/services/integrationConfigService.js`
- `src/services/dsrSyncService.js`
- `src/services/businessSegmentDsrSyncService.js`
- `scripts/v1-c4a-consolidated-transport-foundation-test.js`
- `scripts/v1-c4b-consolidated-reporting-recovery-migration-test.js`
- `scripts/v1-c2-c3-durable-reporting-day-closing-test.js`
- `scripts/v1-c1b-c1c-consolidated-payload-test.js`

## Files created

- `src/services/consolidatedSheetDeliveryWorker.js`
- `scripts/v1-c4c-consolidated-sheet-delivery-worker-test.js`
- `reports/KLBS_V1.1_C4C_Windows_Consolidated_Sheet_Delivery_Worker.md`

No existing source file was modified. No database migration, configuration file, Day Closing path, startup path, legacy integration, email path, or semantic payload builder was modified.

## Worker architecture

`createConsolidatedSheetDeliveryWorker({ database, now, httpClient, configProvider })` is a callable/testable service factory. It has no startup registration, scheduler, Day Closing invocation, or automatic production invocation.

The worker flow is:

1. Recover stale Sheet `PROCESSING` claims in a short `BEGIN IMMEDIATE` transaction.
2. Claim the oldest `PENDING` job by `business_date`, `close_sequence`, and `id` in a separate short transaction.
3. Set only Sheet state to `PROCESSING`, increment `sheet_attempt_count` once, and write the same UTC ISO timestamp to `sheet_last_attempt_at` and `sheet_processing_started_at`.
4. Commit before any HTTP operation.
5. Validate the supplied frozen row with the existing C4A `validateFrozenJob` helper.
6. Build the exact C4A envelope from stored `payload_json`, stored `payload_hash`, the claim timestamp, and the configured consolidated secret.
7. POST JSON outside a database transaction.
8. Reuse C4A receiver and transport classification.
9. Persist only Sheet outcome state in a separate update guarded by the job id and claim timestamp.

The worker never calls `buildConsolidatedPayload`, accounting calculation, bill reads, segment allocation, or any other reporting reconstruction logic.

## Claim and concurrency design

Claiming uses `BEGIN IMMEDIATE`, an ordered `PENDING` selection, and a conditional `UPDATE ... WHERE id = ? AND sheet_status = 'PENDING'`. The external request is never inside that transaction.

Concurrent transaction contention is treated as a non-owning claim (`null`/no job), and the contender does not issue a rollback when it failed before starting its transaction. This prevents a second invocation from claiming the same row or rolling back the first invocation's claim.

The claim increments `sheet_attempt_count` exactly once and writes both C4B Sheet timestamps to the same `Date.toISOString()` value. The email state is not selected for update and is not modified.

## Timestamp and stale-processing recovery

- `sheet_last_attempt_at`: UTC ISO timestamp written at claim time.
- `sheet_processing_started_at`: the same UTC ISO timestamp written at claim time.
- `sheet_delivered_at`: a fresh UTC ISO timestamp written only on successful delivery.
- Stale timeout constant: `STALE_PROCESSING_TIMEOUT_MS = 300000` (five minutes).

Recovery checks only `PROCESSING` rows with a valid UTC ISO `sheet_processing_started_at`. A row at or beyond the named timeout is conditionally changed to `PENDING`, its processing timestamp is cleared, and a safe `RETRYABLE_TRANSPORT_FAILURE` diagnostic is stored. Invalid or missing processing timestamps are not guessed or recovered; they remain `PROCESSING` for explicit investigation.

The existing schema is sufficient. No migration or new column was required in C4C.

## Configuration and endpoint isolation

C4C uses dedicated configuration names and does not reuse the legacy endpoint implicitly:

- `KLBS_CONSOLIDATED_DSR_WEB_APP_URL`
- `KLBS_CONSOLIDATED_DSR_SYNC_SECRET`

The factory also accepts an injected `configProvider` for controlled tests and later integration. The endpoint must be HTTPS and the secret must be present. The worker does not alter `integrationConfigService`, legacy `KLBS_DSR_WEB_APP_URL`, legacy secret resolution, or any existing sender behavior.

There is no production cutover switch, startup call, scheduler, or Day Closing route in this stage.

## Exact HTTP contract

- Method: `POST`
- URL: dedicated HTTPS consolidated endpoint
- Content-Type: `application/json`
- Body: the exact C4A envelope with root keys `transportVersion`, `timestamp`, `payload`, `payloadHash`, and `signature`
- Timeout: 30,000 ms
- Redirects: disabled (`maxRedirects: 0`)
- Response parsing: JSON
- Request/response body limits: 128 KiB
- Secret: never placed in URL, body, logs, or persisted errors

The timestamp passed to the envelope is the persisted claim timestamp. Business Date remains the payload's canonical `YYYY-MM-DD` string and is not parsed as a timezone-bearing instant.

## C4A reuse and HMAC

The worker directly reuses `src/services/consolidatedReportingTransport.js` for:

- frozen-job preflight, including exact stored `payload_json` SHA-256 verification;
- contract/snapshot/status/quality/reconciliation validation;
- exact envelope construction;
- signed-message construction and HMAC-SHA256;
- receiver response identity/action validation;
- HTTP/network/TLS/timeout classification.

No second canonicalizer, payload hash, allocator, or cryptographic scheme was introduced.

## Receiver result mapping

For valid 2xx responses, the worker enforces the C4A response identity and payload hash. It additionally enforces:

| HTTP/action | Local result | Persisted Sheet state |
|---|---|---|
| 201 / `INSERTED` | delivered | `DELIVERED` |
| 200 / `UPDATED` | delivered | `DELIVERED` |
| 200 / `UNCHANGED` | delivered | `DELIVERED` |
| 200 / `STALE` | terminal superseded | `FAILED` |
| any mismatched action/status or malformed 2xx | invalid response | `FAILED` |

`sheet_delivered_at` is set only for delivered actions. Successful delivery clears `sheet_last_error` and clears `sheet_processing_started_at`.

## Retryable and terminal persistence

C4A classification is used without alternate worker rules:

- Retryable: 408, 429, 5xx, timeout, network/connection, TLS/certificate failures.
- Terminal `CONFLICT`: 409.
- Terminal `AUTHENTICATION_FAILED`: 401/403.
- Terminal `REJECTED`: other expected 4xx, including 400, 404, 405, 415, and 422.
- Terminal `INVALID_RESPONSE`: malformed/mismatched 2xx or unexpected status.
- Terminal `STALE_SUPERSEDED`: valid stale receiver response.

Retryable outcomes are represented by `sheet_status = 'PENDING'`, which is the existing retry-eligible state and avoids adding a retryability column or parsing human-readable error text. Terminal outcomes use the existing allowed `sheet_status = 'FAILED'`. Retryable diagnostics are stored with the stable code prefix `RETRYABLE_TRANSPORT_FAILURE`; terminal diagnostics use their stable code prefix. No infinite scheduler was added.

## Schema compatibility and channel isolation

The existing `sheet_status` CHECK values (`PENDING`, `PROCESSING`, `DELIVERED`, `FAILED`) are sufficient for this representation. C4C changes only:

- `sheet_status`
- `sheet_attempt_count`
- `sheet_last_attempt_at`
- `sheet_processing_started_at`
- `sheet_last_error`
- `sheet_delivered_at`

It does not change `payload_json`, `payload_hash`, identity columns, or any email column. Specifically untouched in all worker SQL are `email_status`, `email_attempt_count`, `email_last_error`, `email_delivered_at`, `email_last_attempt_at`, and `email_processing_started_at`.

## Payload immutability evidence

The worker validates and envelopes the row returned by the claim query. It does not reconstruct the semantic payload. The focused test records the original `payload_json` and `payload_hash` and verifies both remain byte/string identical after delivery and retryable processing.

## Tests executed

All tests used synthetic values and disposable SQLite fixtures. No live endpoint, production secret, production database, or email transport was used.

- `node --check src/services/consolidatedSheetDeliveryWorker.js` — PASS
- `node --check scripts/v1-c4c-consolidated-sheet-delivery-worker-test.js` — PASS
- `node scripts/v1-c4c-consolidated-sheet-delivery-worker-test.js` — PASS
- `node scripts/v1-c4a-consolidated-transport-foundation-test.js` — PASS
- `node scripts/v1-c4b-consolidated-reporting-recovery-migration-test.js` — PASS
- `node scripts/v1-c2-c3-durable-reporting-day-closing-test.js` — PASS (41 focused assertions/case groups)
- `node scripts/v1-c1b-c1c-consolidated-payload-test.js` — PASS (50 focused assertions/case groups)
- `git diff --check` — PASS

The C4C test covers PENDING claiming, exact timestamp/envelope/HMAC behavior, INSERTED/UPDATED/UNCHANGED/STALE, conflict/authentication/rejection/invalid response, 408/429/5xx/network/timeout retryability, concurrent claims, stale recovery, payload/hash immutability, email-state isolation, and mock-only HTTP.

## Safety and non-goals confirmation

- Production database was not opened or accessed.
- No live Google endpoint was contacted; the test endpoint is `https://placeholder.invalid/consolidated` and HTTP is injected/mocked.
- No email was sent.
- No source/test/database/configuration/payload/accounting business logic outside the two new C4C files was modified.
- Existing Overall and Segment Google integrations remain unchanged.
- Existing Overall and Segment email integrations remain unchanged.
- No Day Closing or startup invocation was added.
- No migration was added.
- No commit, push, or staging was performed.

## Risks / remaining issues

- C4C is callable but intentionally not wired to a scheduler, startup, or Day Closing. Production delivery remains disabled until the later receiver and cutover stages.
- A missing or malformed processing timestamp is not automatically recovered because recovery must not guess. Such a row requires explicit operational handling.
- HTTP delivery remains at-least-once: a process crash after receiver acceptance and before local `DELIVERED` persistence can cause a retry. This is safe only once the receiver implements the locked idempotency contract.
- Retryable outcomes return to `PENDING`; scheduling/backoff policy belongs to a later worker orchestration stage.

## Exact staging recommendation

Do not stage automatically. After manual review, stage only:

```text
git add -- src/services/consolidatedSheetDeliveryWorker.js scripts/v1-c4c-consolidated-sheet-delivery-worker-test.js reports/KLBS_V1.1_C4C_Windows_Consolidated_Sheet_Delivery_Worker.md
```

Recommended commit message:

```text
feat: add consolidated Google Sheet delivery worker foundation
```

## Required project report sections

### TASK

Implemented the Windows-side C4C consolidated Google Sheet delivery worker only.

### FILES INSPECTED

Listed above; current C4A transport, C4B schema, reporting persistence, Day Closing, configuration, legacy integrations, and fixture tests were inspected.

### FINDINGS

The existing schema and C4A contract support an isolated callable Sheet worker without migration or legacy routing changes.

### FILES MODIFIED

None. Three files were created by this task: the worker, focused test, and this report.

### DATABASE CHANGES

No schema changes. Runtime worker updates only the Sheet delivery columns of claimed durable jobs.

### BUSINESS LOGIC CHANGES

None. Accounting, payload creation, allocation, Day Closing, email, and legacy transport behavior are unchanged.

### TESTS RUN

The exact syntax, focused C4C, C4A, C4B, C2/C3, C1B/C1C, and `git diff --check` commands are listed above.

### TEST RESULTS

All listed checks passed.

### SPECIFICATION CHECK

The implementation matches the supplied C4C scope: isolated callable worker, C4A reuse, C4B timestamp use, short claim transactions, no network inside a transaction, safe terminal/retry mapping, and no automatic production routing.

### RISKS / REMAINING ISSUES

Listed above; the principal remaining dependency is the future idempotent Google receiver and later controlled cutover.

### FINAL STATUS

IMPLEMENTED - TESTS PASSED

## Final status

Final `git status --short` after this task:

```text
?? reports/KLBS_V1.1_C4C_Windows_Consolidated_Sheet_Delivery_Worker.md
?? scripts/v1-c4c-consolidated-sheet-delivery-worker-test.js
?? src/services/consolidatedSheetDeliveryWorker.js
```

## FINAL VERDICT

READY FOR C4C MANUAL REVIEW / COMMIT
