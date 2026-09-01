const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const RESULT_PREFIX = "R10_2B_RESULT=";

function hashFile(filePath) {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function run(database, sql, params = []) {
    return new Promise((resolve, reject) => database.run(sql, params, function(error) {
        error ? reject(error) : resolve(this);
    }));
}

function get(database, sql, params = []) {
    return new Promise((resolve, reject) => database.get(sql, params, (error, row) => {
        error ? reject(error) : resolve(row);
    }));
}

function close(database) {
    return new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));
}

async function integrationChild(tempRoot, phase) {
    const { app } = require("electron");
    const sqlite3 = require("sqlite3").verbose();
    const database = require("../src/database/database");
    const {
        getAuthoritativeDatabasePath,
        assertAuthoritativeDatabaseConnection,
        normalizeForComparison
    } = require("../src/database/databasePath");

    await database.databaseReady;
    await assertAuthoritativeDatabaseConnection(database);
    const livePath = getAuthoritativeDatabasePath();
    const originalOverride = process.env.KLBS_DEV_DATABASE_PATH;
    process.env.KLBS_DEV_DATABASE_PATH = path.join(tempRoot, "must-not-replace-cache.db");
    assert.strictEqual(getAuthoritativeDatabasePath(), livePath);
    process.env.KLBS_DEV_DATABASE_PATH = originalOverride;
    assert.strictEqual(
        normalizeForComparison(livePath),
        normalizeForComparison(path.join(tempRoot, "billing.db"))
    );
    const foreignKeys = await get(database, "PRAGMA foreign_keys");
    assert.strictEqual(foreignKeys.foreign_keys, 1);

    if (phase === "verify-restored") {
        const marker = await get(database, "SELECT value FROM r10_2b_marker WHERE id = 1");
        assert.strictEqual(marker.value, "BACKUP_MARKER");
        await database.closeDatabase();
        process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({ phase, livePath })}\n`);
        app.exit(0);
        return;
    }

    await run(database, "CREATE TABLE r10_2b_marker (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    await run(database, "INSERT INTO r10_2b_marker VALUES (1, 'BACKUP_MARKER')");
    await run(database, "UPDATE settings SET backup_location = ? WHERE id = 1", [
        path.join(tempRoot, "backups")
    ]);

    const { createBackup, restoreBackup } = require("../src/services/backupService");
    const backup = await createBackup();
    assert.strictEqual(backup.success, true);
    assert.strictEqual(path.dirname(backup.backupFilePath), path.join(tempRoot, "backups"));

    await run(database, "UPDATE r10_2b_marker SET value = 'CURRENT_MARKER' WHERE id = 1");
    const restore = await restoreBackup(backup.backupFilePath);
    assert.strictEqual(restore.success, true);

    const verificationDb = new sqlite3.Database(livePath, sqlite3.OPEN_READWRITE);
    const marker = await get(verificationDb, "SELECT value FROM r10_2b_marker WHERE id = 1");
    assert.strictEqual(marker.value, "BACKUP_MARKER");
    await close(verificationDb);
    assert(!fs.existsSync(`${livePath}.restore-recovery`));

    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
        phase,
        livePath,
        backupFilePath: backup.backupFilePath,
        marker: marker.value
    })}\n`);
    app.exit(0);
}

function runElectronPhase(electronBinary, scriptPath, tempRoot, phase) {
    const result = spawnSync(electronBinary, [scriptPath, "--integration-child", tempRoot, phase], {
        cwd: path.resolve(__dirname, ".."),
        env: {
            ...process.env,
            KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "billing.db")
        },
        encoding: "utf8",
        timeout: 120000,
        windowsHide: true
    });
    if (result.error) throw result.error;
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith(RESULT_PREFIX));
    assert(line, `Integration result missing.\n${result.stdout}\n${result.stderr}`);
    return JSON.parse(line.slice(RESULT_PREFIX.length));
}

function parentMain() {
    const repositoryRoot = path.resolve(__dirname, "..");
    const protectedPath = path.join(repositoryRoot, "billing_dev_copy.db");
    const repositoryDatabase = path.join(repositoryRoot, "billing.db");
    const before = {
        protected: hashFile(protectedPath),
        repository: hashFile(repositoryDatabase)
    };
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-r10-2b-"));
    const electronBinary = require("electron");
    const first = runElectronPhase(electronBinary, __filename, tempRoot, "backup-restore");
    const second = runElectronPhase(electronBinary, __filename, tempRoot, "verify-restored");

    assert.strictEqual(first.marker, "BACKUP_MARKER");
    assert.strictEqual(path.resolve(first.livePath), path.join(tempRoot, "billing.db"));
    assert.strictEqual(path.resolve(second.livePath), path.join(tempRoot, "billing.db"));
    assert.strictEqual(hashFile(protectedPath), before.protected);
    assert.strictEqual(hashFile(repositoryDatabase), before.repository);

    console.log("R10.2B disposable Windows database integration and restore tests: PASS");
    console.log(`Disposable directory: ${tempRoot}`);
    console.log(`Repository DB SHA-256: ${before.repository}`);
    console.log(`Protected DB SHA-256: ${before.protected}`);
}

if (process.argv.includes("--integration-child")) {
    const index = process.argv.indexOf("--integration-child");
    integrationChild(process.argv[index + 1], process.argv[index + 2]).catch(error => {
        console.error(error);
        process.exitCode = 1;
        try { require("electron").app.exit(1); } catch (_) {}
    });
}
else {
    parentMain();
}
