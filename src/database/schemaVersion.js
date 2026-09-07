const CURRENT_DB_SCHEMA_VERSION = 2;
const SCHEMA_METADATA_TABLE = "klbs_schema_metadata";

function run(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, error => error ? reject(error) : resolve());
    });
}

function get(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    });
}

function all(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
    });
}

class UnsupportedDatabaseSchemaError extends Error {
    constructor(version) {
        super("The KLBS database schema is newer than this application supports.");
        this.name = "UnsupportedDatabaseSchemaError";
        this.code = "KLBS_DB_SCHEMA_NEWER";
        this.databaseVersion = version;
        this.userMessage = "DATABASE VERSION NOT SUPPORTED";
    }
}

async function ensureMetadataTable(database) {
    await run(database, `
        CREATE TABLE IF NOT EXISTS ${SCHEMA_METADATA_TABLE} (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL CHECK (schema_version >= 0)
        )
    `);
}

async function readSchemaVersion(database) {
    const row = await get(database,
        `SELECT schema_version FROM ${SCHEMA_METADATA_TABLE} WHERE id = 1`);
    if (!row) return null;
    const version = Number(row.schema_version);
    if (!Number.isInteger(version) || version < 0) {
        throw new Error("KLBS database schema metadata contains an invalid version.");
    }
    return version;
}

async function writeSchemaVersion(database, version) {
    if (!Number.isInteger(version) || version < 0) {
        throw new Error("KLBS database schema version must be a non-negative integer.");
    }
    await run(database, `
        INSERT INTO ${SCHEMA_METADATA_TABLE} (id, schema_version)
        VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version
    `, [version]);
}

async function assertSupportedSchemaVersion(version, currentVersion = CURRENT_DB_SCHEMA_VERSION) {
    if (version !== null && version > currentVersion) {
        throw new UnsupportedDatabaseSchemaError(version);
    }
    if (version !== null && version < 0) {
        throw new Error("KLBS database schema version cannot be negative.");
    }
}

function findMigration(steps, source, target) {
    return (steps || []).find(step =>
        step && step.from === source && step.to === target && typeof step.up === "function");
}

function migrateAutomaticBackupSettings(database) {
    return all(database, "PRAGMA table_info(settings)").then(async columns => {
        const existing = new Set(columns.map(column => column.name));
        const additions = [
            ["auto_backup_enabled", "ALTER TABLE settings ADD COLUMN auto_backup_enabled INTEGER NOT NULL DEFAULT 1 CHECK (auto_backup_enabled IN (0, 1))"],
            ["auto_backup_frequency", "ALTER TABLE settings ADD COLUMN auto_backup_frequency TEXT NOT NULL DEFAULT 'DAILY'"],
            ["auto_backup_last_success_at", "ALTER TABLE settings ADD COLUMN auto_backup_last_success_at TEXT"]
        ];
        for (const [name, sql] of additions) {
            if (!existing.has(name)) await run(database, sql);
        }
    });
}

async function runForwardMigrations(database, sourceVersion, targetVersion, steps = [], logger = null) {
    if (sourceVersion === null || sourceVersion === targetVersion) return sourceVersion;
    if (!Number.isInteger(sourceVersion) || sourceVersion > targetVersion) {
        throw new Error("KLBS database schema migration source version is invalid.");
    }

    let version = sourceVersion;
    while (version < targetVersion) {
        const step = findMigration(steps, version, version + 1);
        if (!step) {
            throw new Error(`No KLBS database migration is registered from version ${version}.`);
        }
        logger?.info("DATABASE_MIGRATION", "Forward database migration started", {
            migration: step.name || `${step.from}_to_${step.to}`,
            sourceVersion: step.from,
            targetVersion: step.to
        });
        await run(database, "BEGIN IMMEDIATE TRANSACTION");
        try {
            await step.up(database);
            await writeSchemaVersion(database, step.to);
            await run(database, "COMMIT");
            version = step.to;
            logger?.info("DATABASE_MIGRATION", "Forward database migration succeeded", {
                migration: step.name || `${step.from}_to_${step.to}`,
                schemaVersion: version
            });
        }
        catch (error) {
            await run(database, "ROLLBACK").catch(() => {});
            logger?.error("DATABASE_MIGRATION", "Forward database migration failed", error, {
                migration: step.name || `${step.from}_to_${step.to}`,
                sourceVersion: step.from,
                targetVersion: step.to,
                schemaVersion: version
            });
            throw error;
        }
    }
    return version;
}

async function validateCurrentSchema(database) {
    const requiredTables = [
        "products", "bills", "settings", "inventory_transactions", "day_closing",
        SCHEMA_METADATA_TABLE
    ];
    const rows = await all(database, `
        SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${requiredTables.map(() => "?").join(",")})
    `, requiredTables);
    const present = new Set(rows.map(row => row.name));
    const missing = requiredTables.filter(name => !present.has(name));
    if (missing.length) throw new Error(`KLBS database readiness validation failed: required schema missing.`);
    return true;
}

async function prepareDatabaseSchema({ database, runCurrentMigrations, logger = null,
    migrations = [], currentVersion = CURRENT_DB_SCHEMA_VERSION }) {
    await ensureMetadataTable(database);
    const detectedVersion = await readSchemaVersion(database);
    if (detectedVersion === null) {
        logger?.info("DATABASE", "Legacy KLBS database detected; schema metadata is absent");
    }
    else {
        logger?.info("DATABASE", "KLBS database schema version detected", { schemaVersion: detectedVersion });
        try {
            await assertSupportedSchemaVersion(detectedVersion, currentVersion);
        }
        catch (error) {
            if (error.code === "KLBS_DB_SCHEMA_NEWER") {
                logger?.error("DATABASE", "Unsupported newer KLBS database schema refused", null, {
                    schemaVersion: detectedVersion,
                    supportedSchemaVersion: currentVersion
                });
            }
            throw error;
        }
        const defaultMigrations = [
            { from: 1, to: 2, name: "automatic_backup_settings", up: migrateAutomaticBackupSettings }
        ];
        await runForwardMigrations(
            database,
            detectedVersion,
            currentVersion,
            [...defaultMigrations, ...migrations],
            logger
        );
    }

    if (detectedVersion === null || detectedVersion < currentVersion) {
        await runCurrentMigrations();
    }
    await validateCurrentSchema(database);

    if (detectedVersion === null) {
        await run(database, "BEGIN IMMEDIATE TRANSACTION");
        try {
            await writeSchemaVersion(database, currentVersion);
            await run(database, "COMMIT");
            logger?.info("DATABASE", "Legacy KLBS database adopted at current schema version", {
                schemaVersion: currentVersion
            });
        }
        catch (error) {
            await run(database, "ROLLBACK").catch(() => {});
            throw error;
        }
    }
    return { detectedVersion, schemaVersion: currentVersion };
}

module.exports = {
    CURRENT_DB_SCHEMA_VERSION,
    SCHEMA_METADATA_TABLE,
    UnsupportedDatabaseSchemaError,
    ensureMetadataTable,
    readSchemaVersion,
    writeSchemaVersion,
    assertSupportedSchemaVersion,
    runForwardMigrations,
    validateCurrentSchema,
    prepareDatabaseSchema,
    _test: { run, get, all }
};
