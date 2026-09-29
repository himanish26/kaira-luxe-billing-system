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

async function createGuardFixture(databasePath, value) {
    const database = new sqlite3.Database(databasePath);
    try {
        await run(database, "CREATE TABLE marker (value TEXT NOT NULL)");
        await run(database, "INSERT INTO marker VALUES (?)", [value]);
    }
    finally {
        await close(database);
    }
}

async function main() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-r10-7b-"));
    const protectedPath = path.join(tempRoot, "billing_dev_copy.db");
    const repositoryDatabase = path.join(tempRoot, "billing.db");
    const disposableDatabasePath = path.join(tempRoot, "disposable.db");
    let disposableDatabase;
    let snapshotMonitor;
    const originalLoad = Module._load;
    const tempFolder = path.join(tempRoot, "temp");
    const userDataFolder = path.join(tempRoot, "user data");
    const backupFolder = path.join(tempRoot, "Backups With Spaces");
    let configuredBackupFolder = backupFolder;

    try {
        fs.mkdirSync(tempFolder);
        fs.mkdirSync(userDataFolder);
        fs.mkdirSync(backupFolder);

        await Promise.all([
            createGuardFixture(protectedPath, "DISPOSABLE PROTECTED DATABASE GUARD"),
            createGuardFixture(repositoryDatabase, "DISPOSABLE REPOSITORY DATABASE GUARD"),
            createGuardFixture(disposableDatabasePath, "DISPOSABLE BACKUP SOURCE")
        ]);
        const before = { protected: hashFile(protectedPath), repository: hashFile(repositoryDatabase) };
        disposableDatabase = new sqlite3.Database(disposableDatabasePath);
        await run(disposableDatabase, "PRAGMA foreign_keys = ON");

        let maxSnapshots = 0;
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
        let createBackup;
        let getBackupHistory;
        let validateBackup;
        try {
            ({ createBackup, getBackupHistory, validateBackup } = require("../src/services/backupService"));
        }
        finally {
            Module._load = originalLoad;
        }

        snapshotMonitor = setInterval(() => {
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
        snapshotMonitor = null;

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

        const root = path.resolve(__dirname, "..");
        const service = fs.readFileSync(path.join(root, "src/services/backupService.js"), "utf8");
        const scheduler = fs.readFileSync(path.join(root, "src/services/backupScheduler.js"), "utf8");
        const dayClosing = fs.readFileSync(path.join(root, "src/database/dayClosingService.js"), "utf8");
        assert(service.includes("backupQueueTail.then"));
        assert(service.includes("backupQueueTail = operation.catch"));
        assert(service.includes("`${backupFilePath}.partial`"));
        assert(service.indexOf("await writeBackupArchive") < service.indexOf("await validateBackup(backupFilePath)"));
        assert(service.indexOf("await validateBackup(backupFilePath)") < service.indexOf("success: true"));
        assert(/if\s*\([^;]*schedulerCheckInFlight[^;]*\)\s*return/.test(scheduler));
        assert(scheduler.includes("finally") && scheduler.includes("schedulerCheckInFlight = false"));
        const dayClosedIndex = dayClosing.indexOf("SET close_status = 'CLOSED'");
        const backupCreationIndex = dayClosing.indexOf("backup = await createBackupFn()");
        const backupVerificationIndex = dayClosing.indexOf("const verification = await validateDayClosingBackupFn(");
        const backupSuccessIndex = dayClosing.indexOf("SET backup_status = 'SUCCESS'");
        assert(dayClosedIndex >= 0 && dayClosedIndex < backupCreationIndex,
            "Day Closing must persist CLOSED before snapshot creation");
        assert(backupCreationIndex >= 0 && backupCreationIndex < backupVerificationIndex,
            "Day Closing must verify the created backup");
        assert(backupVerificationIndex >= 0 && backupVerificationIndex < backupSuccessIndex,
            "Day Closing must verify the backup before marking it successful");
        assert(dayClosing.includes("path: backup.backupFilePath"));

        await close(disposableDatabase);
        disposableDatabase = null;
        assert.strictEqual(hashFile(protectedPath), before.protected);
        assert.strictEqual(hashFile(repositoryDatabase), before.repository);
        console.log("R10.7B backup concurrency and collision safety tests: PASS");
    }
    finally {
        Module._load = originalLoad;
        if (snapshotMonitor) clearInterval(snapshotMonitor);
        if (disposableDatabase) await close(disposableDatabase).catch(() => {});
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
