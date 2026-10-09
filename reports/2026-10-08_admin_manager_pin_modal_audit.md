# KLBS V2.1.0 — Administrator / Manager PIN Authorization UI Audit

**Audit type:** Read-only inspection. No source, test, database, or CSS implementation was changed. This report is the only file created for this audit.

## 1. Executive Summary

The repository has two separate operational PIN authorities stored as independent credential hashes in the `settings` row: Administrator and Manager. Both flow through one main authorization service and one shared IPC entry point. The service chooses the required role from a closed purpose policy, validates only that role's hash, and issues a short-lived grant bound to both the exact purpose and role.

There are two operational PIN modal components: `#adminDialog`, a shared Admin/Manager dialog whose title and labels are changed by purpose, and `#ffPinDialog`, a dedicated Manager dialog used for Family & Friends and Gift Voucher. Supplier actions call the shared dialog. Four Supplier Manager purposes are absent from its renderer-side Manager purpose list, producing the reported Administrator title/placeholder with the service's correct Manager error message.

The safest next implementation is two explicit role presentations backed by the same purpose policy, verifier, IPC, grant lifecycle, and shared geometry. That removes role-copy inference from purpose lists without duplicating authorization business logic. The current modal geometry agrees with the accepted V2.0.0 source inspected at `8a71227b7fbc4ac79398f4674018427f04650e8a`; the Supplier CSS added in V2.1 does not target these dialogs.

No actual PIN values are included. The initial Git snapshot is preserved; the pre-existing dirty worktree was not cleaned or otherwise changed. The requested known Dropbox-looking artifact was ignored and not inspected.

## 2. Numerical Inventory

Counts below distinguish credential authorities, submitted-PIN verifier code paths, policy purposes, DOM components, and CSS selector bundles. “CSS selector group” means a semantic bundle of related selectors in the inventory in section 9, not a count of individual selector strings.

| Inventory | Administrator | Manager |
|---|---:|---:|
| Distinct operational PIN authorities | 1 | 1 |
| Operational verification implementations that check the role's PIN | 2 | 1 |
| Authorization purposes in `AUTHORIZATION_POLICY` | 17 | 12 |
| Modal implementations serving this role | 1 shared component | 2 (one shared, one Manager-only) |
| Modal components that can present this role | 1 shared component | 2 (one shared, one Manager-only) |
| Role-specific CSS selector groups | 0 | 2 |

| Shared inventory | Count |
|---|---:|
| Shared Admin/Manager modal implementations | 1 (`#adminDialog`) |
| Shared security CSS selector groups | 9 |
| Shared operational PIN authorization helpers | 1 (`authorizePin`) |
| Detected role/UI mismatches | 4 |
| Unique operational PIN modal components | 2 |
| Additional Master PIN recovery/setup entry surfaces | 1 generated settings-page form; it is not an Admin/Manager operational authorization modal |

**Counting notes.** Operational Admin PIN check code exists in the shared purpose verifier `authorizePin` and the direct current-PIN check in `changePin`. The Manager operational PIN is checked through the Manager branch of `authorizePin`; Manager recovery/configuration validates the separate Master Recovery credential, not the current Manager PIN. `ADMIN_PIN_AUDIT_POLICY` contains audit classifications, not additional authorization purposes. The 17/12 purpose counts are keys in `AUTHORIZATION_POLICY`, including currently unreferenced/orphan purpose keys.

There is no Administrator-only operational modal; the one modal implementation serving Administrator is the shared `#adminDialog`. The Manager can use that shared dialog plus Manager-only `#ffPinDialog`. Administrator and Manager credential records are separate; the application does not appear to reject an owner configuring the same four digits for both, so the conceptual authorities are independent but the chosen secret values are not guaranteed to differ.

Master Recovery is a third credential authority for reset/startup setup, supplied to the service from `src/config/masterRecoveryVerifier`. It is not an Admin or Manager PIN and does not directly issue an operational protected-action grant.

## 3. Administrator Authority

### Canonical authority and flow

- **Credential storage:** `settings.admin_pin_hash` and `settings.admin_security_initialized`; schema declarations are in `src/database/database.js:374-377`. Credentials are stored as salted scrypt records by `src/services/credentialCrypto.js:28-47`, checked with timing-safe comparison at lines 49-84.
- **Canonical protected-action verifier:** `createAdministratorSecurityService().authorizePin(pin, purpose)` in `src/services/administratorSecurityService.js:284-318`. It resolves the role from `AUTHORIZATION_POLICY`, selects the associated hash/initialized fields, validates four digits, checks the hash, and issues a purpose/role-bound grant.
- **Direct Admin PIN verifier:** `changePin(currentPin, ...)` in `administratorSecurityService.js:355-366` checks the current Administrator credential as part of the password-change operation. This is separate from protected-purpose grant verification.
- **Renderer/preload/Main route:** `requestAdminAuthorization` in `src/renderer/app.js:1345-1393` → `window.electronAPI.administratorSecurity.authorizePin` in `src/main/preload.js:591-600` → `security:authorize-pin` in `src/main/main.js:1259-1261` → service `authorizePin`.
- **Grant enforcement:** Main's `requireSecurityGrant` consumes the grant at `src/main/main.js:222-225`; financial/accounting services can use the same injected authority. Grants must match both purpose and policy role (`administratorSecurityService.js:183-198`).
- **TTL:** 60 seconds for Admin purposes; only purpose `FF` is 10 minutes (`administratorSecurityService.js:91-98`).
- **Success:** issues a random token; the protected operation consumes it or, for integrations, validates the still-live token for repeated calls. Resource-export purposes also log resource access without PIN material (`administratorSecurityService.js:304-317`).
- **Failure:** service returns purpose-appropriate role copy such as invalid format, unconfigured role, or incorrect role PIN. Denials log role/purpose labels, not the entered PIN (`administratorSecurityService.js:131-147`, `284-303`).
- **Presentation:** shared `#adminDialog` (`src/renderer/index.html:510-565`) with `Administrator Access`, Administrator placeholder, lock emoji, Cancel and Unlock. Manager presentation is dynamically applied when the renderer purpose list matches.
- **CSS:** shared overlay in `src/renderer/styles/base.css:73-95`; shared dialog and PIN geometry in `src/renderer/styles/settings.css:619-903`; imported by `src/renderer/style.css:1-15`.

### Administrator-protected purposes (17)

| Purpose | Source-proven action / caller | Backend enforcement |
|---|---|---|
| `PAYMENT_CORRECTION` | Correct a payment split for a viewed bill; `app.js:7864` | `main.js:1974` |
| `CUSTOMER_REPORT_EXPORT` | Customer Purchase Report export; `modules/reports.js:118-120,236` | `main.js:2841` |
| `BILL_SUMMARY_REPORT_EXPORT` | Bill Summary Report export; `modules/reports.js:148-150,427` | `main.js:2844` |
| `RECEIPT_SETTINGS` | Edit receipt footer/message; `app.js:1128` | `main.js:2558-2560` |
| `PRODUCT_IMPORT` | Import Product Master file; `modules/inventory.js:850` | `main.js:1288` |
| `INVENTORY_RESET` | Reset inventory; `modules/inventory.js:911` | `main.js:1577` |
| `BACKUP_LOCATION` | Change backup folder; `modules/system/backup.js:197-224` | `main.js:2561-2563` |
| `AUTO_BACKUP_SETTINGS` | Save automatic backup settings; `modules/system/backup.js:12-25` | `main.js:2564-2570` |
| `RESTORE` | Restore backup workflow; `modules/system/restore.js:78-163` | `main.js:3245` |
| `INSTALL_UPDATE` | Download/install update; `modules/system/updates.js:201-202,304-305` | `main.js:3450,3488` |
| `ACTIVITY_EXPORT` | Export Activity Log; `modules/system/activitylog.js:175-178` | `main.js:3618` |
| `ACTIVITY_ARCHIVE` | Archive Activity Log over `activity:archive`; no renderer purpose request was found | `main.js:3660-3668` consumes grant; current UI caller not found |
| `DSR_SYNC_RETRY` | No current purpose caller or matching protected-action handler found outside policy/audit metadata | Policy-only/orphan key in inspected source |
| `INTEGRATION_EMAIL_SETTINGS` | Configure/test email integration; `modules/system/integrations.js:87,103-106` | `main.js:2450-2456,2468-2495` |
| `INTEGRATION_DSR_SETTINGS` | Configure/test DSR integration; same purpose dispatch | `main.js:2450-2456,2474-2502` |
| `INTEGRATION_REMOTE_DASHBOARD_SETTINGS` | Configure/test/clear Remote Dashboard integration; same dispatch | `main.js:2450-2456,2504-2544` |
| `MANAGER_PIN_MANAGEMENT` | Admin-authorized Manager PIN configuration; `app.js:723` | `main.js:1272-1279` |

The `ACTIVITY_ARCHIVE` backend is protected but no current renderer flow obtains its grant in the inspected tree. This is a usage gap requiring an owner/product decision before changing its authority or UI. `DSR_SYNC_RETRY` remains in the authorization and audit policy but has no live caller/handler found; it is counted as a policy purpose, not claimed as an active feature.

## 4. Manager Authority

### Canonical authority and flow

- **Credential storage:** `settings.manager_pin_hash` and `settings.manager_security_initialized`; `src/database/database.js:379-382`, with compatibility migration in `src/database/managerSecurityMigration.js:16-45`.
- **PIN validation:** the Manager branch of `authorizePin` (`administratorSecurityService.js:284-318`) uses only the Manager fields/hash. No second operational Manager PIN verifier was found.
- **Configuration:** Manager PIN configuration requires an Admin-level grant in `configureManagerPin` (`administratorSecurityService.js:320-352`) or an expiring startup setup session (`483-520`). Master Recovery can reset Manager PIN through `recoverManagerPin` (`523-570`).
- **Route:** same shared preload/Main path as Admin. Supplier APIs receive the grant and consume it against the exact purpose in `src/database/supplierDistributorService.js:128,402,418,442,473`.
- **TTL:** 60 seconds except `FF`, which receives 10 minutes. The long TTL is based on purpose, not role.
- **Success/failure:** successful validation issues role and purpose-bound token; failure message identifies Manager. A token for another role or purpose cannot pass `consumeGrant`/`validateGrant`.
- **Presentations:** Manager can use shared `#adminDialog` with `.manager-authorization`; Family & Friends and Gift Voucher use dedicated `#ffPinDialog` in `index.html:2822-2875`.

### Manager-protected purposes (12)

| Purpose | Source-proven action / caller | Actual validator | UI status |
|---|---|---|---|
| `FF` | Apply Family & Friends discount; `app.js:4251`; dedicated `ffPinDialog` verification at 4366-4391 | Manager | Correct dedicated Manager modal |
| `GIFT_VOUCHER` | Apply Gift Voucher; `app.js:4324`; dedicated modal | Manager | Correct dedicated Manager modal |
| `INVENTORY_INWARD` | Post stock inward; `modules/inventory.js:923-925` | Manager | Correct shared modal copy |
| `INVENTORY_OUTWARD` | Post stock outward; `modules/inventory.js:936-938` | Manager | Correct shared modal copy |
| `DAY_REOPEN` | Reopen business day in main flow; `modules/system/dayClosing.js:1006-1024`; startup day recovery also uses this purpose (`main.js:1021-1032,1034-1053`) | Manager | Normal flow has Manager copy. Startup recovery form is separate and explicitly labels Manager in its validation copy (`main.js:1043-1045`); inspect startup presentation when redesigning |
| `EXPENSE_POST` | Post Expense Tracker batch; `modules/expenseTracker.js:211-216` | Manager | Correct shared modal copy |
| `P_AND_L_ENTRY_POST` | Post Management Accounting entry; `modules/managementAccountingEntries.js:97-100` | Manager | Correct shared modal copy |
| `P_AND_L_ENTRY_REVERSE` | Reverse Management Accounting entry; `modules/managementAccountingEntries.js:221-228` | Manager | Correct shared modal copy |
| `SUPPLIER_INVOICE_POST` | Post Supplier Invoice; `modules/supplierManagement.js:160` | Manager | **UI MISMATCH:** shared modal says Administrator |
| `SUPPLIER_PAYMENT_POST` | Post Supplier Payment; `supplierManagement.js:168` | Manager | **UI MISMATCH:** shared modal says Administrator |
| `SUPPLIER_OPENING_BALANCE_POST` | Post Opening Outstanding; `supplierManagement.js:163` | Manager | **UI MISMATCH:** shared modal says Administrator |
| `SUPPLIER_CREDIT_NOTE_POST` | Post Supplier Credit Note; `supplierManagement.js:165` | Manager | **UI MISMATCH:** shared modal says Administrator |

All four Supplier purposes are absent from the renderer's hard-coded Manager list at `app.js:1355-1364`. Their service roles remain correct. No Manager purpose was found routed through Admin hash validation.

## 5. Complete Purpose / Role Matrix

This matrix enumerates every key in the current `AUTHORIZATION_POLICY`. “TTL” is the service grant lifetime; the resulting grant is exact-purpose and exact-role scoped. “Shared dialog” means `#adminDialog` with role copy determined by the renderer purpose array.

| Module / screen | Action | Purpose | Expected role | Actual validator | Modal title | PIN label | Wrong-PIN message | TTL | Source | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Billing | Apply Family & Friends discount | `FF` | Manager | Manager hash | Manager Access | 4-digit Manager PIN | Incorrect Manager PIN. | 10 min | `app.js:4251,4366-4396`; service `284-304` | CORRECT |
| Billing | Apply Gift Voucher | `GIFT_VOUCHER` | Manager | Manager hash | Manager Access | 4-digit Manager PIN | Incorrect Manager PIN. | 1 min | `app.js:4324,4387-4396`; service `284-304` | CORRECT |
| Inventory | Stock inward | `INVENTORY_INWARD` | Manager | Manager hash | Manager Access | 4-digit Manager PIN | Incorrect Manager PIN. | 1 min | `modules/inventory.js:923-925`; app `1355-1364` | CORRECT |
| Inventory | Stock outward | `INVENTORY_OUTWARD` | Manager | Manager hash | Manager Access | 4-digit Manager PIN | Incorrect Manager PIN. | 1 min | `modules/inventory.js:936-938`; app `1355-1364` | CORRECT |
| Day Closing / startup | Reopen closed business day; startup close-previous-day uses same key | `DAY_REOPEN` | Manager | Manager hash | Manager Access in normal flow; startup form is separate | Manager PIN in normal flow/startup validation copy | Incorrect Manager PIN. in service; startup returns same service result | 1 min | `modules/system/dayClosing.js:1018`; `main.js:1021-1053` | CORRECT (startup screen is a separate presentation to include in future review) |
| Expense Tracker | Post expense batch | `EXPENSE_POST` | Manager | Manager hash | Manager Access | 4-digit Manager PIN | Incorrect Manager PIN. | 1 min | `modules/expenseTracker.js:211-216`; app `1355-1364` | CORRECT |
| Management Accounting | Post entry | `P_AND_L_ENTRY_POST` | Manager | Manager hash | Manager Access | 4-digit Manager PIN | Incorrect Manager PIN. | 1 min | `modules/managementAccountingEntries.js:97-100`; app `1355-1364` | CORRECT |
| Management Accounting | Reverse entry | `P_AND_L_ENTRY_REVERSE` | Manager | Manager hash | Manager Access | 4-digit Manager PIN | Incorrect Manager PIN. | 1 min | `modules/managementAccountingEntries.js:221-228`; app `1355-1364` | CORRECT |
| Supplier Account | Post Supplier Invoice | `SUPPLIER_INVOICE_POST` | Manager | Manager hash | Administrator Access | 4-digit Administrator PIN | Incorrect Manager PIN. | 1 min | `supplierManagement.js:160`; app `1345-1376` | UI MISMATCH |
| Supplier Account | Post Supplier Payment | `SUPPLIER_PAYMENT_POST` | Manager | Manager hash | Administrator Access | 4-digit Administrator PIN | Incorrect Manager PIN. | 1 min | `supplierManagement.js:168`; app `1345-1376` | UI MISMATCH |
| Supplier Account | Add Opening Outstanding | `SUPPLIER_OPENING_BALANCE_POST` | Manager | Manager hash | Administrator Access | 4-digit Administrator PIN | Incorrect Manager PIN. | 1 min | `supplierManagement.js:163`; app `1345-1376` | UI MISMATCH |
| Supplier Account | Post Credit Note | `SUPPLIER_CREDIT_NOTE_POST` | Manager | Manager hash | Administrator Access | 4-digit Administrator PIN | Incorrect Manager PIN. | 1 min | `supplierManagement.js:165`; app `1345-1376` | UI MISMATCH |
| Billing | Correct payment allocation/split | `PAYMENT_CORRECTION` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `app.js:7864`; service `284-304` | CORRECT |
| Reports | Export Customer Purchase Report | `CUSTOMER_REPORT_EXPORT` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/reports.js:118-120,236`; `main.js:2841` | CORRECT |
| Reports | Export Bill Summary Report | `BILL_SUMMARY_REPORT_EXPORT` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/reports.js:148-150,427`; `main.js:2844` | CORRECT |
| Settings | Change receipt message | `RECEIPT_SETTINGS` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `app.js:1128`; `main.js:2558-2560` | CORRECT |
| Inventory / Product Master | Import products | `PRODUCT_IMPORT` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/inventory.js:850`; `main.js:1288` | CORRECT |
| Inventory | Reset inventory | `INVENTORY_RESET` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/inventory.js:911`; `main.js:1577` | CORRECT |
| Backup | Change backup location | `BACKUP_LOCATION` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/system/backup.js:197-224`; `main.js:2561-2563` | CORRECT |
| Backup | Save automatic backup settings | `AUTO_BACKUP_SETTINGS` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/system/backup.js:12-25`; `main.js:2564-2570` | CORRECT |
| Backup / Restore | Restore a backup | `RESTORE` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/system/restore.js:78-163`; `main.js:3245` | CORRECT |
| System Update | Download/install update | `INSTALL_UPDATE` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/system/updates.js:201-202,304-305`; `main.js:3450,3488` | CORRECT |
| Activity Log | Export Activity Log | `ACTIVITY_EXPORT` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/system/activitylog.js:175-178`; `main.js:3618` | CORRECT |
| Activity Log | Archive Activity Log | `ACTIVITY_ARCHIVE` | Administrator | Admin hash if a matching grant is obtained | No current renderer requester found | N/A | N/A | 1 min | `main.js:3660-3668`; policy `9-39` | UNCLEAR — NEEDS OWNER DECISION (backend endpoint has no discovered grant-requesting UI) |
| Integrations | Retry DSR sync | `DSR_SYNC_RETRY` | Administrator | Policy would select Admin hash | No current caller or protected handler found | N/A | N/A | 1 min | policy `9-39` | UNCLEAR — NEEDS OWNER DECISION (orphan policy key) |
| Integrations | Configure/test email | `INTEGRATION_EMAIL_SETTINGS` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/system/integrations.js:87,103-106`; `main.js:2450-2495` | CORRECT |
| Integrations | Configure/test DSR | `INTEGRATION_DSR_SETTINGS` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/system/integrations.js:87,103-106`; `main.js:2450-2502` | CORRECT |
| Integrations | Configure/test/clear Remote Dashboard | `INTEGRATION_REMOTE_DASHBOARD_SETTINGS` | Administrator | Admin hash | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `modules/system/integrations.js:87,103-106`; `main.js:2450-2456,2504-2544` | CORRECT |
| Security Settings | Set/change Manager PIN | `MANAGER_PIN_MANAGEMENT` | Administrator | Admin hash; service additionally requires Admin-level authorization to configure Manager | Administrator Access | 4-digit Administrator PIN | Incorrect Administrator PIN. | 1 min | `app.js:723`; `main.js:1272-1279`; service `320-352` | CORRECT |

No purpose in the matrix is found to validate through the opposite role's stored hash. The four Supplier defects are presentation mismatches, not validator mismatches.

## 6. Supplier Financial Authorization Trace

| Supplier action | Purpose | Requester | Service validator | Modal shown / copy | TTL / reuse scope |
|---|---|---|---|---|---|
| Add Opening Outstanding | `SUPPLIER_OPENING_BALANCE_POST` | `src/renderer/modules/supplierManagement.js:163` | `authorizePin` selects Manager hash; Supplier service consumes exact-purpose grant (`supplierDistributorService.js:128,418`) | `#adminDialog`; renderer list omits purpose, so Administrator Access / Administrator PIN. On rejection service says Incorrect Manager PIN. | 60-second, exact purpose/role grant; consumed by posting call, cannot authorize another purpose. |
| Post Supplier Invoice | `SUPPLIER_INVOICE_POST` | `supplierManagement.js:160` | Manager hash; service consumes exact-purpose grant (`supplierDistributorService.js:402`) | Same Administrator-copy mismatch | 60 seconds; consumed by invoice post. |
| Post Supplier Payment | `SUPPLIER_PAYMENT_POST` | `supplierManagement.js:168` | Manager hash; service consumes exact-purpose grant (`supplierDistributorService.js:473`) | Same Administrator-copy mismatch | 60 seconds; consumed by payment post. |
| Post Supplier Credit Note | `SUPPLIER_CREDIT_NOTE_POST` | `supplierManagement.js:165` | Manager hash; service consumes exact-purpose grant (`supplierDistributorService.js:442`) | Same Administrator-copy mismatch | 60 seconds; consumed by credit-note post. |

The sequence for the reported wording is:

1. Opening Outstanding calls `requestAdminAuthorization("SUPPLIER_OPENING_BALANCE_POST")`.
2. `requireAdminAuthorization` decides presentation from a renderer-side list at `app.js:1355-1364`. The list has eight keys and excludes the four Supplier keys, so it takes the Administrator title and placeholder branch.
3. Submission sends the original purpose over the shared preload method and IPC (`preload.js:593`, `main.js:1260-1261`).
4. `authorizePin` looks up the policy role for that purpose (`administratorSecurityService.js:284-303`), selects `manager_pin_hash`, and returns `Incorrect Manager PIN.` on failure.

The error comes from the authoritative validator and is accurate; title and placeholder are not. No Supplier action can use its grant for a different Supplier purpose because the service binds and consumes the token against the exact purpose and expected role.

Other Supplier action: editing Supplier profile and Brand Mapping is not represented as a PIN purpose in the inspected policy, and no authorization request was found for those edits. Do not infer a security purpose from the profile/account screen itself.

## 7. TTL / Authorization Session Behaviour

- Successful Admin and Manager checks create random 32-byte token values (`administratorSecurityService.js:173-180`). The credential is not cached; the grant is.
- Grant TTL is 60 seconds by default. `FF` is 600 seconds. The duration is selected by purpose (`91-98`), not by role.
- Grant map entries bind `{ purpose, level, expiresAt }`. `consumeGrant`, `validateGrant`, reservation, and batch consumption verify both role and exact purpose (`183-280`). Admin authorization cannot satisfy a Manager purpose; Manager authorization cannot satisfy an Admin purpose. A token cannot be repurposed between different purposes of the same role either.
- Normal protected operations call consume semantics, making grants one-use. Supplier posting consumes at the service boundary. Integration configuration endpoints use `validateGrant` rather than consumption (`main.js:228-232,2450-2544`), so one 60-second Admin-purpose token can authorize multiple calls within that exact integration purpose until expiry. This is deliberate session-like reuse in current code; no other purpose inherits it.
- On PIN changes/recovery, grant maps are cleared (`administratorSecurityService.js:344-345,376+,430,557-558`).
- `FF` receives a ten-minute grant, and its grant remains in billing state until the corresponding discount operation/cleanup; references include `app.js:4416-4421,2734-2735,2778,5906-5916`. Treat its extended lifetime and cleanup as specific to this workflow.
- Startup Master Recovery verification creates a separate setup session lasting the default 60 seconds (`443-470`), reusable for setting both missing PINs during that active setup session. It is not an Admin/Manager action grant. Master Recovery failure delay is exponential from 250 ms to a 2-second cap (`386-390`).
- There is no Admin/Manager role crossover in grant validation. A person who deliberately chooses identical numeric values for both configured PINs could enter the same digits and satisfy either independently stored hash; the service does not enforce that the secrets differ. This is credential reuse by configuration, not a cross-role grant path.

## 8. Modal Inventory

### A. Shared Admin/Manager operational modal — `#adminDialog`

- **HTML:** `src/renderer/index.html:510-565`; icon is the lock emoji `🔐`; title element `#authorizationDialogTitle`; error `#adminError`; input `#adminPin`; buttons Cancel and Unlock.
- **Controller/open:** `requireAdminAuthorization` (`src/renderer/app.js:1345-1386`) populates purpose and role copy, clears error/value, toggles `.manager-authorization`, displays the dialog, then focuses/selects the PIN input with `requestAnimationFrame`.
- **Submit:** `app.js:1608-1677`; shared preload `administratorSecurity.authorizePin` and shared service. On failure it presents returned service error, clears/refocuses input. On success it shows transient “Access Granted,” hides modal after 500 ms, and only then calls the protected-action callback with the grant.
- **Designed role:** originally Administrator; current shared role-by-purpose behavior applies Manager presentation using a client-side key list.
- **Escape/cancel:** `app.js:1663-1677` prevents default/propagation/immediate propagation and invokes Cancel. Cancel hides the modal and resolves the awaiting promise with `null`; no protected callback runs.
- **Overlay/focus:** `.modal` full-screen overlay at z-index 9999; focus moves to/selects the input on open. No explicit focus trap or `aria-modal`/dialog role is present in this markup.
- **Animation:** shared grant button success state and a 500 ms close delay; failed modal attempts to add `.shake`, but `document.querySelector(".modal-content")` at `app.js:1641-1644` targets the first `.modal-content` in document order rather than explicitly the security dialog. Security-specific CSS disables animation for the selected dialog (`settings.css:785-789`).
- **CSS:** common selectors in `base.css`, generic and security-specific rules in `styles/settings.css`; see section 9.

### B. Dedicated Manager modal — `#ffPinDialog`

- **HTML:** `src/renderer/index.html:2822-2875`; Manager Access title, lock emoji, `#ffPinError`, `#ffPinInput`, Cancel and Unlock.
- **Controller/open:** Family & Friends opens for purpose `FF` at `app.js:4208-4265`; Gift Voucher opens for `GIFT_VOUCHER` at `4275-4342`. The shared `verifyFamilyFriendsPin` at `4366-4445` maps the current billing action to the correct purpose and calls the same preload/service authority.
- **Designed role:** Manager only. Both flows label the field Manager and use Manager-specific error from service.
- **Escape/cancel:** `modules/shortcuts.js:557-569` maps Escape to the modal's cancel button and returns after one layer. Cancel clears field/error and hides it (`app.js:4344-4361`). Shortcut modal recognition includes both Admin and this modal (`shortcuts.js:831-874`).
- **Focus:** delayed 50 ms focus after opening; failure clears and refocuses (`app.js:4259-4263,4393-4404`). No explicit focus trap or dialog ARIA attributes.
- **Overlay/z-index:** shared `.modal` overlay and z-index 9999.
- **Animation/error:** common access-success transition; `style.css:16-18` inserts a red-cross prefix before a nonempty Manager modal error.
- **CSS:** shared `.manager-authorization` rules in `settings.css`; extra error prefix in `style.css`.

### C. Master Recovery/setup PIN entry — not an Admin/Manager access modal

The Administrator Security settings page dynamically inserts a six-digit Master PIN field for startup verification at `src/renderer/app.js:495-507`; recovery/configuration fields are rendered at `app.js:553-580`. Calls route through `verifyStartupMasterPin`/startup IPC (`preload.js:484`; `main.js:1104` onward) or recovery APIs, and service validates `masterVerifier` (`administratorSecurityService.js:392-470,523-570`). This is a settings-page form, not another `#modal` component and not an operational Admin/Manager PIN presentation. It must remain separately labeled if the two operational modals are separated.

**Modal conclusion:** the two operational modal components are not merely one mutable implementation. There is one shared Admin/Manager component plus one older/parallel Manager-only component. The latter is only used by F&F and Gift Voucher. Settings recovery forms are separate non-modal entry surfaces.

## 9. CSS Inventory

### Shared and role-scoped selectors

| Selector / group | File and lines | Consumers | Classification / origin | Cascade and geometry notes |
|---|---|---|---|---|
| `.modal` | `src/renderer/styles/base.css:73-95` | Both PIN dialogs and many other KLBS dialogs | Shared legacy foundation; present at V2.0 baseline | Fixed full viewport, rgba black `.45`, centered flex, z-index `9999`. Generic shared selector can affect all `.modal` components. No security-specific responsive override found. |
| `.modal-content` | `src/renderer/styles/settings.css:619-633` | Both PIN dialogs and generic modal-content consumers | Shared legacy foundation; V2.0 baseline | 420px width; white; 35px padding; 18px radius; `0 20px 60px rgba(0,0,0,.25)` shadow; centered text. Generic selector affects non-security dialogs too. |
| `.modal-content h2`, `.modal-content p`, `.modal-content input` | `settings.css:635-671` | Any modal content; PIN dialogs inherit | Shared generic selectors; V2.0 baseline | Heading 30px/primary and margin; paragraph 18px/#666; input 100%, 55px, 20px, 2px #ddd border, 10px radius. PIN-specific wrapper/input rules later supersede portions of input sizing. |
| `.modal-buttons`, `.modal-buttons button` | `settings.css:673-693`; hover transition at `828-838` | PIN dialogs and other modal buttons | Shared generic selectors; V2.0 baseline | Flex/equal buttons; 15px gap; 50px height; 18px type; hover translates up 2px. |
| `.admin-lock` | `settings.css:694-700` and security-scoped duplicate at `741-745` | Both PIN dialogs; class name says Admin but markup shares it | Shared security group; scoped duplicate existed at baseline | 64px emoji and 10px bottom margin. Later scoped rule repeats values. |
| `.admin-error` | `settings.css:702-726` and security-scoped duplicate `754-762` | Both operational PIN dialogs | Shared security group; V2.0 baseline | Fixed 22px line box, hidden overflow, no wrapping, red 15px semibold. Long text can clip; current common errors generally fit. Later scoped duplicate repeats size/margin. |
| `#adminDialog .modal-content, .manager-authorization .modal-content` | `settings.css:734-739` | Shared dialog and Manager-only dialog | Shared Admin/Manager security group; present in V2.0 baseline | Repeats 420px/35px/18px geometry; `.manager-authorization` also applies to the FF component. |
| `#adminDialog .admin-lock, .manager-authorization .admin-lock`; corresponding `h2`, `.admin-error`, `.pin-box`, `.modal-buttons` groups | `settings.css:741-783` | Both operational security modal components | Shared Admin/Manager security groups; present at baseline | Reassert icon, heading, error, input wrapper, button geometry. `#adminDialog` ID specificity and `.manager-authorization` class both serve shared design. |
| `#adminDialog .modal-content.shake, .manager-authorization .modal-content.shake` | `settings.css:785-789` | Failed PIN presentation | Shared security group; present at baseline | Sets `animation:none`, overriding generic `.shake` animation. Combined with broad JS query, visible shake may target another dialog or be suppressed. |
| `#adminDialog.manager-authorization ...`, `.manager-authorization ...` heading/buttons/focus selectors | `settings.css:791-826` | Manager shared-dialog variant and `#ffPinDialog` | Manager-specific theme group; present at baseline | Amber title/buttons/focus outline. `.manager-authorization` is also used by the FF dialog; combined selectors have specificity differences (`#adminDialog.manager-authorization` outranks class-only selector). |
| `.pin-box`, `.pin-box span`, `.pin-box input` | `settings.css:839-881` | Both operational PIN dialogs | Shared security group; V2.0 baseline | Wrapper border 2px, radius 14px, 60px high, horizontal padding 15px; input resets border, fills wrapper, 20px type. This overrides generic input height/margin/border in the wrapper. |
| `@keyframes shake`, `.shake`, `.success` | `settings.css:884-910` | Generic modal shaking and authorization button success state | Shared generic group; V2.0 baseline | `.shake` animates 350 ms; scoped security override disables animation. `.success` green background uses `!important`. |
| `#ffPinDialog .admin-error:not(:empty)::before` | `src/renderer/style.css:16-18` | Dedicated Manager dialog only | Manager-specific; present at V2.0 baseline | Prepends `❌ ` by generated content; this is a separate presentation detail not used by `#adminDialog` (whose JS includes the icon text itself). |
| Supplier mapping modal selectors `.supplier-mapping-modal-overlay`, `.supplier-mapping-modal`, descendants | `src/renderer/styles/business.css:528-541,587` | Supplier Brand Mapping modal only | V2.1-added Supplier styles; unrelated to security modal selectors | No selector targets `.modal`, `.modal-content`, `#adminDialog`, `#ffPinDialog`, `.pin-box`, or `.manager-authorization`. No direct cascade effect found. |

### CSS cascade / responsive findings

- `style.css` imports `base.css` before `settings.css`; its later inline rules include only the F&F error prefix in this area. There are duplicate declarations between generic rules and the later security-scoped block in `settings.css`; the security block makes dimensions explicit and wins where specificity/order requires.
- Global `h2` in `styles/base.css:25-30` defines a 32px default and large bottom margin. `.modal-content h2` in settings has greater specificity and defines the security modal heading at 30px. The more specific security-scoped heading rule repeats the 30px value. No additional responsive rule was found changing PIN modal geometry.
- `.modal-content input` is generic; `.pin-box input` later resets its border, margin, height, and font treatment. The enclosing `.pin-box` is the visible PIN control outline.
- No `@media` rule in the searched security/base stylesheet changes `#adminDialog`, `#ffPinDialog`, `.pin-box`, or their dimensions. Other responsive rules in `settings.css` concern integration/day-closing regions.
- No security modal inline geometry styles or JS dimension mutation were found. JS mutates display, `.manager-authorization`, field placeholder/title/error text, and button status class only.
- `z-index:9999` is shared and may be lower than some V2.1 overlays (Supplier mapping modal uses 12020 and other system overlays may use larger values), but no observed concurrent stack shows a security modal collision. This is a potential modal-stack policy issue to consider when the target modal is implemented, not evidence of current Supplier security failure.
- **Selector-group counts used above:** 9 shared bundles: overlay; shell; generic typography/paragraph/input; button layout; security-scoped dimensions; error treatment; input wrapper/input; animation/success; duplicate security refinements for icon/title/error/actions (counted as one scoped refinement bundle). 2 Manager-only bundles: amber semantic theme/focus and F&F error prefix. 0 Admin-exclusive bundles: Admin currently uses the default/shared foundation. These counts are semantic groupings, not total CSS declarations.

## 10. V2.0.0 Baseline Comparison

Read-only inspection used baseline commit `8a71227b7fbc4ac79398f4674018427f04650e8a` with `git show` and `git diff`; the working tree was not checked out or changed.

### V2.0 geometry and appearance

At the baseline, `styles/base.css` supplied the centered full-screen `.modal` overlay with `rgba(0,0,0,.45)` and z-index `9999`. `styles/settings.css` defined the 420px white modal shell, 35px padding, 18px radius, 20/60px soft shadow, centered text, 64px lock emoji, 30px primary-color heading, reserved 22px red error line, and 60px bordered PIN wrapper. The input used 20px text; the two buttons were equal width, 50px high, 18px text, with a 15px gap. Error text sits between title and PIN field. The baseline contains no security-modal-specific responsive geometry rule.

The baseline already contains the shared scoped geometry declarations at `settings.css:728+` and the Manager amber theme. `index.html` already contains both `#adminDialog` and the Manager-only `#ffPinDialog`; the latter has Manager copy and an additional red-cross error prefix in `style.css`.

### Changes after V2.0

- The shared `#adminDialog` title and placeholder are dynamically selected by a purpose list in `app.js`. Baseline list contained `FF`, `GIFT_VOUCHER`, `INVENTORY_INWARD`, `INVENTORY_OUTWARD`, and `DAY_REOPEN`. Current list additionally includes `EXPENSE_POST`, `P_AND_L_ENTRY_POST`, and `P_AND_L_ENTRY_REVERSE`.
- Supplier purpose keys were added to authorization policy and Supplier flows, but were not added to that renderer-side list. This is the present four-purpose UI mismatch.
- V2.1 imported Supplier-specific `business.css`; inspected Supplier mapping selectors are separately named and do not target security modal selectors.
- The security geometry in `styles/settings.css` and core overlay in `styles/base.css` match the V2.0 baseline values. The current Administrator modal therefore still matches the baseline geometry. Current V2.1 CSS has not altered it based on the selector and cascade inspection.
- Existing source has both a shared purpose-driven modal and the dedicated F&F/Gift Voucher Manager modal, so separating the roles can consolidate presentation behavior while retaining one service/grant implementation.

## 11. Mismatches / Risks

1. **Four confirmed role/copy mismatches:** Supplier Invoice, Payment, Opening Outstanding, and Credit Note are Manager-authorized but shared modal title/placeholder display Administrator. This directly explains the owner's report.
2. **Purpose-to-copy duplication:** the policy's required role is authoritative, but renderer presentation uses a second hand-maintained list. The lists drifted as purposes were added.
3. **Legacy parallel Manager UI:** F&F/Gift Voucher use `#ffPinDialog`; other Manager actions use the shared dialog. This creates divergent error icon behavior, focus/cancel controller paths, and future maintenance risk.
4. **Orphan/unused purpose evidence:** `DSR_SYNC_RETRY` has no live purpose caller/handler found; `ACTIVITY_ARCHIVE` has a protected Main handler but no renderer grant requester found. Preserve these as owner decisions; do not remove/change authority as part of UI work.
5. **Legacy storage field:** schema retains `settings.ff_pin` as a legacy field. Migration hashes a valid legacy four-digit value into `admin_pin_hash` and clears the old field only when Admin security is initialized (`database.js:629-663`). If the legacy value is malformed and no valid hash initializes Admin, the migration leaves the old field unchanged. This is a residual plaintext credential-storage concern for affected legacy rows. No value was read or printed.
6. **No enforced PIN uniqueness:** separate hashes and authority selection are present, but the code allows the configured Manager digits to equal Administrator digits. Clarify whether policy expects distinct secret values; current code does not enforce distinction.
7. **Integration grants can be reused:** exact-purpose Admin grants are validated (not consumed) for multiple integration operations for up to one minute. That can permit save/test/clear calls within the same purpose session. It does not cross role or purpose.
8. **Shake targeting:** generic first-match `.modal-content` lookup can act on a different modal; current security CSS also disables its shake animation. Feedback is inconsistent, but this does not change authority.
9. **Accessibility:** operational PIN modal markup lacks explicit dialog ARIA semantics and a demonstrated focus trap. Focus does move to the input and Escape cancels.
10. **Startup recovery is a separate presentation:** startup reopen/previous-day flow goes through direct startup IPC and purpose `DAY_REOPEN`, rather than opening `#adminDialog`. Include it in future role copy review.

## 12. Security Invariant Review

| Invariant | Finding |
|---|---|
| Manager PIN must not grant Administrator authority | **Preserved by service policy/grants.** Manager purposes select Manager hash; issued grant role must match expected role. |
| Administrator PIN must not silently substitute for Manager authority | **Preserved by service policy/grants.** Admin hash is not checked for Manager purpose. A user may intentionally configure equal numeric PINs in both distinct authorities; no equality rule exists. |
| UI wording must match validator | **Violated for four Supplier purposes.** Title and placeholder say Administrator while Manager hash is checked. |
| Wrong-PIN message must match authority | **Preserved for Supplier.** Service correctly says Manager; this exposes the mismatch rather than masking it. |
| TTL scoped to correct role/purpose | **Preserved.** Tokens bind purpose/level and expiry; TTL selection is by purpose. Integration same-purpose reuse is a deliberate different consumption mode; assess with owner if session behavior is not intended. |
| Closing authorization modal must not execute protected action | **Preserved in shared dialog.** Cancel resolves null; protected callback is only called after successful service validation and grant. F&F cancellation hides modal without invoking the authorized action. |
| Escape cancels one authorization layer | **Generally preserved in observed handlers.** Shared dialog prevents propagation and clicks cancel; F&F is handled by shortcut priority and returns. The audit did not find a path where Escape approves. Startup direct forms have their own screen/IPC flow. |
| PIN values not exposed in renderer logs, Activity Log, reports, tests, or source | **No actual PIN value exposure found in inspected paths.** Service logs role/purpose outcome only; `verifyFamilyFriendsPin` comments explicitly avoid logging/storing the entered PIN (`app.js:4409-4412`). However, `settings.ff_pin` legacy persistence may retain a malformed old value in the migration edge case described above. No credential value is reproduced in this audit. |

## 13. Recommended Two-Modal Architecture

The target direction is the safest choice after inspecting the source:

1. Provide an explicit Administrator presentation and an explicit Manager presentation. Choose presentation role from the same canonical purpose policy or a narrowly exposed role lookup; do not infer it from the purpose name or maintain a second renderer list.
2. Keep `authorizePin(pin,purpose)` as the single operational verifier. Do not add duplicate Admin and Manager verification services. The service continues selecting the proper credential hash and returning role-specific errors.
3. Keep grant issue/consume/validate semantics, exact purpose+role binding, and TTL policy unchanged. A modal is presentation only and must not grant privileges by itself.
4. Use one shared structural modal component/CSS geometry foundation. Add only explicit semantic role classes/copy/theme where required. Retire or adapt `#ffPinDialog` so F&F and Gift Voucher use the same explicit Manager presentation after verifying the billing-specific callback/cancel behavior.
5. Match V2.0 geometry: 420px shell, 35px padding, 18px radius, shared overlay, icon/title/error/input/button spacing and typography. Do not introduce Supplier-specific modal geometry.
6. Treat the Master PIN settings/recovery form as its own labeled flow; it is neither modal and neither operational role.
7. Add UI contract coverage mapping every active purpose to expected role title, placeholder, and wrong-PIN copy. Include Supplier purposes and modal cancel/Escape behavior. Keep existing service tests for cross-role and cross-purpose rejection.
8. Resolve `ACTIVITY_ARCHIVE`, orphan `DSR_SYNC_RETRY`, PIN-equality policy, integration reuse duration, and legacy `ff_pin` cleanup expectations separately with owner decisions; do not fold those policy choices into a visual separation task.

## 14. Proposed Implementation Boundaries

For the next implementation, expected boundaries are:

- Renderer modal markup/controller and purpose-to-role presentation routing.
- Preload/Main only if a minimal safe role metadata lookup is needed; avoid exposing hashes or credential data.
- Security modal CSS only, preserving accepted V2.0 geometry and existing KLBS amber Manager treatment as owner-approved.
- Focused authorization UI contract tests plus existing security/service tests.

No schema, credential storage, purpose policy, Supplier relationship/accounting service, financial semantics, Product Master, or grant TTL changes are needed to fix the four UI mismatches. If the owner wants role authority changes or any unresolved purpose activated/removed, that requires a separate explicit decision.

## 15. Files That Would Need Modification

Expected for a two-presentation UI implementation, subject to the final design:

- `src/renderer/index.html` — explicit role dialog structure or shared accessible dialog shell; remove/adapt legacy duplicate modal.
- `src/renderer/app.js` — explicit role presentation/open/cancel controller and safe selection from canonical purpose role.
- `src/renderer/modules/shortcuts.js` — Escape priority only if modal identifiers/controller change; preserve one-layer cancellation.
- `src/renderer/styles/settings.css` — canonical shared geometry and narrow role-specific selectors.
- `src/renderer/style.css` — remove or relocate legacy FF-only error pseudo-element if that modal is consolidated.
- `src/main/preload.js` and `src/main/main.js` only if adding a non-sensitive role metadata IPC is necessary; prefer not to expose any new IPC if an existing safe route can supply it.
- Existing focused security test(s), especially `scripts/r09-manager-admin-separation-test.js`; add role-copy/active-purpose UI contract coverage there or in the consolidated Supplier test if that is the established fixture.

Do not modify `administratorSecurityService.js` for a presentation-only correction unless inspection during implementation proves a separate authorization defect. No database/schema file should be modified for the recommended UI work.

## 16. Tests That Would Need Modification / Addition

For the next implementation (not run as part of this audit):

- Extend `scripts/r09-manager-admin-separation-test.js` or its established focused UI fixture to enumerate active Manager and Administrator purpose labels against policy role.
- Assert Supplier Invoice/Payment/Opening/Credit Note show Manager Access and Manager PIN wording while preserving Manager validator results.
- Assert Admin purposes remain Administrator copy and Admin validator; verify both directions of cross-role grant rejection and exact-purpose grant binding.
- Cover shared/dedicated Manager actions (F&F and Gift Voucher), modal Cancel/Escape resolving no grant/action, focus placement, and no fall-through.
- Preserve tests for 60-second default TTL, 10-minute `FF` TTL, expiration, one-use consumption, and integration same-purpose validation semantics.
- Run the targeted security regression plus affected Supplier authorization UI test; no full regression is implied by this audit.

## 17. Pending Supplier UI Defects — NOT PART OF THIS AUDIT

Owner-identified pending Supplier owner-acceptance defects, deliberately not modified:

- Supplier profile `VIEW PROFILE` button clipping.
- Supplier Payment Allocation Method radio layout.

Correction 05 Brand Mapping modal and Correction 06 Supplier Account responsiveness were not changed or re-audited visually in this security-only task.

## 18. Final Recommendation

Proceed with explicit Administrator and Manager presentations that share the established V2.0 modal geometry and retain the current single purpose-policy verifier/grant authority. The immediate Supplier issue is a renderer presentation-list omission for four newly added Manager purpose keys. Fixing that as part of a full role-presentation cleanup is appropriate; do not change any purpose's backend role or TTL while doing so.

Do not claim Module #9 closure or owner acceptance from this audit. No implementation or tests were run. The initial baseline was `main`, HEAD and `origin/main` both `eaa3f0193f4cc62663388266d890e7be08e84ab8`, package `2.0.0`, schema `12`. The pre-existing dirty/untracked worktree was preserved; this report is the sole audit-created file. Nothing was staged, committed, or pushed.
