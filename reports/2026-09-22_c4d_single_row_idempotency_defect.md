# KLBS V1.1 C4D Single-Row Idempotency Defect Audit

## Executive verdict

NOT READY — the authoritative deployed V15 C4D receiver source is not present in this repository, so the live duplicate-row root cause cannot be proven or safely fixed without guessing.

## Live evidence supplied

The controlled Job 2 POST was sent exactly once. The receiver returned a non-success outcome because it did not return `UNCHANGED`. The live sheet now has two rows for Business Date `2026-09-21`, both with Closing ID `7`, Close Sequence `2`, Contract Version `2`, Snapshot Version `2`, and the locked Job 2 payload hash. No further POST or live-sheet modification was performed for this audit.

## Repository inspection

The requested files `KLBS_C4D_Receiver.js` and `KLBS_DSR_WebApp.js` are not present under the repository. The available files are:

- `deployment/google-apps-script/KLBS_DSR_WebApp.gs`
- `deployment/google-apps-script/KLBS_Segment_DSR_WebApp.gs`
- C4D transport/worker tests and legacy DSR tests under `scripts/`.

The checked-in `KLBS_DSR_WebApp.gs` is not the live C4D V15 receiver:

- it defines the legacy 28-column `KLBS_Daily_Data` header;
- it requires `contractVersion === 1` and `snapshotVersion === 1`;
- its payload field set is the legacy aggregate contract;
- the live Job 2 payload and rows are Contract Version 2 / Snapshot Version 2 and use the newer 58-column formatting.

Therefore the requested deployed V15 source is external to this worktree or was not synchronized into it.

## What the checked-in receiver actually proves

The local legacy receiver reads column B using `getValues()`, not `getDisplayValues()`, obtains the spreadsheet timezone, and normalizes each cell through `normalizeBusinessDate_()`:

```javascript
var data = sheet.getLastRow() > 1
  ? sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues() : [];
data.forEach(function(row, index) {
  if (normalizeBusinessDate_(row[0], sheetTimeZone) === payload.businessDate) {
    matchingRows.push(index + 2);
  }
});
```

The local normalizer handles valid Google Sheets `Date` objects with `Utilities.formatDate(value, sheetTimeZone, 'yyyy-MM-dd')`, canonical ISO strings, `dd/MM/yyyy`, and `dd Mon, yyyy` values. It scans all data rows. If more than one row matches, it throws `Duplicate Business Date integrity conflict.` before any insert/update. The local code therefore does not reproduce the reported Row 3 insertion for one matching legacy date row.

## Proven root-cause boundary

The exact deployed defect cannot be attributed to a specific Date/string/timezone/index bug from this repository because the live V15 receiver source and its deployed test fixtures are absent. The evidence establishes a version/source mismatch: the only local receiver cannot accept the live V2 payload, while the live receiver accepted it and inserted Row 3.

Possible causes such as raw Date timezone rollover, display/raw value mismatch, lookup range, header mapping, or a malformed V15 key remain hypotheses until the deployed V15 source and its test harness are supplied. This audit does not select among them.

## Changes made

None to Apps Script, Google Sheets, databases, or the existing repair utility. No live state was touched. Existing unrelated worktree changes were preserved.

## Required safe fix design once authoritative V15 source is supplied

The receiver fix must canonicalize every existing Business Date representation without converting the incoming business date through a timezone-shifting JavaScript parse. It must scan all data rows and collect every row whose canonical date equals the incoming canonical `yyyy-MM-dd` date.

The decision table must be:

| Matching rows | Sequence/hash | Result | Writes |
|---:|---|---|---|
| 0 | normal new sequence | INSERT | one insert |
| 1 | higher sequence | UPDATE same physical row | one update |
| 1 | lower sequence | STALE | zero |
| 1 | same sequence + same hash | UNCHANGED | zero semantic rewrite; allowed format repair only |
| 1 | same sequence + different hash | CONFLICT | zero |
| 2+ | any | deterministic duplicate/conflict error | zero |

The existing 58-column mapping and V15 formatting must be retained. Duplicate detection must occur before all write operations. No code should choose Row 2 or Row 3 automatically while both exist.

## Current duplicate remediation plan

Do not delete either live row yet. First preserve a versioned Sheet export/snapshot and obtain the authoritative V15 receiver source plus deployment/version identity. Deploy and verify the duplicate fail-safe in a non-live test spreadsheet. Then, under an approved controlled Google Sheets remediation procedure, determine which row is authoritative from the frozen payload, timestamps, formatting contract, and audit/version history; archive both original rows; remove only the confirmed duplicate; and verify exactly one row remains. The receiver must be tested against the repaired sheet before any future resend.

No automatic cleanup is recommended because the two rows have identical visible business identity/hash but different historical provenance.

## Tests and results

Passed:

- `node scripts/v1-stable-gate-follow-up-test.js`
- `node scripts/v1-stable-gate-final-targeted-test.js`
- `node scripts/v1-stable-gate-blocker-regression-test.js`
- `node scripts/v1-dsr-outbox-repair-test.js`
- `node scripts/v1-c4d-auth-compatibility-test.js`
- `node scripts/v1-c4d-failed-job-retry-test.js`
- `Get-Content -Raw deployment/google-apps-script/KLBS_DSR_WebApp.gs | node --check -`
- `Get-Content -Raw deployment/google-apps-script/KLBS_Segment_DSR_WebApp.gs | node --check -`
- `git diff --check`

The existing tests prove the checked-in legacy receiver’s date normalization, sequence behavior, and duplicate guard. They cannot prove the absent deployed V15 receiver’s behavior. No live HTTP request, Apps Script deployment, Sheet write, database write, or Job 2 execution was performed.

## Files inspected

- `deployment/google-apps-script/KLBS_DSR_WebApp.gs`
- `deployment/google-apps-script/KLBS_Segment_DSR_WebApp.gs`
- `scripts/v1-stable-gate-follow-up-test.js`
- `scripts/v1-stable-gate-final-targeted-test.js`
- `scripts/v1-stable-gate-blocker-regression-test.js`
- `scripts/v1-dsr-outbox-repair-test.js`
- `scripts/v1-c4d-auth-compatibility-test.js`
- `scripts/v1-c4d-failed-job-retry-test.js`
- C4D repair utility and current worktree status.

## Final status

NOT READY — supply the authoritative deployed V15 C4D receiver source (`KLBS_C4D_Receiver.js` / actual deployed `KLBS_DSR_WebApp.js`) and its Apps Script test fixtures before implementing or deploying the canonical lookup fix.
