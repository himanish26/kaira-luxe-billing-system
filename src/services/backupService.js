const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const {
    app
} = require("electron");

const packageJson = require("../../package.json");
const archiver = require("archiver");
const AdmZip = require("adm-zip");
const sqlite3 = require("sqlite3").verbose();
const technicalLogger = require("./technicalLogger");
const {
    getAuthoritativeDatabasePath,
    assertAuthoritativeDatabaseConnection
} = require("../database/databasePath");
const {
    CURRENT_DB_SCHEMA_VERSION,
    SCHEMA_METADATA_TABLE,
    readSchemaVersion,
    assertSupportedSchemaVersion
} = require("../database/schemaVersion");
const {
    getRestoreSafetyPaths,
    operationId,
    atomicWriteJson,
    createState,
    forceRecoverPreviousDatabase
} = require("./restoreSafety");
const {
    beginRestore,
    endRestoreBeforeClose
} = require("./restoreState");
const DEFAULT_BACKUP_FOLDER = path.join(
    os.homedir(),
    "Documents",
    "Kaira Luxe",
    "Backups"
);
const PRE_UPGRADE_BACKUP_FOLDER_NAME = "PreUpgrade";

const {
    getSettings,
    recordScheduledBackupSuccess
} = require("../database/settingsService");
const { getBusinessDate, addBusinessCalendarDays } = require("../database/businessDate");
const {
    isPositivelyIdentifiedScheduledAutomatic,
    shouldDeleteScheduledAutomaticBackup
} = require("./scheduledBackupRetentionLogic");

const database = require("../database/database");
const {
    closeDatabase
} = database;

const {

    logBackupCreated,
    logAutomaticBackupCreated,
    logAutomaticBackupFailed,

    logBackupFailed,

    logRestoreFailed

} = require("../database/logService");

function ensureDirectory(folderPath) {

    if (!fs.existsSync(folderPath)) {

        fs.mkdirSync(folderPath, {
            recursive: true
        });

    }

}

async function createSQLiteSnapshot(snapshotPath) {

    await assertAuthoritativeDatabaseConnection(database);

    return new Promise((resolve, reject) => {
        let backup;

        backup = database.backup(
            snapshotPath,
            initializeErr => {

            if (initializeErr) {
                reject(initializeErr);
                return;
            }

            backup.step(
                -1,
                (stepErr, completed) => {

                    if (stepErr) {
                        reject(stepErr);
                        return;
                    }

                    backup.finish(() => {
                        if (!completed) {
                            reject(
                                new Error(
                                    "SQLite backup did not complete."
                                )
                            );
                            return;
                        }
                        resolve();
                    });

                }
            );

        });
    });

}

function validateWritableSQLiteDatabase(databasePath) {
    return new Promise((resolve, reject) => {
        const writableDb = new sqlite3.Database(
            databasePath,
            sqlite3.OPEN_READWRITE,
            openError => {
                if (openError) {
                    reject(openError);
                    return;
                }
                writableDb.run("BEGIN IMMEDIATE TRANSACTION", beginError => {
                    if (beginError) {
                        writableDb.close(() => reject(beginError));
                        return;
                    }
                    writableDb.run("ROLLBACK", rollbackError => {
                        writableDb.close(closeError => {
                            if (rollbackError || closeError) {
                                reject(rollbackError || closeError);
                                return;
                            }
                            resolve();
                        });
                    });
                });
            }
        );
    });
}

function forceControlledRestartAfterRestoreFailure() {
    try {
        app.relaunch({ args: [...process.argv.slice(1)] });
    }
    finally {
        app.exit(1);
    }
}

function validateSQLiteDatabase(databasePath) {

    return new Promise((resolve, reject) => {

        const validationDb = new sqlite3.Database(
            databasePath,
            sqlite3.OPEN_READONLY,
            openErr => {

                if (openErr) {
                    reject(openErr);
                    return;
                }

                validationDb.get(
                    "PRAGMA integrity_check",
                    [],
                    (integrityErr, integrityRow) => {

                        if (
                            integrityErr ||
                            !integrityRow ||
                            integrityRow.integrity_check !== "ok"
                        ) {
                            validationDb.close(() =>
                                reject(
                                    integrityErr ||
                                    new Error(
                                        "SQLite integrity_check failed."
                                    )
                                )
                            );
                            return;
                        }

                        validationDb.all(
                            "PRAGMA foreign_key_check",
                            [],
                            (foreignKeyErr, violations) => {

                                validationDb.close(closeErr => {
                                    if (foreignKeyErr || closeErr) {
                                        reject(
                                            foreignKeyErr || closeErr
                                        );
                                        return;
                                    }

                                    if (violations.length > 0) {
                                        reject(
                                            new Error(
                                                "SQLite foreign_key_check failed."
                                            )
                                        );
                                        return;
                                    }

                                    resolve();
                                });

                            }
                        );

                    }
                );

            }
        );

    });

}

function getTimestamp() {

    const now = new Date();

    const year = now.getFullYear();

    const month = String(now.getMonth() + 1).padStart(2, "0");

    const day = String(now.getDate()).padStart(2, "0");

    const hours = String(now.getHours()).padStart(2, "0");

    const minutes = String(now.getMinutes()).padStart(2, "0");

    const seconds = String(now.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;

}

async function getBackupFolder() {

    const settings =
        await getSettings();

    if (

        settings &&
        settings.backup_location &&
        settings.backup_location.trim() !== ""

    ) {

        return settings.backup_location;

    }

    return DEFAULT_BACKUP_FOLDER;

}

let backupQueueTail = Promise.resolve();
let backupOperationSequence = 0;

function getBackupOperationId() {
    backupOperationSequence += 1;
    return `${process.pid}_${backupOperationSequence}_${crypto.randomBytes(6).toString("hex")}`;
}

function readRestoredSchemaVersion(databasePath) {
    return new Promise((resolve, reject) => {
        const validationDb = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, openError => {
            if (openError) return reject(openError);
            validationDb.get(
                `SELECT schema_version FROM ${SCHEMA_METADATA_TABLE} WHERE id = 1`,
                [],
                (error, row) => {
                    validationDb.close(closeError => {
                        if (error && !/no such table/i.test(error.message || "")) return reject(error);
                        if (closeError) return reject(closeError);
                        if (!row) return resolve(null);
                        const version = Number(row.schema_version);
                        if (!Number.isInteger(version) || version < 0) {
                            return reject(new Error("Restored database schema metadata is invalid."));
                        }
                        resolve(version);
                    });
                }
            );
        });
    });
}

async function validateRestoredDatabase(databasePath) {
    if (!fs.existsSync(databasePath) || fs.statSync(databasePath).size <= 0) {
        throw new Error("Restored billing.db is missing or empty.");
    }
    await validateSQLiteDatabase(databasePath);
    const schemaVersion = await readRestoredSchemaVersion(databasePath);
    await assertSupportedSchemaVersion(schemaVersion, CURRENT_DB_SCHEMA_VERSION);
    await new Promise((resolve, reject) => {
        const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, error => {
            if (error) return reject(error);
            db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?, ?)`,
                ["products", "bills", "settings", "inventory_transactions", "day_closing"],
                (listError, rows) => db.close(closeError => {
                    if (listError || closeError) return reject(listError || closeError);
                    const names = new Set((rows || []).map(row => row.name));
                    const missing = ["products", "bills", "settings", "inventory_transactions", "day_closing"]
                        .filter(name => !names.has(name));
                    if (missing.length) return reject(new Error("Restored database is missing required KLBS tables."));
                    resolve();
                }));
        });
    });
    return { schemaVersion };
}

function removeOwnArtifact(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

function writeBackupArchive(snapshotPath, inProgressPath, metadataOverrides = {}) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(inProgressPath, { flags: "wx" });
        const archive = archiver("zip", { zlib: { level: 9 } });
        let settled = false;

        function fail(error) {
            if (settled) return;
            settled = true;
            try { archive.abort(); } catch (_) {}
            output.destroy();
            if (output.closed) reject(error);
            else output.once("close", () => reject(error));
        }

        output.on("error", fail);
        archive.on("error", fail);
        output.on("close", () => {
            if (settled) return;
            settled = true;
            resolve(archive.pointer());
        });

        archive.pipe(output);

        const backupInfo = {
            application: packageJson.productName || "KAIRA LUXE Billing System",
            backupSchema: 1,
            appVersion: packageJson.version,
            createdOn: new Date().toISOString(),
            createdBy: "Administrator",
            database: "billing.db",
            includesSettings: true,
            platform: process.platform,
            electron: process.versions.electron,
            node: process.versions.node
        };
        Object.assign(backupInfo, metadataOverrides);

        archive.append(JSON.stringify(backupInfo, null, 4), {
            name: "backup-info.json"
        });
        archive.file(snapshotPath, { name: "Database/billing.db" });

        const logsFolder = path.join(app.getPath("userData"), "logs");
        if (fs.existsSync(logsFolder)) {
            archive.glob("**/*", {
                cwd: logsFolder,
                ignore: ["KLBS.log", "KLBS.log.*"]
            }, { prefix: "Logs" });
        }

        archive.finalize().catch(fail);
    });
}

async function createBackupInternal(options = {}) {

    const configuredBackupFolder = options.backupFolder || await getBackupFolder();
    const backupFolder = options.purpose === "PRE_UPGRADE"
        ? path.join(configuredBackupFolder, PRE_UPGRADE_BACKUP_FOLDER_NAME)
        : configuredBackupFolder;

    ensureDirectory(backupFolder);

    const timestamp = getTimestamp();
    const operationId = getBackupOperationId();

    const backupFileName = options.purpose === "PRE_UPGRADE"
        ? `KL_PreUpgrade_${timestamp}_${operationId}.zip`
        : `KL_Backup_${timestamp}_${operationId}.zip`;

    const backupFilePath = path.join(
    backupFolder,
    backupFileName
);

    const snapshotPath = path.join(
        app.getPath("temp"),
        `klbs_backup_${timestamp}_${operationId}.db`
    );
    const inProgressPath = `${backupFilePath}.partial`;
    let finalArtifactCreated = false;

    try {
        if (fs.existsSync(backupFilePath)) {
            throw new Error("Backup destination already exists; refusing to overwrite it.");
        }
        let schemaVersion = null;
        if (options.purpose === "PRE_UPGRADE") {
            schemaVersion = await readSchemaVersion(database);
            if (!Number.isInteger(schemaVersion)) {
                throw new Error("Current KLBS database schema version is unavailable.");
            }
            await assertSupportedSchemaVersion(schemaVersion, CURRENT_DB_SCHEMA_VERSION);
        }
        await createSQLiteSnapshot(snapshotPath);
        await validateSQLiteDatabase(snapshotPath);
        const size = await writeBackupArchive(snapshotPath, inProgressPath, {
            purpose: options.purpose || "BACKUP",
            ...(schemaVersion === null ? {} : { schemaVersion })
        });
        if (!fs.existsSync(inProgressPath) || fs.statSync(inProgressPath).size <= 0) {
            throw new Error("Backup archive was not written successfully.");
        }
        fs.renameSync(inProgressPath, backupFilePath);
        finalArtifactCreated = true;

        const verification = await validateBackup(backupFilePath);
        if (!verification || verification.success !== true) {
            throw new Error(
                verification && verification.message || "Backup verification failed."
            );
        }

        try {
            if (options.purpose === "SCHEDULED_AUTOMATIC") {
                await logAutomaticBackupCreated(backupFileName, options.frequency);
            }
            else {
                await logBackupCreated(backupFileName);
            }
        }
        catch (error) {
            console.error(error);
        }

        return {
            success: true,
            backupFileName,
            backupFilePath,
            size
        };
    }
    catch (error) {
        removeOwnArtifact(inProgressPath);
        if (finalArtifactCreated) removeOwnArtifact(backupFilePath);
        throw error;
    }
    finally {
        removeOwnArtifact(snapshotPath);
    }

}

async function createBackup() {
    const operation = backupQueueTail.then(async () => {
        try {
            return await createBackupInternal();
        }
        catch (error) {
            technicalLogger.error(
                "BACKUP",
                "Backup creation failed",
                error,
                { operation: "CREATE_BACKUP" }
            );
            try {
                await logBackupFailed(error.message);
            }
            catch (logError) {
                console.error(logError);
            }
            throw error;
        }
    });
    backupQueueTail = operation.catch(() => undefined);
    return operation;
}

async function createPreUpgradeBackup() {
    const operation = backupQueueTail.then(async () => {
        try {
            return await createBackupInternal({ purpose: "PRE_UPGRADE" });
        }
        catch (error) {
            technicalLogger.error(
                "BACKUP",
                "Pre-upgrade backup creation failed",
                error,
                { operation: "CREATE_PRE_UPGRADE_BACKUP", purpose: "PRE_UPGRADE" }
            );
            throw error;
        }
    });
    backupQueueTail = operation.catch(() => undefined);
    return operation;
}

function readBackupMetadata(filePath) {
    try {
        const zip = new AdmZip(filePath);
        const entry = zip.getEntries().find(item => item.entryName === "backup-info.json");
        if (!entry) return null;
        const metadata = JSON.parse(entry.getData().toString("utf8"));
        return metadata && typeof metadata === "object" ? metadata : null;
    }
    catch (_) {
        return null;
    }
}

async function retainScheduledAutomaticBackups(now = new Date()) {
    const backupFolder = await getBackupFolder();
    if (!fs.existsSync(backupFolder)) return { deleted: 0, preserved: 0 };

    const cutoffDate = addBusinessCalendarDays(getBusinessDate(now), -6);
    let deleted = 0;
    let preserved = 0;

    for (const file of fs.readdirSync(backupFolder)) {
        if (!file.endsWith(".zip")) continue;
        const filePath = path.join(backupFolder, file);
        if (!fs.statSync(filePath).isFile()) continue;

        const metadata = readBackupMetadata(filePath);
        if (!isPositivelyIdentifiedScheduledAutomatic(metadata)) {
            continue;
        }

        if (shouldDeleteScheduledAutomaticBackup(metadata, now)) {
            fs.unlinkSync(filePath);
            deleted += 1;
        }
        else {
            preserved += 1;
        }
    }

    return { deleted, preserved, cutoffDate };
}

async function createScheduledAutomaticBackup(frequency = "DAILY") {
    const operation = backupQueueTail.then(async () => {
        try {
            const result = await createBackupInternal({
                purpose: "SCHEDULED_AUTOMATIC",
                frequency
            });
            await recordScheduledBackupSuccess(new Date().toISOString());
            try {
                await retainScheduledAutomaticBackups();
            }
            catch (retentionError) {
                technicalLogger.warn("BACKUP", "Scheduled backup retention was not completed", {
                    operation: "RETAIN_SCHEDULED_AUTOMATIC_BACKUPS",
                    message: retentionError.message
                });
            }
            return result;
        }
        catch (error) {
            try { await logAutomaticBackupFailed(error.message); }
            catch (logError) { console.error(logError); }
            throw error;
        }
    });
    backupQueueTail = operation.catch(() => undefined);
    return operation;
}

function getBackupHistory() {

    return new Promise(async (resolve, reject) => {

        try {

            const backupFolder =
                await getBackupFolder();

            ensureDirectory(backupFolder);

            const files =
                fs.readdirSync(backupFolder);

            const backups =
                files

                    .filter(file =>
                        file.endsWith(".zip")
                    )

                    .map(file => {

                        const filePath =
                            path.join(
                                backupFolder,
                                file
                            );

                        const stats =
                            fs.statSync(filePath);

                        return {

                            fileName: file,

                            filePath,

                            createdAt: stats.birthtime,

                            size: stats.size

                        };

                    })

                    .sort(

                        (a, b) =>

                            b.createdAt - a.createdAt

                    );

            resolve(backups);

        }

        catch (error) {

            reject(error);

        }

    });

}

async function validateBackup(zipPath) {

    try {

        const zip = new AdmZip(zipPath);

        const entries = zip.getEntries();

        const infoEntry = entries.find(

            entry =>

                entry.entryName === "backup-info.json"

        );

        if (!infoEntry) {

            return {

                success: false,

                message: "backup-info.json not found."

            };

        }

        const metadata = JSON.parse(

            infoEntry

                .getData()

                .toString("utf8")

        );

        if (metadata.backupSchema !== 1) {

            return {

                success: false,

                message: "Unsupported backup schema."

            };

        }

        if (

            metadata.application !==

            (

                packageJson.productName ||

                "KAIRA LUXE Billing System"

            )

        ) {

            return {

                success: false,

                message: "Backup belongs to another application."

            };

        }

        const databaseExists = entries.some(

    entry =>

        entry.entryName ===
        "Database/billing.db"

);

const logsExists = entries.some(

    entry =>

        entry.entryName.startsWith(
            "Logs/"
        )

);

const settingsExists = entries.some(

    entry =>

        entry.entryName.startsWith(
            "Settings/"
        )

);

        if (!databaseExists) {

            return {

                success: false,

                message: "Database not found in backup."

            };

        }

        return {

    success: true,

    metadata,

    databaseExists,

    logsExists,

    settingsExists

};

    }

    catch (error) {

        return {

            success: false,

            message: error.message

        };

    }

}

async function restoreBackupInternal(zipPath) {
    let liveDatabase = null;
    let recoveryDatabase = null;
    let state = null;
    let databaseClosed = false;
    let stagingFolder = null;
    try {
        technicalLogger.info("RESTORE", "Restore requested", { operation: "RESTORE_BACKUP" });
        const backupValidation = await validateBackup(zipPath);
        if (!backupValidation.success) return backupValidation;
        const zip = new AdmZip(zipPath);
        const databaseEntry = zip.getEntries().find(entry => entry.entryName === "Database/billing.db");
        if (!databaseEntry) throw new Error("billing.db not found inside backup.");

        liveDatabase = getAuthoritativeDatabasePath();
        recoveryDatabase = `${liveDatabase}.restore-recovery`;
        await assertAuthoritativeDatabaseConnection(database);
        if (fs.existsSync(recoveryDatabase)) {
            throw new Error("A previous restore recovery copy exists; resolve it before restoring again.");
        }

        const restoreId = operationId();
        stagingFolder = path.join(app.getPath("temp"), "kaira_restore", restoreId);
        fs.mkdirSync(stagingFolder, { recursive: true });
        zip.extractEntryTo(databaseEntry, stagingFolder, false, true);
        const stagedDatabase = path.join(stagingFolder, "billing.db");
        technicalLogger.info("RESTORE", "Unique restore staging created", { operationId: restoreId });
        await validateRestoredDatabase(stagedDatabase);
        technicalLogger.info("RESTORE", "Staged database validation succeeded", { operationId: restoreId });

        const safetyPaths = getRestoreSafetyPaths(liveDatabase);
        fs.mkdirSync(safetyPaths.safetyFolder, { recursive: true });
        const safetyBackupPath = path.join(safetyPaths.safetyFolder, `PreRestoreSafety_${getTimestamp()}_${restoreId}.db`);
        state = createState(liveDatabase, { operationId: restoreId, stagedDatabasePath: stagedDatabase, safetyBackupPath });
        atomicWriteJson(safetyPaths.statePath, state);
        beginRestore();
        await closeDatabase();
        databaseClosed = true;
        state.phase = "PREPARED";
        atomicWriteJson(safetyPaths.statePath, state);
        fs.copyFileSync(liveDatabase, safetyBackupPath, fs.constants.COPYFILE_EXCL);
        await validateRestoredDatabase(safetyBackupPath);
        technicalLogger.info("RESTORE", "Pre-restore safety backup created", { operationId: restoreId });

        fs.copyFileSync(liveDatabase, recoveryDatabase, fs.constants.COPYFILE_EXCL);
        await validateRestoredDatabase(recoveryDatabase);
        state.phase = "LIVE_MOVED";
        atomicWriteJson(safetyPaths.statePath, state);
        for (const suffix of ["-wal", "-shm"]) {
            const sidecar = `${liveDatabase}${suffix}`;
            if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
        }
        const authoritativeTemporary = `${liveDatabase}.${restoreId}.tmp`;
        fs.copyFileSync(stagedDatabase, authoritativeTemporary, fs.constants.COPYFILE_EXCL);
        fs.renameSync(liveDatabase, `${liveDatabase}.${restoreId}.old`);
        fs.renameSync(authoritativeTemporary, liveDatabase);
        state.phase = "RESTORED_ESTABLISHED";
        atomicWriteJson(safetyPaths.statePath, state);
        await validateRestoredDatabase(liveDatabase);
        await validateWritableSQLiteDatabase(liveDatabase);
        state.phase = "VERIFIED";
        atomicWriteJson(safetyPaths.statePath, state);
        const oldMovedPath = `${liveDatabase}.${restoreId}.old`;
        if (fs.existsSync(oldMovedPath)) fs.unlinkSync(oldMovedPath);
        // The durable PreRestoreSafety copy remains. The transient recovery
        // name is removed only after the new authoritative DB is verified.
        if (fs.existsSync(recoveryDatabase)) fs.unlinkSync(recoveryDatabase);
        fs.unlinkSync(safetyPaths.statePath);
        technicalLogger.info("RESTORE", "Restore complete; authoritative database verified", { operationId: restoreId });

        const logsExist = zip.getEntries().some(entry => entry.entryName.startsWith("Logs/"));
        if (logsExist) {
            const logsFolder = path.join(app.getPath("userData"), "logs");
            ensureDirectory(logsFolder);
            zip.getEntries().filter(entry => entry.entryName.startsWith("Logs/") &&
                !/^KLBS\.log(?:\.\d+)?$/i.test(path.basename(entry.entryName)))
                .forEach(entry => zip.extractEntryTo(entry, app.getPath("userData"), true, true));
        }
        fs.rmSync(stagingFolder, { recursive: true, force: true });
        return { success: true, message: "Database restored successfully." };
    }
    catch (error) {
        technicalLogger.error("RESTORE", "Backup restore failed", error, { operation: "RESTORE_BACKUP" });
        if (liveDatabase && recoveryDatabase && fs.existsSync(recoveryDatabase)) {
            try {
                if (forceRecoverPreviousDatabase(liveDatabase) && state) {
                    const paths = getRestoreSafetyPaths(liveDatabase);
                    state.phase = "RECOVERED";
                    atomicWriteJson(paths.statePath, state);
                    fs.unlinkSync(paths.statePath);
                }
                technicalLogger.warn("RESTORE", "Previous database recovered after restore failure", { operation: "RECOVER_ORIGINAL_DATABASE" });
            }
            catch (recoveryError) {
                technicalLogger.fatal("RESTORE", "Previous database recovery failed", recoveryError, { operation: "RECOVER_ORIGINAL_DATABASE" });
            }
        }
        if (stagingFolder) { try { fs.rmSync(stagingFolder, { recursive: true, force: true }); } catch (_) {} }
        if (databaseClosed) {
            forceControlledRestartAfterRestoreFailure();
            return { success: false, restartRequired: true, message: "Restore failed. KLBS is restarting to verify database recovery." };
        }
        endRestoreBeforeClose();
        try { await logRestoreFailed(error.message); } catch (_) {}
        return { success: false, message: error.message };
    }
}

// Restore shares the existing backup queue so scheduled/manual snapshots
// cannot overlap the close-and-replace window.
async function restoreBackup(zipPath) {
    const operation = backupQueueTail.then(() => restoreBackupInternal(zipPath));
    backupQueueTail = operation.catch(() => undefined);
    return operation;
}

module.exports = {

    DEFAULT_BACKUP_FOLDER,

    ensureDirectory,

    getTimestamp,

    getBackupFolder,

    createBackup,

    createScheduledAutomaticBackup,

    createPreUpgradeBackup,

    getBackupHistory,

    validateBackup,

    restoreBackup,

    validateSQLiteDatabase,

    validateWritableSQLiteDatabase,

    retainScheduledAutomaticBackups

};
