const CURRENT_DB_SCHEMA_VERSION = 15;
const SCHEMA_METADATA_TABLE = "klbs_schema_metadata";
const { migrateV5Foundation } = require("./v5FoundationMigration");
const { migrateStoreIdentity } = require("./storeIdentityMigration");
const { migrateExpenseTracker } = require("./expenseTrackerMigration");
const { migrateReturnCogsReversal } = require("./returnCogsReversalMigration");
const { migrateManagementAccountingEntries } = require("./managementAccountingEntryMigration");
const { migrateSupplierDistributor } = require("./supplierDistributorMigration");
const { migrateSupplierSubledger } = require("./supplierSubledgerMigration");
const { migrateSupplierRelationships } = require("./supplierRelationshipMigration");
const { migrateSupplierInvoiceCapture } = require("./supplierInvoiceCaptureMigration");
const { migrateStockInwardV14 } = require("./stockInwardMigration");
const { migrateStockInwardArchiveV15 } = require("./stockInwardArchiveMigration");

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
        const foreignKeysState=step.foreignKeysOff?await get(database,"PRAGMA foreign_keys"):null;
        const restoreForeignKeys=Boolean(foreignKeysState&&Number(foreignKeysState.foreign_keys)===1);
        if(restoreForeignKeys)await run(database,"PRAGMA foreign_keys=OFF");
        await run(database, "BEGIN IMMEDIATE TRANSACTION");
        try {
            await step.up(database);
            if(restoreForeignKeys){
                const violations=await all(database,"PRAGMA foreign_key_check");
                if(violations.length)throw new Error("Database migration would violate foreign keys: "+JSON.stringify(violations));
            }
            await writeSchemaVersion(database, step.to);
            await run(database, "COMMIT");
            if(restoreForeignKeys)await run(database,"PRAGMA foreign_keys=ON");
            version = step.to;
            logger?.info("DATABASE_MIGRATION", "Forward database migration succeeded", {
                migration: step.name || `${step.from}_to_${step.to}`,
                schemaVersion: version
            });
        }
        catch (error) {
            await run(database, "ROLLBACK").catch(() => {});
            if(restoreForeignKeys)await run(database,"PRAGMA foreign_keys=ON").catch(()=>{});
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
    if (currentVersion >= 10) requiredTables.push("supplier_master", "supplier_sequences", "supplier_brands", "supplier_product_segments", "supplier_business_segments", "supplier_invoices", "supplier_invoice_lines", "supplier_payments", "supplier_payment_allocations", "supplier_cost_provenance_links");
    if (currentVersion >= 11) requiredTables.push("supplier_subledger_sequences", "supplier_opening_balances", "supplier_credit_notes", "supplier_payment_opening_allocations", "supplier_credit_note_invoice_allocations", "supplier_credit_note_opening_allocations");
    if (currentVersion >= 12) requiredTables.push("supplier_relationship_sequences", "supplier_brand_master", "supplier_product_segment_master", "supplier_relationships");
    if (currentVersion >= 14) requiredTables.push("stock_movement_sequences");
    if (currentVersion >= 13) {
        const invoiceColumns = await all(database, "PRAGMA table_info(supplier_invoices)");
        const invoiceColumnNames = new Set(invoiceColumns.map(column => column.name));
        const missingInvoiceColumns = ["capture_mode", "total_quantity"].filter(name => !invoiceColumnNames.has(name));
        if (missingInvoiceColumns.length) throw new Error(`KLBS database readiness validation failed: required Supplier invoice columns missing (${missingInvoiceColumns.join(", ")}).`);
    }
    if (currentVersion >= 14) {
        const [movementColumns, lineColumns] = await Promise.all([
            all(database, "PRAGMA table_info(stock_movements)"),
            all(database, "PRAGMA table_info(stock_movement_lines)")
        ]);
        for (const name of ["store_id", "supplier_id", "supplier_invoice_id", "invoice_date", "invoice_total_quantity", "supplier_code_snapshot", "supplier_name", "supplier_invoice_code_snapshot", "invoice_number_snapshot", "store_code_snapshot", "store_name_snapshot"]) {
            if (!movementColumns.some(column => column.name === name)) throw new Error(`KLBS V14 readiness validation failed: stock_movements.${name} is missing.`);
        }
        for (const name of ["sku_snapshot", "product_name_snapshot", "colour_snapshot", "size_snapshot", "resolution_note", "discard_reason", "discarded_by", "discarded_at"]) {
            if (!lineColumns.some(column => column.name === name)) throw new Error(`KLBS V14 readiness validation failed: stock_movement_lines.${name} is missing.`);
        }
        const movementForeignKeys = await all(database, "PRAGMA foreign_key_list(stock_movements)");
        for (const table of ["stores", "supplier_master", "supplier_invoices"]) {
            if (!movementForeignKeys.some(key => key.table === table)) throw new Error(`KLBS V14 readiness validation failed: stock_movements foreign key to ${table} is missing.`);
        }
    }
    if (currentVersion >= 15) {
        const movementColumns = await all(database, "PRAGMA table_info(stock_movements)");
        for (const name of ["archived_at", "archived_by"]) {
            if (!movementColumns.some(column => column.name === name)) throw new Error(`KLBS V15 readiness validation failed: stock_movements.${name} is missing.`);
        }
    }
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
        { from: 8, to: 9, name: "v2_1_management_accounting_entries", up: migrateManagementAccountingEntries },
        { from: 9, to: 10, name: "v2_1_supplier_distributor_accounts", up: migrateSupplierDistributor },
        { from: 10, to: 11, name: "v2_1_supplier_subledger_completion", up: migrateSupplierSubledger },
        { from: 11, to: 12, name: "v2_1_supplier_relationship_tuples", up: migrateSupplierRelationships },
        { from: 12, to: 13, name: "v2_1_supplier_invoice_capture_modes", up: migrateSupplierInvoiceCapture, foreignKeysOff: true },
        { from: 13, to: 14, name: "v2_1_multi_item_stock_inward", up: migrateStockInwardV14, foreignKeysOff: true },
        { from: 14, to: 15, name: "v2_1_stock_inward_cancelled_archive", up: migrateStockInwardArchiveV15 }
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
        // Recent numbered schemas own financial authorities. Validate the
        // declared source endpoint before advancing it so a damaged V9
        // database cannot be relabelled V10 by the additive migration.
        if (detectedVersion >= 9) await validateCurrentSchema(database, detectedVersion);
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
    migrateStockInwardArchiveV15,
    _test: { run, get, all }
};
