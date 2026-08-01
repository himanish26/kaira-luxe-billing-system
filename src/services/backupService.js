const fs = require("fs");
const path = require("path");
const os = require("os");
const { app } = require("electron");
const archiver = require("archiver");

console.log("ARCHIVER =", archiver);
console.log("TYPE =", typeof archiver);

const DEFAULT_BACKUP_FOLDER = path.join(
    os.homedir(),
    "Documents",
    "Kaira Luxe",
    "Backups"
);

const {
    getSettings
} = require("../database/settingsService");

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

    const userDataPath = app.getPath("userData");

    const electronStoreFile = path.join(
        userDataPath,
        "config.json"
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

        output.on("close", () => {

            resolve({

                success: true,

                backupFileName,

                backupFilePath,

                size: archive.pointer()

            });

        });

        archive.on("error", err => {

            reject(err);

        });

        archive.pipe(output);

        archive.file(
    databasePath,
    {
        name: "Database/billing.db"
    }
    
);

if (fs.existsSync(electronStoreFile)) {

    archive.file(
        electronStoreFile,
        {
            name: "Settings/config.json"
        }
    );

}

const settingsPath = path.join(
    process.cwd(),
    "config.json"
);

if (fs.existsSync(settingsPath)) {

    archive.file(
        settingsPath,
        {
            name: "Settings/config.json"
        }
    );

}

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

module.exports = {

    DEFAULT_BACKUP_FOLDER,

    ensureDirectory,

    getTimestamp,

    getBackupFolder,

    createBackup,

    getBackupHistory

};