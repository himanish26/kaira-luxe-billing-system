"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const repositoryRoot = path.resolve(__dirname, "..");

// Every entry is a child process. The existing suites create their own
// :memory: or disposable temporary databases; this runner supplies no live
// database path and never opens an application database itself.
const suites = [
    { name: "Database Foundation", tests: ["v1-schema-version-compatibility-test.js"] },
    { name: "Product Master", tests: [{ file: "v1-product-master-validation-test.js", runtime: "electron" }] },
    { name: "Product / Inventory", tests: ["v1-inventory-performance-regression-test.js"] },
    { name: "Billing", tests: ["v1-h01-authoritative-billing-test.js"] },
    { name: "Payment Integrity / Store Credit", tests: ["v1-store-credit-exact-value-redemption-test.js"] },
    { name: "Discounts / Authorization", tests: [
        "v1-authorization-grant-retry-safety-test.js",
        "v1-authorization-ttl-regression-test.js"
    ] },
    { name: "Returns / Exchanges", tests: ["v1-return-reason-regression-test.js"] },
    { name: "Bill History / Navigation Guards", tests: ["v1-history-pagination-regression-test.js"] },
    { name: "Day Closing", tests: ["v1-stable-gate-follow-up-test.js"] },
    { name: "Reopen / Reclose Sequence Integrity", tests: ["v1-stable-gate-final-targeted-test.js"] },
    { name: "Backup / Restore Safety", tests: [
        "v1-restore-safety-test.js",
        "v1-pre-upgrade-backup-test.js"
    ] },
    { name: "Email / DSR Outbox Logic", tests: ["v1-stable-gate-targeted-test.js"] },
    { name: "DSR Contract / Outbox Repair", tests: [
        "v1-dsr-outbox-repair-test.js",
        "v1-stable-gate-blocker-regression-test.js"
    ] },
    { name: "DSR Stale PROCESSING Recovery", tests: ["v1-dsr-stale-processing-recovery-test.js"] },
    { name: "Day Closing History / Historical Print Eligibility", tests: ["v1-day-closing-history-test.js"] },
    { name: "Startup / Readiness Guards", tests: ["r10-4-startup-readiness-test.js"] }
];

const manualChecks = [
    "POS-80 physical print",
    "Barcode scanner",
    "Windows packaged navigation/focus",
    "Startup splash visual acceptance",
    "Actual Email delivery",
    "Actual Google Sheets DSR sync",
    "Production backup path",
    "Production restart / business-day persistence"
];

function runTest(test) {
    const testFile = typeof test === "string" ? test : test.file;
    const runtime = typeof test === "string" ? "node" : test.runtime;
    const executable = runtime === "electron" ? require("electron") : process.execPath;
    const command = `${runtime} scripts\\${testFile}`;
    const startedAt = process.hrtime.bigint();
    const args = runtime === "electron"
        ? ["--disable-gpu", "--in-process-gpu", path.join(__dirname, testFile)]
        : [path.join(__dirname, testFile)];
    const result = spawnSync(executable, args, {
        cwd: repositoryRoot,
        env: { ...process.env },
        encoding: "utf8",
        timeout: 240000,
        windowsHide: true
    });
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const timedOut = result.error && result.error.code === "ETIMEDOUT";
    const exitCode = timedOut ? null : result.status;
    return {
        command,
        durationMs,
        exitCode,
        passed: exitCode === 0,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        error: result.error ? result.error.message : ""
    };
}

function printOutput(result) {
    const output = `${result.stdout}${result.stderr}`.trim();
    if (!output) return;
    const lines = output.split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(-3).join(" | ");
    process.stdout.write(`      ${tail}\n`);
}

function main() {
    process.stdout.write("============================================================\n");
    process.stdout.write("KLBS V1.0.0 FINAL GO-LIVE REGRESSION\n");
    process.stdout.write("============================================================\n\n");

    const results = [];
    for (const suite of suites) {
        const startedAt = process.hrtime.bigint();
        const testResults = suite.tests.map(runTest);
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const passed = testResults.every(result => result.passed);
        results.push({ suite, testResults, durationMs, passed });

        process.stdout.write(`[${passed ? "PASS" : "FAIL"}] ${suite.name} (${durationMs.toFixed(0)} ms)\n`);
        for (const result of testResults) {
            if (!result.passed) {
                process.stdout.write(`      FAILED: ${result.command} (exit ${result.exitCode === null ? "timeout" : result.exitCode})\n`);
                if (result.error) process.stdout.write(`      ERROR: ${result.error}\n`);
            }
            printOutput(result);
        }
    }

    const passedCount = results.filter(result => result.passed).length;
    const failed = results.filter(result => !result.passed);
    process.stdout.write("\n============================================================\n");
    process.stdout.write("RESULT\n");
    process.stdout.write("============================================================\n");
    process.stdout.write(`Automated suites: ${results.length}\n`);
    process.stdout.write(`Passed: ${passedCount}\n`);
    process.stdout.write(`Failed: ${failed.length}\n`);
    if (failed.length) {
        process.stdout.write("Failed suites / commands:\n");
        for (const item of failed) {
            for (const result of item.testResults.filter(value => !value.passed)) {
                process.stdout.write(`- ${item.suite.name}: ${result.command}\n`);
            }
        }
    }
    process.stdout.write(`\nAUTOMATED GO-LIVE GATE: ${failed.length ? "FAIL" : "PASS"}\n\n`);
    process.stdout.write("MANUAL GO-LIVE CHECKS STILL REQUIRED:\n");
    for (const check of manualChecks) process.stdout.write(`[ ] ${check}\n`);
    process.stdout.write("============================================================\n");
    return failed.length ? 1 : 0;
}

process.exitCode = main();
