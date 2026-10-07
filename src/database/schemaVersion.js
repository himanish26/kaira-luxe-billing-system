const CURRENT_DB_SCHEMA_VERSION = 9;
const SCHEMA_METADATA_TABLE = "klbs_schema_metadata";
const { migrateV5Foundation } = require("./v5FoundationMigration");
const { migrateStoreIdentity } = require("./storeIdentityMigration");
const { migrateExpenseTracker } = require("./expenseTrackerMigration");
const { migrateReturnCogsReversal } = require("./returnCogsReversalMigration");
const { migrateManagementAccountingEntries } = require("./managementAccountingEntryMigration");

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

function migrateBusinessSegmentColumns(database) {
    return Promise.all([
        all(database, "PRAGMA table_info(products)"),
        all(database, "PRAGMA table_info(bill_items)")
    ]).then(async ([productColumns, billItemColumns]) => {
        if (!productColumns.some(column => column.name === "business_segment")) {
            await run(database, "ALTER TABLE products ADD COLUMN business_segment TEXT");
        }
        if (!billItemColumns.some(column => column.name === "business_segment")) {
            await run(database, "ALTER TABLE bill_items ADD COLUMN business_segment TEXT");
        }
        const [products, billItems] = await Promise.all([
            all(database, "PRAGMA table_info(products)"),
            all(database, "PRAGMA table_info(bill_items)")
        ]);
        if (!products.some(column => column.name === "business_segment") ||
            !billItems.some(column => column.name === "business_segment")) {
            throw new Error("Business Segment schema migration verification failed.");
        }
    });
}

async function migrateVariableValueBillingFoundation(database) {
    const [productColumns, billItemColumns] = await Promise.all([
        all(database, "PRAGMA table_info(products)"),
        all(database, "PRAGMA table_info(bill_items)")
    ]);
    const productNames = new Set(productColumns.map(column => column.name));
    const billItemNames = new Set(billItemColumns.map(column => column.name));

    if (!productNames.has("variable_value")) {
        await run(database,
            "ALTER TABLE products ADD COLUMN variable_value INTEGER NOT NULL DEFAULT 0");
    }
    if (!billItemNames.has("gross_amount")) {
        await run(database,
            "ALTER TABLE bill_items ADD COLUMN gross_amount REAL");
    }

    const [verifiedProductColumns, verifiedBillItemColumns] = await Promise.all([
        all(database, "PRAGMA table_info(products)"),
        all(database, "PRAGMA table_info(bill_items)")
    ]);
    const variableValue = verifiedProductColumns.find(column => column.name === "variable_value");
    const grossAmount = verifiedBillItemColumns.find(column => column.name === "gross_amount");
    if (!variableValue || Number(variableValue.notnull) !== 1 || String(variableValue.dflt_value) !== "0" || !grossAmount) {
        throw new Error("Variable-Value billing foundation migration verification failed.");
    }
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

async function validateCurrentSchema(database, currentVersion = CURRENT_DB_SCHEMA_VERSION) {
    const requiredTables = [
        "products", "bills", "settings", "inventory_transactions", "day_closing",
        SCHEMA_METADATA_TABLE
    ];
    if (currentVersion >= 5) requiredTables.push("customers", "stock_movements", "stock_movement_lines", "expenses");
    if (currentVersion >= 6) requiredTables.push("stores", "store_context");
    if (currentVersion >= 8) requiredTables.push("returns", "return_items");
    if (currentVersion >= 9) requiredTables.push("management_accounting_entries", "management_accounting_entry_sequences");
    const rows = await all(database, `
        SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${requiredTables.map(() => "?").join(",")})
    `, requiredTables);
    const present = new Set(rows.map(row => row.name));
    const missing = requiredTables.filter(name => !present.has(name));
    if (missing.length) throw new Error(`KLBS database readiness validation failed: required schema missing (${missing.join(", ")}).`);
    return true;
}

async function prepareDatabaseSchema({ database, runCurrentMigrations, logger = null,
    migrations = [], currentVersion = CURRENT_DB_SCHEMA_VERSION }) {
    await ensureMetadataTable(database);
    const detectedVersion = await readSchemaVersion(database);
    const defaultMigrations = [
        { from: 1, to: 2, name: "automatic_backup_settings", up: migrateAutomaticBackupSettings },
        { from: 2, to: 3, name: "business_segment_columns", up: migrateBusinessSegmentColumns },
        { from: 3, to: 4, name: "variable_value_billing_foundation", up: migrateVariableValueBillingFoundation },
        { from: 4, to: 5, name: "v2_1_database_foundation", up: migrateV5Foundation },
        { from: 5, to: 6, name: "v2_1_store_identity", up: migrateStoreIdentity },
        { from: 6, to: 7, name: "v2_1_expense_tracker", up: migrateExpenseTracker },
        { from: 7, to: 8, name: "v2_1_return_cogs_reversal", up: migrateReturnCogsReversal },
        { from: 8, to: 9, name: "v2_1_management_accounting_entries", up: migrateManagementAccountingEntries }
    ];
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
        await runForwardMigrations(
            database,
            detectedVersion,
            currentVersion,
            [...defaultMigrations, ...migrations],
            logger
        );
    }

    // Current migrations are idempotent schema reconciliation steps. They
    // must also run for databases whose version marker already equals the
    // current numbered schema, because release-level objects can be added
    // without changing the numbered compatibility version.
    if (detectedVersion === null) {
        await runCurrentMigrations();
        // Current migrations reconcile a metadata-free database through the
        // V5 foundation. Verify that baseline physically exists before
        // recording V5 or beginning its numbered forward migrations.
        const reconciledVersion = Math.min(5, currentVersion);
        await validateCurrentSchema(database, reconciledVersion);
        if (currentVersion > reconciledVersion) {
            await writeSchemaVersion(database, reconciledVersion);
        }
        // Apply every subsequent numbered migration in order. Metadata only
        // advances inside each migration transaction after its schema exists.
        const numberedMigrations = [...defaultMigrations, ...migrations]
            .filter(step => step.from >= reconciledVersion);
        if (currentVersion > reconciledVersion) {
            await runForwardMigrations(database, reconciledVersion, currentVersion, numberedMigrations, logger);
        }
        else {
            // A caller may intentionally reconcile only through V5 (for
            // migration qualification or compatibility). Record that
            // completed version instead of leaving metadata absent.
            await writeSchemaVersion(database, currentVersion);
        }
        await validateCurrentSchema(database, currentVersion);
        return { detectedVersion: null, schemaVersion: currentVersion };
    }

    await runCurrentMigrations();
    await validateCurrentSchema(database, currentVersion);
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
    migrateBusinessSegmentColumns,
    migrateVariableValueBillingFoundation,
    migrateV5Foundation,
    _test: { run, get, all }
};
