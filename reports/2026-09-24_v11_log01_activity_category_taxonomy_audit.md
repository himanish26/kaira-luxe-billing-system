# KLBS V1.1.0 LOG-01 Activity Log Category Taxonomy Audit

## 1. Git/worktree pre-state

- Repository: `D:\KLBS\kaira-luxe-billing-system`
- Branch: `main...origin/main`
- HEAD: `995cfd6735a4d8d9e6155cb4d7654b0df7694a62`
- Existing uncommitted LOG-01 patch preserved:
  - `src/database/activityService.js`
  - first LOG-01 test/report artifacts already present in the worktree
- Other pre-existing untracked C4D/V1.1 reports and diagnostic scripts were preserved.
- No source code, test code, database, staging area, commit, or remote was modified.

## 2. Complete Activity Log architecture

### Write path

The authoritative production write path is:

1. Business/service callers invoke helpers in `src/database/logService.js`, or pass an event to one of the two indirect logging services.
2. `src/services/administratorSecurityService.js` calls `logActivity` directly for security events unless a test/injected `logEvent` callback is supplied.
3. `src/services/integrationActivityService.js` maps integration events to category `SETTINGS` and calls the injected `logActivity` callback.
4. `src/services/integrationOutboxService.js` constructs `DAY CLOSING` events and calls the injected `logActivity` callback after duplicate checking.
5. `src/database/activityService.js:logActivity()` normalizes and validates category, action, actor, status, details, references, and change data, then inserts into `activities`.

No production source path was found that directly inserts into `activities` outside `activityService.js`. Direct SQL inserts found in `scripts/` are test fixtures or test doubles.

### Read/search path

`src/renderer/modules/system/activitylog.js` stores the input as `activityKeyword` and calls `window.electronAPI.getActivities({ page, pageSize, keyword })`. `src/main/preload.js` forwards `activity:get`; `src/main/main.js` calls `getActivityPage()`. The service uses the same predicate for the count query and paged data query.

The first LOG-01 patch currently searches seven displayed fields, including `details`. It removed hidden `entity_type` and `user_name`, but it did not change the details-inclusive behavior.

## 3. Canonical category list

`src/database/activityService.js` defines this exact allow-list, normalized to uppercase:

| Category | Source status |
|---|---|
| `SYSTEM` | Written |
| `SECURITY` | Written |
| `PRODUCT` | Allowed but no current writer found |
| `INVENTORY` | Written |
| `BILLING` | Written |
| `RETURN` | Written |
| `CREDIT NOTE` | Written |
| `STORE CREDIT` | Written |
| `GIFT VOUCHER` | Written |
| `SETTINGS` | Written |
| `BACKUP` | Written |
| `RESTORE` | Written |
| `DAY CLOSING` | Written |
| `PRINTING` | Allowed but no current writer found |
| `EXPORT` | Written |
| `ACTIVITY` | Written |

The source-derived taxonomy therefore contains 14 categories with current writers. `PRODUCT` and `PRINTING` are dormant categories in the validator, not observed writers.

## 4. Complete category/action matrix

The rows below describe actions that current source can actually submit to `logActivity`. Security policy entries that only describe authorization purposes are listed separately in the taxonomy findings.

| CATEGORY | ACTION | SOURCE FILE | CALLER / FUNCTION | DETAILS PURPOSE | REFERENCE PURPOSE |
|---|---|---|---|---|---|
| SYSTEM | `APPLICATION_STARTED` | `src/database/logService.js:21-23` | `logApplicationStarted`; startup caller `src/main/main.js:689` | Application startup message | None |
| SYSTEM | `APPLICATION_CLOSED` | `logService.js:24-26` | `logApplicationClosed`; window close path `main.js:532` | Application shutdown message | None |
| SYSTEM | `APPLICATION_UPDATED` | `logService.js:27-29`; direct same helper form in `main.js:2805-2808` | `logApplicationUpdated` / `logAdministratorAction`; update install IPC | Version or installer-launch message | Update version when direct admin action is used; none in helper |
| SYSTEM | `DATABASE_RESET` | `logService.js:30-32` | `logDatabaseReset`; exported helper caller not found in current `src/` call search | Reset completion message | None |
| SECURITY | `PROTECTED_ACTION_DENIED` | `src/services/administratorSecurityService.js:115-126` | `deniedEvent` → `denied` → `safeLog` | Authorization failure and protected-purpose label | Authorization purpose |
| SECURITY | `PROTECTED_RESOURCE_ACCESSED` | `administratorSecurityService.js:289-298` | `authorizePin` for resource-access policies → `safeLog` | Protected report/resource access | Resource name, e.g. report resource |
| SECURITY | `MANAGER_PIN_CHANGED` | `administratorSecurityService.js:329-335` | `configureManagerPin` → `safeLog` | Manager PIN changed/configured through manager-PIN management | `MANAGER_PIN` |
| SECURITY | `MANAGER_PIN_CONFIGURED` | `administratorSecurityService.js:329-335` | `configureManagerPin` when not previously configured | Manager PIN configured | `MANAGER_PIN` |
| SECURITY | `MANAGER_PIN_RECOVERED` | `administratorSecurityService.js:543-548` | `recoverManagerPin` when already configured | Manager PIN recovered | `MANAGER_PIN` |
| SECURITY | `ADMIN_PIN_CHANGED` | `administratorSecurityService.js:363-366` | `changePin` → `safeLog` | Administrator PIN changed | `ADMIN_PIN` |
| SECURITY | `MASTER_RECOVERY_FAILED` | `administratorSecurityService.js:391-394`, `439-442`, `519-523` | `recoverPin`, `beginStartupSetup`, `recoverManagerPin` | Master recovery failure | `MASTER_RECOVERY` |
| SECURITY | `ADMIN_PIN_RECOVERED` | `administratorSecurityService.js:415-419` | `recoverPin` when administrator security was initialized | Administrator PIN recovered | `ADMIN_PIN` |
| SECURITY | `ADMIN_SECURITY_INITIALIZED` | `administratorSecurityService.js:415-419`, `492-499` | `recoverPin` first success or missing-admin-PIN setup | Administrator security initialized | `ADMIN_PIN` |
| SECURITY | `MASTER_RECOVERY_SUCCESS` | `administratorSecurityService.js:420-423`, `450-453`, `549-552` | `recoverPin`, `beginStartupSetup`, `recoverManagerPin` | Master recovery success | `MASTER_RECOVERY` |
| BILLING | `INVOICE_GENERATED` | `src/database/logService.js:48-51` | `logInvoiceGenerated`; `billService.js:1016` | Bill number, amount, item count | Bill number |
| BILLING | `PAYMENT_CORRECTED` | `logService.js:53-55`; `billService.js:1689` | `logPaymentCorrected` | Corrected bill reference | Bill number |
| BILLING | `FAMILY_FRIENDS_DISCOUNT_APPLIED` | `main.js:1376-1379` via `logAdministratorAction` | Billing finalization path after manager authorization | Discount applied to bill | Bill number |
| GIFT VOUCHER | `GIFT_VOUCHER_APPLIED` | `main.js:1389-1392` via `logAdministratorAction` | Billing finalization path after manager authorization | Gift Voucher applied to bill | Bill number |
| RETURN | `RETURN_COMPLETED` | `logService.js:57-85`; `returnService.js:1313` | `logReturnCompleted` | Return number, original bill, amount, optional return reason | Return number |
| CREDIT NOTE | `CREDIT_NOTE_GENERATED` | `logService.js:87-103`; `returnService.js:1329` | `logCreditNoteGenerated` | Credit note, return, original bill, amount | Credit note number |
| STORE CREDIT | `STORE_CREDIT_ISSUED` | `logService.js:105-120`; `returnService.js:1355` | `logStoreCreditIssued` | Store Credit number, return, amount | Store Credit number |
| STORE CREDIT | `STORE_CREDIT_UPDATED` | `logService.js:122-138`; `returnService.js:1346` | `logStoreCreditUpdated` | Store Credit balance addition/update | Store Credit number |
| STORE CREDIT | `STORE_CREDIT_REDEEMED` | `logService.js:140-155`; `billService.js:1034` | `logStoreCreditRedeemed` | Store Credit number, bill, amount | Store Credit number |
| INVENTORY | `PRODUCT_IMPORT_COMPLETED` | `logService.js:157-168`; `importProducts.js:439` | `logProductImport` | Import filename and row counts | Sanitized filename |
| INVENTORY | `PRODUCT_MASTER_IMPORT_FAILED` | `logService.js:170-177`; `importProducts.js:1075` | `logProductImportFailed` | Sanitized import failure reason | Sanitized filename |
| INVENTORY | `INVENTORY_RESET` | `logService.js:179-181`; `resetInventory.js:87` | `logInventoryReset` | Inventory reset completion | None |
| INVENTORY | `STOCK_INWARD` | `logService.js:183-204`; `inventoryTransactionService.js:260` | `logStockInward` → `logInventoryMovement` | Product, barcode, quantity, optional invoice/remarks | Inventory transaction ID |
| INVENTORY | `STOCK_OUTWARD` | `logService.js:183-204`; `inventoryTransactionService.js:455` | `logStockOutward` → `logInventoryMovement` | Product, barcode, quantity, reason/remarks | Inventory transaction ID |
| BACKUP | `BACKUP_CREATED` | `logService.js:206-209`; `backupService.js:463` | `logBackupCreated` | Sanitized backup filename | Sanitized backup filename |
| BACKUP | `AUTOMATIC_BACKUP_CREATED` | `logService.js:210-219`; `backupService.js:460` | `logAutomaticBackupCreated` | Scheduled backup frequency and success | Sanitized backup filename |
| BACKUP | `AUTOMATIC_BACKUP_FAILED` | `logService.js:220-222`; `backupService.js:595` | `logAutomaticBackupFailed` | Sanitized failure reason | None |
| BACKUP | `BACKUP_FAILED` | `logService.js:223-225`; `backupService.js:501` | `logBackupFailed` | Sanitized failure reason | None |
| RESTORE | `RESTORE_COMPLETED` | `logService.js:226-229`; `main.js:671` | `logRestoreCompleted` | Sanitized restore filename | Sanitized backup filename |
| RESTORE | `RESTORE_FAILED` | `logService.js:230-231`; `backupService.js:920` | `logRestoreFailed` | Sanitized failure reason | None |
| DAY CLOSING | `BUSINESS_DAY_OPENED` | `logService.js:233-236` | `logBusinessDayOpened`; no direct current caller found in the inspected `src/` call search | Business date | Business date |
| DAY CLOSING | `BUSINESS_DAY_CLOSED` | `logService.js:237-240`; `dayClosingService.js:707` through injected callback | `logBusinessDayClosed` | Closed business date | Business date |
| DAY CLOSING | `BUSINESS_DAY_REOPENED` | `logService.js:241-244`; `dayClosingService.js:849` through injected callback | `logBusinessDayReopened` | Reopened business date | Business date |
| DAY CLOSING | `DSR_SYNC_SUCCEEDED` | `logService.js:245-250`; `dayClosingService.js:559` through injected callback | `logDsrSyncSucceeded` | Close sequence and sync action | Business date |
| DAY CLOSING | `DSR_SYNC_FAILED` | `logService.js:251-255`; `dayClosingService.js:562` through injected callback | `logDsrSyncFailed` | Close sequence and sanitized failure reason | Business date |
| DAY CLOSING | `OUTBOX_DELIVERY_SUPERSEDED` | `src/services/integrationOutboxService.js:41-54` | `recordSupersededActivity` → injected `logActivity` | Email/DSR delivery not sent and reason | Business date display |
| EXPORT | `INVENTORY_EXPORTED` | `main.js:2067-2070` through `logDataExported` | Inventory export IPC | Export completion | `INVENTORY` |
| EXPORT | `BUSINESS_REPORT_EXPORTED` | `main.js:2276-2285` through `logDataExported` | Report export IPC, `business` report | Report export completion | `BUSINESS_REPORT` |
| EXPORT | `GST_REPORT_EXPORTED` | `main.js:2276-2285` through `logDataExported` | Report export IPC, `gst` report | Report export completion | `GST_REPORT` |
| EXPORT | `PRODUCT_SALES_REPORT_EXPORTED` | `main.js:2276-2285` through `logDataExported` | Report export IPC, `product` report | Report export completion | `PRODUCT_SALES_REPORT` |
| EXPORT | `CUSTOMER_PURCHASE_REPORT_EXPORTED` | `main.js:2276-2285` through `logDataExported` | Report export IPC, `customer` report | Report export completion | `CUSTOMER_PURCHASE_REPORT` |
| EXPORT | `BILL_SUMMARY_REPORT_EXPORTED` | `main.js:2276-2285` through `logDataExported` | Report export IPC, `billSummary` report | Report export completion | `BILL_SUMMARY_REPORT` |
| EXPORT | `ACTIVITY_LOG_EXPORTED` | `main.js:2937-2940` through `logDataExported` | Activity export IPC | Activity Log export completion | `ACTIVITY_LOG` |
| ACTIVITY | `ACTIVITY_LOG_ARCHIVED` | `logService.js:33-38`; `main.js:3005` | `logActivityArchived` | Archive filename and removed row count | Archive filename |
| SETTINGS | `RECEIPT_FOOTER_UPDATED` | `src/database/settingsService.js:4-112` | `saveSettings` → `buildSettingsActivity` → injected `logActivity` | Receipt footer change | `RECEIPT_SETTINGS` |
| SETTINGS | `PRINTER_SETTINGS_UPDATED` | `settingsService.js:16-22` | `saveSettings` → `buildSettingsActivity` | Default printer change | `PRINTER_SETTINGS` |
| SETTINGS | `BACKUP_LOCATION_UPDATED` | `settingsService.js:26-32` | `saveSettings` → `buildSettingsActivity` | Backup location change | `BACKUP_SETTINGS` |
| SETTINGS | `AUTO_BACKUP_SETTINGS_UPDATED` | `settingsService.js:36-42` | `saveSettings` → `buildSettingsActivity` | Automatic backup settings change | `AUTO_BACKUP_SETTINGS` |
| SETTINGS | `FAMILY_FRIENDS_SETTINGS_UPDATED` | `settingsService.js:50-56` | `saveSettings` → `buildSettingsActivity` | Family & Friends settings change | `FAMILY_FRIENDS_SETTINGS` |
| SETTINGS | `EMAIL_SETTINGS_UPDATED` | `src/services/integrationActivityService.js:28-33`; `main.js:1975` | `emailSettingsEvent` → `recordIntegrationActivity` | Email security mode and recipient count | `EMAIL_INTEGRATION` |
| SETTINGS | `DSR_SETTINGS_UPDATED` | `integrationActivityService.js:35-40`; `main.js:1981` | `dsrSettingsEvent` → `recordIntegrationActivity` | DSR data-tab setting | `DSR_INTEGRATION` |
| SETTINGS | `EMAIL_CONNECTION_TEST_SUCCESS` / `EMAIL_CONNECTION_TEST_FAILED` | `integrationActivityService.js:42-52`; `main.js:1988` | `connectionEvent("email")` → `recordIntegrationActivity` | Email connection result and sanitized error | `EMAIL_INTEGRATION` |
| SETTINGS | `DSR_CONNECTION_TEST_SUCCESS` / `DSR_CONNECTION_TEST_FAILED` | `integrationActivityService.js:42-52`; `main.js:2005` | `connectionEvent("dsr")` → `recordIntegrationActivity` | DSR connection result and sanitized error | `DSR_INTEGRATION` |
| SETTINGS | `EMAIL_TEST_MESSAGE_SENT` | `integrationActivityService.js:55-59`; `main.js:1996` | `emailTestMessageEvent` → `recordIntegrationActivity` | Email test completion | `EMAIL_INTEGRATION` |

## 5. Source locations and indirect callers

The normal helper layer is `src/database/logService.js`. Its callers include:

- `src/main/main.js`: lifecycle, restore, billing authorization, inventory export, report export, update install, Activity Log export/archive.
- `src/database/billService.js`: invoice generation, Store Credit redemption, payment correction.
- `src/database/returnService.js`: return, credit note, and Store Credit events.
- `src/database/importProducts.js`: import success/failure.
- `src/database/inventoryTransactionService.js`: stock inward/outward.
- `src/database/resetInventory.js`: inventory reset.
- `src/services/backupService.js`: backup/restore events.
- `src/database/dayClosingService.js`: business-day and DSR events through injected callbacks.

Indirect/direct alternatives are `administratorSecurityService.js`, `settingsService.js`, `integrationActivityService.js`, and `integrationOutboxService.js`, all of which ultimately use `activityService.logActivity` in production wiring.

## 6. Category consistency findings

- Stored category normalization is authoritative: `canonicalValue()` trims, uppercases, and rejects values outside the allow-list.
- No lower-case or spelling variants are writable through `normalizeActivity()`.
- Multi-word categories use spaces (`CREDIT NOTE`, `STORE CREDIT`, `GIFT VOUCHER`, `DAY CLOSING`); action names use uppercase underscore style.
- `PRODUCT` and `PRINTING` are accepted by the validator but have no current source writer.
- `EXPORT` is a generic but intentional module category for inventory/report/Activity Log exports.
- `ACTIVITY` is a separate category for archive operations; export is categorized as `EXPORT`.
- `SETTINGS` contains both ordinary settings changes and integration settings/test events. This is broad but source-consistent.
- `SECURITY` contains authorization failures, resource accesses, PIN lifecycle, and master recovery events. This is broad but source-consistent.
- Details are operational descriptions, not stable taxonomy values. Several details contain product/application terms such as `Kaira Luxe Billing System`.
- References are consistently populated for business/resource-specific events, but lifecycle, reset, and failure events often intentionally have no reference.

## 7. Taxonomy defects and anomalies

### Blank/null categories

No normal production writer can intentionally persist a blank category: `normalizeActivity()` requires a nonblank category and validates it. Test fixtures can bypass that normalization by inserting directly, but no production direct insert was found.

### Spelling/case variants

No writable case variants were found; normalization forces uppercase. Source literals are consistent with the allow-list.

### Synonymous categories

No exact synonyms were found. `ACTIVITY` versus `EXPORT` is a deliberate operation split, not a spelling synonym. `BACKUP` and `RESTORE` are separate operation areas.

### Actions under multiple categories

`APPLICATION_UPDATED` is available through the general `SYSTEM` helper and the update-install caller, but both use `SYSTEM`; no cross-category duplicate was found in actual writers. `PAYMENT_CORRECTED` appears in the security policy as an authorization-purpose action and in actual `BILLING` logging; the policy declaration is not itself a second Activity Log writer.

### Generic/ambiguous categories

`SETTINGS`, `SECURITY`, and `EXPORT` each contain multiple subdomains/actions. They remain stable module categories, but action/reference are needed for finer distinctions.

### Category not representing business/module area

No actual writer was found that uses a category unrelated to its module. The important UX issue is different: Details is free-form and can contain the application name, so it is not a reliable category signal.

### Bypasses and legacy paths

No production direct SQL insert bypassing `activityService` was found. `getActivities()` and `searchActivities()` are legacy service exports not used by the current renderer; the current UI uses `getActivityPage()`.

### Declared-but-not-written actions

`ADMIN_PIN_AUDIT_POLICY` contains business-operation action labels such as `STOCK_INWARD_AUTHORIZED`, `STOCK_OUTWARD_AUTHORIZED`, `RECEIPT_FOOTER_UPDATED`, `BACKUP_LOCATION_UPDATED`, `DSR_SYNC_RETRY`, and others. The policy validates authorization purposes; `authorizePin()` only emits Activity Log rows for `RESOURCE_ACCESS` classifications. These policy labels must not be counted as additional current Activity Log records unless a later caller explicitly logs them.

## 8. Historical search behavior

Before V1.1 pagination, `src/renderer/modules/system/activitylog.js` loaded the full Activity Log and filtered each rendered row using `row.textContent.toLowerCase().includes(keyword)`. Because the rendered row included Details, `billing` matched `SYSTEM / APPLICATION_STARTED` when Details was `Kaira Luxe Billing System started`.

## 9. V1.1 pagination search behavior

Commit `216e44b` introduced `getActivityPage()` and moved filtering into SQLite. The first paged predicate searched:

- activity date
- activity time
- category
- action
- details
- entity type
- reference number
- user name
- status

The renderer retained the keyword across page navigation and the count/data queries shared the predicate.

## 10. First LOG-01 patch behavior

The existing uncommitted patch removed `entity_type` and `user_name` from the paged predicate and changed the parameter count from nine to seven. This corrected hidden-metadata matches but intentionally retained `details` in the predicate. Therefore it does not satisfy the newly stated category-first UX requirement: `SYSTEM / APPLICATION_STARTED` still matches `billing` through Details.

## 11. Why manual acceptance still fails

The first patch treated all seven displayed columns as free-text searchable fields. The current UX requirement is narrower: `billing` is a category-oriented term and must not match a generic application-name phrase in Details. This is expected behavior under the current details-inclusive predicate, not an IPC, pagination, stale-render, or parameter-binding defect.

## 12. Category-search design options

### Option A — Category-only search

Search only `LOWER(category) LIKE '%' || LOWER(term) || '%'`, with no Details/action/reference matching. This directly satisfies `billing` → `BILLING`, excludes `SYSTEM / APPLICATION_STARTED`, is case-insensitive, and preserves pagination through the same count/data predicate.

### Option B — Category-first with an explicit second mechanism

Use the current free-text field for category-only search and add a separately labelled advanced search/filter for action/reference/details. This is semantically clearest but expands UI scope and is not currently present.

### Option C — Combined broad free-text search

Continue searching category, action, reference, Details, and status. This preserves broad discovery but is explicitly inconsistent with the stated category-first UX because Details contains generic application text.

## 13. Recommended search contract

Recommend Option A: case-insensitive partial matching against the canonical `category` field only.

Evidence:

- The user-facing requirement explicitly defines `billing` as a category search.
- Categories are validated against a finite canonical allow-list.
- Partial matching is useful and unambiguous for the current taxonomy: `bill` → `BILLING`, `inven` → `INVENTORY`, `store` → `STORE CREDIT`.
- Exact matching would make normal abbreviated category searches fail without adding safety benefits because the category values are canonical.
- A term matching no category should return zero rows.
- The same category predicate must be used for count and data queries, so pagination remains safe.
- No existing category filter UI needs to be added for this contract.

## 14. Exact implementation scope for subsequent fix

The subsequent approved implementation should be limited to:

1. Change `getActivityPage()` search predicate and bindings to category-only matching.
2. Preserve the existing renderer keyword state, IPC route, page reset, count/data query pairing, case normalization, and pagination.
3. Update the focused LOG-01 regression fixture so `billing` excludes a SYSTEM Details-only match and includes `BILLING` category rows.
4. Add coverage for partial category terms (`bill`, `inven`), case variations, no category match, clearing search, and page navigation.
5. Do not alter Activity Log writers, categories, actions, audit semantics, retention, or database schema.

## 15. Required subsequent regression tests

- Empty search returns the normal dataset.
- `billing`, `Billing`, and `BILLING` return only `BILLING` category rows.
- `bill` returns `BILLING`; `inven` returns `INVENTORY`.
- A SYSTEM row with Details containing `Kaira Luxe Billing System` is excluded from `billing`.
- A term matching no category returns zero rows.
- Search remains active on next/previous/jump pagination.
- Clearing search restores the unfiltered result set.
- Count and data rows agree for every search term.
- Existing history pagination regression remains passing.

## 16. Database safety

Neither `C:\Users\USER\AppData\Roaming\KAIRA LUXE BILLING SYSTEM\billing.db` nor any training database was opened, inspected, modified, migrated, seeded, or tested against. This audit used source inspection only.

## 17. Final status

READY FOR SEARCH CONTRACT REVIEW
