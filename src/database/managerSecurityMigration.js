const { isCredentialRecord } = require("../services/credentialCrypto");

function migrateManagerSecurity(database) {
    const run = (sql, params = []) => new Promise((resolve, reject) => {
        database.run(sql, params, function(error) {
            error ? reject(error) : resolve(this);
        });
    });
    const all = (sql, params = []) => new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
    const get = (sql, params = []) => new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    });

    return (async () => {
        let started = false;
        try {
            await run("BEGIN IMMEDIATE TRANSACTION");
            started = true;
            const columns = await all("PRAGMA table_info(settings)");
            if (!columns.length) throw new Error("Manager security migration requires the settings table.");
            const names = new Set(columns.map(column => column.name));
            if (!names.has("manager_pin_hash")) {
                await run("ALTER TABLE settings ADD COLUMN manager_pin_hash TEXT");
            }
            if (!names.has("manager_security_initialized")) {
                await run(`
                    ALTER TABLE settings ADD COLUMN manager_security_initialized
                    INTEGER NOT NULL DEFAULT 0
                    CHECK (manager_security_initialized IN (0, 1))
                `);
            }
            const row = await get(`
                SELECT manager_pin_hash, manager_security_initialized
                FROM settings WHERE id = 1
            `);
            if (!row) throw new Error("Manager security migration requires settings row id 1.");
            await run(`
                UPDATE settings SET manager_security_initialized = ? WHERE id = 1
            `, [isCredentialRecord(row.manager_pin_hash) ? 1 : 0]);
            await run("COMMIT");
            started = false;
            console.log("✓ Manager security migration complete");
        }
        catch (error) {
            if (started) await run("ROLLBACK").catch(() => {});
            throw error;
        }
    })();
}

module.exports = { migrateManagerSecurity };
