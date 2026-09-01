const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const hashFile = filePath => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const run = (database, sql, params = []) => new Promise((resolve, reject) =>
    database.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
const close = database => new Promise((resolve, reject) =>
    database.close(error => error ? reject(error) : resolve()));

async function main() {
    const root = path.resolve(__dirname, "..");
    const protectedPath = path.join(root, "billing_dev_copy.db");
    const repositoryDatabase = path.join(root, "billing.db");
    const before = { protected: hashFile(protectedPath), repository: hashFile(repositoryDatabase) };
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-r10-7b-"));
    const tempFolder = path.join(tempRoot, "temp");
    const userDataFolder = path.join(tempRoot, "user data");
    const backupFolder = path.join(tempRoot, "Backups With Spaces");
    fs.mkdirSync(tempFolder);
    fs.mkdirSync(userDataFolder);

    const disposableDatabasePath = path.join(tempRoot, "disposable.db");
    const disposableDatabase = new sqlite3.Database(disposableDatabasePath);
    await run(disposableDatabase, "PRAGMA foreign_keys = ON");
    await run(disposableDatabase, "CREATE TABLE marker (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    await run(disposableDatabase, "INSERT INTO marker VALUES (1, 'DISPOSABLE')");

    let configuredBackupFolder = backupFolder;
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (parent && parent.filename.endsWith("backupService.js")) {
            if (request === "electron") return { app: {
                getPath(name) {
                    if (name === "temp") return tempFolder;
                    if (name === "userData") return userDataFolder;
                    throw new Error(`Unexpected Electron path: ${name}`);
                },
                relaunch() {}, exit() {}
            } };
            if (request === "../database/settingsService") return {
                getSettings: async () => ({ backup_location: configuredBackupFolder })
            };
            if (request === "../database/database") return Object.assign(disposableDatabase, {
                closeDatabase: async () => close(disposableDatabase)
            });
            if (request === "../database/logService") return {
                logBackupCreated: async () => {}, logBackupFailed: async () => {}, logRestoreFailed: async () => {}
            };
            if (request === "../database/databasePath") return {
                getAuthoritativeDatabasePath: () => disposableDatabasePath,
                assertAuthoritativeDatabaseConnection: async () => true
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    const { createBackup, getBackupHistory, validateBackup } = require("../src/services/backupService");
    Module._load = originalLoad;

    let maxSnapshots = 0;
    const snapshotMonitor = setInterval(() => {
        const count = fs.readdirSync(tempFolder).filter(name => /^klbs_backup_.*\.db$/.test(name)).length;
        maxSnapshots = Math.max(maxSnapshots, count);
    }, 1);
    const simultaneous = await Promise.all([createBackup(), createBackup()]);
    const logical = await Promise.all([
        createBackup().then(result => ({ caller: "manual", result })),
        createBackup().then(result => ({ caller: "scheduler", result })),
        createBackup().then(result => ({ caller: "day-closing", result }))
    ]);
    clearInterval(snapshotMonitor);

    const allResults = [...simultaneous, ...logical.map(item => item.result)];
    assert.strictEqual(new Set(allResults.map(item => item.backupFilePath)).size, 5);
    assert.strictEqual(new Set(allResults.map(item => item.backupFileName)).size, 5);
    assert(maxSnapshots <= 1, `backup snapshots overlapped: ${maxSnapshots}`);
    for (const result of allResults) {
        assert.strictEqual(result.success, true);
        assert(fs.existsSync(result.backupFilePath));
        assert(/^KL_Backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_\d+_\d+_[a-f0-9]{12}\.zip$/.test(result.backupFileName));
        assert.strictEqual((await validateBackup(result.backupFilePath)).success, true);
    }

    const failingLocation = path.join(tempRoot, "not-a-directory");
    fs.writeFileSync(failingLocation, "disposable test obstruction");
    configuredBackupFolder = failingLocation;
    await assert.rejects(createBackup());
    assert.strictEqual(fs.readdirSync(tempFolder).filter(name => /^klbs_backup_.*\.db$/.test(name)).length, 0);

    configuredBackupFolder = backupFolder;
    const recovery = await createBackup();
    assert.strictEqual((await validateBackup(recovery.backupFilePath)).success, true);

    fs.writeFileSync(path.join(backupFolder, "KL_Backup_in_progress.zip.partial"), "in progress");
    const history = await getBackupHistory();
    assert.strictEqual(history.length, 6);
    assert(history.every(item => item.fileName.endsWith(".zip")));
    assert(allResults.concat(recovery).every(result => history.some(item => item.filePath === result.backupFilePath)));
    assert.strictEqual(fs.readdirSync(backupFolder).some(name => name.endsWith(".partial") &&
        name !== "KL_Backup_in_progress.zip.partial"), false);

    const service = fs.readFileSync(path.join(root, "src/services/backupService.js"), "utf8");
    const scheduler = fs.readFileSync(path.join(root, "src/services/backupScheduler.js"), "utf8");
    const dayClosing = fs.readFileSync(path.join(root, "src/database/dayClosingService.js"), "utf8");
    assert(service.includes("backupQueueTail.then"));
    assert(service.includes("backupQueueTail = operation.catch"));
    assert(service.includes("`${backupFilePath}.partial`"));
    assert(service.indexOf("await writeBackupArchive") < service.indexOf("await validateBackup(backupFilePath)"));
    assert(service.indexOf("await validateBackup(backupFilePath)") < service.indexOf("success: true"));
    assert(scheduler.includes("if (schedulerCheckInFlight) return"));
    assert(scheduler.includes("finally") && scheduler.includes("schedulerCheckInFlight = false"));
    assert(dayClosing.indexOf("backup = await createBackupFn()") < dayClosing.indexOf("await validateBackupFn(backup.backupFilePath)"));
    assert(dayClosing.indexOf("await validateBackupFn(backup.backupFilePath)") < dayClosing.indexOf("SET close_status = 'CLOSED'"));
    assert(dayClosing.includes("path: backup.backupFilePath"));

    await close(disposableDatabase);
    assert.strictEqual(hashFile(protectedPath), before.protected);
    assert.strictEqual(hashFile(repositoryDatabase), before.repository);
    console.log("R10.7B backup concurrency and collision safety tests: PASS");
    console.log(`Disposable directory: ${tempRoot}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
