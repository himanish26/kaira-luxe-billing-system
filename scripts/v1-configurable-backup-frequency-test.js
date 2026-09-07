const assert = require("assert");
const {
    getIntervalMilliseconds,
    isScheduledBackupDue
} = require("../src/services/backupScheduleLogic");
const {
    isPositivelyIdentifiedScheduledAutomatic,
    shouldDeleteScheduledAutomaticBackup
} = require("../src/services/scheduledBackupRetentionLogic");

const base = {
    auto_backup_enabled: 1,
    auto_backup_time: "21:30"
};
const at = value => new Date(value);

assert.strictEqual(isScheduledBackupDue({ ...base }, at("2026-09-07T16:00:00Z")), true);
assert.strictEqual(isScheduledBackupDue({ ...base }, at("2026-09-07T16:00:00Z"), "2026-09-07"), false);
assert.strictEqual(isScheduledBackupDue({ ...base }, at("2026-09-07T16:01:00Z")), false);
assert.strictEqual(isScheduledBackupDue({ ...base }, at("2026-09-08T16:00:00Z")), true);
assert.strictEqual(isScheduledBackupDue({ ...base }, at("2026-09-08T00:00:00Z")), false);

for (const [frequency, hours] of [["EVERY_6_HOURS", 6], ["EVERY_3_HOURS", 3], ["EVERY_1_HOUR", 1]]) {
    const last = "2026-09-07T04:47:00Z";
    const settings = { ...base, auto_backup_frequency: frequency, auto_backup_last_success_at: last };
    assert.strictEqual(getIntervalMilliseconds(frequency), hours * 60 * 60 * 1000);
    const beforeDue = new Date(at(last).getTime() + hours * 60 * 60 * 1000 - 1);
    assert.strictEqual(isScheduledBackupDue(settings, beforeDue), false);
    assert.strictEqual(isScheduledBackupDue(settings, at(`2026-09-07T${String(4 + hours).padStart(2, "0")}:47:00Z`)), true);
}

assert.strictEqual(isScheduledBackupDue({ ...base, auto_backup_frequency: "EVERY_3_HOURS" }, at("2026-09-07T08:00:00Z")), true);
assert.strictEqual(isScheduledBackupDue({ ...base, auto_backup_frequency: "EVERY_3_HOURS", auto_backup_last_success_at: "2026-09-07T06:00:00Z" }, at("2026-09-07T08:59:59Z")), false);
assert.strictEqual(isScheduledBackupDue({ ...base, auto_backup_frequency: "EVERY_3_HOURS", auto_backup_last_success_at: "2026-09-07T06:00:00Z" }, at("2026-09-07T09:00:00Z")), true);
assert.strictEqual(isScheduledBackupDue({ ...base, auto_backup_frequency: "EVERY_1_HOUR", auto_backup_last_success_at: "2026-09-07T00:00:00Z" }, at("2026-09-07T02:00:00Z")), true);
assert.strictEqual(isScheduledBackupDue({ ...base, auto_backup_enabled: 0, auto_backup_frequency: "EVERY_1_HOUR" }, at("2026-09-07T02:00:00Z")), false);
assert.strictEqual(isScheduledBackupDue({ ...base, auto_backup_frequency: "UNKNOWN" }, at("2026-09-07T16:00:00Z")), true);

const oldDate = { purpose: "SCHEDULED_AUTOMATIC", createdOn: "2026-08-30T10:00:00Z" };
const recentDate = { purpose: "SCHEDULED_AUTOMATIC", createdOn: "2026-09-05T10:00:00Z" };
assert.strictEqual(isPositivelyIdentifiedScheduledAutomatic(oldDate), true);
assert.strictEqual(shouldDeleteScheduledAutomaticBackup(oldDate, at("2026-09-07T10:00:00Z")), true);
assert.strictEqual(shouldDeleteScheduledAutomaticBackup(recentDate, at("2026-09-07T10:00:00Z")), false);
for (const purpose of ["BACKUP", "PRE_UPGRADE", "DAY_CLOSING", "PRE_RESTORE", undefined]) {
    assert.strictEqual(isPositivelyIdentifiedScheduledAutomatic({ purpose, createdOn: oldDate.createdOn }), false);
    assert.strictEqual(shouldDeleteScheduledAutomaticBackup({ purpose, createdOn: oldDate.createdOn }, at("2026-09-07T10:00:00Z")), false);
}
assert.strictEqual(shouldDeleteScheduledAutomaticBackup({ createdOn: oldDate.createdOn }, at("2026-09-07T10:00:00Z")), false);

console.log("V1 configurable backup frequency schedule tests passed.");
