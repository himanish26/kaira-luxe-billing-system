# KLBS V1.1.0 Runtime Database Provenance Forensic Audit

Audit date: 2026-09-24 (Asia/Kolkata)
Mode: read-only forensic diagnosis
Repository: `D:\KLBS\kaira-luxe-billing-system`

## 1. DB path resolution architecture

The runtime authority is `src/database/databasePath.js`.

`src/database/database.js` calls `getAuthoritativeDatabasePath()` while the Electron main module is being loaded, before `app.whenReady()`. It then opens one `sqlite3.Database` connection using that path, performs startup restore recovery, enables foreign keys, creates/migrates schema, and verifies the SQLite `PRAGMA database_list` main path against the authority.

The resolved path is cached in the module-level `cachedAuthoritativeDatabasePath`. The cache lasts for the process/module lifetime. A new application process starts with a new module cache and resolves the path again.

Exact precedence:

1. Packaged Electron: `app.getPath("userData")\billing.db` is authoritative. `KLBS_DEV_DATABASE_PATH` is forbidden and causes an error if present.
2. Unpackaged Electron with `KLBS_DEV_DATABASE_PATH` present: the absolute `.db` override is authoritative, subject to validation and protected-path rejection.
3. Unpackaged Electron without the override: repository-root `billing.db` is authoritative.

There is no normal application fallback to a training database, test database, or arbitrary current-working-directory database. Training/test paths are supplied only by test/diagnostic launch environments or direct test code.

The override must be absolute, have a non-empty `.db` filename, and cannot be the protected `billing_dev_copy.db` or a listed protected path. No later application code overwrites the selected database path.

## 2. Normal connection and worker architecture

`src/database/database.js` exports one SQLite connection object. Node module caching means normal `require("../database/database")` consumers receive that same object.

The following are explicitly constructed with that object in `src/main/main.js`:

- Day Closing service (`database` option)
- Consolidated reporting persistence service (`database` option)
- Consolidated Sheet delivery worker (`database` option)
- Consolidated reporting email worker (`database` option)
- Integration outbox and other database services

The reporting workers are ordinary in-process service objects. They do not create child processes and do not independently resolve or open a database. The main process drains them from the integration timer.

Therefore: **Can different normal V1.1 reporting services use different DBs in one process? NO.** Evidence is the single exported connection from `database.js`, dependency injection of that same object at `main.js` lines 399-414 and 423-430, and no worker-level database constructor or path helper.

The worker email text is built from `consolidated_reporting_jobs.payload_json`. The exact labels `Closing ID`, `Closing Sequence`, `Closed At`, and `KLBS Version` occur in the consolidated email worker. Legacy day-closing email text does not contain that complete identity set.

## 3. All runtime-capable database opening paths

### Production

- Packaged application primary connection: `<Electron userData>\billing.db`, selected only when `app.isPackaged` is true.
- Restore/backup internal validation connections: read-only `sqlite3.Database` opens of paths supplied by the restore/validation workflow. These are validation/staging inputs, not alternate primary application connections.
- Backup source: `database.backup(snapshotPath)` from the authoritative singleton connection.

### Development

- Unpackaged application with no override: repository-root `D:\KLBS\kaira-luxe-billing-system\billing.db`.
- Unpackaged application with `KLBS_DEV_DATABASE_PATH`: the exact absolute override value.
- The repository `billing_dev_copy.db` is explicitly protected against use as the development override.

### Test/diagnostic

- Test Electron child processes explicitly pass `KLBS_DEV_DATABASE_PATH` to temporary `billing.db` files.
- Unit/integration scripts open temporary files or `:memory:` SQLite databases directly. These are test fixtures and do not represent normal V1.1 runtime authority.
- `c4d-v16-idempotency-verifier.js` and `c4d-job2-unchanged-repair.js` have explicit read-only database inputs for approved diagnostic/training verification.

### Dead/unreachable as normal runtime authority

- No source path hardcodes `KLBS_TRAINING_*.db`.
- No source path makes repository-root `billing.db` authoritative for packaged Electron.
- No `better-sqlite3` constructor exists in the repository.
- No reporting worker has an independent SQLite open.
- `installerService` and printer-status `child_process` use do not open databases.

## 4. Environment variable lifetime and process behavior

`set KLBS_DEV_DATABASE_PATH=...` in Windows CMD places the variable in the CMD environment. `npm start` runs the package script `electron .`; npm does not remove this variable, and the Electron main process inherits it through normal Windows process environment inheritance.

For the command specified in the task, the unpackaged Electron main process therefore resolves the override path, provided the variable was set in the same CMD session and the process was actually started by that command.

Reporting services run in that same main process, so they retain the same selected connection. No reporting worker is spawned. The only application child-process uses found are installer launch and PowerShell printer inspection; neither opens the KLBS database. Test scripts that spawn Electron explicitly use `{ ...process.env, KLBS_DEV_DATABASE_PATH: ... }` where needed.

The path is resolved/cached on first authoritative database-module use. Changing `process.env.KLBS_DEV_DATABASE_PATH` later in the same process does not change the cached path. Restarting the app starts a new process and can change the selected path based on the new environment, packaging state, and userData path.

## 5. Read-only database forensics

All SQLite inspection below used `sqlite3.OPEN_READONLY` and did not load KLBS startup code, migrations, restore logic, or normal application initialization. The production path `C:\Users\USER\AppData\Roaming\KAIRA LUXE BILLING SYSTEM\billing.db` was not accessed.

Non-production files inspected:

- `D:\KLBS\KLBS_V110_RELEASE_TEST_2026-09-24.db`
- `D:\KLBS\KLBS_TRAINING_2026-09-16.db`
- `D:\KLBS\KLBS_TRAINING_2026-09-21.db`
- `D:\KLBS\KLBS_TRAINING_2026-09-21_REG02_RETEST.db`
- `D:\KLBS\KLBS_TRAINING_2026-09-21_REG02_RETEST_BEFORE_C4E_RETRY.db`
- `D:\KLBS\kaira-luxe-billing-system\billing.db`
- `D:\KLBS\kaira-luxe-billing-system\billing_dev_copy.db`
- `_codex_fresh_runtime_20260911\billing.db`
- `_codex_fresh_runtime_20260911_b\billing.db`

Exact successful queries used, with read-only handles:

```sql
PRAGMA database_list;
SELECT name FROM sqlite_master
 WHERE type='table'
   AND name IN ('day_closing_snapshots','consolidated_reporting_jobs')
 ORDER BY name;
SELECT id,business_date,close_sequence,close_status,closed_at,
       backup_status,backup_reference,email_status
  FROM day_closing_snapshots
 WHERE business_date='2026-09-22'
    OR id=8
    OR closed_at='2026-09-24T05:22:49.219Z'
 ORDER BY id;
SELECT id,closing_id,business_date,close_sequence,contract_version,
       snapshot_version,payload_hash,report_status,data_quality_status,
       sheet_status,email_status,sheet_delivered_at,email_delivered_at,
       created_at
  FROM consolidated_reporting_jobs
 WHERE business_date='2026-09-22'
    OR closing_id=8
    OR payload_json LIKE '%2026-09-22%'
    OR payload_json LIKE '%2026-09-24T05:22:49.219Z%'
 ORDER BY id;
SELECT id,closing_id,business_date,close_sequence,payload_hash,payload_json
  FROM consolidated_reporting_jobs
 WHERE id=3;
```

The final payload query was parsed in memory only to extract metadata fields; customer/product/bill payload details were not reported.

## 6. Forensic results

### Intended release-test database

`D:\KLBS\KLBS_V110_RELEASE_TEST_2026-09-24.db` contains:

- Snapshot `id=7`: business date `2026-09-22`, sequence `1`, closed at `2026-09-22T16:18:49.282Z`, backup status `SUCCESS`, email status `SUCCESS`.
- Snapshot `id=8`: business date `2026-09-23`, sequence `1`, closed at `2026-09-23T13:46:03.023Z`, backup status `SUCCESS`, email status `SUCCESS`.
- No `consolidated_reporting_jobs` rows matching the target; the queried job result was empty.

Therefore: **Did the intended release-test DB contain the job that produced the observed email? NO.** It has no consolidated reporting jobs, and its snapshot `id=8` is for 23 Sep, not the observed 22 Sep closing.

### Exact matching source database and job

`D:\KLBS\KLBS_TRAINING_2026-09-21_REG02_RETEST.db` contains:

- Snapshot `id=8`
- Business date `2026-09-22`
- Close sequence `1`
- Closed at `2026-09-24T05:22:49.219Z`
- Close status `CLOSED`
- Backup status `SUCCESS`
- Email status `SUCCESS`
- Backup reference `KL_Backup_2026-09-24_10-52-49_5984_1_e0853d3da87e.zip`

The exact matching job is:

- `consolidated_reporting_jobs.id = 3`
- `closing_id = 8`
- `business_date = 2026-09-22`
- `close_sequence = 1`
- `payload_hash = 8eb79f567f7a9fe9ea7b0ad3baa3b5cd52d17ccf095c591404b8af57ad758cf7`
- `report_status = FINAL`
- `data_quality_status = COMPLETE`
- `sheet_status = DELIVERED`
- `email_status = DELIVERED`
- `sheet_delivered_at = 2026-09-24T07:55:30.148Z`
- `email_delivered_at = 2026-09-24T07:55:45.895Z`
- `created_at = 2026-09-24T05:22:49.219Z`

The parsed payload metadata is exactly:

```text
businessDate = 2026-09-22
closingId    = 8
closeSequence= 1
closedAt     = 2026-09-24T05:22:49.219Z
klbsVersion  = 1.1.0
```

Concrete provenance chain established from database records:

```text
Observed consolidated email
  <- consolidated_reporting_jobs.id 3
  <- closing_id / day_closing_snapshots.id 8
  <- D:\KLBS\KLBS_TRAINING_2026-09-21_REG02_RETEST.db
  <- backup_reference KL_Backup_2026-09-24_10-52-49_5984_1_e0853d3da87e.zip
```

### Backup binding

The source code binds the backup reference to this closing as follows: Day Closing first creates a SQLite backup from the authoritative singleton connection, validates it, then in the same finalization transaction writes `backup_reference` to the closed snapshot and inserts the frozen consolidated job from that snapshot. The email worker reads that snapshot reference, resolves the exact backup filename, validates the attachment, and sends it.

The referenced ZIP was not present under `D:\KLBS` during this audit, so the archive's internal `backup-info.json` and embedded database could not be independently inspected. The database-record binding is established; the physical attached archive's contents are **UNPROVEN**.

Therefore: **Was the attached backup bound to that same closing? UNPROVEN as an archive-content claim; database-level binding is present and consistent.**

## 7. Alternative explanations

- Previous training DB: **CONFIRMED source**, specifically `KLBS_TRAINING_2026-09-21_REG02_RETEST.db`.
- Intended release-test DB: disproved by no jobs and mismatched snapshot identity.
- Repo-root `billing.db`: disproved by no matching job; its inspected snapshot `id=8` is a reopened 2026-09-07 record.
- Other inspected training/repo DBs: no matching target record.
- Stale in-memory job: not needed to explain the email; the exact durable job exists in the matching training DB. No source evidence identifies a memory-only reporting job.
- Previously queued async work: possible in general because jobs persist as `PENDING`/`PROCESSING` and are drained later, but the current evidence cannot distinguish ordinary drain from a startup drain.
- Startup recovery: possible in general; both workers recover stale processing rows and the main process starts the consolidated drain after readiness. The matching job is now `DELIVERED`, so the post-run DB does not prove whether startup recovery was the triggering drain.
- Another running KLBS/Electron instance: possible in principle. The first instance owns the lock and continues running; a later same-user launch exits. An older instance could therefore continue draining its own already-resolved training DB. No process was terminated or used as proof during this audit.
- Legacy email path: not consistent with the exact consolidated identity fields. `dayClosingEmail.js` lacks Closing ID/Sequence/closed-at/version identity in this format; the consolidated worker is the source path containing all exact labels and uses the frozen payload.
- Fixture/test execution: the database was a training/regression artifact, but the matching durable row and delivered status are evidence of an actual reporting pipeline record, not merely a synthetic in-memory fixture.
- Manual retry: possible only if a failed job was requeued; the current row is delivered and the audit cannot identify which UI/action initiated any prior retry.

## 8. Multiple-instance behavior

`src/main/main.js` calls `app.requestSingleInstanceLock()` at top level. If the lock is not acquired, that process calls `app.quit()` and does not initialize the normal application branch.

Therefore: **Is KLBS currently protected against multiple simultaneous app instances? YES, for normal instances sharing the Electron single-instance lock scope.** There is no `second-instance` handler found, so an attempted second launch does not take over or prove which database the already-running first instance is using. The lock also does not stop an older first instance from continuing its workers.

Therefore: **Could another running KLBS/Electron instance have produced the email? YES, as a possible mechanism, but it is not required to establish provenance.** The exact source DB/job is already identified as the training retest DB.

## 9. Production database access

No production database access occurred. The forbidden path was not opened, queried, migrated, copied, or passed to KLBS code. No Day Close, reopen, retry, email, Google request, backup creation, KLBS launch, build, or installer operation was performed.

## 10. Recommended future prevention (not implemented)

The smallest safe improvement is a developer-only startup diagnostic emitted by the main process immediately after authoritative path resolution and connection identity verification. It should log only the normalized resolved database path, `app.isPackaged`, process ID, and reporting mode to the existing technical log/console; it must not log SMTP, OAuth, DSR secrets, customer data, or payload contents.

For win-unpacked regression, the diagnostic should make a line such as `THIS INSTANCE DATABASE: D:\...\TEST.db` visible in the technical log and startup console. A developer-only System Information readout is a useful secondary display, but is broader than the minimal release-gate proof.

A single-instance lock should remain a release requirement. It is already present in source; a future regression gate should verify it and, if desired, add a `second-instance` diagnostic that reports the attempted duplicate launch without exposing secrets.

## 11. Git status at audit completion

Pre-existing modified/untracked V1.1 source and audit artifacts were preserved. This audit added only this report. No source file was changed, staged, committed, reset, cleaned, restored, or checked out.

## Required answers

- Can different normal V1.1 reporting services use different DBs in one process? **NO.** One cached authoritative path and one singleton SQLite connection are injected into all normal reporting services.
- Did the intended release-test DB contain the job that produced the observed email? **NO.** It has no consolidated jobs; its snapshot 8 is 23 Sep.
- Which exact DB produced the observed email? **`D:\KLBS\KLBS_TRAINING_2026-09-21_REG02_RETEST.db`**, provable from the exact snapshot/payload identity.
- Which exact consolidated job produced it? **Job `id=3`, `closing_id=8`, business date 2026-09-22, sequence 1**, payload hash recorded above.
- Was the attached backup bound to that same closing? **UNPROVEN for physical archive contents; database-level reference binding is consistent.**
- Could another running KLBS/Electron instance have produced it? **YES, possible; an older lock-owning instance could continue draining its resolved DB.**
- Is KLBS currently protected against multiple simultaneous app instances? **YES, via `app.requestSingleInstanceLock()`.**
- Is any code correction required before win-unpacked regression? **NO provenance correction is required to explain this email; the blocker was a wrong runtime database provenance. A diagnostic path log is recommended but not implemented in this audit.**

## Required KLBS reporting format

### TASK

Determine the exact runtime database provenance of the observed V1.1 consolidated email without changing application source or accessing the production database.

### FILES INSPECTED

`AGENTS.md`; `package.json`; `src/database/databasePath.js`; `src/database/database.js`; `src/main/main.js`; `src/database/dayClosingService.js`; `src/services/consolidatedReportingPersistenceService.js`; `src/services/consolidatedSheetDeliveryWorker.js`; `src/services/consolidatedReportingEmailWorker.js`; `src/services/consolidatedReportingTransport.js`; `src/services/integrationOutboxService.js`; `src/services/dayClosingEmail.js`; `src/services/businessSegmentDsrEmailService.js`; `src/services/backupService.js`; `src/services/reportingMode.js`; `src/services/installerService.js`; `src/main/statusService.js`; `src/shared/consolidatedDsrBuilder.js`; relevant database-opening test/diagnostic scripts; and all listed non-production SQLite files.

### FINDINGS

The exact source is `D:\KLBS\KLBS_TRAINING_2026-09-21_REG02_RETEST.db`, consolidated job `id=3`, snapshot `id=8`, with the exact observed payload metadata. The intended release-test DB has no consolidated jobs and does not contain that identity.

### FILES MODIFIED

Only `reports/2026-09-24_v11_runtime_database_provenance_forensic_audit.md` was created. No application source was modified.

### DATABASE CHANGES

None. All database access was read-only using `sqlite3.OPEN_READONLY`; no migrations or writes occurred.

### BUSINESS LOGIC CHANGES

None. This was diagnosis only.

### TESTS RUN

- Read-only SQLite provenance queries listed in section 5.
- Repository source searches for database paths, constructors, environment overrides, worker construction, child processes, and single-instance enforcement.
- `git diff --check`.
- `git status --short`.

### TEST RESULTS

Read-only forensic queries passed against all nine permitted non-production database files. Exact matching job/snapshot found in the training retest DB. `git diff --check` passed; existing line-ending warnings were reported for pre-existing modified files. No production database was accessed.

### SPECIFICATION CHECK

The audit matches the supplied KLBS requirements: no application source change, no launch/build/send/retry/backup operation, no production DB access, and explicit provenance answers.

### RISKS / REMAINING ISSUES

The referenced ZIP backup was not present under `D:\KLBS`, so its internal archive metadata and embedded snapshot were not independently verified. An older lock-owning instance could have performed the drain; process state was not used or altered. A startup path diagnostic is recommended before future manual regression.

### FINAL STATUS

AUDIT ONLY - NO FILES CHANGED

## Release-gate conclusion

RUNTIME DB PROVENANCE RESOLVED  READY TO COMPLETE AUTOMATED RELEASE GATE
