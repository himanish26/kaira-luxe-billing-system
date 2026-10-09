const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RESULT_PREFIX = "V21_V14_STARTUP=";

async function child(tempRoot, phase) {
    const { app } = require("electron");
    app.setPath("userData", path.join(tempRoot, "user-data"));
    const expectedDatabasePath = path.join(tempRoot, "fresh.db");
    assert.strictEqual(process.env.KLBS_DEV_DATABASE_PATH, expectedDatabasePath,
        "clean-startup DB override must reach Electron before database initialization");
    assert(expectedDatabasePath.startsWith(`${tempRoot}${path.sep}`), "startup DB path is disposable and scoped to the test directory");
    const database = require("../src/database/database");
    await database.databaseReady;
    const pathAuthority = require("../src/database/databasePath");
    assert.strictEqual(pathAuthority.normalizeForComparison(database.databasePath),
        pathAuthority.normalizeForComparison(expectedDatabasePath));
    assert.strictEqual(await pathAuthority.assertAuthoritativeDatabaseConnection(database), true);
    assert.strictEqual(pathAuthority.normalizeForComparison(await pathAuthority.readSqliteMainPath(database)),
        pathAuthority.normalizeForComparison(expectedDatabasePath));
    const get = (sql, params = []) => new Promise((resolve, reject) =>
        database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = sql => new Promise((resolve, reject) =>
        database.all(sql, [], (error, rows) => error ? reject(error) : resolve(rows || [])));
    const version = await get("SELECT schema_version FROM klbs_schema_metadata WHERE id=1");
    const integrity = await get("PRAGMA integrity_check");
    const foreignKeys = await all("PRAGMA foreign_key_check");
    const stockTables = await get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('stock_movements','stock_movement_lines','expenses')");
    const identity = await get("SELECT s.store_code, s.store_name, s.status FROM store_context c JOIN stores s ON s.id=c.current_store_id WHERE c.id=1");
    assert.strictEqual(Number(version.schema_version), 15);
    assert.strictEqual(integrity.integrity_check, "ok");
    assert.strictEqual(foreignKeys.length, 0);
    assert.strictEqual(Number(stockTables.count), 3);
    assert.deepStrictEqual(identity, { store_code: "KL001", store_name: "Kaira Luxe", status: "ACTIVE" });
    assert.strictEqual(database.CURRENT_DB_SCHEMA_VERSION, 15);
    const archiveColumns = await get("SELECT COUNT(*) AS count FROM pragma_table_info('stock_movements') WHERE name IN ('archived_at','archived_by')");
    assert.strictEqual(Number(archiveColumns.count), 2);
    const stockInwardColumns = await get("SELECT COUNT(*) AS count FROM pragma_table_info('stock_movements') WHERE name IN ('invoice_total_quantity','invoice_date','supplier_invoice_id','store_id')");
    const lineDiscardColumns = await get("SELECT COUNT(*) AS count FROM pragma_table_info('stock_movement_lines') WHERE name IN ('discard_reason','discarded_by','discarded_at','sku_snapshot')");
    assert.strictEqual(Number(stockInwardColumns.count), 4);
    assert.strictEqual(Number(lineDiscardColumns.count), 4);
    const accountingTables = await get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('management_accounting_entries','management_accounting_entry_sequences')");
    assert.strictEqual(Number(accountingTables.count), 2);
    const periodTable = await get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='management_accounting_period_status'");
    assert.strictEqual(Number(periodTable.count), 0);
    const accountingRows = await get("SELECT COUNT(*) AS count FROM management_accounting_entries");
    assert.strictEqual(Number(accountingRows.count), 0, "fresh/repeated startup creates no synthetic management accounting rows");
    const supplierTables = await get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('supplier_master','supplier_sequences','supplier_brands','supplier_product_segments','supplier_business_segments','supplier_invoices','supplier_invoice_lines','supplier_payments','supplier_payment_allocations','supplier_cost_provenance_links','supplier_subledger_sequences','supplier_opening_balances','supplier_credit_notes','supplier_payment_opening_allocations','supplier_credit_note_invoice_allocations','supplier_credit_note_opening_allocations','supplier_relationship_sequences','supplier_brand_master','supplier_product_segment_master','supplier_relationships')");
    assert.strictEqual(Number(supplierTables.count), 20);
    const supplierRows = await get("SELECT COUNT(*) AS count FROM supplier_master");
    assert.strictEqual(Number(supplierRows.count), 0);
    await database.closeDatabase();
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({ phase, version: version.schema_version, integrity: integrity.integrity_check, foreignKeyViolations: foreignKeys.length, foundationTables: stockTables.count, accountingTables: accountingTables.count, accountingRows: accountingRows.count, supplierTables: supplierTables.count, supplierRows: supplierRows.count })}\n`);
    app.exit(0);
}

function parent() {
    const tempRoot = fs.mkdtempSync("/private/tmp/klbs-v21-v5-clean-startup-");
    const electronBinary = require("electron");
    try {
        const results = [];
        for (const phase of ["fresh", "repeat"]) {
            const result = spawnSync(electronBinary, ["--disable-gpu", "--in-process-gpu", __filename,
                "--integration-child", tempRoot, phase], {
                cwd: path.resolve(__dirname, ".."),
                env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "fresh.db") },
                encoding: "utf8",
                timeout: 30000,
                windowsHide: true
            });
            if (result.error) throw result.error;
            assert.strictEqual(result.status, 0, `signal=${result.signal} error=${result.error || ""}\n${result.stdout}\n${result.stderr}`);
            const line = result.stdout.split(/\r?\n/).find(value => value.startsWith(RESULT_PREFIX));
            assert(line, `Startup result missing.\n${result.stdout}\n${result.stderr}`);
            results.push(JSON.parse(line.slice(RESULT_PREFIX.length)));
        }
        assert.deepStrictEqual(results[0], { phase: "fresh", version: 15, integrity: "ok", foreignKeyViolations: 0, foundationTables: 3, accountingTables: 2, accountingRows: 0, supplierTables: 20, supplierRows: 0 });
        assert.deepStrictEqual(results[1], { phase: "repeat", version: 15, integrity: "ok", foreignKeyViolations: 0, foundationTables: 3, accountingTables: 2, accountingRows: 0, supplierTables: 20, supplierRows: 0 });
        console.log("PASS actual Electron clean database startup and repeated startup at schema V15");
        console.log(`Disposable database: ${path.join(tempRoot, "fresh.db")}`);
    }
    finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

if (process.argv.includes("--integration-child")) {
    const index = process.argv.indexOf("--integration-child");
    child(process.argv[index + 1], process.argv[index + 2]).catch(error => {
        console.error(error);
        process.exit(1);
    });
}
else parent();
