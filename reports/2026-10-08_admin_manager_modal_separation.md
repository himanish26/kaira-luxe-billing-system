# KLBS V2.1.0 — V21-SEC-02 Administrator / Manager Modal Separation

**Task:** Canonical operational role presentations, implementation only.  
**Baseline:** `reports/2026-10-08_admin_manager_pin_modal_audit.md`; accepted V2.0.0 source `8a71227b7fbc4ac79398f4674018427f04650e8a`.

## 1. Audit Baseline

The pre-implementation audit found one Administrator credential authority, one Manager credential authority, one canonical `authorizePin(pin, purpose)` verifier, purpose-and-role-bound grants, a default 60-second TTL, and a 600-second TTL for `FF`. The policy has 17 Administrator purposes and 12 Manager purposes. Before this implementation there were two operational dialog components: shared `#adminDialog` and Manager-only `#ffPinDialog`.

## 2. Root Cause

`requireAdminAuthorization` in `src/renderer/app.js` kept a second hard-coded Manager-purpose array. The four Supplier purposes were missing from that list, so they displayed Administrator copy even though `authorizePin` correctly selected the Manager credential and returned the Manager error message.

## 3. Architecture Implemented

The backend policy remains the only purpose-to-role authority. The service now exposes `getAuthorizationRole(purpose)`, returning only `ADMINISTRATOR`, `MANAGER`, or `null`; it uses an own-property check so prototype property names cannot produce a role. A sender-checked `security:get-authorization-role` IPC and preload method expose this non-secret metadata to the main renderer only. No hashes, PINs, credential records, grant internals, or recovery credential information are returned.

The renderer obtains the canonical role before opening authorization presentation. It fails closed for unknown roles or lookup errors and never defaults unknown purposes to Administrator. There remains one shared structural shell, `#adminDialog`, with explicit `authorization-role-administrator` / `authorization-role-manager` state, role-specific title and PIN copy, and the existing shared `authorizePin` path. The role presentation does not grant authority; the backend verifier and protected workflow remain authoritative.

## 4. Administrator Presentation

The shell presents **Administrator Access** and **Enter 4-digit Administrator PIN** when the policy returns `ADMINISTRATOR`. The service remains responsible for wrong-PIN copy, including `Incorrect Administrator PIN.` The established primary/magenta treatment is retained.

## 5. Manager Presentation

The same shell presents **Manager Access** and **Enter 4-digit Manager PIN** when the policy returns `MANAGER`. Service-provided failure copy remains authoritative, including `Incorrect Manager PIN.` The accepted amber Manager treatment is applied only through the explicit Manager role class.

## 6. FF / Gift Voucher Treatment

The dedicated `#ffPinDialog` and its duplicate PIN verification handler were removed. Family & Friends requests purpose `FF`; Gift Voucher requests `GIFT_VOUCHER`; both use `requestAdminAuthorization` and the canonical Manager shell. The existing billing continuation functions, grant variables and lifecycle, authorization purposes, Manager validation, `FF` 600-second TTL, Gift Voucher default TTL, cancel behavior, bill cleanup, and discount/voucher workflows remain in place. No billing business rule or posting behavior was changed.

## 7. Supplier Purpose Correction

The following policy-resolved purposes now present Manager Access and submit the same purpose to the unchanged canonical verifier:

- `SUPPLIER_INVOICE_POST`
- `SUPPLIER_PAYMENT_POST`
- `SUPPLIER_OPENING_BALANCE_POST`
- `SUPPLIER_CREDIT_NOTE_POST`

They retain the existing 60-second TTL and exact-purpose/Manager-role grant binding. Supplier financial and relationship services were not changed by this correction.

## 8. Administrator and Manager Purpose Verification

The focused test checks role metadata against every key in `AUTHORIZATION_POLICY`, verifies all 12 Manager purposes, and verifies every other policy purpose remains Administrator. The presentation code selects wording solely from that returned role; no renderer Manager-purpose array remains. `DAY_REOPEN` startup recovery remains its separate Manager-labeled recovery path and was not redesigned.

## 9. CSS and V2.0 Geometry Preservation

The V2.0 security geometry remains the shared foundation in `src/renderer/styles/settings.css`, scoped to `#adminDialog.security-authorization-dialog`: centered overlay, 420px shell, 35px padding, 18px radius, existing shadow and overlay, 64px lock, 30px heading, reserved 22px error line, 60px PIN wrapper, and 50px equal-height buttons with a 15px gap. There is no geometry redesign or extra Supplier-specific security styling. Manager amber colors are semantic role overrides. Generic unrelated `.modal` consumers are not targeted by the new foundation.

Failure feedback now targets `adminDialog.querySelector(".modal-content")`, not the first document-wide `.modal-content`. The existing no-shake V2.0 appearance is preserved. The dialog has `role="dialog"`, `aria-modal`, an associated title, and a live error region described by the PIN input.

## 10. Cancel, ESC, and Focus

Opening clears the prior PIN and error, applies role copy, and focuses/selects the PIN input. A wrong PIN uses the backend's role-specific message, clears the PIN, and returns focus to the input. Cancel and Escape close only the authorization layer, resolve a pending request with no grant, clear the input, and restore the prior focus where possible. Escape during asynchronous role lookup is intercepted by the existing shortcut controller and cancels that pending request before underlying Supplier navigation can run. A grant returned after cancellation is discarded. During the existing 500ms success feedback, Cancel is disabled and Escape is consumed; protected work continues only after successful backend authorization.

## 11. Security Invariant Results

- **Role and purpose authority:** preserved; authorization still uses the single `authorizePin` implementation and policy.
- **Manager-to-Administrator / Administrator-to-Manager:** rejected by credential-role verification and exact-role grant enforcement; focused tests cover both wrong-role PINs and cross-role grant use.
- **Cross-purpose grants:** rejected; tests cover Manager FF grant against a Supplier purpose and Admin Product Import grant against a different Admin purpose.
- **Expiry and consumption:** tested; consumed and expired grants are rejected.
- **Unknown purpose:** role metadata returns `null`, renderer fails closed, and the verifier rejects the purpose.
- **PIN logging/persistence:** no renderer PIN logging or persistence was added. The focused service test confirms authorization event payloads contain neither entered test credentials nor credential/hash internals.
- **Cancel/ESC:** handlers close/cancel the authorization layer without calling the protected callback; Escape is stopped at the active modal/pending request level.

No credential columns, hashes, migrations, policy roles, or TTL configuration were changed in V21-SEC-02. `getAuthorizationRole` is read-only metadata.

## 12. Parked Audit Findings

These remain unchanged: `ACTIVITY_ARCHIVE` lacks a discovered renderer grant requester; `DSR_SYNC_RETRY` is an orphan policy purpose; equal numeric secrets may be configured independently for Admin and Manager; integrations retain same-purpose grant reuse; and the legacy `settings.ff_pin` edge case remains. Master Recovery stays a third authority with its existing six-digit setup/recovery behavior. No parked issue was activated, removed, reassigned, or redesigned.

## 13. Files Modified

V21-SEC-02 implementation/test files:

- `src/services/administratorSecurityService.js` — safe purpose-role metadata getter.
- `src/main/main.js` — sender-checked metadata IPC handler.
- `src/main/preload.js` — metadata method exposure.
- `src/renderer/app.js` — policy-driven role presentation, lifecycle, F&F/Gift Voucher consolidation, scoped failure feedback.
- `src/renderer/index.html` — semantic attributes and removal of `#ffPinDialog`.
- `src/renderer/modules/shortcuts.js` — pending lookup/active Manager modal Escape handling; obsolete FF PIN route removed.
- `src/renderer/styles/settings.css` — one scoped security geometry foundation with semantic Manager theme.
- `src/renderer/style.css` — obsolete FF-only error selector removed.
- `scripts/r09-manager-admin-separation-test.js` — role, presentation, grant, TTL, and lifecycle coverage.
- `scripts/v21-04-expense-tracker-test.js` — corrected its stale fixture schema assertion to use `CURRENT_DB_SCHEMA_VERSION` (the same test already asserts the current version is 12).

Several of these files already contain uncommitted V21 Supplier work. That work was retained. The only change to the Expense test is the stale test-fixture version expectation; no Expense implementation was changed.

## 14. Database / Schema Confirmation

**No database or schema change.** `CURRENT_DB_SCHEMA_VERSION` remains V12. No V13, credential-column, credential-hash, or migration changes were introduced. Package version remains 2.0.0.

## 15. Tests and Results

Passed:

- `node scripts/r09-manager-admin-separation-test.js` — PASS; all policy roles, role-specific wrong-PIN messages, role-purpose grant binding, unknown purpose, expiry/consumption, event redaction, TTL, both role presentation contracts, modal consolidation, and Escape/focus source contracts.
- `node scripts/v1-authorization-grant-retry-safety-test.js` — PASS.
- `node scripts/v1-authorization-ttl-regression-test.js` — PASS; confirms `FF` 600,000ms and ordinary purpose TTL behavior.
- `node scripts/v11-admin-security-enter-key-test.js` — PASS.
- `node scripts/v21-04-expense-tracker-test.js` — PASS after making its stale schema assertion use `CURRENT_DB_SCHEMA_VERSION`.
- `node scripts/v21-05e1-management-accounting-entry-test.js` — PASS.
- `node scripts/v21-05e2-management-accounting-entry-ui-test.js` — PASS.
- `node scripts/v21-06-supplier-distributor-module-test.js` — PASS.

`node --check` passed for every JavaScript file changed by this correction: `src/services/administratorSecurityService.js`, `src/main/main.js`, `src/main/preload.js`, `src/renderer/app.js`, `src/renderer/modules/shortcuts.js`, `scripts/r09-manager-admin-separation-test.js`, and `scripts/v21-04-expense-tracker-test.js`.

`git diff --check` — PASS. No full KLBS regression was run.

## 16. Source Control Status

Branch remains `main`; package version is `2.0.0`; schema authority remains V12. The worktree remains dirty with the existing uncommitted V21 Supplier/Module #9 files and this correction's files. The known unrelated artifact was left untouched. The index is empty: nothing is staged, committed, or pushed.

## 17. Owner Retest Instructions

1. Trigger a representative Administrator action and confirm **Administrator Access**, Administrator PIN wording, and Administrator failure copy.
2. Trigger each Supplier post action, especially Add Opening Outstanding, and confirm **Manager Access**, Manager PIN wording, and `Incorrect Manager PIN.` after a wrong Manager credential.
3. Trigger stock inward/outward, Day Reopen, Expense posting, and Management Accounting post/reverse to verify Manager presentation remains consistent.
4. Apply Family & Friends and Gift Voucher in a test bill; confirm the shared Manager presentation opens and each existing billing workflow continues after authorization.
5. Cancel and press Escape from the role modal; confirm only that authorization layer closes and the underlying screen remains in place.
6. Try an invalid/unknown purpose through the focused test contract; confirm no authorization modal defaults to Administrator.
7. Confirm the accepted V2.0 geometry and Admin magenta / Manager amber presentation remain visually unchanged.

These steps request presentation/workflow retest only; do not post financial test transactions solely to populate data.

## 18. Final Verdict

**V21-SEC-02 PASS — READY FOR OWNER ADMINISTRATOR / MANAGER MODAL RETEST**

No files were staged, committed, or pushed. Module #9 closure, Owner Pass, and production readiness are not claimed.
