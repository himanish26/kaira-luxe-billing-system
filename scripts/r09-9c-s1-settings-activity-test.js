const assert = require("assert");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const database = new sqlite3.Database(":memory:");
const databaseModule = path.resolve(__dirname, "../src/database/database.js");
require.cache[databaseModule] = {
    id: databaseModule,
    filename: databaseModule,
    loaded: true,
    exports: database
};

const { saveSettings, buildSettingsActivity } = require("../src/database/settingsService");
const { normalizeActivity } = require("../src/database/activityService");

const run = (sql, params = []) => new Promise((resolve, reject) => {
    database.run(sql, params, error => error ? reject(error) : resolve());
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
});

async function main() {
    await run(`
        CREATE TABLE settings (
            id INTEGER PRIMARY KEY,
            receipt_message TEXT,
            default_printer TEXT,
            backup_location TEXT,
            auto_backup_time TEXT,
            auto_backup_enabled INTEGER,
            auto_backup_frequency TEXT,
            auto_backup_last_success_at TEXT,
            smtp_host TEXT,
            smtp_port INTEGER,
            smtp_secure INTEGER,
            smtp_user TEXT,
            smtp_password TEXT,
            smtp_from TEXT,
            ff_enabled INTEGER,
            ff_discount_percent REAL,
            last_updated TEXT
        )
    `);
    await run(`
        INSERT INTO settings VALUES (
            1, 'Thank you', 'Printer A', 'C:\\KLBS\\Backups', '21:30', 1, 'DAILY', NULL,
            'smtp.example', 587, 1, 'mailer', 'existing-secret', 'store@example',
            0, 10, 'old timestamp'
        )
    `);
    await run(`
        CREATE TABLE activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            activity_date TEXT, activity_time TEXT, category TEXT, action TEXT,
            details TEXT, user_name TEXT, status TEXT, entity_type TEXT,
            reference_no TEXT, change_data TEXT, created_at TEXT
        )
    `);

    const events = [];
    const capture = event => events.push(event);
    let result = await saveSettings(
        { receipt_message: "Visit again", last_updated: "new timestamp" },
        { logActivity: capture }
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].action, "RECEIPT_FOOTER_UPDATED");
    assert.strictEqual(events[0].reference_no, "RECEIPT_SETTINGS");
    assert.strictEqual(events[0].details, "Receipt footer message changed");
    assert.strictEqual(events[0].user_name, "ADMINISTRATOR");
    assert.deepStrictEqual(events[0].change_data.changes, [{
        field: "receipt_footer_message",
        label: "Receipt Footer Message",
        old: "Thank you",
        new: "Visit again"
    }]);

    events.length = 0;
    result = await saveSettings(
        { receipt_message: "Visit again", last_updated: "newer timestamp" },
        { logActivity: capture }
    );
    assert.strictEqual(result.changed, false);
    assert.strictEqual(events.length, 0);

    const grouped = buildSettingsActivity(
        { ff_enabled: 0, ff_discount_percent: 10, default_printer: "Printer A" },
        { ff_enabled: 1, ff_discount_percent: 15, default_printer: "Printer A" },
        { ff_enabled: 1, ff_discount_percent: 15, default_printer: "Printer A" }
    );
    assert.strictEqual(grouped.action, "FAMILY_FRIENDS_SETTINGS_UPDATED");
    assert.strictEqual(grouped.change_data.changes.length, 2);
    assert(!grouped.change_data.changes.some(change => change.field === "default_printer"));

    const credentialAttempt = buildSettingsActivity(
        { smtp_password: "old-secret" },
        { smtp_password: "new-secret" },
        { smtp_password: "new-secret" }
    );
    assert.strictEqual(credentialAttempt, null);

    const sanitized = normalizeActivity({
        ...events[0],
        category: "SETTINGS",
        action: "RECEIPT_FOOTER_UPDATED",
        details: "password: should-not-appear",
        user_name: "ADMINISTRATOR",
        status: "SUCCESS",
        reference_no: "RECEIPT_SETTINGS",
        change_data: {
            version: 1,
            changes: [{
                field: "receipt_footer_message",
                label: "Receipt Footer Message",
                old: "password: old-secret",
                new: "password: new-secret"
            }]
        }
    });
    const serialized = JSON.stringify(sanitized);
    assert(!serialized.includes("should-not-appear"));
    assert(!serialized.includes("old-secret"));
    assert(!serialized.includes("new-secret"));

    const backup = normalizeActivity(buildSettingsActivity(
        { backup_location: "C:\\KLBS\\Old" },
        { backup_location: "C:\\KLBS\\New" },
        { backup_location: "C:\\KLBS\\New" }
    ));
    assert(!JSON.stringify(backup).includes("C:\\KLBS"));

    for (const [frequency, expected] of [
        ["DAILY", "Automatic Backup: ON, Frequency: Daily, Time: 09:30 PM"],
        ["EVERY_6_HOURS", "Automatic Backup: ON, Frequency: Every 6 Hours"],
        ["EVERY_3_HOURS", "Automatic Backup: ON, Frequency: Every 3 Hours"],
        ["EVERY_1_HOUR", "Automatic Backup: ON, Frequency: Every 1 Hour"]
    ]) {
        const activity = buildSettingsActivity(
            { auto_backup_enabled: 1, auto_backup_frequency: frequency === "DAILY" ? "EVERY_1_HOUR" : "DAILY", auto_backup_time: "21:30" },
            { auto_backup_enabled: 1, auto_backup_frequency: frequency, auto_backup_time: "21:30" },
            { auto_backup_frequency: frequency }
        );
        assert.strictEqual(activity.details, expected);
        assert.strictEqual(activity.action, "AUTO_BACKUP_SETTINGS_UPDATED");
        assert.strictEqual(normalizeActivity(activity).status, "SUCCESS");
        assert(!JSON.stringify(activity).match(/pin|grant|token|secret|credential/i));
    }
    const disabled = buildSettingsActivity(
        { auto_backup_enabled: 1, auto_backup_frequency: "DAILY", auto_backup_time: "21:30" },
        { auto_backup_enabled: 0, auto_backup_frequency: "DAILY", auto_backup_time: "21:30" },
        { auto_backup_enabled: 0 }
    );
    assert.strictEqual(disabled.details, "Automatic Backup: OFF");
    assert.strictEqual(normalizeActivity(disabled).change_data,
        JSON.stringify({ version: 1, changes: [{
            field: "active", label: "Automatic Backup Enabled", old: "1", new: "0"
        }] }));

    events.length = 0;
    result = await saveSettings(
        { default_printer: "Printer B" },
        { logActivity: capture }
    );
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].action, "PRINTER_SETTINGS_UPDATED");
    assert.strictEqual(events[0].user_name, "OPERATOR");

    result = await saveSettings(
        { default_printer: "Printer C" },
        { logActivity: async () => { throw new Error("injected log failure"); } }
    );
    assert.strictEqual(result.success, true);
    assert(result.activityWarning);

    const beforeAutomaticSave = await all(`
        SELECT * FROM activities
        WHERE category = 'SETTINGS' AND action = 'AUTO_BACKUP_SETTINGS_UPDATED'
    `);
    result = await saveSettings({
        auto_backup_enabled: 1,
        auto_backup_frequency: "EVERY_1_HOUR",
        auto_backup_time: "21:30",
        last_updated: "automatic backup timestamp"
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.activityWarning, null);
    const persistedAutomatic = await all(`
        SELECT * FROM activities
        WHERE category = 'SETTINGS' AND action = 'AUTO_BACKUP_SETTINGS_UPDATED'
          AND reference_no = 'AUTO_BACKUP_SETTINGS' AND status = 'SUCCESS'
    `);
    assert.strictEqual(persistedAutomatic.length - beforeAutomaticSave.length, 1);
    assert.strictEqual(persistedAutomatic[persistedAutomatic.length - 1].details,
        "Automatic Backup: ON, Frequency: Every 1 Hour");
    assert.strictEqual(persistedAutomatic[persistedAutomatic.length - 1].reference_no, "AUTO_BACKUP_SETTINGS");
    assert.strictEqual(persistedAutomatic[persistedAutomatic.length - 1].status, "SUCCESS");
    assert(!/pin|grant|token|secret|credential/i.test(JSON.stringify(persistedAutomatic[persistedAutomatic.length - 1])));

    const beforeUnchangedSave = persistedAutomatic.length;
    result = await saveSettings({
        auto_backup_enabled: 1,
        auto_backup_frequency: "EVERY_1_HOUR",
        auto_backup_time: "21:30",
        last_updated: "automatic backup unchanged timestamp"
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.activityWarning, null);
    const afterUnchangedSave = await all(`
        SELECT * FROM activities
        WHERE category = 'SETTINGS' AND action = 'AUTO_BACKUP_SETTINGS_UPDATED'
          AND reference_no = 'AUTO_BACKUP_SETTINGS' AND status = 'SUCCESS'
    `);
    assert.strictEqual(afterUnchangedSave.length - beforeUnchangedSave, 1);

    await new Promise(resolve => database.close(resolve));
    console.log("R09.9C-S1 focused settings activity tests: PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
