const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    saveAutomaticBackupSettings
} = require("../src/renderer/modules/system/backup");

const settings = {
    auto_backup_enabled: 1,
    auto_backup_frequency: "EVERY_1_HOUR",
    auto_backup_time: "21:30",
    last_updated: "2026-09-07T12:00:00.000Z"
};

async function main() {
    let authorizationCalls = 0;
    let saveCalls = [];
    let nextGrant = "grant-1";
    const requestAuthorization = async purpose => {
        assert.strictEqual(purpose, "AUTO_BACKUP_SETTINGS");
        authorizationCalls += 1;
        return nextGrant;
    };
    const saveSettings = async (data, grant) => {
        saveCalls.push({ data, grant });
        return { success: true };
    };

    assert.deepStrictEqual(
        await saveAutomaticBackupSettings(settings, { requestAuthorization, saveSettings }),
        { success: true }
    );
    assert.strictEqual(authorizationCalls, 1);
    assert.strictEqual(saveCalls.length, 1);
    assert.strictEqual(saveCalls[0].grant, "grant-1");

    nextGrant = "grant-2";
    await saveAutomaticBackupSettings(settings, { requestAuthorization, saveSettings });
    assert.strictEqual(authorizationCalls, 2);
    assert.strictEqual(saveCalls.length, 2);
    assert.strictEqual(saveCalls[1].grant, "grant-2");
    assert.notStrictEqual(saveCalls[0].grant, saveCalls[1].grant);

    let cancelledSaveCalls = 0;
    const cancelled = await saveAutomaticBackupSettings(settings, {
        requestAuthorization: async () => null,
        saveSettings: async () => { cancelledSaveCalls += 1; }
    });
    assert.strictEqual(cancelled, null);
    assert.strictEqual(cancelledSaveCalls, 0);

    let consumed = false;
    const consumeOnce = async (_data, grant) => {
        if (consumed || grant !== "one-shot") {
            throw new Error("Required authorization is missing, invalid, or has expired.");
        }
        consumed = true;
        return { success: true };
    };
    const oneShotAuthorization = async () => "one-shot";
    await saveAutomaticBackupSettings(settings, {
        requestAuthorization: oneShotAuthorization,
        saveSettings: consumeOnce
    });
    await assert.rejects(
        () => saveAutomaticBackupSettings(settings, {
            requestAuthorization: oneShotAuthorization,
            saveSettings: consumeOnce
        }),
        /Required authorization is missing, invalid, or has expired/
    );

    let retryGrant = "expired-grant";
    await assert.rejects(
        () => saveAutomaticBackupSettings(settings, {
            requestAuthorization: async () => retryGrant,
            saveSettings: async () => {
                throw new Error("Required authorization is missing, invalid, or has expired.");
            }
        }),
        /Required authorization is missing, invalid, or has expired/
    );
    retryGrant = "fresh-grant";
    const retryResult = await saveAutomaticBackupSettings(settings, {
        requestAuthorization: async () => retryGrant,
        saveSettings
    });
    assert.deepStrictEqual(retryResult, { success: true });
    assert.strictEqual(saveCalls[saveCalls.length - 1].grant, "fresh-grant");

    const source = fs.readFileSync(
        path.join(__dirname, "../src/renderer/modules/system/backup.js"),
        "utf8"
    );
    assert(source.includes('requestAuthorization("AUTO_BACKUP_SETTINGS")'));
    assert(source.includes("finally {\n        clearAutomaticBackupAuthorization();"));
    assert(source.includes("await saveAutomaticBackupSettings({"));
    assert(!source.includes('requireAdminAuthorization("AUTO_BACKUP_SETTINGS"'));
    assert(source.includes("catch (error)"));
    assert(source.includes('alert(error.message || "Automatic backup settings could not be saved.")'));

    const mainSource = fs.readFileSync(
        path.join(__dirname, "../src/main/main.js"),
        "utf8"
    );
    assert(mainSource.includes('requireSecurityGrant(grant, "AUTO_BACKUP_SETTINGS")'));

    console.log("V1 automatic backup authorization/navigation regression tests: PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
