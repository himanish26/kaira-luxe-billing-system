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

async function main() {
    await run(`
        CREATE TABLE settings (
            id INTEGER PRIMARY KEY,
            receipt_message TEXT,
            default_printer TEXT,
            backup_location TEXT,
            auto_backup_time TEXT,
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
            1, 'Thank you', 'Printer A', 'C:\\KLBS\\Backups', '21:30',
            'smtp.example', 587, 1, 'mailer', 'existing-secret', 'store@example',
            0, 10, 'old timestamp'
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

    await new Promise(resolve => database.close(resolve));
    console.log("R09.9C-S1 focused settings activity tests: PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
