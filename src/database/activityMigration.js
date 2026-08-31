function migrateActivityLogSchema(db) {
    const run = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function(error) {
            error ? reject(error) : resolve({ changes: this.changes });
        });
    });
    const all = sql => new Promise((resolve, reject) => {
        db.all(sql, [], (error, rows) => error ? reject(error) : resolve(rows));
    });

    return (async () => {
        let transactionStarted = false;
        try {
            await run("BEGIN IMMEDIATE TRANSACTION");
            transactionStarted = true;
            const before = await all("SELECT * FROM activities ORDER BY id");
            const columns = await all("PRAGMA table_info(activities)");
            const existing = new Set(columns.map(column => column.name));
            const additions = [
                ["entity_type", "ALTER TABLE activities ADD COLUMN entity_type TEXT"],
                ["reference_no", "ALTER TABLE activities ADD COLUMN reference_no TEXT"],
                ["change_data", "ALTER TABLE activities ADD COLUMN change_data TEXT"],
                ["created_at", "ALTER TABLE activities ADD COLUMN created_at TEXT"]
            ];
            for (const [name, sql] of additions) {
                if (!existing.has(name)) await run(sql);
            }
            await run(`
                CREATE INDEX IF NOT EXISTS idx_activities_category_reference
                ON activities (category, reference_no)
            `);
            const after = await all("SELECT * FROM activities ORDER BY id");
            if (after.length !== before.length || before.some((row, index) =>
                Object.keys(row).some(key => row[key] !== after[index][key])
            )) {
                throw new Error("Activity Log migration changed historical rows.");
            }
            const verified = new Set(
                (await all("PRAGMA table_info(activities)")).map(column => column.name)
            );
            if (additions.some(([name]) => !verified.has(name))) {
                throw new Error("Activity Log schema verification failed.");
            }
            await run("COMMIT");
            transactionStarted = false;
            return { migrated: additions.filter(([name]) => !existing.has(name)).map(([name]) => name) };
        }
        catch (error) {
            if (transactionStarted) await run("ROLLBACK").catch(() => {});
            throw error;
        }
    })();
}

module.exports = { migrateActivityLogSchema };
