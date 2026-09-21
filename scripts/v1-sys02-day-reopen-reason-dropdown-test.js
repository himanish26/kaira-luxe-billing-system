const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const reasons = require(path.join(root, "src/renderer/shared/dayReopenReasons.js"));
const expectedReasons = [
    "Late Night Customer",
    "Payment Mode Correction",
    "Inventory Correction",
    "Other Operational Issue"
];

assert.deepStrictEqual(reasons.DAY_REOPEN_REASONS, expectedReasons);
assert.strictEqual(reasons.isValidDayReopenReason(""), false);
assert.strictEqual(reasons.isValidDayReopenReason("Select Reopen Reason"), false);
for (const reason of expectedReasons) {
    assert.strictEqual(reasons.isValidDayReopenReason(reason), true);
}
assert.strictEqual(reasons.isValidDayReopenReason("arbitrary free text"), false);

const normal = read("src/renderer/modules/system/dayClosing.js");
const splashHtml = read("src/renderer/startupSplash.html");
const splash = read("src/renderer/startupSplash.js");
const normalStyles = read("src/renderer/styles/settings.css");
const splashStyles = read("src/renderer/styles/startup.css");
const index = read("src/renderer/index.html");

assert.match(normal, /<select\s+id="dayReopenReasonInput"/);
assert.doesNotMatch(normal, /<textarea[\s\S]*id="dayReopenReasonInput"/);
assert.match(normal, /<option value="">Select Reopen Reason<\/option>/);
assert.match(normal, /window\.KLBS_DAY_REOPEN_REASONS[\s\S]*\.map\(reason/);
assert.match(normal, /window\.KLBS_isValidDayReopenReason\(reason\)/);
assert.match(normal, /window\.electronAPI\.reopenBusinessDay\(grant, reason\)/);

assert.match(splashHtml, /<select id="reopenReason" required><option value="">Select Reopen Reason<\/option><\/select>/);
assert.doesNotMatch(splashHtml, /<textarea[^>]*id="reopenReason"/);
assert.match(splash, /window\.KLBS_DAY_REOPEN_REASONS\.forEach\(reason/);
assert.match(splash, /window\.KLBS_isValidDayReopenReason\(reason\)/);
assert.match(splash, /startupAPI\.reopenClosedDay\(\{ reason, pin \}\)/);

assert.match(index, /<script src="shared\/dayReopenReasons\.js"><\/script>/);
assert.match(splashHtml, /<script src="shared\/dayReopenReasons\.js"><\/script>/);
assert.match(normalStyles, /\.day-reopen-reason-select\{/);
assert.match(splashStyles, /\.reopen-panel select/);

// The controlled UI must still pass the existing reason argument through to
// the unchanged reopen persistence service, which retains historical values.
const service = read("src/database/dayClosingService.js");
assert.match(service, /reopen_reason = \?/);
assert.match(service, /normalizedReason/);

// The password/PIN controls remain outside the changed reason-control paths.
assert.match(splashHtml, /id="reopenPin" type="password" inputmode="numeric" maxlength="4"/);
assert.match(splash, /!\/\^\\d\{4\}\$\/.test\(pin\)/);

console.log("SYS-02 day reopen reason dropdown tests: PASS (20 assertions)");
