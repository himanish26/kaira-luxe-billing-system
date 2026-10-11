# KLBS Customer CRM Receiver Protocol

Protocol identifier: `KLBS_CUSTOMER_CRM_V1`  
Transport: HTTPS POST, `Content-Type: application/json`  
Apps Script entry point: `doPost(e)`  
Credential: project Script Property `KLBS_CUSTOMER_CRM_AUTH_SECRET`

## Envelope and signature

The JSON envelope has exactly these fields:

```json
{
  "contract": "KLBS_CUSTOMER_CRM_V1",
  "timestamp": "2026-10-11T06:30:00.000Z",
  "action": "TEST_CONNECTION",
  "payload": {
    "contract": "KLBS_CUSTOMER_CRM_V1",
    "spreadsheetId": "1HMLsWV4MLxQ1oGKj-P4DD6KMgm44tvCLnx1VXWiE9lo",
    "worksheet": "Customer_Master"
  },
  "signature": "64 lowercase hexadecimal characters"
}
```

The sender constructs an insertion-ordered JavaScript payload and signs the exact payload JSON serialization. Receiver signature input is UTF-8:

```text
timestamp + LF + action + LF + JSON.stringify(payload)
```

The signature is HMAC-SHA256 with the CRM-only secret, lowercase hexadecimal output. The receiver uses a constant-time comparison for equal-length valid hex signatures. Timestamp must be UTC ISO-8601 with millisecond precision and within ±5 minutes of receiver time. No authentication header is required or inspected; Apps Script authenticates the signed JSON body.

## `TEST_CONNECTION`

Payload keys are exactly `contract`, `spreadsheetId`, `worksheet`. The ID must equal Script Property `KLBS_CUSTOMER_CRM_SPREADSHEET_ID`; worksheet must be `Customer_Master`. The receiver checks `Customer_Master` and `Sync_Log` and exact first-row headings. It writes only a sanitized test event to `Sync_Log`.

Success acknowledgement:

```json
{
  "contract": "KLBS_CUSTOMER_CRM_V1",
  "action": "TEST_CONNECTION",
  "result": "SUCCESS",
  "spreadsheetId": "1HMLsWV4MLxQ1oGKj-P4DD6KMgm44tvCLnx1VXWiE9lo",
  "worksheet": "Customer_Master"
}
```

## `CUSTOMER_UPSERT`

The payload contains exactly:

`contract`, `storeCode`, `customerId`, `customerName`, `mobile`, `email`, `birthdayDDMM`, `anniversaryDDMM`, `customerCreatedAt`, `customerUpdatedAt`, `customerRevision`, `spreadsheetId`, `worksheet`.

Identity is the exact pair `(storeCode, customerId)`. Customer ID must match `KLCUS` plus six digits. Revision must be a positive safe integer. Mobile, email and DD/MM dates may be `null` or empty; those values clear the destination cells. The receiver maps to `Customer_Master` A:J in the existing heading order. Text is written as literal content to prevent formula interpretation.

Success acknowledgement (additional `disposition` is informational):

```json
{
  "contract": "KLBS_CUSTOMER_CRM_V1",
  "action": "CUSTOMER_UPSERT",
  "result": "SUCCESS",
  "storeCode": "KL001",
  "customerId": "KLCUS000001",
  "customerRevision": 3,
  "disposition": "INSERTED"
}
```

`disposition` is `INSERTED`, `UPDATED`, or `UNCHANGED`. KLBS requires the contract, action, success result, and exact Store Code, Customer ID, and revision before it marks the corresponding outbox revision synchronized.

## Revision and idempotency

The receiver lazily creates and hides `CRM_Revision_Metadata`, with identity key and highest accepted revision columns. It uses a Script Lock around the revision lookup, exact Customer_Master identity lookup, write, metadata update, and success log. A repeated equal revision returns `SUCCESS` / `UNCHANGED` when its master row exists. A smaller revision returns `PERMANENT_REJECTION` with `STALE_REVISION`. Duplicate master identities or metadata identities are rejected as permanent integrity errors. Metadata is scoped to this spreadsheet destination.

## Failure acknowledgements

Apps Script ContentService returns a `TextOutput`; it does not provide the receiver a conventional arbitrary HTTP status response contract. Receiver-level errors therefore use JSON result values (normally returned with HTTP 200) and KLBS must inspect the JSON result rather than considering HTTP 200 sufficient.

```json
{
  "contract": "KLBS_CUSTOMER_CRM_V1",
  "action": "CUSTOMER_UPSERT",
  "result": "RETRYABLE_FAILURE",
  "errorCode": "LOCK_BUSY"
}
```

or

```json
{
  "contract": "KLBS_CUSTOMER_CRM_V1",
  "action": "CUSTOMER_UPSERT",
  "result": "PERMANENT_REJECTION",
  "errorCode": "STALE_REVISION"
}
```

Retryable classes include lock contention, transient Spreadsheet service errors, and quota/service exceptions. Permanent classes include invalid contract/envelope/signature/timestamp, destination mismatch, invalid customer data, duplicate identity integrity conflicts, and stale revisions. Codes are uppercase sanitized tokens. Responses contain no personal data or credentials. The KLBS CRM sender recognizes these two result values; permanent rejection moves that exact outbox revision to `FAILED`, while retryable failures remain pending with bounded exponential backoff.

## Logs and platform redirect

`Sync_Log` columns remain exactly: Timestamp, Operation, Store Code, Customer ID, Result, Error Code, Details. Logs exclude names, phone, email, dates, full payloads, secrets, and signatures and are capped at 5,000 retained data rows. `Campaign_Log` is never accessed.

Google ContentService redirects response content to a one-time `script.googleusercontent.com` URL. KLBS follows at most one HTTPS redirect and permits that exact destination host only. Google documents the redirect in [Content Service](https://developers.google.com/apps-script/guides/content). A redirect to any other host/protocol is rejected by the CRM sender.
