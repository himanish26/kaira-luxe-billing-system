"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { CURRENT_DB_SCHEMA_VERSION } = require("../src/database/schemaVersion");

const root = path.resolve(__dirname, "..");
assert.strictEqual(CURRENT_DB_SCHEMA_VERSION, 9, "complete P&L remains on schema V9");
const pnlSource = fs.readFileSync(path.join(root, "src/database/managementPnlService.js"), "utf8");
assert.doesNotMatch(pnlSource, /closing_id|day_closing|\bDSR\b|email_status|report_job|export_job|remote_dashboard|push_notification|integration_outbox|activity_log/i,
    "central P&L arithmetic must not depend on non-financial workflow metadata");
const entrySource = fs.readFileSync(path.join(root, "src/database/managementAccountingEntryService.js"), "utf8");
const listEntries = entrySource.match(/async function listEntries\([\s\S]*?\n    async function getEntryDataQuality/);
assert(listEntries, "authoritative posted-entry reporting query exists");
assert.doesNotMatch(listEntries[0], /appendActivity|reserveAuthorization|Activity Log|activity_log/i,
    "P&L reads posted accounting facts without Activity Log or authorization dependencies");

for (const script of ["v21-05b-management-pnl-engine-test.js", "v21-05d-management-pnl-excel-test.js"]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, script)], { cwd: root, encoding: "utf8" });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.strictEqual(result.status, 0, `${script} must pass as part of the complete P&L qualification`);
}
console.log("PASS V21-05E3 golden arithmetic, longevity, V9 entry-source, spreadsheet reconciliation contracts, and non-financial independence");
