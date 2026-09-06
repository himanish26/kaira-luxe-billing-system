const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const {
    CURRENT_DB_SCHEMA_VERSION,
    SCHEMA_METADATA_TABLE,
    UnsupportedDatabaseSchemaError,
    prepareDatabaseSchema,
    readSchemaVersion,
    runForwardMigrations
} = require("../src/database/schemaVersion");

const run = (database, sql, params = []) => new Promise((resolve, reject) =>
    database.run(sql, params, error => error ? reject(error) : resolve()));
const get = (database, sql, params = []) => new Promise((resolve, reject) =>
    database.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
const exec = (database, sql) => new Promise((resolve, reject) =>
    database.exec(sql, error => error ? reject(error) : resolve()));
const close = database => new Promise((resolve, reject) =>
    database.close(error => error ? reject(error) : resolve()));
const open = filePath => new sqlite3.Database(filePath);

const BASE_SCHEMA = `
    CREATE TABLE products (id INTEGER PRIMARY KEY, product_name TEXT);
    CREATE TABLE bills (id INTEGER PRIMARY KEY, bill_no TEXT);
    CREATE TABLE settings (id INTEGER PRIMARY KEY);
    CREATE TABLE inventory_transactions (id INTEGER PRIMARY KEY, quantity INTEGER);
    CREATE TABLE day_closing (id INTEGER PRIMARY KEY, business_date TEXT);
`;
const createDatabase = async filePath => {
    const database = open(filePath);
    await exec(database, BASE_SCHEMA);
    return database;
};
const metadata = database => get(database,
    `SELECT schema_version FROM ${SCHEMA_METADATA_TABLE} WHERE id = 1`);
const prepare = (database, options = {}) => prepareDatabaseSchema({
    database,
    currentVersion: CURRENT_DB_SCHEMA_VERSION,
    runCurrentMigrations: options.runCurrentMigrations || (async () => {}),
    migrations: options.migrations || []
});

async function main() {
    assert.strictEqual(CURRENT_DB_SCHEMA_VERSION, 1);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-schema-version-"));
    try {
        // 1, 2, 7: fresh initialization, legacy adoption, and data preservation.
        const legacyPath = path.join(temporary, "legacy.db");
        let database = await createDatabase(legacyPath);
        await run(database, "INSERT INTO products VALUES (7, 'Test Product')");
        await run(database, "INSERT INTO bills VALUES (8, 'TEST-BILL')");
        await run(database, "INSERT INTO inventory_transactions VALUES (9, 3)");
        await run(database, "INSERT INTO day_closing VALUES (10, '2026-09-06')");
        await prepare(database);
        assert.strictEqual(await readSchemaVersion(database), 1);
        assert.strictEqual((await get(database, "SELECT product_name FROM products WHERE id = 7")).product_name, "Test Product");
        assert.strictEqual((await get(database, "SELECT bill_no FROM bills WHERE id = 8")).bill_no, "TEST-BILL");
        assert.strictEqual((await get(database, "SELECT quantity FROM inventory_transactions WHERE id = 9")).quantity, 3);
        assert.strictEqual((await get(database, "SELECT business_date FROM day_closing WHERE id = 10")).business_date, "2026-09-06");
        await prepare(database);
        assert.strictEqual((await metadata(database)).schema_version, 1);
        await close(database);

        // 1: fresh disposable database receives the current version.
        database = await createDatabase(path.join(temporary, "fresh.db"));
        await prepare(database);
        assert.strictEqual(await readSchemaVersion(database), CURRENT_DB_SCHEMA_VERSION);
        await close(database);

        // 3: current databases do not incur migration churn or version rewrites.
        database = await createDatabase(path.join(temporary, "current.db"));
        await prepare(database);
        let migrationRuns = 0;
        await prepare(database, { runCurrentMigrations: async () => { migrationRuns += 1; } });
        assert.strictEqual(migrationRuns, 0);
        assert.strictEqual((await metadata(database)).schema_version, 1);
        await close(database);

        // 4: newer databases are rejected and remain untouched.
        database = await createDatabase(path.join(temporary, "newer.db"));
        await run(database, `CREATE TABLE ${SCHEMA_METADATA_TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL)`);
        await run(database, `INSERT INTO ${SCHEMA_METADATA_TABLE} VALUES (1, 2)`);
        let normalMigrations = 0;
        await assert.rejects(() => prepare(database, {
            runCurrentMigrations: async () => { normalMigrations += 1; }
        }), error => error instanceof UnsupportedDatabaseSchemaError && error.code === "KLBS_DB_SCHEMA_NEWER");
        assert.strictEqual(normalMigrations, 0);
        assert.strictEqual((await metadata(database)).schema_version, 2);
        await close(database);

        // 5: a failed forward migration rolls back and leaves the source version.
        database = await createDatabase(path.join(temporary, "failure.db"));
        await run(database, `CREATE TABLE ${SCHEMA_METADATA_TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL)`);
        await run(database, `INSERT INTO ${SCHEMA_METADATA_TABLE} VALUES (1, 0)`);
        await assert.rejects(() => runForwardMigrations(database, 0, 1, [{
            name: "safe_failure_fixture", from: 0, to: 1,
            up: async db => { await run(db, "CREATE TABLE migration_fixture (id INTEGER PRIMARY KEY)"); throw new Error("fixture failure"); }
        }]));
        assert.strictEqual((await metadata(database)).schema_version, 0);
        assert.strictEqual(await get(database, "SELECT name FROM sqlite_master WHERE name = 'migration_fixture'"), undefined);
        await close(database);

        // 6: ordered forward steps run once and advance one version at a time.
        database = await createDatabase(path.join(temporary, "forward.db"));
        await run(database, `CREATE TABLE ${SCHEMA_METADATA_TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL)`);
        await run(database, `INSERT INTO ${SCHEMA_METADATA_TABLE} VALUES (1, 0)`);
        const steps = [
            { name: "fixture_0_to_1", from: 0, to: 1, up: async db => run(db, "CREATE TABLE step_one (id INTEGER PRIMARY KEY)") },
            { name: "fixture_1_to_2", from: 1, to: 2, up: async db => run(db, "CREATE TABLE step_two (id INTEGER PRIMARY KEY)") }
        ];
        await runForwardMigrations(database, 0, 2, steps);
        assert.strictEqual(await readSchemaVersion(database), 2);
        await close(database);

        // 8: an ordinary SQLite file copy preserves the in-database version.
        const backupPath = path.join(temporary, "backup.db");
        fs.copyFileSync(path.join(temporary, "legacy.db"), backupPath);
        database = open(backupPath);
        assert.strictEqual(await readSchemaVersion(database), 1);
        await close(database);
        console.log("PASS V1 schema version compatibility: fresh, legacy, current, newer refusal, failure rollback, repeated startup, preservation, and SQLite copy");
    }
    finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
