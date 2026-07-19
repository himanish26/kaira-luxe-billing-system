const db = require("./database");

function initializeStoreSettings() {

    const row = db
        .prepare(
            "SELECT COUNT(*) AS count FROM store_settings"
        )
        .get();

    if (row.count === 0) {

        db.prepare(`
            INSERT INTO store_settings
            (
                id,
                receipt_message,
                last_updated
            )
            VALUES
            (
                1,
                '',
                ''
            )
        `).run();

    }

}

function getStoreSettings() {

    return db.prepare(
        `
        SELECT
            receipt_message,
            last_updated
        FROM store_settings
        WHERE id = 1
        `
    ).get();

}

function saveStoreSettings(data) {

    db.prepare(
        `
        UPDATE store_settings
        SET
            receipt_message = ?,
            last_updated = ?
        WHERE id = 1
        `
    ).run(
        data.receipt_message,
        data.last_updated
    );

}

module.exports = {

    initializeStoreSettings,

    getStoreSettings,

    saveStoreSettings

};