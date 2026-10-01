"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const protectedProductionDb = path.resolve("C:\\Users\\USER\\AppData\\Roaming\\KAIRA LUXE BILLING SYSTEM\\billing.db");
const protectedReleaseCopy = path.resolve("D:\\KLBS\\KLBS_V110_RELEASE_TEST_2026-09-24.db");

const groups = [
    { name: "FOUNDATION", tests: [
        "v1-schema-version-compatibility-test.js", "v1-reg02-production-db-migration-test.js",
        "r09-9a1-admin-audit-test.js", "r09-9c-s1-settings-activity-test.js",
        "r09-manager-admin-separation-test.js", "r10-4-startup-readiness-test.js"
    ] },
    { name: "PRODUCT/INVENTORY", tests: [
        "v1-product-master-validation-test.js", "v1-product-import-failure-activity-test.js",
        "v1-inventory-performance-regression-test.js", "v1-inv02-inventory-search-state-reset-test.js",
        "v1-inventory-ux-xlsx-business-segment-test.js", "v1-business-segment-report-test.js",
        "v1-business-segment-dsr-apps-script-test.js", "v1-business-segment-dsr-stage3b-test.js",
        "v1-business-segment-dsr-sync-test.js"
    ] },
    { name: "BILLING/PAYMENTS", tests: [
        "v1-h01-authoritative-billing-test.js", "v1-store-credit-exact-value-redemption-test.js",
        "v1-c1a-segment-payment-allocator-test.js", "v1-authorization-grant-retry-safety-test.js",
        "v1-authorization-ttl-regression-test.js", "v1-return-reason-regression-test.js"
    ] },
    { name: "SECURITY/F&F", tests: [
        "r09-10b-technical-logger-test.js", "v1-automatic-backup-authorization-navigation-test.js",
        "v1-automatic-backup-activity-test.js", "v1-automatic-backup-parent-card-test.js"
    ] },
    { name: "RETURNS/SC/GV", tests: [
        "v1-stable-gate-follow-up-test.js", "v1-stable-gate-targeted-test.js"
    ] },
    { name: "REPORTS/EXPORTS", tests: [
        "v1-inventory-ux-xlsx-business-segment-test.js"
    ] },
    { name: "DAY CLOSING/BACKUP", tests: [
        "v1-stable-gate-final-targeted-test.js", "v1-stable-gate-blocker-regression-test.js",
        "v1-day-closing-history-test.js", "v1-pre-upgrade-backup-test.js",
        "v1-restore-safety-test.js", "v1-restore-quiesce-test.js",
        "v1-configurable-backup-frequency-test.js", "r10-7b-backup-concurrency-test.js"
    ] },
    { name: "DSR CONSOLIDATED", tests: [
        "v1-c1b-c1c-consolidated-payload-test.js", "v1-c2-c3-durable-reporting-day-closing-test.js",
        "v1-c4a-consolidated-transport-foundation-test.js", "v1-c4b-consolidated-reporting-recovery-migration-test.js",
        "v1-c4c-consolidated-sheet-delivery-worker-test.js", "v1-c4d-auth-compatibility-test.js",
        "v1-c4d-failed-job-retry-test.js", "v1-dsr08-phase2-single-pipeline-test.js",
        "v11-day-closing-sequence-recovery-test.js",
        "v2-legacy-dsr-retirement-test.js",
        "c4d-job2-unchanged-repair-test.js", "c4d-v16-job2-idempotency-verifier-test.js"
    ] },
    { name: "RECLOSE/RECOVERY", tests: [
        "v1-dsr-outbox-repair-test.js", "v1-dsr-stale-processing-recovery-test.js",
        "v1-sys02-day-reopen-reason-dropdown-test.js"
    ] },
    { name: "LOG/NAVIGATION", tests: [
        "v1-history-pagination-regression-test.js", "v11-log01-activity-log-search-test.js",
        "v1-stable-gate-activity-outbox-test.js", "v2-ui-shortcut-modal-consistency-test.js"
    ] },
    { name: "STATIC/CONFIG", tests: [
        "r10-5-integrations-test.js", "r10-5b-integrations-final-polish-test.js",
        "r10-7a-production-env-isolation-test.js", "r10-7c-secure-update-pipeline-test.js",
        "r09-dsr-phase2-test.js"
    ] }
];

const manualOnly = [
    "Electron packaged startup and visual navigation", "all keyboard/menu shortcuts and modal focus",
    "thermal printer output/alignment and scanner hardware", "Excel openability and Windows save dialogs",
    "isolated real backup file creation and restore UI", "controlled live C4D Sheet delivery",
    "controlled consolidated email and attachment inspection", "restart/network recovery in win-unpacked",
    "Windows safeStorage/encrypted configuration with packaged app", "System Health visual/status acceptance",
    "Paytm/remote-access paths (not activated by current scope)"
];

function assertSafety() {
    if (path.resolve(process.cwd()) === protectedProductionDb || path.resolve(process.cwd()) === protectedReleaseCopy) {
        throw new Error("Regression runner was pointed at a protected database path.");
    }
    if (fs.existsSync(path.join(root, "billing.db"))) {
        // The runner itself never opens this file; retain the guard as an audit signal.
        process.stdout.write("[SAFETY] Repository billing.db exists but is not opened by this runner.\n");
    }
}

function runTest(file) {
    const started = Date.now();
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
        cwd: root,
        env: { ...process.env, KLBS_RELEASE_REGRESSION: "1" },
        encoding: "utf8",
        timeout: 240000,
        windowsHide: true
    });
    return {
        file,
        passed: result.status === 0,
        exitCode: result.status,
        durationMs: Date.now() - started,
        output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
        error: result.error ? result.error.message : ""
    };
}

function runSyntaxCheck() {
    const files = [
        ...fs.readdirSync(path.join(root, "src"), { recursive: true }).filter(file => String(file).endsWith(".js")).map(file => path.join(root, "src", file)),
        ...fs.readdirSync(path.join(root, "scripts"), { recursive: true }).filter(file => String(file).endsWith(".js")).map(file => path.join(root, "scripts", file))
    ];
    const failures = [];
    for (const file of files) {
        const result = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8", windowsHide: true });
        if (result.status !== 0) failures.push({ file: path.relative(root, file), output: `${result.stdout || ""}${result.stderr || ""}`.trim() });
    }
    return { count: files.length, failures };
}

function main() {
    assertSafety();
    const results = [];
    let total = 0;
    process.stdout.write("KLBS V1.1.0 COMPLETE SAFE AUTOMATED RELEASE REGRESSION\n\n");
    for (const group of groups) {
        process.stdout.write(`[${group.name}]\n`);
        for (const file of group.tests) {
            total += 1;
            const result = runTest(file);
            results.push({ group: group.name, ...result });
            process.stdout.write(`  [${result.passed ? "PASS" : "FAIL"}] ${file} (${result.durationMs} ms)\n`);
            if (!result.passed) process.stdout.write(`      ${(result.error || result.output).split(/\r?\n/).slice(-4).join(" | ")}\n`);
        }
        process.stdout.write("\n");
    }
    const syntax = runSyntaxCheck();
    process.stdout.write(`[STATIC] node --check ${syntax.count} JS files: ${syntax.failures.length ? "FAIL" : "PASS"}\n`);
    for (const failure of syntax.failures) process.stdout.write(`  [FAIL] ${failure.file}: ${failure.output}\n`);
    const failed = results.filter(result => !result.passed);
    process.stdout.write("\n============================================================\n");
    process.stdout.write(`Master suites executed: ${total}\n`);
    process.stdout.write(`PASS: ${total - failed.length}\nFAIL: ${failed.length + syntax.failures.length}\n`);
    process.stdout.write(`Manual-only items: ${manualOnly.length}\n`);
    process.stdout.write(`Critical skipped tests: 0 (safe automated scope is explicit; manual-only items are listed separately)\n`);
    if (failed.length) for (const item of failed) process.stdout.write(`FAILED SUITE: ${item.group}/${item.file}\n`);
    process.stdout.write(`COMPLETE AUTOMATED REGRESSION: ${failed.length || syntax.failures.length ? "FAIL" : "PASS"}\n`);
    return failed.length || syntax.failures.length ? 1 : 0;
}

process.exitCode = main();
