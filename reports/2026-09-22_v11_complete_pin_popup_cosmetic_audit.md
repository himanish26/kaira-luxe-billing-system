# KLBS V1.1.0 Complete Current PIN Popup Cosmetic Audit

## Audit Metadata

- Repository: `D:\KLBS\kaira-luxe-billing-system`
- Branch: `main`
- HEAD: `bec9a126cb6a56ba1daeeb121d86a7b00d15396d`
- Package version: `1.1.0`
- Scope: read-only inventory and cosmetic design audit only
- Database access: none
- Live network/email/DSR access: none
- Implementation: none

## Executive Summary

The authoritative authorization policy is internally consistent for the core operations:

- Manager: `FF`, `GIFT_VOUCHER`, `INVENTORY_INWARD`, `INVENTORY_OUTWARD`, `DAY_REOPEN`.
- Administrator: all reporting/export, settings, inventory reset, restore/update, integration, DSR retry, payment correction, and Manager-PIN-management purposes.

The normal Administrator popup is the shared `#adminDialog` in `src/renderer/index.html` and is the locked visual reference. It uses the burgundy Kaira Luxe theme, shared by the normal popup CSS. It must remain unchanged.

The proven current cosmetic defect is in `src/renderer/app.js:1292`: the renderer’s display-only `managerPurpose` list contains `FF`, `GIFT_VOUCHER`, and `DAY_REOPEN`, but omits `INVENTORY_INWARD` and `INVENTORY_OUTWARD`. The inventory caller nevertheless passes the correct Manager purposes, and the main process enforces those purposes against the Manager policy. Consequently Stock Inward/Outward currently receive the correct Manager credential enforcement but show the shared popup as **Administrator Access** with an Administrator placeholder and burgundy styling.

The F&F/Gift Voucher popup is a separate `#ffPinDialog`. Its wording is Manager-oriented, but its title is `Manager Authorization`, its primary button is `Verify`, its structure differs from the accepted Administrator popup, and its title/buttons use the burgundy `--primary` styling. Its input focus uses an amber color. It is therefore not the proposed standard Manager popup.

The safest future change is a presentation-only role modifier on the existing shared `#adminDialog`, driven by the authoritative Manager-purpose classification or a complete renderer presentation map. The Administrator DOM, default class, selectors, dimensions, behavior, and burgundy defaults must remain byte/functionally unchanged. The dedicated F&F/Gift Voucher flow should retain its grant and workflow behavior while receiving only an isolated Manager presentation treatment if it is included in the later cosmetic scope.

## Current Authorization Policy Inventory

Authoritative policy source: `src/services/administratorSecurityService.js:9-31`. Authorization is resolved by `authorizePin()` at lines 268-301; the level selects `manager_pin_hash` or `admin_pin_hash` at lines 272-286. Grants carry purpose, level, and TTL; ordinary purposes use 60 seconds and `FF` uses 600 seconds at lines 74-82 and 157-174. No PIN values or hashes were accessed.

The main-process enforcement boundary is `src/main/main.js:197-205` (`requireSecurityGrant` / `requireIntegrationSession`) and `src/main/main.js:1035-1053` for security IPC. Business handlers enforce the purpose again at their specific IPC boundary.

| Purpose | Action / protected operation | Credential | Renderer reachability and caller | Authorization path | Current presentation |
|---|---|---|---|---|---|
| `FF` | Family & Friends discount | Manager | `app.js:4057-4115`, dedicated popup | `administratorSecurity.authorizePin(..., "FF")`; main commits grant in bill flow `main.js:1302-1397` | Dedicated `#ffPinDialog`; `Manager Authorization`; `Enter 4-digit Manager PIN`; `Cancel` / `Verify`; burgundy primary |
| `GIFT_VOUCHER` | Gift Voucher application | Manager | `app.js:4120-4189`, same dedicated popup | `authorizePin(..., "GIFT_VOUCHER")`; grant reserved/committed in `main.js:1305-1397` | Same dedicated popup and wording; burgundy primary |
| `INVENTORY_INWARD` | Stock Inward | Manager | `modules/inventory.js:925-935` calls `requestAdminAuthorization` | `main.js:1148-1161` requires exact purpose; inventory service receives sanitized data | Shared normal popup, currently incorrectly presented as Administrator |
| `INVENTORY_OUTWARD` | Stock Outward | Manager | `modules/inventory.js:938-948` calls `requestAdminAuthorization` | `main.js:1182-1195` requires exact purpose; inventory service receives sanitized data | Shared normal popup, currently incorrectly presented as Administrator |
| `DAY_REOPEN` | Normal in-app Day Re-open | Manager | `modules/system/dayClosing.js:809-845` requests shared popup after reason | `main.js:3179-3187` requires grant; startup path also uses same purpose at `main.js:800-810` | Shared popup correctly presented as Manager |
| `PAYMENT_CORRECTION` | Payment correction | Administrator | `app.js:7461-7475` | `main.js:1661-1666` requires grant | Shared Administrator popup |
| `CUSTOMER_REPORT_EXPORT` | Customer purchase report export | Administrator | `modules/reports.js:113-125`, request at approximately 236/427 | `main.js:2177` requires grant | Shared Administrator popup |
| `BILL_SUMMARY_REPORT_EXPORT` | Bill Summary export | Administrator | `modules/reports.js:129-157`, request at approximately 236/427 | `main.js:2180` requires grant | Shared Administrator popup |
| `RECEIPT_SETTINGS` | Receipt footer/settings | Administrator | `app.js:1067`; default purpose at `app.js:1282-1287` | receipt settings handler in `main.js` | Shared Administrator popup |
| `PRODUCT_IMPORT` | Product import | Administrator | `modules/inventory.js:856-?` | `main.js:1060-1065` | Shared Administrator popup |
| `INVENTORY_RESET` | Inventory reset | Administrator | `modules/inventory.js:917-?` | `main.js:1267-1272` | Shared Administrator popup |
| `BACKUP_LOCATION` | Backup location setting | Administrator | `modules/system/backup.js:197` | settings handler in `main.js` | Shared Administrator popup |
| `AUTO_BACKUP_SETTINGS` | Automatic backup settings | Administrator | `modules/system/backup.js:12-29` | settings handler in `main.js` | Shared Administrator popup |
| `RESTORE` | Restore backup | Administrator | `modules/system/restore.js:78-95` | `main.js:2581` | Shared Administrator popup |
| `INSTALL_UPDATE` | Install/download update | Administrator | `modules/system/updates.js:202` and `305` | `main.js:2762-2800` | Shared Administrator popup |
| `ACTIVITY_EXPORT` | Activity Log export | Administrator | `modules/system/activitylog.js:175-184` | `main.js:2915-2940` | Shared Administrator popup |
| `ACTIVITY_ARCHIVE` | Activity Log archive | Administrator | main handler `main.js:2969-2985`; no renderer caller found in current source search | `requireSecurityGrant` | No current renderer PIN surface found |
| `DSR_SYNC_RETRY` | DSR retry | Administrator | main handler `main.js:3216`; no current renderer caller found in current source search | `requireSecurityGrant` | No current renderer PIN surface found |
| `INTEGRATION_EMAIL_SETTINGS` | Email integration settings/test | Administrator | `modules/system/integrations.js:62-87` | `requireIntegrationSession` / policy | Shared Administrator popup |
| `INTEGRATION_DSR_SETTINGS` | DSR integration settings/test | Administrator | `modules/system/integrations.js:62-87` | `requireIntegrationSession` / policy | Shared Administrator popup |
| `MANAGER_PIN_MANAGEMENT` | Configure/change Manager PIN | Administrator | `app.js:701-725` requests admin grant before settings form | `main.js:1048-1053` requires Administrator | Shared Administrator popup, then Settings form |

`AUTHORIZATION_POLICY` also defines `MANAGER_PIN_MANAGEMENT`; it is not a Manager authorization despite its name. Master PIN is not an entry in this operational-purpose map and is handled by separate startup/recovery APIs.

## Complete PIN UI Surface Inventory

1. Shared normal operational popup: `#adminDialog`, `index.html:506-565`, opened by `requireAdminAuthorization()` in `app.js:1282-1319`. It is used for every reachable policy purpose except F&F/Gift Voucher and startup/splash PIN forms.
2. Dedicated F&F/Gift Voucher popup: `#ffPinDialog`, `index.html:2237-2288`, opened and verified by `app.js:4041-4308`.
3. Stock transaction form: `#stockTransactionModal` is a post-authorization operational form, not the PIN popup. It is opened only after the shared authorization grant in `modules/inventory.js:500-607`.
4. Normal in-app Day Re-open reason modal followed by shared Manager PIN popup: `modules/system/dayClosing.js:809-845` and `app.js:1282-1319`.
5. Startup/splash Day Re-open form: `startupSplash.html:60-68`; Manager PIN input `#reopenPin`; validated and sent through `startup:reopen-closed-day` by `startupSplash.js:262-285`.
6. Startup/splash previous-business-day closing: `startupSplash.html:70-80`; Manager PIN input `#previousDayPin`; validated and sent through `startup:close-previous-day` by `startupSplash.js:306-324`.
7. Fresh/unconfigured startup security setup: splash routes to the main security page through `startup:open-security-setup`; the main renderer renders Master verification, Administrator creation, and Manager creation panels in `app.js:478-603`.
8. Security Settings Administrator PIN change: `app.js:491-515`, `securityCurrentPin`, `securityNewPin`, `securityConfirmPin`.
9. Security Settings Manager PIN change/set: `app.js:516-533`, `securityManagerPin`, `securityManagerConfirmPin`; Administrator grant is required before normal change at `app.js:701-725`.
10. Security Settings Master recovery: `app.js:534-553`, `securityMasterPin`, `securityRecoveryPin`, `securityRecoveryConfirmPin`.
11. Fresh initialization: `app.js:555-572`, Master plus new Administrator PIN; startup setup can separately require Master verification at `app.js:478-487`.
12. Reporting/export, backup/restore/update, integration, receipt, payment, inventory-reset, and activity-log PIN prompts all route through the shared normal popup when there is a current renderer caller.

## Normal Administrator Popup — Locked Reference

Source markup: `src/renderer/index.html:506-565`.

- DOM: `#adminDialog.modal > .modal-content`, with `.admin-lock`, `#authorizationDialogTitle`, `#adminError`, `.pin-box > #adminPin`, `.modal-buttons`, `#adminCancelBtn`, and `#adminUnlockBtn`.
- Default title: `Administrator Access` at `index.html:519-523`.
- Default placeholder: `Enter 4-digit Administrator PIN` at `index.html:533-539`.
- Icon: the lock glyph in `.admin-lock` at `index.html:513-517`.
- Buttons: `Cancel` and `Unlock` at `index.html:543-559`.
- Dimensions/layout: `.modal-content` width 420px, white background, 35px padding, 18px radius, shadow, centered text in `styles/settings.css:616-630`; buttons are a two-column flex row with 15px gap and 50px height at `670-690`.
- Icon sizing: `.admin-lock` 64px with 10px bottom margin at `691-697`.
- Title: `var(--primary)`, 30px, at `632-640`; current `--primary` is the burgundy Kaira Luxe theme.
- Error: `#adminError` fixed 22px height, red, 600 weight, 15px at `699-709`; failed authorization also adds `.shake` to the first `.modal-content` in `app.js:1551-1571`.
- PIN container: `.pin-box` border 2px solid `#ddd`, radius 14px, 60px height, 15px horizontal padding, margins at `settings.css:724-742`; input removes border/outline and fills the container at `752-766`.
- Focus: the input is focused and selected after opening at `app.js:1303-1310`; focus handler reselects it at `1604-1608`.
- Validation/error: main authorization service validates four digits and returns role-specific errors at `administratorSecurityService.js:268-286`; renderer displays the error, shakes, clears, and refocuses at `app.js:1524-1572`.
- Success: shared `showAuthorizationGranted()` changes the primary button to `Access Granted`, applies `.success`, hides after 500ms, clears input, restores button text, and invokes the callback at `app.js:1246-1257`.
- Keyboard: Enter clicks Unlock at `app.js:1578-1588`; Escape hides the dialog at `1610-1621`. Escape does not invoke `adminCancelCallback`, so a caller awaiting `requestAdminAuthorization()` can remain unresolved. This is a behavior risk observed during audit, not changed here.
- Paste/drop are blocked at `app.js:1592-1602`.

Every reachable Administrator purpose in the policy inventory that uses the shared popup currently inherits this reference. No Administrator visual change is recommended.

## Normal Manager Popup Findings

The shared popup dynamically changes only title and placeholder. At `app.js:1292-1297`, the Manager display list is `['FF','GIFT_VOUCHER','DAY_REOPEN']`. Because F&F/Gift Voucher use the dedicated popup, the shared list’s effective current Manager behavior is only Day Re-open. Inventory purposes are missing.

Consequences by action:

- Normal Day Re-open: correct visible title `Manager Access`, correct placeholder `Enter 4-digit Manager PIN`, but burgundy Administrator-style accent because the shared dialog has no Manager presentation class.
- Stock Inward: authoritative Manager policy and correct `INVENTORY_INWARD` grant path, but visible title `Administrator Access` and Administrator placeholder. This is a renderer presentation mapping defect, not a credential enforcement defect.
- Stock Outward: same defect with `INVENTORY_OUTWARD`.
- F&F/Gift Voucher: correct Manager wording in a dedicated popup, but not the shared Administrator structure and not the Settings amber/gold theme.

The future requirement can be met cosmetically by isolating Manager styling on the shared popup through a role modifier. The authorization purpose, grant, callback, TTL, and IPC path need not change.

## Stock Inward / Stock Outward Investigation

**Authoritative credential:** `AUTHORIZATION_POLICY` requires Manager for both purposes at `administratorSecurityService.js:12-13`.

**Call chain:**

1. `modules/inventory.js:929-931` calls `requestAdminAuthorization("INVENTORY_INWARD")`.
2. `modules/inventory.js:942-944` calls `requestAdminAuthorization("INVENTORY_OUTWARD")`.
3. `app.js:1289-1290` stores the exact purpose and later calls `window.electronAPI.administratorSecurity.authorizePin(adminPin.value, adminAuthorizationPurpose)` at `1528-1529`.
4. `preload.js:487-495` exposes the security authorization API.
5. `main.js:1035-1037` invokes `administratorSecurity.authorizePin`; the service selects the Manager hash for the policy level.
6. After grant, `main.js:1156` / `1190` independently requires the exact purpose before calling the inventory service. The grant is not trusted solely from visible UI state.

**Current visible defect:** `requireAdminAuthorization()` tests a stale/incomplete display-only list. Since neither inventory purpose is in it, the popup uses `Administrator Access` and `Enter 4-digit Administrator PIN`. The actual service still validates the Manager PIN. The defect is therefore incorrect visible wording and role presentation mapping, not CSS alone and not security enforcement.

**Minimum future presentation repair:** complete or centralize the renderer’s role presentation mapping and apply an isolated Manager modifier/accent for `INVENTORY_INWARD` and `INVENTORY_OUTWARD`. Do not alter `AUTHORIZATION_POLICY`, `authorizePin`, grant handling, IPC, or inventory handlers. No security logic change is required.

## F&F / Gift Voucher Investigation

The dedicated popup still exists at `index.html:2237-2288` and is shared by both actions. It shows:

- title: `Manager Authorization`;
- prompt: `Enter 4-digit Manager PIN`;
- placeholder: `Enter Manager PIN`;
- buttons: `Cancel`, `Verify`;
- input: `#ffPinInput`, four-digit numeric password field;
- error: `#ffPinError`;
- CSS: `#ffPinDialog` selectors in `src/renderer/style.css:971-1096`.

Its layout is 420px wide, 34px/30px padding, 18px radius, 30px title, 18px prompt, 56px input, and 52px buttons. The title uses `var(--primary)` and the buttons use the shared `.klbs-primary-btn` / `.klbs-cancel-btn`, also burgundy. Input focus is amber (`#e09a00`) at `style.css:1028-1036`. This is visually different from the Administrator popup’s lock icon, `.pin-box`, title wording, button label (`Unlock` versus `Verify`), error container, and spacing.

Both F&F and Gift Voucher use the same popup state (`pinAuthorizationAction`) and the same verification function at `app.js:4215-4308`; purpose selection is exact at `4236-4240`, and grants are stored separately for later bill submission at `4262-4270`. This dedicated behavior is necessary for the two-step bill workflows and must be preserved. Future standardization can change only presentation and labels if approved; it must not merge the workflows or alter grant reservation/commit behavior.

## Normal Day Reopen vs Startup/Splash

**Normal in-app:** The user first selects a reason in the Day Re-open reason modal (`modules/system/dayClosing.js:700-807`), then `requestAdminAuthorization("DAY_REOPEN")` at `809-824`. It uses the shared popup and currently gets Manager wording. Main IPC `reopen-business-day` at `main.js:3179-3187` consumes the Manager grant and calls the business service.

**Startup/splash:** This is a separate form, not the shared popup. `startupSplash.html:60-68` contains `#reopenPin`, label `Manager PIN`, and `AUTHORIZE & RE-OPEN`; `startupSplash.js:262-285` validates and invokes `startup:reopen-closed-day`. Previous Business Day closing uses `#previousDayPin` at `startupSplash.html:70-80` and `startup:close-previous-day` at `startupSplash.js:306-324`. Both main handlers call `authorizePin(..., "DAY_REOPEN")` at `main.js:800-829`.

Both enforce Manager PIN, but the startup/splash forms are explicitly out of scope and must not be merged with or affected by normal popup styling.

## Fresh Database / First-Run Security Setup

Startup readiness checks identify incomplete Administrator/Manager security through `statusService.js:156-170`. The splash opens security setup through `startup:open-security-setup` (`main.js:832-858`) and sends `startup:security-setup-required` to the main renderer.

The main renderer’s `showAdministratorSecurityPage()` creates the setup session UI:

- Master verification: `VERIFY MASTER PIN`, six-digit `#startupSecurityMasterPin`, `Verify Master PIN`, `app.js:478-487`.
- Administrator setup: `INITIALIZE SECURITY`, Master PIN if needed, new/confirm Administrator PIN, `Initialize Security`, `app.js:555-572`.
- Manager setup during startup session: Manager card and new/confirm Manager PIN, `app.js:516-533`, using `configureMissingStartupManagerPin` with the setup token at `app.js:722-724`.
- Startup banner: `SECURITY SETUP REQUIRED`, `app.js:591-594`.

These are Settings/security cards using `.security-card`, `.security-form-grid`, `.security-pin-input`, `.security-action-btn`, `.security-recovery-panel`, and role-specific card classes. They are not normal operational popups and are out of scope.

## Administrator / Manager PIN Settings Screens

The Settings security page is rendered in `app.js:474-603`.

- Administrator card: `.security-admin-card`, burgundy `#8B004B` border/title/button and `#6D0033` hover, `styles/settings.css:448-463`.
- Manager card: `.security-manager-card`, amber/gold `#B26A00` border/title/button and `#8A4F00` hover, `styles/settings.css:465-480`.
- Master recovery card: `.security-master-recovery-card`, blue `#1F5D9B` / `#174777`, `styles/settings.css:482-503`.
- Administrator PIN change, Manager PIN set/change, and Master recovery fields all use the broad `.security-pin-input` selector at `styles/settings.css:303-319`, but card-specific wrappers distinguish their color treatment.

These screens are visual references only and are out of scope for normal popup cosmetic work.

## Master PIN Boundary

Master PIN is six digits in current UI (`pattern="[0-9]{6}"`, `maxlength="6"`) and is used only by startup setup verification and Administrator recovery/initialization. It is not an operational authorization purpose in `AUTHORIZATION_POLICY`. The service routes Master verification through `beginStartupSetup`, `recoverPin`, and related setup/recovery methods rather than `authorizePin()`.

No Master PIN popup should be restyled as a Manager operational popup. Existing blue recovery styling and setup cards must remain unchanged.

## CSS / Shared Component Blast Radius

| Selector / component | File and lines | Affected surfaces | Shared? | Future Manager-safe? |
|---|---|---|---|---|
| `.modal-content` | `styles/settings.css:616-630` | Administrator popup and any modal that loads this stylesheet; dedicated popup receives later ID overrides | Yes | Unsafe for global change |
| `.modal-content h2`, `.modal-content p`, `.modal-content input` | `styles/settings.css:632-668` | Generic modal descendants, including Administrator and potentially other modals | Yes | Unsafe for global change |
| `.modal-buttons`, `.modal-buttons button` | `styles/settings.css:670-690` | Generic modal action rows | Yes | Unsafe for global change |
| `.admin-lock` | `styles/settings.css:691-697` | Administrator popup lock icon | Narrow | Safe only if Administrator remains untouched; do not change |
| `.admin-error` | `styles/settings.css:699-709` | Administrator popup error | Narrow | Unsafe for Administrator reference |
| `.pin-box` / `.pin-box input` | `styles/settings.css:724-766` | Administrator popup PIN container/input | Narrow | Unsafe for global change |
| `.klbs-primary-btn`, `.klbs-cancel-btn` | `style.css:1104-1157` | Administrator and F&F/GV buttons, plus any reuse | Shared | Unsafe globally; Manager modifier must override narrowly |
| `#ffPinDialog .modal-content`, `h2`, `p`, `.modal-buttons button` | `style.css:971-1096` | F&F/GV dedicated popup only | Dedicated | Safe for dedicated presentation only |
| `#ffPinInput`, `#ffPinInput:focus`, `#ffPinError` | `style.css:1012-1065` | F&F/GV only | Dedicated | Safe for dedicated presentation only |
| `.security-pin-input` | `styles/settings.css:303-319` | Startup security, Settings Administrator/Manager/Master fields | Shared within Settings | Unsafe for normal popup change |
| `.security-admin-card`, `.security-manager-card`, `.security-master-recovery-card` | `styles/settings.css:448-503` | Settings security role cards | Scoped | Do not change for popup task |
| `.reopen-panel input/select`, `.reopen-panel` | `styles/startup.css:826-880` | Startup/splash Day Re-open and previous-day panels | Scoped startup | Unsafe for normal popup change |

The minimum-blast-radius design is a role-specific class or data attribute on `#adminDialog` only, applied while opening the shared popup and removed/reset on close. Manager-only selectors should be scoped to `#adminDialog` plus that modifier. Administrator defaults must remain the current selectors and values; no global `.modal-content`, `.modal-buttons`, `.pin-box`, `.klbs-*`, or `.security-pin-input` rule should be changed.

## Role Presentation Matrix

| Surface | Action | Purpose | Credential | Current title/text | Current colour | Component | Normal popup? | Future scope | Problem / required cosmetic change | Logic change? | Files |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Operational shared popup | Settings, payment, reports, backup, restore, update, activity, integrations | Admin purposes listed above | Administrator | Administrator Access / Administrator PIN / Unlock | Burgundy | Shared | Yes | NO — reference | No change | No | `index.html:506-565`, `app.js:1282-1615`, `settings.css:616-766` |
| Stock Inward authorization | Stock Inward | `INVENTORY_INWARD` | Manager | Administrator Access / Administrator PIN / Unlock | Burgundy | Shared popup | Yes | YES | Wrong role wording and accent; use Manager title/text/accent | No | `inventory.js:925-935`, `app.js:1292-1297`, `main.js:1148-1161` |
| Stock Outward authorization | Stock Outward | `INVENTORY_OUTWARD` | Manager | Administrator Access / Administrator PIN / Unlock | Burgundy | Shared popup | Yes | YES | Wrong role wording and accent; use Manager title/text/accent | No | `inventory.js:938-948`, `app.js:1292-1297`, `main.js:1182-1195` |
| Normal Day Re-open | Re-open day | `DAY_REOPEN` | Manager | Manager Access / Manager PIN / Unlock | Burgundy | Shared popup | Yes | YES as normal Manager popup | Wording correct; accent/structure remains Administrator reference | No | `dayClosing.js:809-845`, `app.js:1282-1319` |
| Family & Friends | Apply discount | `FF` | Manager | Manager Authorization / Manager PIN / Verify | Burgundy title/buttons; amber focus | Dedicated | Yes, dedicated | YES if included in Manager presentation standard | Dedicated structure/label/accent differs; preserve workflow | No | `index.html:2237-2288`, `style.css:971-1096`, `app.js:4041-4308` |
| Gift Voucher | Apply voucher | `GIFT_VOUCHER` | Manager | Manager Authorization / Manager PIN / Verify | Burgundy title/buttons; amber focus | Dedicated/shared with FF | Yes, dedicated | YES if included | Same as F&F | No | same as above |
| Startup Day Re-open | Re-open closed day during startup | `DAY_REOPEN` | Manager | `Manager PIN`; `AUTHORIZE & RE-OPEN` | Startup theme | Splash form | No | NO — splash | Intentional separate startup surface | No | `startupSplash.html:60-68`, `startupSplash.js:262-285`, `styles/startup.css:826-880` |
| Startup previous-day close | Close previous business day | `DAY_REOPEN` | Manager | `Manager PIN`; `AUTHORIZE & CLOSE DAY` | Startup theme | Splash form | No | NO — splash | Intentional separate startup surface | No | `startupSplash.html:70-80`, `startupSplash.js:306-324` |
| First-run Master verification | Setup session start | Setup API, not policy purpose | Master | Verify Master PIN / Verify Master PIN | Settings/security theme | Inline card | No | NO — first-run | Out of scope | No | `app.js:478-487`, `main.js:880-885` |
| First-run Administrator creation | Initialize security | Setup/recovery API | Master + new Administrator | Initialize Security / PIN fields | Burgundy card / Settings | Inline card | No | NO — first-run | Out of scope | No | `app.js:555-572`, `main.js:887-892` |
| First-run Manager creation | Complete setup | Setup token API | Setup session / Administrator-authorized path | Manager PIN / Save Manager PIN | Amber/gold card | Inline card | No | NO — first-run | Out of scope | No | `app.js:516-533`, `main.js:894-898` |
| Settings Administrator change | Change Administrator PIN | `MANAGER_PIN_MANAGEMENT` grant gate + change API | Administrator | Change Administrator PIN / fields | Burgundy | Settings form | No | NO — Settings | Intentional settings UI | No | `app.js:491-515`, `styles/settings.css:448-463` |
| Settings Manager change | Change Manager PIN | `MANAGER_PIN_MANAGEMENT` | Administrator | Change/Set Manager PIN / fields | Amber/gold | Settings form | No | NO — Settings | Intentional settings UI | No | `app.js:516-533`, `styles/settings.css:465-480` |
| Master recovery | Reset Administrator PIN | Master recovery API | Master | Master Recovery / Reset Administrator PIN | Blue | Settings recovery card | No | NO — Master/recovery | Intentional separate scheme | No | `app.js:534-553`, `styles/settings.css:482-503` |
| Activity export | Export Activity Log | `ACTIVITY_EXPORT` | Administrator | Administrator Access / Administrator PIN / Unlock | Burgundy | Shared | Yes | NO | No issue | No | `activitylog.js:175-184` |
| Report export | Customer/Bill Summary | `CUSTOMER_REPORT_EXPORT` / `BILL_SUMMARY_REPORT_EXPORT` | Administrator | Administrator Access / Administrator PIN / Unlock | Burgundy | Shared | Yes | NO | No issue | No | `reports.js:113-157`, `reports.js:236-427` |
| Integration settings | Email/DSR settings | `INTEGRATION_*` | Administrator | Administrator Access / Administrator PIN / Unlock | Burgundy | Shared | Yes | NO | No issue | No | `integrations.js:62-87` |

## Errors and Inconsistencies

### A. Genuine cosmetic problems requiring future change

1. **WRONG ROLE WORDING:** Stock Inward shared popup displays Administrator wording even though policy and enforcement require Manager.
2. **WRONG ROLE WORDING:** Stock Outward has the same defect.
3. **WRONG ROLE COLOUR:** Normal Manager actions currently inherit burgundy Administrator styling; the intended Manager reference is the existing amber/gold Settings card (`#B26A00`, hover `#8A4F00`).
4. **INCONSISTENT POPUP STRUCTURE:** F&F/Gift Voucher use a dedicated popup with `Manager Authorization` / `Verify`, not the accepted shared popup’s lock/icon/layout and `Unlock` button.
5. **CSS BLAST-RADIUS RISK:** `.modal-content`, `.modal-buttons`, `.klbs-primary-btn`, `.klbs-cancel-btn`, and `.security-pin-input` are shared enough that global edits could change Administrator, F&F/GV, startup, or Settings surfaces.
6. **INPUT PRESENTATION:** The dedicated F&F/GV placeholder is `Enter Manager PIN`, while the proposed standard text is `Enter 4-digit Manager PIN`.

### B. Intentional special screens that must remain untouched

- Startup/splash Day Re-open and previous-day closing forms.
- First-run Master verification and security setup.
- Settings Administrator/Manager change cards.
- Master recovery/initialization card.
- Dedicated F&F/GV workflow behavior, grant state, and bill submission flow.

### C. Legacy/unreachable surfaces

- `ACTIVITY_ARCHIVE` and `DSR_SYNC_RETRY` are policy/main-process protected purposes with no current renderer caller found in the repository-wide search. They are not current normal popup surfaces.
- `PRODUCT_IMPORT`, `INVENTORY_RESET`, and some main handlers are reachable through renderer modules but have no separate PIN markup; they use the shared popup.

### D. Functional/security findings

The audit found no incorrect credential-level enforcement for Stock Inward, Stock Outward, F&F, Gift Voucher, or normal Day Re-open. Main-process policy and purpose-bound grant checks remain correct. One non-security behavior risk was found: Escape hides the shared popup without invoking the cancel resolver (`app.js:1610-1621` versus `requestAdminAuthorization()` at `1315-1319`), which can leave an awaiting caller unresolved. This must be handled as a separate behavior decision, not silently folded into cosmetic work.

## Surfaces Explicitly Out of Scope

- Administrator popup visual reference itself.
- Startup/splash PIN UI and startup Day Re-open/previous-day forms.
- Fresh database/first-run security setup session.
- Settings Administrator PIN, Manager PIN, and Master recovery pages.
- Master PIN UI and recovery boundaries.
- PIN hashes, credential storage, encryption, authorization service, policy, grants, TTLs, IPC, preload, main-process checks, database schema/data, business logic, and security audit logging.
- Existing legacy or unreachable protected-purpose paths except documenting them.

## Missing / Previously Unidentified PIN Surfaces

The repository-wide search found the following protected surfaces beyond the specifically named Stock, Day Re-open, F&F, Gift Voucher, and settings items:

- Customer Purchase Report export.
- Bill Summary Report export.
- Product import.
- Inventory reset.
- Receipt settings.
- Payment correction.
- Backup location and automatic backup settings.
- Restore backup.
- Application install/update.
- Activity Log export and an archive handler without a current renderer caller.
- Email and DSR integration settings/tests.
- DSR sync retry handler without a current renderer caller.
- Manager PIN management gate.

All current reachable items above use the shared normal popup unless marked as an inline/settings/startup surface. No additional PIN DOM surface was found in the current renderer source.

## Functional/Security Findings

The policy/service boundary is correct for the audited Manager actions. `authorizePin()` selects the Manager or Administrator hash from `AUTHORIZATION_POLICY`; main handlers verify the purpose-bound grant again. Normal grants use the existing 60-second TTL, and F&F retains the special 600-second TTL. No functional/security change is recommended.

The only observed functional behavior risk is the unresolved promise on Escape from the shared popup. It is outside the requested cosmetic scope and should be separately triaged before any broad authorization UI refactor.

## Recommended Future Cosmetic Change Scope

1. Preserve the Administrator popup’s existing markup, default classes, CSS values, event behavior, title, placeholder, icon, button labels, dimensions, focus, error, and success states.
2. Add only a renderer presentation classification for Manager purposes that includes `INVENTORY_INWARD`, `INVENTORY_OUTWARD`, and `DAY_REOPEN`; do not derive security from this classification. The authoritative service remains unchanged.
3. Apply a Manager-only modifier to `#adminDialog` while open. Scope every new selector under that modifier. Revert/remove it before the next open so Administrator defaults remain unchanged.
4. Set Manager title/placeholder to `Manager Access` / `Enter 4-digit Manager PIN`; use the existing Settings Manager amber/gold values only under the Manager modifier.
5. Decide separately whether F&F/GV should adopt the same visual structure. If yes, limit changes to `#ffPinDialog` markup/CSS and preserve its dedicated purpose state, Verify flow, grant storage, and bill integration. Do not merge it with Administrator logic.
6. Correct Stock Inward/Outward only through the cosmetic role mapping/modifier; their call sites and main authorization paths need no logic change.
7. Do not alter `startup.css`, `.security-pin-input`, Settings card selectors, Master/recovery selectors, or startup markup.
8. Before implementation, resolve the separate Escape/cancel behavior decision and add UI regression coverage proving Administrator defaults, Manager presentation mapping, F&F/GV workflow, and startup/Settings isolation.

## Files Likely Required for Future Change

Likely minimal future scope:

- `src/renderer/app.js`: presentation-only Manager classification/modifier for the shared popup.
- `src/renderer/style.css` or `src/renderer/styles/settings.css`: narrowly scoped Manager popup selectors, preferably in the stylesheet owning the shared popup; no global rule edits.
- `src/renderer/index.html`: only if an isolated class/data attribute cannot be applied to existing `#adminDialog`; avoid markup changes if possible.
- Focused renderer tests/fixtures if the repository’s current test pattern supports popup DOM checks.

Do not modify `administratorSecurityService.js`, `main.js`, `preload.js`, database/security migration code, startup markup/CSS, Settings security markup/CSS, or business services for this cosmetic task.

## Regression Risks

- A global `.modal-content` or `.modal-buttons` edit would change the accepted Administrator popup and potentially other modals.
- A global `.klbs-primary-btn` or `.klbs-cancel-btn` edit would change Administrator and F&F/GV buttons.
- A global `.security-pin-input` or `--primary` edit would change Settings and recovery screens.
- Treating renderer role labels as authorization policy could create a security regression; the renderer must remain presentation-only.
- Reusing the Manager class on startup/splash or Settings markup would violate the explicit exclusions.
- Merging F&F/GV into the shared popup could break purpose-specific grant state and the 600-second F&F TTL.
- Changing Escape handling during a cosmetic patch could alter callback semantics and must be reviewed separately.

## Validation Performed

Read-only commands/checks performed:

- `git status -sb`
- `git rev-parse HEAD`
- `git branch --show-current`
- `node -p "require('./package.json').version"`
- repository-wide `rg` searches for PIN, authorization, security, grant, role, unlock/access, reopen, inward/outward, and related terms
- read-only inspection of current renderer HTML/JS/CSS, preload, main IPC, authorization service, security setup, inventory, reports, activity, backup/restore/update, and integration modules

Initial validation values:

- `## main...origin/main`
- HEAD `bec9a126cb6a56ba1daeeb121d86a7b00d15396d`
- branch `main`
- version `1.1.0`

No database or database file was accessed. No destructive or live test was run.

## Files Modified by Audit

Only this report was created:

`reports/2026-09-22_v11_complete_pin_popup_cosmetic_audit.md`

No source, CSS, HTML, test, package, configuration, database, or existing dirty-worktree file was modified, deleted, staged, committed, reset, restored, checked out, cleaned, or stashed.

Final worktree status after report creation is expected to retain the pre-existing C4D files/reports plus this single new report.

## Final Verdict

**READY FOR COSMETIC IMPLEMENTATION DESIGN REVIEW**
