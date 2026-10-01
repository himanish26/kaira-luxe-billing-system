# V2.0.0 Legacy DSR Pipeline Retirement

## Task and baseline

- Date/time: 2026-10-01 09:28 +05:30 (qualification reconciliation); UTC 2026-10-01 03:57Z.
- Branch: main. Starting HEAD and origin/main: `78087b9bc78a2b44a703a54b137dd05de3ec2662`. Package: 2.0.0. Starting working tree was clean.
- Scope: retire only historical legacy DSR work when reporting mode is CONSOLIDATED_V2.

## Root cause and decision

The restored V1 database contained incomplete legacy `DSR_DAY_CLOSING` queue records from an incompatible legacy DSR contract. V2 suppresses legacy draining in CONSOLIDATED_V2 mode, so those records remained counted and were presented as pending despite the legacy pipeline being retired. The SQLite status constraint permits only PENDING, PROCESSING, SUCCESS. KLBS already represents stale/superseded jobs as SUCCESS with a `completed_at` and `last_error` beginning with the existing "Delivery not sent: ..." wording; that truthful, existing retirement convention was reused. No row is represented as successfully delivered: the reason explicitly identifies the legacy pipeline retirement and UI says RETIRED - NOT SENT.

## Exact implementation

- Added an idempotent outbox service reconciliation gated on the authoritative `CONSOLIDATED_V2` mode. It takes an immediate SQLite transaction and only selects `DSR_DAY_CLOSING` rows in PENDING/PROCESSING whose business date and creation time predate the current OPEN day, whose exact matching Day Closing snapshot is CLOSED, and whose matching consolidated job has no active PENDING/PROCESSING Sheet or email work.
- Selected rows use the existing schema-compatible SUCCESS retirement state and explanatory last_error. Existing attempt count, last-attempt timestamp, business date, closing identity, Day Closing snapshot, and all other rows remain unchanged. Activity Log receives one warning-level superseded/not-sent audit record per retired item. No network sender is called.
- Startup invokes reconciliation only after `databaseReady` (migrations complete) and before integration polling starts.
- Integration Status continues counting genuine pending/processing legacy/email and consolidated work. Retired rows are excluded from pending/failed and display `RETIRED - NOT SENT`, not LEGACY DSR PENDING or SYNCED.
- No schema migration or database schema change.

## Files modified

- `src/services/integrationOutboxService.js`
- `src/main/main.js`
- `src/renderer/modules/system/integrations.js`
- `scripts/v2-legacy-dsr-retirement-test.js` (new)
- `scripts/v11-complete-release-regression.js`
- `README.md` (existing chronological ledger)

## Qualification DB before and after

The read-only pre-mutation inspection found current business date 2026-10-01 OPEN and 10 pending legacy DSR rows for 2026-09-21 through 2026-09-30. At that time row 28 was already PENDING with last error Application restarted during delivery; therefore the database contained 10 PENDING and 0 PROCESSING, although the earlier reported state had 9 PENDING and 1 PROCESSING. All 10 rows matched CLOSED snapshots exactly, were created before the current OPEN day, and had no corresponding consolidated jobs. The 16 email rows were SUCCESS; all 16 segment DSR rows had status SUCCESS and Sheets SUCCESS; consolidated jobs count was zero. Integration Status before: pending 10, failed 0.

Before mutation, a byte-for-byte safety copy was made at:

`D:\KLBS\Windows-Qualification\V2_RESTORE_78087B9\safety-copies\billing.db.before-legacy-dsr-retirement.20261001T035753435Z.bak`

SHA-256: `F5D0DB9E70F64526B7AD9100FB82CE051A16FA35D1A27B747D1CB8B1A80886EE`; size 1,253,376 bytes. The tested service method was invoked directly with CONSOLIDATED_V2; KLBS was not launched and network sender callbacks were guarded to throw if called.

Retired exactly 10 IDs: 12, 14, 16, 18, 20, 22, 24, 26, 28, 32. After: legacy DSR rows 16 SUCCESS (6 prior SUCCESS + 10 explicitly retired); email 16 SUCCESS; no PENDING/PROCESSING rows. Integration Status pending/failed: 0/0. Each retired record has `completed_at` and a `last_error` that begins `Delivery not sent: legacy DSR pipeline retired because CONSOLIDATED_V2 replaced the legacy DSR pipeline.` Attempt counters and last-attempt timestamps were preserved. Ten activity-log audit records were added.

Before/after equality was verified for email and all nonselected integration outbox rows; segment DSR outbox; consolidated jobs; bills (30), bill items (50), products (1,678), inventory transactions (1,677), returns (1), Store Credits (1), customer credit transactions (2), Day Closing snapshots (16), business-day state (16), and settings (1). The user's intentional inventory state was not repaired or changed. SQLite `integrity_check=ok`; foreign-key check returned 0 violations. No network delivery/replay was triggered.

## Tests and validation

- Focused: `node scripts/v2-legacy-dsr-retirement-test.js` PASS. Covers historical PENDING and PROCESSING retirement, strict date/snapshot/status eligibility, active matching consolidated job protection, future job preservation, email/segment/success/past-retirement preservation, active same-date row precedence, no sender invocation, activity audit, idempotence, Integration Status pending/failed counts, UI retired label, and business-state preservation.
- Adjacent suites: DSR outbox repair, stale PROCESSING recovery, Integration Status authority, stable-gate follow-up/targeted/blocker, DSR-08 single pipeline: PASS.
- Authoritative runner: `node scripts/v11-complete-release-regression.js` - 59 suites PASS, 0 FAIL, 0 critical skips. The total increased from 58 to 59 for the new deterministic regression suite.
- Syntax: runner's `node --check` scan PASS, 193/193 JavaScript files (prior 192 plus the new test).
- `git diff --check`: PASS.

## Safety and release state

- Production DB: NOT TOUCHED. Dropbox original/backups: NOT TOUCHED.
- Qualification DB: intentionally modified only by the tested retirement service after making the verified safety copy.
- Network delivery/replay: NONE. Apps Script/Cloudflare deployment: NONE. Installer/build/package: NONE.
- Business rules and schema: unchanged.
- Implementation commit SHA: `0085a62098e0c0ca1458b1513fc351222b06a83b`.
- Push/HEAD-origin verification: pending.

## Verdict

PASS - LEGACY DSR PIPELINE CLEAN on the isolated qualification DB.
