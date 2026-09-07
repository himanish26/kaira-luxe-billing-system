const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-v1-pre-upgrade-"));
const userData = path.join(tempRoot, "userData");
const tempPath = path.join(tempRoot, "temp");
const backupFolder = path.join(tempRoot, "configured-backups");
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(tempPath, { recursive: true });
fs.mkdirSync(backupFolder, { recursive: true });

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "electron" && parent && parent.filename.endsWith("backupService.js")) {
        return { app: { getPath: name => name === "userData" ? userData : tempPath } };
    }
    if (request === "../database/databasePath" && parent && parent.filename.endsWith("backupService.js")) {
        return {
            getAuthoritativeDatabasePath: () => path.join(userData, "billing.db"),
            assertAuthoritativeDatabaseConnection: async () => true
        };
    }
    if (request === "../database/settingsService" && parent && parent.filename.endsWith("backupService.js")) {
        return { getSettings: async () => ({ backup_location: backupFolder }) };
    }
    if (request === "../database/database" && parent && parent.filename.endsWith("backupService.js")) {
        return {
            get: (sql, params, callback) => setImmediate(() => callback(null, { schema_version: 1 })),
            backup: (destination, callback) => {
                fs.copyFileSync(path.join(tempRoot, "fixture.db"), destination);
                setImmediate(() => callback(null));
                return {
                    step: (count, stepCallback) => setImmediate(() => stepCallback(null, true)),
                    finish: finishCallback => setImmediate(finishCallback)
                };
            }
        };
    }
    if (request === "../database/schemaVersion" && parent && parent.filename.endsWith("backupService.js")) {
        return {
            CURRENT_DB_SCHEMA_VERSION: 1,
            SCHEMA_METADATA_TABLE: "klbs_schema_metadata",
            readSchemaVersion: async () => 1,
            assertSupportedSchemaVersion: async () => true
        };
    }
    if (request === "./technicalLogger" && parent && parent.filename.endsWith("backupService.js")) {
        return { error: () => {} };
    }
    if (request === "../database/logService" && parent && parent.filename.endsWith("backupService.js")) {
        return { logBackupCreated: async () => {}, logBackupFailed: async () => {}, logRestoreFailed: async () => {} };
    }
    if (request === "./restoreState" && parent && parent.filename.endsWith("backupService.js")) {
        return { beginRestore: () => {}, endRestoreBeforeClose: () => {} };
    }
    if (request === "./restoreSafety" && parent && parent.filename.endsWith("backupService.js")) {
        return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};

const sqlite3 = require("sqlite3").verbose();
const backupService = require("../src/services/backupService");
Module._load = originalLoad;

const run = (database, sql, params = []) => new Promise((resolve, reject) =>
    database.run(sql, params, error => error ? reject(error) : resolve()));
const close = database => new Promise((resolve, reject) =>
    database.close(error => error ? reject(error) : resolve()));

async function main() {
    const fixturePath = path.join(tempRoot, "fixture.db");
    const database = new sqlite3.Database(fixturePath);
    await run(database, "CREATE TABLE klbs_schema_metadata (id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL)");
    await run(database, "INSERT INTO klbs_schema_metadata VALUES (1, 1)");
    await run(database, "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)");
    await run(database, "INSERT INTO products VALUES (1, 'Disposable fixture')");
    await close(database);
    fs.copyFileSync(fixturePath, path.join(userData, "billing.db"));

    const result = await backupService.createPreUpgradeBackup();
    assert.strictEqual(result.success, true);
    assert(fs.existsSync(result.backupFilePath));
    assert(result.backupFilePath.includes(`${path.sep}PreUpgrade${path.sep}`));
    const validation = await backupService.validateBackup(result.backupFilePath);
    assert.strictEqual(validation.success, true);
    assert.strictEqual(validation.metadata.appVersion, "1.0.0");
    assert.strictEqual(validation.metadata.schemaVersion, 1);
    assert.strictEqual(validation.metadata.purpose, "PRE_UPGRADE");
    assert.strictEqual(new AdmZip(result.backupFilePath).getEntry("Database/billing.db") !== null, true);
    assert.strictEqual(fs.existsSync(`${result.backupFilePath}.partial`), false);

    const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
    assert(packageJson.includes('"!**/*.db"'));
    assert(builder.includes('"!**/*.db"'));
    assert(!builder.includes('"billing.db"'));

    const update = require("../src/services/updateService");
    const descriptor = {
        version: "1.0.1", minimumVersion: "1.0.0", releaseDate: "2026-09-07",
        notes: ["fixture"],
        downloadUrl: "https://github.com/himanish26/kaira-luxe-billing-system/releases/download/v1.0.1/KairaLuxeBillingSetup-1.0.1.exe",
        sha256: "a".repeat(64)
    };
    let launched = 0;
    let backupCalls = 0;
    const failedLaunch = update.createUpdatePipeline({
        currentVersion: "1.0.0", httpClient: { get: async () => ({ data: descriptor }) },
        downloadFile: async () => path.join(tempRoot, "installer.exe"),
        verifyChecksum: async () => true,
        createPreUpgradeBackup: async () => {
            backupCalls += 1;
            return { success: true, backupFilePath: result.backupFilePath };
        },
        launchInstaller: async () => { throw new Error("injected installer launch failure"); },
        technicalLogger: { info: () => {}, error: () => {} }
    });
    await failedLaunch.checkForUpdates();
    await failedLaunch.downloadAcceptedUpdate({});
    await assert.rejects(failedLaunch.installAcceptedUpdate(), /injected installer launch failure/);
    assert.strictEqual(backupCalls, 1);
    assert.strictEqual(fs.existsSync(result.backupFilePath), true);
    assert.strictEqual(launched, 0);

    const successful = update.createUpdatePipeline({
        currentVersion: "1.0.0", httpClient: { get: async () => ({ data: descriptor }) },
        downloadFile: async () => path.join(tempRoot, "installer.exe"),
        verifyChecksum: async () => true,
        createPreUpgradeBackup: async () => ({ success: true, backupFilePath: result.backupFilePath }),
        launchInstaller: async () => { launched += 1; },
        technicalLogger: { info: () => {}, error: () => {} }
    });
    await successful.checkForUpdates();
    await successful.downloadAcceptedUpdate({});
    const installResult = await successful.installAcceptedUpdate();
    assert.strictEqual(installResult.success, true);
    assert.strictEqual(launched, 1);

    console.log("PASS V1 pre-upgrade backup: disposable snapshot, verification, metadata, launch gating, failure preservation, and package exclusions");
}

main().catch(error => { console.error(error); process.exitCode = 1; })
    .finally(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
