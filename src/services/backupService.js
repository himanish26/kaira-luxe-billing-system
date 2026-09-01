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
const DEFAULT_BACKUP_FOLDER = path.join(
    os.homedir(),
    "Documents",
    "Kaira Luxe",
    "Backups"
);

const {
    getSettings
} = require("../database/settingsService");

const database = require("../database/database");
const {
    closeDatabase
} = database;

const {

    logBackupCreated,

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

function removeOwnArtifact(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

function writeBackupArchive(snapshotPath, inProgressPath) {
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

async function createBackupInternal() {

    const backupFolder =
        await getBackupFolder();

    ensureDirectory(backupFolder);

    const timestamp = getTimestamp();
    const operationId = getBackupOperationId();

    const backupFileName =
        `KL_Backup_${timestamp}_${operationId}.zip`;

    const backupFilePath = path.join(
    backupFolder,
    backupFileName
);

    const snapshotPath = path.join(
        app.getPath("temp"),
        `klbs_backup_${timestamp}_${operationId}.db`
    );
    const inProgressPath = `${backupFilePath}.partial`;

    try {
        await createSQLiteSnapshot(snapshotPath);
        await validateSQLiteDatabase(snapshotPath);
        const size = await writeBackupArchive(snapshotPath, inProgressPath);
        if (!fs.existsSync(inProgressPath) || fs.statSync(inProgressPath).size <= 0) {
            throw new Error("Backup archive was not written successfully.");
        }
        fs.renameSync(inProgressPath, backupFilePath);

        const verification = await validateBackup(backupFilePath);
        if (!verification || verification.success !== true) {
            throw new Error(
                verification && verification.message || "Backup verification failed."
            );
        }

        try {
            await logBackupCreated(backupFileName);
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
        removeOwnArtifact(backupFilePath);
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

async function restoreBackup(zipPath) {

    let liveDatabase = null;
    let backupDatabase = null;
    let databaseClosed = false;

    try {

        const backupValidation =
            await validateBackup(zipPath);

        if (!backupValidation.success) {
            technicalLogger.warn("RESTORE", "Backup restore validation was rejected", {
                operation: "VALIDATE_RESTORE_BACKUP"
            });
            return backupValidation;
        }

        

        const zip =
            new AdmZip(zipPath);

        const entries =
            zip.getEntries();

        const databaseEntry =
            entries.find(

                entry =>

                    entry.entryName ===
                    "Database/billing.db"

            );

        if (!databaseEntry) {

            technicalLogger.warn("RESTORE", "Backup restore archive is missing its database entry", {
                operation: "RESTORE_BACKUP"
            });

            return {

                success: false,

                message:
                    "billing.db not found inside backup."

            };

        }

        const tempFolder =
            path.join(

                app.getPath("temp"),

                "kaira_restore"

            );

        ensureDirectory(tempFolder);

        zip.extractEntryTo(

            databaseEntry,

            tempFolder,

            false,

            true

        );

const extractedDatabase = path.join(
    tempFolder,
    "billing.db"
);

        technicalLogger.info("RESTORE", "Backup database extracted for validation");

    await validateSQLiteDatabase(
        extractedDatabase
    );

    liveDatabase = getAuthoritativeDatabasePath();
    backupDatabase = `${liveDatabase}.restore-recovery`;

    await assertAuthoritativeDatabaseConnection(database);

    if (fs.existsSync(backupDatabase)) {
        throw new Error(
            "A prior database restore recovery file exists. Resolve it before restoring again."
        );
    }

// Close the active SQLite connection
// before replacing the live database file.

await closeDatabase();
databaseClosed = true;

console.log(
    "STEP 0 : Database connection closed."
);

// Backup current database

if (fs.existsSync(liveDatabase)) {

    fs.renameSync(
        liveDatabase,
        backupDatabase
    );

    console.log(
        "STEP 0A : Existing database backed up."
    );

}

// Copy restored database

fs.copyFileSync(

    extractedDatabase,

    liveDatabase

);

console.log(
    "STEP 1 : Database copied."
);

await validateSQLiteDatabase(liveDatabase);

// Ensure the restored database is writable.

fs.chmodSync(
    liveDatabase,
    0o644
);

await validateWritableSQLiteDatabase(liveDatabase);

console.log(
    "STEP 1B : Database permissions restored."
);

// Verify restore

const logsExist = entries.some(

    entry =>

        entry.entryName.startsWith(
            "Logs/"
        )

);

if (logsExist) {

    const logsFolder = path.join(
    app.getPath("userData"),
    "logs"
);

    ensureDirectory(logsFolder);

    entries
        .filter(entry =>
            entry.entryName.startsWith("Logs/") &&
            !/^KLBS\.log(?:\.\d+)?$/i.test(path.basename(entry.entryName))
        )
        .forEach(entry => zip.extractEntryTo(
            entry,
            app.getPath("userData"),
            true,
            true
        ));

    console.log(
        "STEP 1A : Logs restored."
    );

}

if (!fs.existsSync(liveDatabase)) {

    if (fs.existsSync(backupDatabase)) {

        fs.renameSync(
            backupDatabase,
            liveDatabase
        );

    }

    throw new Error("Database restore verification failed.");

}

// Delete backup

if (fs.existsSync(backupDatabase)) {

    fs.unlinkSync(
        backupDatabase
    );

}

console.log(
    "STEP 2 : Backup deleted."
);

// Delete temporary folder

fs.rmSync(

    tempFolder,

    {

        recursive: true,

        force: true

    }

);

console.log(
    "STEP 3 : Temp folder deleted."
);

console.log(
    "STEP 4 : Returning success."
);

        console.log(
    "Restart required."
);


return {

    success: true,

    message:
        "Database restored successfully."

};

    }

    catch (error) {

    console.error("Backup restore failed. See KLBS.log for sanitized diagnostics.");
    technicalLogger.error(
        "RESTORE",
        "Backup restore failed",
        error,
        { operation: "RESTORE_BACKUP" }
    );

    let originalRecovered = false;
    if (
        liveDatabase &&
        backupDatabase &&
        fs.existsSync(backupDatabase)
    ) {
        try {
            if (fs.existsSync(liveDatabase)) {
                fs.unlinkSync(liveDatabase);
            }
            fs.renameSync(
                backupDatabase,
                liveDatabase
            );
            originalRecovered = true;
        }
        catch (restoreOriginalError) {
            technicalLogger.fatal(
                "RESTORE",
                "Original database recovery failed after restore error",
                restoreOriginalError,
                { operation: "RECOVER_ORIGINAL_DATABASE" }
            );
            console.error(
                "Original database recovery failed:",
                restoreOriginalError && restoreOriginalError.code || "Unknown error"
            );
        }
    }

    if (databaseClosed) {
        technicalLogger.fatal(
            "RESTORE",
            originalRecovered
                ? "Restore failed after database close; original database recovered and restart required"
                : "Restore failed after database close; controlled restart required",
            error,
            { operation: "RESTORE_BACKUP" }
        );
        forceControlledRestartAfterRestoreFailure();
        return {
            success: false,
            restartRequired: true,
            message: "Database restore failed after the live database was closed. KLBS is restarting."
        };
    }

    try {

        await logRestoreFailed(

            error.message

        );

    }

    catch (err) {

        console.error(err);

    }

    return {

        success: false,

        message:
            error.message

    };

}

}

module.exports = {

    DEFAULT_BACKUP_FOLDER,

    ensureDirectory,

    getTimestamp,

    getBackupFolder,

    createBackup,

    getBackupHistory,

    validateBackup,

    restoreBackup,

    validateSQLiteDatabase,

    validateWritableSQLiteDatabase

};
