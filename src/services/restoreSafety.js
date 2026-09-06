const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");

const STATE_FILE = "restore-state.json";
const SAFETY_FOLDER = "restore-safety";

function getRestoreSafetyPaths(databasePath, userDataPath = app.getPath("userData")) {
    return {
        statePath: path.join(userDataPath, STATE_FILE),
        safetyFolder: path.join(userDataPath, SAFETY_FOLDER),
        recoveryPath: `${databasePath}.restore-recovery`
    };
}

function operationId() {
    return `${Date.now()}_${process.pid}_${crypto.randomBytes(6).toString("hex")}`;
}

function atomicWriteJson(filePath, value) {
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
    try { fs.renameSync(temporary, filePath); }
    catch (error) { try { fs.unlinkSync(temporary); } catch (_) {} throw error; }
}

function readRestoreState(statePath) {
    if (!fs.existsSync(statePath)) return null;
    try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
    catch (error) {
        const wrapped = new Error("KLBS restore state is unreadable; database startup is blocked.");
        wrapped.code = "KLBS_RESTORE_STATE_INVALID";
        wrapped.cause = error;
        throw wrapped;
    }
}

function isLikelySQLite(filePath) {
    let descriptor = null;
    try {
        if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 16) return false;
        descriptor = fs.openSync(filePath, "r");
        const header = Buffer.alloc(16);
        fs.readSync(descriptor, header, 0, 16, 0);
        return header.toString("utf8") === "SQLite format 3\u0000";
    }
    catch (_) { return false; }
    finally { if (descriptor !== null) { try { fs.closeSync(descriptor); } catch (_) {} } }
}

function establishRecoveryDatabase(databasePath, sourcePath, operation) {
    if (!isLikelySQLite(sourcePath)) return false;

    const directory = path.dirname(databasePath);
    const baseName = path.basename(databasePath);
    const candidatePath = path.join(directory, `${baseName}.${operation}.recovery-tmp`);
    const previousLivePath = path.join(directory, `${baseName}.${operation}.recovery-old`);

    // Copy and validate before moving the authoritative path. The source is
    // intentionally retained so another startup still has a known-good copy.
    fs.copyFileSync(sourcePath, candidatePath, fs.constants.COPYFILE_EXCL);
    if (!isLikelySQLite(candidatePath)) {
        throw new Error("KLBS recovery candidate failed SQLite validation.");
    }

    let liveMoved = false;
    try {
        if (fs.existsSync(databasePath)) {
            fs.renameSync(databasePath, previousLivePath);
            liveMoved = true;
        }
        fs.renameSync(candidatePath, databasePath);
        if (!isLikelySQLite(databasePath)) {
            throw new Error("KLBS recovered database failed SQLite validation.");
        }
    }
    catch (error) {
        // Best-effort rollback keeps a valid live database when replacement
        // failed before establishment. If rollback cannot complete, the
        // recovery source, candidate, and previous-live artifact remain.
        if (liveMoved && !fs.existsSync(databasePath) && fs.existsSync(previousLivePath)) {
            try { fs.renameSync(previousLivePath, databasePath); } catch (_) {}
        }
        throw error;
    }

    return { candidatePath, previousLivePath };
}

function recoverInterruptedRestoreAtStartup(databasePath, userDataPath = app.getPath("userData")) {
    const paths = getRestoreSafetyPaths(databasePath, userDataPath);
    const state = readRestoreState(paths.statePath);
    const recoveryExists = fs.existsSync(paths.recoveryPath);
    const safetyPath = state && state.safetyBackupPath;
    const safetyExists = Boolean(safetyPath && fs.existsSync(safetyPath));
    const liveExists = fs.existsSync(databasePath);

    if (!state && !recoveryExists && !safetyExists) return { interrupted: false };

    // Never allow SQLite's default create-on-open behavior to decide recovery.
    // A present live file wins once a candidate has been established; otherwise
    // the previous live copy is the deterministic recovery source.
    if (!liveExists) {
        const source = recoveryExists ? paths.recoveryPath : (safetyExists ? safetyPath : null);
        if (!source || !isLikelySQLite(source)) {
            const error = new Error("KLBS cannot recover the interrupted restore; no valid previous database is available.");
            error.code = "KLBS_RESTORE_RECOVERY_REQUIRED";
            throw error;
        }
        establishRecoveryDatabase(databasePath, source, operationId());
        return { interrupted: true, recovered: true, source };
    }

    if (!isLikelySQLite(databasePath) && recoveryExists && isLikelySQLite(paths.recoveryPath)) {
        establishRecoveryDatabase(databasePath, paths.recoveryPath, operationId());
        return { interrupted: true, recovered: true, source: paths.recoveryPath };
    }

    return { interrupted: Boolean(state || recoveryExists), recovered: false, state };
}

function forceRecoverPreviousDatabase(databasePath, userDataPath = app.getPath("userData")) {
    const paths = getRestoreSafetyPaths(databasePath, userDataPath);
    if (!fs.existsSync(paths.recoveryPath) || !isLikelySQLite(paths.recoveryPath)) return false;
    establishRecoveryDatabase(databasePath, paths.recoveryPath, operationId());
    return true;
}

function createState(databasePath, fields = {}) {
    const paths = getRestoreSafetyPaths(databasePath);
    return {
        operationId: fields.operationId || operationId(),
        phase: fields.phase || "PREPARED",
        originalDatabasePath: databasePath,
        recoveryDatabasePath: paths.recoveryPath,
        safetyBackupPath: fields.safetyBackupPath || null,
        stagedDatabasePath: fields.stagedDatabasePath || null,
        startedAt: fields.startedAt || new Date().toISOString()
    };
}

module.exports = {
    STATE_FILE,
    SAFETY_FOLDER,
    getRestoreSafetyPaths,
    operationId,
    atomicWriteJson,
    readRestoreState,
    isLikelySQLite,
    recoverInterruptedRestoreAtStartup,
    forceRecoverPreviousDatabase,
    createState
};
