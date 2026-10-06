const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    BYPASS_ENVIRONMENT_VARIABLE,
    isDevelopmentBusinessDayGateBypassEnabled,
    isPendingPreviousBusinessDayFailure,
    areStartupChecksBlocked
} = require("../src/main/developmentStartupGate");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const main = read("src/main/main.js");
const splash = read("src/renderer/startupSplash.js");
const splashHtml = read("src/renderer/startupSplash.html");
const renderer = read("src/renderer/app.js");
const operationalHtml = read("src/renderer/index.html");
const preload = read("src/main/preload.js");
const packageJson = require(path.join(root, "package.json"));
const devLauncher = read("scripts/dev-launch.js");

const pending = {
    id: "businessDay",
    critical: true,
    state: "failed",
    action: "closePreviousBusinessDay",
    pendingPreviousBusinessDate: "2026-10-01"
};

assert.strictEqual(BYPASS_ENVIRONMENT_VARIABLE, "KLBS_DEV_BYPASS_BUSINESS_DAY_GATE");
assert.strictEqual(packageJson.version, "2.0.0");
assert.strictEqual(packageJson.scripts.start, "electron .", "normal npm start remains unchanged");
assert.strictEqual(packageJson.scripts.dev, "node scripts/dev-launch.js");
assert.match(devLauncher, /spawn\(process\.execPath, \[npmCli, "start"\]/);
assert.match(devLauncher, /env: launchEnvironment/);
assert.strictEqual(isDevelopmentBusinessDayGateBypassEnabled({ isPackaged: false, env: {} }), false);
assert.strictEqual(isDevelopmentBusinessDayGateBypassEnabled({ isPackaged: false, env: { [BYPASS_ENVIRONMENT_VARIABLE]: "0" } }), false);
assert.strictEqual(isDevelopmentBusinessDayGateBypassEnabled({ isPackaged: false, env: { [BYPASS_ENVIRONMENT_VARIABLE]: "true" } }), false);
assert.strictEqual(isDevelopmentBusinessDayGateBypassEnabled({ isPackaged: false, env: { [BYPASS_ENVIRONMENT_VARIABLE]: "1" } }), true);
assert.strictEqual(isDevelopmentBusinessDayGateBypassEnabled({ isPackaged: true, env: { [BYPASS_ENVIRONMENT_VARIABLE]: "1" } }), false);

assert.strictEqual(isPendingPreviousBusinessDayFailure(pending), true);
assert.strictEqual(areStartupChecksBlocked([pending]), true, "bypass absent retains normal blocking");
assert.strictEqual(areStartupChecksBlocked([pending], false), true, "disabled bypass retains normal blocking");
assert.strictEqual(areStartupChecksBlocked([pending], true), false, "valid development bypass permits only this pending-day failure");
assert.strictEqual(areStartupChecksBlocked([{ ...pending, pendingPreviousBusinessDate: "invalid" }], true), true);
assert.strictEqual(areStartupChecksBlocked([pending, { id: "database", critical: true, state: "failed" }], true), true);
const pendingBefore = JSON.stringify(pending);
areStartupChecksBlocked([pending], true);
assert.strictEqual(JSON.stringify(pending), pendingBefore, "readiness evaluation does not mutate pending business-day state");

assert.match(main, /const developmentBusinessDayGateBypassActive = isDevelopmentBusinessDayGateBypassEnabled\(\{\s*isPackaged: app\.isPackaged/);
assert.match(main, /if \(developmentBusinessDayGateBypassActive\) \{\s*return \{ success: false, error: "Day Closing is disabled while Development Bypass is active\." \};\s*\}/);
assert(main.includes('"startup:close-previous-day"'));
assert(main.includes('"close-business-day"'));
assert.match(main, /if \(developmentBusinessDayGateBypassActive\) return;[\s\S]{0,80}if \(integrationOutboxTimer\) return;/);
assert.match(main, /if \(!developmentBusinessDayGateBypassActive\) \{\s*startIntegrationOutboxDrain\(\);\s*remoteDashboard\.start\(\);/);
assert.match(main, /if \(developmentBusinessDayGateBypassActive\) \{\s*return \{ success: false, error: "Automatic integration retry is disabled/);
assert.match(main, /areStartupChecksBlocked\(readinessChecks, developmentBusinessDayGateBypassActive\)/);
assert(!/closeBusinessDay\s*\(/.test(read("src/main/developmentStartupGate.js")), "bypass helper must not call Day Closing");
assert(splashHtml.includes("DEVELOPMENT BYPASS ACTIVE — Day Closing disabled while Development Bypass is active."));
assert(splash.includes('finalStatus.querySelector("span").textContent = "DEVELOPMENT BYPASS ACTIVE"'));
assert(splash.includes('document.getElementById("closePreviousBtn").hidden = true'));
assert(splash.includes("if (!developmentBypassActive)"), "splash retry must not invoke Remote Dashboard retry in bypass mode");
assert(operationalHtml.includes("DEVELOPMENT MODE — BUSINESS DAY GATE BYPASSED"));
assert(renderer.includes("getDevelopmentStartupGateStatus()"));
assert(preload.includes('ipcRenderer.invoke("development:get-startup-gate-status")'));

console.log("PASS — development startup bypass activation and packaged guard");
console.log("PASS — pending-day readiness remains failed but is bypassable only in development");
console.log("PASS — other critical readiness failures remain blocking");
console.log("PASS — close routes and automatic startup integration retry are guarded");
console.log("PASS — development-only splash notice and operational warning are present");
