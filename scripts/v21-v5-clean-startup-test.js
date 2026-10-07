const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RESULT_PREFIX = "V21_V8_STARTUP=";

async function child(tempRoot, phase) {
    const { app } = require("electron");
    app.setPath("userData", path.join(tempRoot, "user-data"));
    const database = require("../src/database/database");
    await database.databaseReady;
    const get = (sql, params = []) => new Promise((resolve, reject) =>
        database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = sql => new Promise((resolve, reject) =>
        database.all(sql, [], (error, rows) => error ? reject(error) : resolve(rows || [])));
    const version = await get("SELECT schema_version FROM klbs_schema_metadata WHERE id=1");
    const integrity = await get("PRAGMA integrity_check");
    const foreignKeys = await all("PRAGMA foreign_key_check");
    const stockTables = await get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('stock_movements','stock_movement_lines','expenses')");
    const identity = await get("SELECT s.store_code, s.store_name, s.status FROM store_context c JOIN stores s ON s.id=c.current_store_id WHERE c.id=1");
    assert.strictEqual(Number(version.schema_version), 8);
    assert.strictEqual(integrity.integrity_check, "ok");
    assert.strictEqual(foreignKeys.length, 0);
    assert.strictEqual(Number(stockTables.count), 3);
    assert.deepStrictEqual(identity, { store_code: "KL001", store_name: "Kaira Luxe", status: "ACTIVE" });
    assert.strictEqual(database.CURRENT_DB_SCHEMA_VERSION, 8);
    await database.closeDatabase();
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({ phase, version: version.schema_version, integrity: integrity.integrity_check, foreignKeyViolations: foreignKeys.length, foundationTables: stockTables.count })}\n`);
    app.exit(0);
}

function parent() {
    const tempRoot = fs.mkdtempSync("/private/tmp/klbs-v21-v5-clean-startup-");
    const electronBinary = require("electron");
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
    assert.deepStrictEqual(results[0], { phase: "fresh", version: 8, integrity: "ok", foreignKeyViolations: 0, foundationTables: 3 });
    assert.deepStrictEqual(results[1], { phase: "repeat", version: 8, integrity: "ok", foreignKeyViolations: 0, foundationTables: 3 });
    console.log("PASS actual Electron clean database startup and repeated startup at schema V8");
    console.log(`Disposable database: ${path.join(tempRoot, "fresh.db")}`);
}

if (process.argv.includes("--integration-child")) {
    const index = process.argv.indexOf("--integration-child");
    child(process.argv[index + 1], process.argv[index + 2]).catch(error => {
        console.error(error);
        process.exit(1);
    });
}
else parent();
