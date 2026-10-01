# KAIRA LUXE Billing System

**Version 2.0.0 Release Candidate**
**Windows x64**

KAIRA LUXE Billing System is an offline-first Windows desktop application for retail billing, inventory operations, customer transactions, reporting, and controlled business-day workflows.

## Release information

- Product: KAIRA LUXE Billing System
- Release: Version 2.0.0 Release Candidate
- Platform: Windows 10/11, x64
- Installer: Windows NSIS installer
- Copyright: 2026 Himanish Patnaik. All Rights Reserved.

## Release history

- 2026-10-01 09:28 +05:30 - V2.0.0 legacy DSR pipeline retirement: baseline `main` HEAD `78087b9bc78a2b44a703a54b137dd05de3ec2662`, package `2.0.0`. In `CONSOLIDATED_V2`, exact-identity historical `DSR_DAY_CLOSING` rows in `PENDING` or `PROCESSING` are retired only when their CLOSED snapshot predates the current OPEN business date and no matching consolidated job has PENDING/PROCESSING Sheet or email work. The existing `SUCCESS` retirement convention is retained with `completed_at` plus `last_error` explicitly stating `Delivery not sent`; snapshots, attempts and last-attempt data are preserved. Startup runs the reconciliation after database migrations and before integration polling. Integration Status excludes retired rows and labels them `RETIRED - NOT SENT`; active legacy/email/V2 work stays visible. Added deterministic coverage for eligibility guards, PROCESSING, active/future V2 jobs, email/segment/success preservation, same-date pending-row visibility, idempotence, no sender calls, status counts, and business-data preservation. Focused DSR/outbox/status tests passed; complete regression `59/59` PASS, `0` failed, `0` critical skipped; syntax `193/193` PASS. On isolated qualification DB `D:\KLBS\Windows-Qualification\V2_RESTORE_78087B9\userData\billing.db`, after a SHA-256-verified safety copy, 10 historical DSR rows (IDs 12,14,16,18,20,22,24,26,28,32) were reconciled; Integration Status pending/failed changed `10/0 -> 0/0`. Ten audit activities were recorded; email/segment outboxes, consolidated jobs, snapshots, bills, inventory, products, returns, Store Credits, accounting, settings, and business-day state were unchanged. No sender/network delivery ran. SQLite integrity `ok`, foreign-key violations `0`. Production DB and Dropbox NOT TOUCHED; deployment/build NONE. Implementation commit SHA `0085a62098e0c0ca1458b1513fc351222b06a83b`. See `codex-reports/2026-10-01_v2_legacy_dsr_pipeline_retirement.md`.

- 2026-10-01 07:54 +05:30 - V2.0.0 focused UI/navigation/IPC audit and shortcut correction: baseline `main` HEAD `309aaa97d17a3e1c9fa32ab3f6bf7eff772c0448`, package `2.0.0`. Source tracing proved that F2-F5 called nonexistent `confirmDiscardCurrentBill` on Payment, and incomplete modal detection allowed page/save shortcuts through Store Credit/Gift Voucher and other omitted dialogs. Shortcuts now delegate to the same existing buttons and their existing guards; no mapping, cart-discard policy, PIN authority, or accounting rule was introduced. Existing modal detection now includes Store Credit, Gift Voucher, Return Reason, VVP, Day Re-open Reason, and the Day Closing lifecycle overlay. Esc invokes existing Cancel controls or stays blocked during locked processing/closing overlays. Added disposable DOM/VM regression `scripts/v2-ui-shortcut-modal-consistency-test.js` to the authoritative runner. Focused shortcut, Manager/Administrator, Remote Dashboard settings, and Return tests PASS; authoritative regression 58/58 PASS, zero failures/critical skips; syntax 192/192 PASS (one new suite/file); staged and working-tree diff checks PASS. Existing VVP/Remote Dashboard/Day Closing acceptance and business behavior preserved. Packaged shortcut/modal keyboard verification PENDING. Production/qualification DB and Dropbox NOT MODIFIED; deployment, commit/push NONE; resulting SHA NOT CREATED. Existing staged and later unstaged work preserved; final working versions must be staged before the next qualification checkpoint/build.

- 2026-09-30 - V2.0.0 Windows Remote Dashboard snapshot bounded retry: baseline HEAD `f3c69a6a34a7a7b497e88d0cc4bc98a23c948777`, package `2.0.0`. Windows runtime evidence showed `SNAPSHOT_START` 11:42:02 / `TIMEOUT` 11:42:22, then 11:42:32 / HTTP 200 `ACCEPTED` 11:42:36, then timeouts at 11:43:22 and 11:43:52 after starts at 11:43:02 and 11:43:32; the next scheduled start was 11:44:02. Each logical snapshot is built once and is allowed at most two transport attempts; retries preserve snapshot ID, generated time, body/data, identity, and `/snapshot` context while creating a fresh outer request ID, timestamp, and HMAC. `ACCEPTED`/`DUPLICATE` terminate successfully; `STALE_REJECTED` retires without retry. Retry eligibility is limited to timeout/network connection failures, existing 408/429/5xx and `SERVER_BUSY`/`UPSTREAM_UNAVAILABLE` classifications, HTTP 200 `BACKEND_ONLY`, and 404 only when Axios follow-redirects identifies final host `script.googleusercontent.com`; permanent responses including `BAD_SIGNATURE` are not retried. Snapshot request timeout is 12 seconds per attempt with a one-second retry delay (maximum 25 seconds of request-plus-delay time); scheduler cadence remains 30 seconds and single-flight coalesces overlapping calls. The Gateway push/event path and all billing/business logic are unchanged by this implementation. Focused snapshot/settings tests passed; complete deterministic regression passed 57/57 suites and 191/191 syntax checks; `git diff --check` passed. Production DB and Dropbox originals were not touched. Runtime acceptance remains pending; resulting SHA not yet created; no commit or push.

- 2026-10-01 - V2.0.0 Remote Dashboard Clear Configuration focus/navigation correction: the clear flow now uses the existing parented asynchronous Electron confirmation and activation/renderer-focus restoration path instead of synchronous browser `confirm()`. After Administrator authorization and successful clear, KLBS stays on the Remote Dashboard detail page and refreshes its unconfigured state. Manual Windows acceptance passed for immediate Administrator PIN keyboard input without Alt+Tab, Cancel preserving configuration, successful clear, and staying on the detail page. Focused Remote Dashboard/Administrator/navigation tests passed; the complete deterministic regression passed 57/57 suites and 191/191 syntax checks. No authorization, business rules, production DB, or Dropbox changes; no deployment, commit, or push.

- 2026-10-01 04:12 +05:30 - V2.0.0 VVP Return exclusion / mixed-bill safety: starting baseline `main` HEAD `309aaa97d17a3e1c9fa32ab3f6bf7eff772c0448`, package `2.0.0`. Product Master `products.variable_value` is exposed in Return lookup and used by the renderer to keep every original line visible while showing VVP Return Qty as `0` and disabled. The Return service independently rejects an authoritative VVP Product Master item before monetary calculation, regardless of renderer-supplied flags. Normal-only returns preserve their existing accounting; a mixed bill can return multiple normal SKU lines while excluding VVP. Isolated Return regression proves VVP-only and mixed normal+VVP forged requests reject atomically without Return, Return Item, inventory, or Store Credit writes; normal SKU zero, fractional, and over-sold quantity validation remains unchanged. Modified: `src/database/returnService.js`, `src/renderer/app.js`, `scripts/v1-return-reason-regression-test.js`, and this ledger. Focused Return, Store Credit, VVP sale/downstream, billing, inventory, and GST tests passed. Complete regression: 57/57 suites PASS; syntax: 191/191 PASS; `git diff --check` PASS. Manual Windows mixed-bill UI acceptance PASS: VVP/Generic remains visible with Return Qty `0` disabled, and normal non-VVP lines retain editable Return Qty. Production DB, qualification DB, and Dropbox NOT MODIFIED; deployment NONE; commit/push NONE; no resulting SHA created. Since source changed after pre-packaged qualification checkpoint `309aaa97d17a3e1c9fa32ab3f6bf7eff772c0448`, a new qualification checkpoint/build is required.

- 2026-09-29 - REL-04A Windows RC sync/preflight: clean Windows SHA `5aaaa75a1e3eec106dd66054cd10508748aa8421` was fetched and fast-forwarded to frozen V2.0.0 RC SHA `f3c69a6a34a7a7b497e88d0cc4bc98a23c948777`; package and lock versions are 2.0.0. Node/npm were v24.19.0/v11.17.0, installed Electron/sqlite3/electron-builder were 42.5.0/6.0.1/26.15.3, and no better-sqlite3 dependency is used. The preserved V1.0.0 installer SHA-256 is `63951ac51e09b1151970a0477b5957bf236b8816c580f32834f514cbd479a170`. Production DB/configuration were untouched; V2 application launch and build were not performed. Windows qualification remains pending.

- 2026-09-29 - REL-04B full Windows V2 source regression: frozen RC `f3c69a6a34a7a7b497e88d0cc4bc98a23c948777` and package `2.0.0` verified. Latest valid Dropbox source was `C:\Users\USER\Dropbox\KAIRA LUXE\KLBS Backups\KL_Backup_2026-09-29_13-43-11_7124_2_29a8be171adc.zip`, modified `2026-09-29 13:43:11 +05:30`, 163,306 bytes, SHA-256 `2034A25F5A55A7779F150FC4014E15F03D37A94A04C13D52E6E5B1DCC92AD14D`; backup metadata identifies scheduled automatic KLBS backup created `2026-09-29T08:13:11.274Z`, app `1.0.0`, Windows, Electron `42.5.0`. Protected qualification archive copy under `D:\KLBS\Windows-Qualification` matched the source hash; extracted disposable DB SHA-256 is `C41C7E19BB12F5C73B25292D0F537AD9E06A11C6443FCE33BBEC632EA883CF46`. Preflight integrity was `ok`, `user_version=0`, KLBS schema metadata version `3`, current business date `2026-09-29 OPEN`, prior dates closed, and latest bill date `2026-09-27`. The current authoritative runner executed 57/57 suites PASS and 190/190 JavaScript syntax checks PASS; `git diff --check` passed. No V2 build, installer, application launch, live AppData access, Dropbox modification, production backup modification, printer change, or V1 installer change occurred. REL-04B FULL WINDOWS V2 SOURCE REGRESSION PASS; packaged/UI/hardware/live-integration gates remain separately manual.

- 2026-09-29 - REL-05A V2.0.0 Windows clean build: frozen RC `f3c69a6a34a7a7b497e88d0cc4bc98a23c948777`, package/lock `2.0.0`, and REL-04B evidence (`57/57` automated suites, `190/190` syntax checks) reverified. The obsolete repository `dist` was removed only after recording 174 files and 605,493,815 bytes. `npm.cmd run dist` using electron-builder `26.15.3` completed successfully after the required network-enabled rerun; new dist contains 173 files and 605,769,151 bytes. V2 installer `KairaLuxeBillingSetup-2.0.0.exe` is 117,215,472 bytes with SHA-256 `78B9F644AABDFD3B618E529AE0EBB3B5C0E38FD79CD1F3EC0D0BD309BD58BC4D`; packaged executable `KAIRA LUXE BILLING SYSTEM.exe` is 232,351,232 bytes with SHA-256 `E4AE95B005F24B7EA97FE9D07F86ED110F1E09C233AD4F0F6EB095490D6CAC4F`. Blockmap, `latest.yml`, and builder debug metadata were generated; no V1 artifacts remain in dist. Protected V1 installer remains SHA-256 `63951ac51e09b1151970a0477b5957bf236b8816c580f32834f514cbd479a170`. No application launch, install, database/configuration access, fixture access, printer change, commit, or push occurred. REL-05A V2.0.0 WINDOWS CLEAN BUILD PASS.

- 2026-09-29 — V1.1.0 was the internal development-cycle version. After REL-02 Full Mac V1.1 Regression passed with 75/75 reconciled regression cases, the accepted V1.1 development baseline was promoted to the intended major production release, V2.0.0. This commit is a release candidate; Windows qualification remains pending and no production deployment has occurred.

- 2026-09-29 - REL-05B Windows win-unpacked isolated qualification preparation/launch: frozen RC and V2 hashes verified. Packaged source forbids `KLBS_DEV_DATABASE_PATH` and resolves its DB as `app.getPath("userData")\\billing.db`; launch used `--user-data-dir=D:\\KLBS\\Windows-Qualification\\REL05B_WIN_UNPACKED`. REL-04B baseline hash `C41C7E19BB12F5C73B25292D0F537AD9E06A11C6443FCE33BBEC632EA883CF46` matched the new copy before setup. Only the disposable copy's backup location was redirected to its qualification-owned `Backups` folder. V2 launched as PID 2640, remained responsive, created runtime/log/cache state only under the qualification user-data directory, and migrated schema metadata `3 -> 4`; integrity check was `ok`. Production AppData DB metadata remained size `1,175,552` and last-write `2026-09-29T14:39:39.7307547+05:30`; no production DB contents were opened. No installer, installed V1, live business transaction, backup, printer, DSR, email, or restore operation was performed. REL-05B is awaiting manual UI acceptance.

- 2026-09-29 - REL-05B finalization: user manual UI acceptance PASS for Startup Splash, EULA, Dashboard at production scaling, F2/F3/F4/F5/F6 navigation, Esc Back, and representative modal rendering. The V2 win-unpacked process terminated normally. Final disposable DB integrity was `ok`, KLBS schema metadata remained `4` after valid migration `3 -> 4`, and final REL-05B DB SHA-256 was `02D98EB92BCE7A987C642D6BCBBB23AA8E28F6E2714E622D1681B62CA2F10505`. REL-04B baseline remained `C41C7E19BB12F5C73B25292D0F537AD9E06A11C6443FCE33BBEC632EA883CF46`. Live production DB filesystem metadata remained unchanged at 1,175,552 bytes and `2026-09-29T14:39:39.7307547+05:30`; contents were not opened, queried, copied, or hashed. Protected V1 installer, V2 artifacts, source/package state, Dropbox, production backup folders, and installed V1 remained unchanged. REL-05B WINDOWS WIN-UNPACKED ISOLATED QUALIFICATION PASS.

- 2026-09-29 - REL-05C-PUSH Windows packaged V2 push qualification preflight: frozen baseline verified (`main`, HEAD/origin `f3c69a6a34a7a7b497e88d0cc4bc98a23c948777`, package `2.0.0`, packaged EXE SHA-256 `E4AE95B005F24B7EA97FE9D07F86ED110F1E09C233AD4F0F6EB095490D6CAC4F`). Qualification stopped before V2 launch because the existing Windows Remote Dashboard configuration was unavailable: no `remoteDashboard` section in the existing integration store and no required endpoint/installation-secret environment values. No production DB access beyond metadata, no isolated V2 launch, no event tests, and no source/package/backend changes occurred. See `codex-reports/2026-09-29_rel05c_windows_v2_push_notification_qualification.md`. REL-05C-PUSH FAIL — CONFIGURATION BLOCKER.

- 2026-09-29 - Remote Dashboard integrations UI implementation: starting RC `f3c69a6a34a7a7b497e88d0cc4bc98a23c948777`, package `2.0.0`. Confirmed Windows hidden-input TTY provisioning defect; replaced normal GUI operation's dependency on terminal provisioning with an Administrator-authorized Settings workflow using existing Email/DSR patterns, safeStorage ciphertext, redacted technical/Activity Log events, existing signed `/snapshot` Test Connection, and isolated clear/reconfigure semantics. Focused Email/DSR, Remote Dashboard runtime, and new settings/security tests passed; `git diff --check` passed. No billing DB/schema, backend, Apps Script, Cloudflare, installer, packaged runtime, production configuration, commit, or push was touched. Manual UI/real-endpoint acceptance and later isolated push qualification remain pending. REMOTE DASHBOARD INTEGRATIONS UI AWAITING USER ACCEPTANCE.

- 2026-09-30 - Integrations UI CSS consistency repair: fixed A-01 Configure-button overflow risk introduced by the three-column Email/DSR/Remote Dashboard overview using a scoped `.integration-card .dashboard-btn { width:100%; max-width:360px; box-sizing:border-box; }` rule. B-01 Remote security-note emphasis and intentional Remote-only identity/Advanced/error-state differences were retained. Email/DSR, Remote Dashboard settings/runtime, syntax, CSS-contract, and `git diff --check` validations passed. Current source was restarted only in the approved isolated qualification userData/DB; no production DB/configuration, Dropbox, backend, installer, commit, or push was touched. Manual visual acceptance remains pending.

- 2026-09-30 - Integrations UI acceptance correction and isolated test-pipeline cleanup: user rejected the three-column overview; `.integration-summary-grid` was restored to two equal columns, preserving DOM order Email & Backup, Daily Sales Report, Remote Dashboard so Remote Dashboard appears directly below Email & Backup. In the isolated qualification DB only, a safety copy was created and disposable `remote_dashboard_outbox` (1 row), `integration_outbox` (28 rows), `segment_dsr_outbox` (14 rows), and `consolidated_reporting_jobs` (0 rows) were cleared. Bills, bill items, inventory transactions, returns, store credits, Day Closing snapshots, products, and customers were preserved; immutable Day Closing delivery statuses were not falsified. SQLite integrity remained `ok`; focused integration/runtime tests and syntax checks passed; no production DB/configuration, Dropbox, backend, installer, commit, or push was touched. Manual visual acceptance remains pending.

- 2026-09-30 - Remote Dashboard connection/UI diagnosis: isolated qualification log evidence identified the failed Test Connection response as upstream Web App `BAD_SIGNATURE` during the signed `/snapshot` request; no backend change was made. The Remote Dashboard `&middot;` renderer escaping defect was corrected to a real middle-dot character. Temporary sanitized terminal diagnostics were added for unpackaged development runs and regression-tested for secret/header redaction; packaged runs suppress terminal diagnostics. The transient Admin PIN input symptom was not deterministically proven from source/log evidence and was not guess-fixed. Production DB/configuration, secret material, Dropbox, backend, commit, and push were untouched.

- 2026-09-30 - Remote Dashboard final runtime cleanup: distinguished intentional app-wide 30-second background `/snapshot` polling (`SNAPSHOT_*`) from deliberate GUI Test Connection operations (`TEST_CONNECTION_*`); no extra page-open polling was introduced. Preserved HTTP response classifications through failure logging so HTTP 404/BAD_SIGNATURE remain `PERMANENT_FAILURE` rather than becoming `TRANSPORT_ERROR`, while timeout/DNS failures remain transport classifications. Restored Remote Dashboard successful Save to the accepted Email/DSR behavior: refresh the saved detail page in place without automatic Test Connection or navigation to Integrations overview. Windows qualification reported Web App Test Connection PASS, real KLBS_STARTED Gateway push PASS with user notification received, persistence across restart PASS, and two-column visual PASS. No production/backend/Dropbox changes, commit, or push. Release remains uncommitted pending review.
- 2026-09-30 - Splash telemetry alignment polish: corrected the telemetry row to share a text baseline while keeping `VISUAL TELEMETRY` left-anchored and right-aligning the existing animated telemetry within the available row width. Telemetry generation, animation timing/content, splash geometry, and business behavior were unchanged. No production resources, backend, commit, or push were touched; visual review remains pending.

- 2026-09-30 14:34 +05:30 - V2.0.0 F&F/Gift Voucher Manager modal CSS consistency correction: baseline `main` HEAD `f3c69a6a34a7a7b497e88d0cc4bc98a23c948777`, package `2.0.0`. The approved Stock Inward/Stock Outward Manager Access popup remained the visual authority and was not functionally altered. The dedicated `#ffPinDialog` retained its existing IDs, wording, FF/GIFT_VOUCHER authorization purposes, PIN validation, grant flow, and TTL behavior; only title presentation was aligned to the approved Manager modal (`.83em 0 6px` margin, 700 weight, normal line-height). The existing Manager/Admin separation regression test was minimally extended to protect geometry, wording, dedicated-dialog architecture, and both Manager purposes. Targeted Manager/Admin, authorization TTL/grant safety, billing, Store Credit, and VVP tests passed; syntax and `git diff --check` passed. Manual visual acceptance at Windows 100%/150% scaling remains required. No production DB/configuration, Dropbox, secrets, business logic, commit, or push was touched.

- 2026-09-30 - V2.0.0 F&F Manager Access exact visual-match implementation: root cause was confirmed from the actual cascade and DOM: `#ffPinDialog` used a separate `ff-pin-lock`/`ff-pin-box` CSS system, a plain `🔒` icon, placed `ffPinError` after the PIN field, used `dialog-error`, and retained target-only focus/button overrides; the approved Stock Manager modal uses `admin-lock`/`pin-box`, `🔐`, an `admin-error` reservation before the PIN field, and shared Manager presentation rules. The target now reuses the canonical presentation classes/rules through `manager-authorization`, preserves its dedicated IDs and handlers, adds the same error-icon presentation, and removes duplicate target-only geometry CSS. The reference Stock Inward/Outward workflow and all authorization/business logic remain untouched. Manager/Admin, FF/Gift Voucher purpose mapping, authorization TTL/grant safety, authoritative billing, Store Credit, VVP, syntax, and `git diff --check` passed. Windows visual acceptance remains required; no commit or push.

- 2026-09-30 - V2.0.0 Windows final functional regression pre-commit qualification: baseline `main` HEAD `f3c69a6a34a7a7b497e88d0cc4bc98a23c948777`, package `2.0.0`, and isolated qualification DB `D:\KLBS\Windows-Qualification\REL05C_REMOTE_DASHBOARD_UI\userData\billing.db` verified. Required safety copy was created at `D:\KLBS\Windows-Qualification\REL05C_REMOTE_DASHBOARD_UI\userData\billing.db.codex-precommit-20260930-safety-copy` with SHA-256 `B1C25A9CAE23F6564E25F7BA970956A8A30C7D0E46148A9A4942985F2A6637F0`; integrity `ok`, KLBS schema metadata version `4`, and baseline counts were preserved. The complete safe automated runner passed `57/57` suites and `191/191` JS syntax checks; V2-specific VVP SALE, GST reconciliation, EULA, supported Store Credit/returns, Product Master, restore authority, Day Closing, DSR, security, logging, and Remote Dashboard settings/runtime tests passed. One Product Master file-picker contract test was reconciled as a stale exact-source-shape assumption; the actual Product Master suite passed. Real isolated GUI visual, POS-80 printer, and unavoidable external BILL_SAVED notification observations remain manual. Splash telemetry alignment remains `USER VISUAL PASS` from 30 September 2026. Production DB/configuration, Dropbox originals, backend, commit, push, build, installer, and production were untouched. See `codex-reports/2026-09-30_v2_windows_final_functional_regression_precommit.md`. Release state: regression passed; manual gates remain.

- 2026-09-30 - V2.0.0 Remote Dashboard snapshot retry contract correction: baseline HEAD `f3c69a6a34a7a7b497e88d0cc4bc98a23c948777`, package `2.0.0`. Root cause: retry outer `request_id` changed while body `request_id` remained stale, so Apps Script rejected the retry before duplicate comparison. Each attempt now signs a shallow per-attempt body copy with matching fresh outer/body IDs (`R1/R1`, then `R2/R2`), while the logical snapshot remains frozen. The lost-ack sequence was demonstrated in isolated qualification runtime: attempt 1 timed out at `2026-09-30T16:37:11.397Z`; attempt 2 returned HTTP 200 `DUPLICATE` at `2026-09-30T16:37:18.375Z` and terminal success followed, with no `REQUEST_ID_MISMATCH` or third attempt. `KLBS_STARTED` push and normal/subsequent snapshots returned `ACCEPTED`. The exact retryable ContentService 404 classifier requires final URL `https://script.googleusercontent.com/macros/echo`; other 404s remain permanent. Deterministic regression passed 57/57 suites, 191/191 JavaScript syntax checks, and `git diff --check`. Push implementation is unchanged. Snapshot retry runtime acceptance PASS; underlying Apps Script/Google response and dashboard initial-load latency remain OPEN. Production DB and Dropbox NOT TOUCHED; deployment NONE; commit/push NONE; resulting SHA NOT YET CREATED. See `codex-reports/2026-09-30_remote_dashboard_snapshot_retry_contract_correction.md`.

## Billing and invoicing

- Barcode-based product lookup and billing
- GST-aware invoice calculation and finalisation
- Cash, UPI, card, and permitted split-payment workflows
- Customer capture and invoice history
- Thermal receipt and invoice printing where a supported printer is available
- Payment allocation and controlled payment corrections

## Inventory management

- Product master and Excel-based product import
- Barcode, category, brand, size, colour, pricing, and stock information
- Traceable inventory transactions for opening stock, inward, sales, returns, damage, adjustments, and supplier returns
- Stock inward and outward workflows with authorization and stock protection

## Returns, exchange, and Store Credit

Returns remain traceable to the original bill and can support eligible return, exchange, and Store Credit workflows.

- One active ISSUED Store Credit is maintained per customer mobile number.
- Subsequent eligible returns add to the same active Store Credit.
- The original issue date and 180-day validity remain unchanged.
- Redemption consumes the entire selected Store Credit balance.
- Store Credit may be combined with other permitted payment methods for the remaining bill amount.
- Redeemed Store Credit must not become available again.

## Business Day and Day Closing

Business Day controls support operational continuity, Day Closing, day-close summaries, and controlled Day Re-open actions. Day Closing records the relevant sales, payment, return, and inventory-facing business information for the closed day.

## Dashboard and Reports

The dashboard and reports provide operational visibility into sales, bills, customers, inventory, GST-related information, returns, Store Credit, and business-day activity. Report and Activity Log exports are subject to the application's authorization and audit controls.

## External integration and persistent Integration Outbox

Configured external integrations can queue work in a persistent Integration Outbox. Queued work can be retried when connectivity is available, helping local business operations remain usable while an external service is temporarily unavailable. External integrations may require internet access and their own accounts or service availability.

## Backup and Recovery

KLBS provides manual backup, backup history, backup-location selection, backup validation, restore, and pre-operation protection for relevant recovery workflows. Operators are responsible for selecting an appropriate destination, protecting backup files, and verifying that backups are available and usable.

KLBS can use a locally synchronized folder, such as a Dropbox folder, as a backup destination. Dropbox synchronization is external to KLBS; KLBS does not contain a Dropbox API integration.

## Configurable Automatic Backup

Automatic Backup can be switched **ON** or **OFF** and configured as:

- Daily
- Every 6 Hours
- Every 3 Hours
- Every 1 Hour

Daily scheduling supports a configured Backup Time. Interval modes use elapsed time from the last successful scheduled backup. Scheduled automatic-backup retention protects Manual, Day Closing, PreUpgrade, Pre-Restore, restore-source, legacy/unidentified, and unrelated files.

## Upgrade and database compatibility protection

The application protects upgrade and restore workflows with database compatibility checks and relevant pre-operation backup safeguards. Do not replace, edit, or move the live database manually. Use the application's supported backup, restore, and upgrade workflows.

## Security and authorization

- Administrator authorization is required for sensitive system settings.
- Manager authorization is required for designated operational actions, including Stock Inward/Outward and Day Re-open.
- Master security is used for designated setup and recovery functions.
- Security and authorization controls are enforced by the application; operators must keep credentials confidential.

## Activity Log

Important operational events are recorded in the Activity Log, including relevant billing, payment, inventory, return, Store Credit, backup/restore, security, integration, and business-day actions. The log supports operational traceability and controlled review/export workflows.

## Offline-first architecture

Core local operations do not require continuous internet access. Configured external integrations, synchronization, update downloads, and other external services may require internet access. Local availability does not guarantee the availability or correctness of a third-party service.

## Technology stack

- Electron
- Node.js
- SQLite3
- HTML5 and CSS3
- Vanilla JavaScript

## Supported Windows platform

Version 2.0.0 Release Candidate targets Windows 10 and Windows 11 on x64 hardware. Windows installation, printer drivers, permissions, storage, and third-party services remain subject to qualification before production release.

## Data and operator responsibilities

Operators are responsible for accurate product, customer, tax, payment, and business data; protecting credentials and backup destinations; reviewing invoices and reports; maintaining suitable storage and printer environments; and complying with applicable tax, accounting, privacy, and business requirements.

## Design philosophy

KLBS is designed around fast, clear, reliable, auditable, and offline-first retail operations. Workflows aim to provide practical operator guidance, minimize unnecessary steps, preserve traceability, and protect business state through authorization and transaction-aware persistence.

Only functionality available in this release candidate's shipped workflows is documented here. Items presented inside the application as Coming Soon are not represented as completed production features by this README.

## License

KAIRA LUXE Billing System is commercially licensed for authorized use. The software is licensed, not sold. See [EULA.txt](EULA.txt) for the End User License Agreement.

## Copyright

Copyright 2026 Himanish Patnaik
All Rights Reserved.
