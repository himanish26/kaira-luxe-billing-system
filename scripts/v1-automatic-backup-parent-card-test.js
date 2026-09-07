const assert = require("assert");
const { formatAutomaticBackupCard } = require("../src/renderer/modules/system/backup");

assert.strictEqual(
    formatAutomaticBackupCard({ auto_backup_enabled: 1, auto_backup_frequency: "DAILY", auto_backup_time: "21:00" }),
    "Daily at <strong>09:00 PM</strong>"
);
assert.strictEqual(formatAutomaticBackupCard({ auto_backup_enabled: 1, auto_backup_frequency: "EVERY_6_HOURS" }), "Every 6 Hours");
assert.strictEqual(formatAutomaticBackupCard({ auto_backup_enabled: 1, auto_backup_frequency: "EVERY_3_HOURS" }), "Every 3 Hours");
assert.strictEqual(formatAutomaticBackupCard({ auto_backup_enabled: 1, auto_backup_frequency: "EVERY_1_HOUR" }), "Every 1 Hour");
assert.strictEqual(formatAutomaticBackupCard({ auto_backup_enabled: 0, auto_backup_frequency: "EVERY_1_HOUR" }), "Off");

let persisted = { auto_backup_enabled: 1, auto_backup_frequency: "DAILY", auto_backup_time: "21:00" };
assert.strictEqual(formatAutomaticBackupCard(persisted), "Daily at <strong>09:00 PM</strong>");
persisted = { auto_backup_enabled: 1, auto_backup_frequency: "EVERY_1_HOUR", auto_backup_time: "21:00" };
assert.strictEqual(formatAutomaticBackupCard(persisted), "Every 1 Hour");

console.log("V1 automatic backup parent card tests: PASS");
