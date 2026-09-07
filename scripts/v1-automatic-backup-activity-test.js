const assert = require("assert");
const path = require("path");

const activityServicePath = path.resolve(__dirname, "../src/database/activityService.js");
const logServicePath = path.resolve(__dirname, "../src/database/logService.js");
const databasePath = path.resolve(__dirname, "../src/database/database.js");
const events = [];
require.cache[activityServicePath] = {
    id: activityServicePath,
    filename: activityServicePath,
    loaded: true,
    exports: { logActivity: async event => events.push(event) }
};
const logService = require(logServicePath);
delete require.cache[activityServicePath];
require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: {}
};
const { normalizeActivity } = require(activityServicePath);

async function main() {
    for (const [frequency, label] of [
        ["DAILY", "Daily"],
        ["EVERY_6_HOURS", "Every 6 Hours"],
        ["EVERY_3_HOURS", "Every 3 Hours"],
        ["EVERY_1_HOUR", "Every 1 Hour"]
    ]) {
        events.length = 0;
        await logService.logAutomaticBackupCreated(`KL_Backup_${frequency}.zip`, frequency);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].category, "BACKUP");
        assert.strictEqual(events[0].action, "AUTOMATIC_BACKUP_CREATED");
        assert.strictEqual(events[0].status, "SUCCESS");
        assert.strictEqual(events[0].reference_no, `KL_Backup_${frequency}.zip`);
        assert(events[0].details.endsWith(`- ${label}`));
        assert.strictEqual(normalizeActivity(events[0]).action, "AUTOMATIC_BACKUP_CREATED");
        assert(!JSON.stringify(events[0]).match(/pin|grant|token|secret|credential/i));
    }

    events.length = 0;
    await logService.logAutomaticBackupFailed("Unable to write C:\\private\\backup.zip; token=hidden");
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].action, "AUTOMATIC_BACKUP_FAILED");
    assert.strictEqual(events[0].status, "FAILED");
    const failed = normalizeActivity(events[0]);
    assert(!JSON.stringify(failed).includes("private"));
    assert(!JSON.stringify(failed).includes("hidden"));
    console.log("V1 automatic backup Activity Log tests: PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
