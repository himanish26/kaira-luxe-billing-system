"use strict";

function run(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, error => error ? reject(error) : resolve());
    });
}

async function migrateStoreIdentity(database) {
    const timestamp = new Date().toISOString();
    await run(database, `
        CREATE TABLE stores (
            id INTEGER PRIMARY KEY,
            store_code TEXT NOT NULL UNIQUE,
            store_name TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `);
    await run(database, `
        CREATE TABLE store_context (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            current_store_id INTEGER NOT NULL,
            FOREIGN KEY (current_store_id) REFERENCES stores(id)
        )
    `);
    await run(database, `
        CREATE TRIGGER trg_stores_store_code_immutable
        BEFORE UPDATE OF store_code ON stores
        FOR EACH ROW
        WHEN NEW.store_code IS NOT OLD.store_code
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_STORE_CODE_IMMUTABLE');
        END
    `);
    await run(database, `
        INSERT INTO stores (id, store_code, store_name, status, created_at, updated_at)
        VALUES (1, 'KL001', 'Kaira Luxe', 'ACTIVE', ?, ?)
    `, [timestamp, timestamp]);
    await run(database, `
        INSERT INTO store_context (id, current_store_id) VALUES (1, 1)
    `);
}

module.exports = { migrateStoreIdentity };
