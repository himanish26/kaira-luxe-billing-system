const fs = require("fs");
const path = require("path");
const os = require("os");
const {
    app
} = require("electron");

const packageJson = require("../../package.json");
const archiver = require("archiver");
const AdmZip = require("adm-zip");
const DEFAULT_BACKUP_FOLDER = path.join(
    os.homedir(),
    "Documents",
    "Kaira Luxe",
    "Backups"
);

const {
    getSettings
} = require("../database/settingsService");

const {

    logBackupCreated,

    logBackupFailed,

    logRestoreCompleted,

    logRestoreFailed

} = require("../database/logService");

function ensureDirectory(folderPath) {

    if (!fs.existsSync(folderPath)) {

        fs.mkdirSync(folderPath, {
            recursive: true
        });

    }

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

async function createBackup() {

    const backupFolder =
        await getBackupFolder();

    ensureDirectory(backupFolder);

    const timestamp = getTimestamp();

    const backupFileName =
        `KL_Backup_${timestamp}.zip`;

    const backupFilePath = path.join(
    backupFolder,
    backupFileName
);

    const databasePath = path.join(
        process.cwd(),
        "billing.db"
    );

    return new Promise((resolve, reject) => {

        const output =
            fs.createWriteStream(backupFilePath);

        const archive =
            archiver("zip", {

                zlib: {
                    level: 9
                }

            });

        output.on(

    "close",

    async () => {

        try {

            await logBackupCreated(

                backupFileName

            );

        }

        catch (error) {

            console.error(error);

        }

        resolve({

            success: true,

            backupFileName,

            backupFilePath,

            size: archive.pointer()

        });

    }

);

        archive.on(

    "error",

    async (err) => {

        try {

            await logBackupFailed(

                err.message

            );

        }

        catch (error) {

            console.error(error);

        }

        reject(err);

    }

);

        archive.pipe(output);

        const backupInfo = {

    application:
        packageJson.productName ||
        "KAIRA LUXE Billing System",

    backupSchema: 1,

    appVersion:
        packageJson.version,

    createdOn:
        new Date().toISOString(),

    createdBy:
        "Administrator",

    database:
        "billing.db",

    includesSettings:
    true,

    platform:
        process.platform,

    electron:
        process.versions.electron,

    node:
        process.versions.node

};

archive.append(

    JSON.stringify(
        backupInfo,
        null,
        4
    ),

    {

        name:
            "backup-info.json"

    }

);

        archive.file(
    databasePath,
    {
        name: "Database/billing.db"
    }
    
    

);


const logsFolder = path.join(
    process.cwd(),
    "logs"
);

if (fs.existsSync(logsFolder)) {

    archive.directory(
        logsFolder,
        "Logs"
    );

}

        archive.finalize();

    });

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

    try {

        

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

        console.log("Temp Folder:", tempFolder);

console.log(
    "Temp Folder Contents:",
    fs.readdirSync(tempFolder)
);

const extractedDatabase = path.join(
    tempFolder,
    "billing.db"
);

console.log(
    "Expected Database:",
    extractedDatabase
);

console.log(
    "Exists:",
    fs.existsSync(extractedDatabase)
);

        console.log(
            "Database extracted:",
            extractedDatabase
        );

        const liveDatabase = path.join(
    process.cwd(),
    "billing.db"
);

const backupDatabase = path.join(
    process.cwd(),
    "billing.db.bak"
);

// Backup current database

if (fs.existsSync(liveDatabase)) {

    fs.renameSync(
        liveDatabase,
        backupDatabase
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

// Verify restore

const logsExist = entries.some(

    entry =>

        entry.entryName.startsWith(
            "Logs/"
        )

);

if (logsExist) {

    const logsFolder = path.join(
        process.cwd(),
        "logs"
    );

    ensureDirectory(logsFolder);

    zip.extractEntriesTo(

        "Logs/",

        process.cwd(),

        true

    );

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

    return {

        success: false,

        message:
            "Database restore verification failed."

    };

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

try {

    await logRestoreCompleted();

}

catch (error) {

    console.error(error);

}

return {

    success: true,

    message:
        "Database restored successfully."

};

    }

    catch (error) {

    console.error(error);

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

    restoreBackup

};