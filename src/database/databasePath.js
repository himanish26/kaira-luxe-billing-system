const path = require("path");

const DATABASE_FILE_NAME = "billing.db";
const DEVELOPMENT_OVERRIDE_NAME = "KLBS_DEV_DATABASE_PATH";
const PROTECTED_DATABASE_FILE_NAME = "billing_dev_copy.db";
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function normalizeForComparison(value) {
    const normalized = path.resolve(String(value || ""));
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isProvided(value) {
    return value !== undefined && value !== null;
}

function validateDevelopmentOverride(developmentOverride, protectedPaths) {
    const rawOverride = String(developmentOverride);
    if (!rawOverride.trim()) {
        throw new Error(`${DEVELOPMENT_OVERRIDE_NAME} must not be empty.`);
    }
    if (!path.isAbsolute(rawOverride)) {
        throw new Error(`${DEVELOPMENT_OVERRIDE_NAME} must be an absolute path.`);
    }

    const resolvedOverride = path.resolve(rawOverride);
    if (path.extname(resolvedOverride).toLowerCase() !== ".db" ||
        path.basename(resolvedOverride).toLowerCase() === ".db") {
        throw new Error(`${DEVELOPMENT_OVERRIDE_NAME} must identify a .db file.`);
    }
    if (path.basename(resolvedOverride).toLowerCase() === PROTECTED_DATABASE_FILE_NAME) {
        throw new Error("The protected KLBS database cannot be used as a development override.");
    }

    const normalizedOverride = normalizeForComparison(resolvedOverride);
    const protectedSet = new Set((protectedPaths || []).map(normalizeForComparison));
    if (protectedSet.has(normalizedOverride)) {
        throw new Error("The protected KLBS database cannot be used as a development override.");
    }

    return resolvedOverride;
}

function resolveDatabasePath({
    isPackaged,
    userDataPath,
    projectRoot,
    developmentOverride,
    protectedPaths = []
}) {
    const overrideProvided = isProvided(developmentOverride);

    if (isPackaged) {
        if (overrideProvided) {
            throw new Error(`${DEVELOPMENT_OVERRIDE_NAME} is forbidden in packaged KLBS.`);
        }
        if (!String(userDataPath || "").trim() || !path.isAbsolute(userDataPath)) {
            throw new Error("Packaged KLBS requires an absolute Electron userData path.");
        }
        return path.resolve(userDataPath, DATABASE_FILE_NAME);
    }

    if (overrideProvided) {
        return validateDevelopmentOverride(developmentOverride, protectedPaths);
    }

    if (!String(projectRoot || "").trim() || !path.isAbsolute(projectRoot)) {
        throw new Error("Unpackaged KLBS requires an absolute project root.");
    }
    return path.resolve(projectRoot, DATABASE_FILE_NAME);
}

let cachedAuthoritativeDatabasePath;

function getAuthoritativeDatabasePath() {
    if (cachedAuthoritativeDatabasePath) return cachedAuthoritativeDatabasePath;

    const { app } = require("electron");
    const developmentOverride = Object.prototype.hasOwnProperty.call(
        process.env,
        DEVELOPMENT_OVERRIDE_NAME
    ) ? process.env[DEVELOPMENT_OVERRIDE_NAME] : undefined;

    cachedAuthoritativeDatabasePath = resolveDatabasePath({
        isPackaged: app.isPackaged,
        userDataPath: app.getPath("userData"),
        projectRoot: PROJECT_ROOT,
        developmentOverride,
        protectedPaths: [path.join(PROJECT_ROOT, PROTECTED_DATABASE_FILE_NAME)]
    });
    return cachedAuthoritativeDatabasePath;
}

function readSqliteMainPath(database) {
    return new Promise((resolve, reject) => {
        database.all("PRAGMA database_list", [], (error, rows) => {
            if (error) {
                reject(error);
                return;
            }
            const main = (rows || []).find(row => row.name === "main");
            if (!main || !String(main.file || "").trim()) {
                reject(new Error("SQLite main database path is unavailable."));
                return;
            }
            resolve(path.resolve(main.file));
        });
    });
}

async function assertAuthoritativeDatabaseConnection(database) {
    const expectedPath = getAuthoritativeDatabasePath();
    const activePath = await readSqliteMainPath(database);
    if (normalizeForComparison(activePath) !== normalizeForComparison(expectedPath)) {
        throw new Error("SQLite main database does not match the authoritative KLBS path.");
    }
    return true;
}

module.exports = {
    DATABASE_FILE_NAME,
    DEVELOPMENT_OVERRIDE_NAME,
    PROJECT_ROOT,
    resolveDatabasePath,
    getAuthoritativeDatabasePath,
    readSqliteMainPath,
    assertAuthoritativeDatabaseConnection,
    normalizeForComparison
};
