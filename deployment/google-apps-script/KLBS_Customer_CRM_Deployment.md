# KLBS Customer CRM Apps Script Deployment

This guide deploys the receiver for the existing **KAIRA LUXE - CUSTOMER CRM** spreadsheet. It does not create a spreadsheet or deploy anything automatically.

## 1. Identify the existing spreadsheet

- Spreadsheet: **KAIRA LUXE - CUSTOMER CRM**
- Spreadsheet ID: `1HMLsWV4MLxQ1oGKj-P4DD6KMgm44tvCLnx1VXWiE9lo`
- Required tabs: `Customer_Master`, `Sync_Log`, and `Campaign_Log`
- Do not rename tabs or change the existing column headings. The receiver does not write to `Campaign_Log`.

## 2. Create the bound Apps Script project

1. Open the existing spreadsheet in Google Sheets.
2. Choose **Extensions → Apps Script** to create/open its bound script project.
3. Replace or create the script source with `KLBS_Customer_CRM_WebApp.gs` from this directory. Do not copy the DSR receiver into this project.
4. Save the project with a clear name such as `KLBS Customer CRM Receiver`.

## 3. Set Script Properties

In Apps Script, open **Project Settings → Script Properties** and add:

| Property | Value |
| --- | --- |
| `KLBS_CUSTOMER_CRM_SPREADSHEET_ID` | `1HMLsWV4MLxQ1oGKj-P4DD6KMgm44tvCLnx1VXWiE9lo` |
| `KLBS_CUSTOMER_CRM_AUTH_SECRET` | A newly generated high entropy secret shared only with KLBS |

Do not put the secret in source code, spreadsheet cells, logs, or deployment documentation. Do not reuse the DSR secret. Use the same secret in KLBS. Script Properties are shared project configuration; protect project editor access accordingly.

## 4. Verify tabs and headings before deployment

The receiver does not create or repair the three user-owned tabs or headings. In the Apps Script editor, select and run `verifyKLBSCustomerCrmSetup` once. Approve the requested spreadsheet permissions. It checks the configured spreadsheet plus the existing `Customer_Master` and `Sync_Log` headings without writing customer data.

`Customer_Master` headings, A:J:

1. Store Code
2. Customer ID
3. Customer Name
4. Mobile Number
5. Birthday (DDMM)
6. Anniversary (DDMM)
7. Email
8. Customer Created At
9. Customer Updated At
10. Last Synced At

`Sync_Log` headings, A:G:

1. Timestamp
2. Operation
3. Store Code
4. Customer ID
5. Result
6. Error Code
7. Details

## 5. Deploy as a Web App

1. Choose **Deploy → New deployment**.
2. Select **Web app** as the deployment type.
3. Set **Execute as** to **Me** (the spreadsheet owner/deployer), so the receiver uses the owner's spreadsheet permissions.
4. Select the narrowest access option that permits KLBS requests under the account's Google Workspace policy. The CRM protocol authenticates requests with HMAC; Google may restrict anonymous Web App access by organization policy.
5. Deploy, authorize the script, and copy the deployment URL ending in `/exec`.
6. Keep the deployment URL private as configuration information. The HMAC secret remains the request credential.

Apps Script ContentService returns its output through a one-time `script.googleusercontent.com` URL. The KLBS CRM transport follows one HTTPS redirect only when its destination host is exactly `script.googleusercontent.com`; it rejects redirects elsewhere. Google documents this redirect behavior for ContentService responses: [Content Service](https://developers.google.com/apps-script/guides/content).

## 6. Configure KLBS

1. Open **Settings → System → Integrations → Customer CRM → Configure** and authenticate with an authorized Manager PIN.
2. Enter the deployment `/exec` URL.
3. Enter the Spreadsheet ID above (it remains editable for approved future destination changes).
4. Enter the exact secret configured in Script Properties. The saved value is masked and is not displayed again.
5. Leave Customer Sync disabled until configuration is saved and tested, or save it enabled; delivery remains blocked until a successful test for the current configuration.
6. Select **Save**. A changed URL, Spreadsheet ID, or secret invalidates the previous test. Existing outbox records are retained.
7. Select **Test Connection**. The receiver verifies the HMAC, timestamp, configured spreadsheet, `Customer_Master`, and expected headings. It does not write customer rows or alter `Campaign_Log`.
8. After a successful test, confirm Customer Sync is enabled. Use **Sync Now** for pending customer changes.
9. Use **Sync Existing Customers** only when explicitly initiating the historical KLBS customer backfill.

## 7. Verify results

- Confirm the matching Store Code + Customer ID appears once in `Customer_Master`.
- Confirm optional empty values appear as blank cells and later clears remove prior values.
- Confirm updates change the existing identity row.
- Confirm `Last Synced At` is a receiver timestamp in `Asia/Kolkata`.
- Confirm test, upsert, idempotent, stale, authentication, validation, and retry outcomes appear in `Sync_Log` without personal profile fields or secrets.
- The first successful upsert creates a hidden `CRM_Revision_Metadata` tab. It stores only composite identity keys and highest accepted revisions. Do not delete, unhide for routine use, or edit it manually.

## 8. Troubleshooting

### Authentication failure

Check that `KLBS_CUSTOMER_CRM_AUTH_SECRET` exactly matches the secret saved in KLBS. A secret change in KLBS requires a fresh **Test Connection** before delivery. Never put the secret in Sync_Log or a support screenshot.

### Redirect or connection failure

Confirm the URL is the deployed HTTPS `/macros/s/{deploymentId}/exec` URL. Re-deploying a new version normally keeps the deployment URL; creating a new deployment may produce a new URL that must be saved and tested in KLBS. The CRM client only accepts the documented ContentService redirect to `script.googleusercontent.com`.

### Spreadsheet or headings failure

Confirm the configured Script Property ID matches the Spreadsheet ID in KLBS, and that the existing spreadsheet has the exact required tabs and headings. Do not create a second spreadsheet or rename a tab to work around a mismatch.

### Duplicate or stale revision rejection

Check `Sync_Log` for `CUSTOMER_IDENTITY_DUPLICATE`, `REVISION_METADATA_DUPLICATE`, or `STALE_REVISION`. Resolve data integrity issues only after reviewing the affected Store Code + Customer ID. The receiver uses a Script Lock around identity lookup, revision comparison, sheet write, and metadata update.

### Retry and recovery

Transient receiver/Google service issues return `RETRYABLE_FAILURE`; KLBS retains the outbox obligation and retries with bounded backoff. `PERMANENT_REJECTION` is surfaced as a failed CRM outbox item. After correcting configuration or data, an authorized operator can explicitly run **Sync Existing Customers** to requeue current customer records. Do not delete outbox or metadata rows as a retry method.

### Quotas

Each request uses Apps Script execution, Spreadsheet service, and Properties service quotas. Work is one customer per request, with writes serialized by `LockService`; the receiver does not run a daily job. Google publishes current limits in [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas), which can change. The receiver uses a hidden sheet for per-customer revisions rather than consuming the limited Script Properties store for every customer.

## 9. Update a deployment

Edit and save the bound project, then choose **Deploy → Manage deployments → Edit**, select a new version, and deploy the updated version to the existing deployment. Confirm the `/exec` URL remains the one configured in KLBS, then run **Test Connection**.

## 10. Rotate the authentication secret

1. Generate a new high entropy secret.
2. Replace `KLBS_CUSTOMER_CRM_AUTH_SECRET` in Script Properties.
3. In KLBS, enter the same replacement secret and save.
4. Run **Test Connection** successfully before enabling or resuming delivery.
5. Pending outbox rows remain stored. Delivery does not resume until the current endpoint/Spreadsheet ID/secret passes the test.

During the short interval between updating one side and the other, connection tests and delivery fail closed. The KLBS outbox retains eligible records.

## 11. Change the Spreadsheet ID

The receiver is bound to its spreadsheet but explicitly opens the configured ID. Update `KLBS_CUSTOMER_CRM_SPREADSHEET_ID` and the editable KLBS Spreadsheet ID to the intended existing spreadsheet, then save and test the new destination in KLBS before sending records. Do not create a spreadsheet as part of this operation. Revision metadata belongs to a particular destination spreadsheet; transfer it only as part of a separately reviewed migration if preserving revision history across destinations is required.

## 12. Scope and deployment status

This document describes deployment only. The source has not been deployed. No customer records have been synchronized by this implementation task.
