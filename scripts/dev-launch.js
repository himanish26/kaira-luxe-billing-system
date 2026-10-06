const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const bypassVariable = "KLBS_DEV_BYPASS_BUSINESS_DAY_GATE";
const databaseVariable = "KLBS_DEV_DATABASE_PATH";
const npmCli = process.env.npm_execpath;
const packageJson = require(path.join(__dirname, "..", "package.json"));
const repositoryRoot = path.resolve(__dirname, "..");
const developmentDataRoot = path.resolve(__dirname, "../../dev-data");
const workspaceRoot = path.join(developmentDataRoot, "v21-production-baseline-2026-10-05");
const workingDirectory = path.join(workspaceRoot, "working");
const intendedDatabasePath = path.join(workingDirectory, "billing-v21-dev.db");
const referenceDatabasePath = path.join(workspaceRoot, "reference", "billing.db");
const originalSourceZipPath = "/Users/himanishpatnaik/Downloads/KL_Backup_2026-10-05_21-36-46_6376_4_1996388cc061.zip";
const workspaceSourceZipPath = path.join(workspaceRoot, "source", "KL_Backup_2026-10-05_21-36-46_6376_4_1996388cc061.zip");
const preservedDevelopmentDatabasePath = path.join(developmentDataRoot, "preserved-development-db-2026-10-06_0633_IST", "billing.db");

function canonicalPath(filePath) {
    return fs.existsSync(filePath) ? fs.realpathSync(filePath) : path.resolve(filePath);
}

function resolveValidatedDevelopmentDatabase() {
    const configuredPath = intendedDatabasePath;
    if (!path.isAbsolute(configuredPath)) throw new Error("Development database path must be absolute.");
    if (path.extname(configuredPath).toLowerCase() !== ".db") throw new Error("Development database path must end in .db.");
    if (!fs.existsSync(configuredPath) || !fs.statSync(configuredPath).isFile()) {
        throw new Error("The V2.1 development working database does not exist.");
    }

    const resolvedPath = canonicalPath(configuredPath);
    const resolvedWorkingDirectory = canonicalPath(workingDirectory);
    const relativeToWorkingDirectory = path.relative(resolvedWorkingDirectory, resolvedPath);
    if (relativeToWorkingDirectory.startsWith("..") || path.isAbsolute(relativeToWorkingDirectory)) {
        throw new Error("Development database is outside the approved working directory.");
    }

    const protectedPaths = [
        referenceDatabasePath,
        originalSourceZipPath,
        workspaceSourceZipPath,
        preservedDevelopmentDatabasePath,
        path.join(repositoryRoot, "billing.db"),
        path.join(repositoryRoot, "billing_dev_copy.db")
    ].map(canonicalPath);
    if (protectedPaths.includes(resolvedPath)) {
        throw new Error("Development database resolves to a protected reference, source, production, or backup path.");
    }

    if (canonicalPath(intendedDatabasePath) !== resolvedPath || path.resolve(configuredPath) !== intendedDatabasePath) {
        throw new Error("Development database path does not match the approved V2.1 working database.");
    }
    return resolvedPath;
}

let developmentDatabasePath;
try {
    developmentDatabasePath = resolveValidatedDevelopmentDatabase();
}
catch (error) {
    console.error(`Development database validation failed: ${error.message}`);
    process.exitCode = 1;
}

const launchEnvironment = {
    ...process.env,
    [bypassVariable]: "1",
    [databaseVariable]: developmentDatabasePath || intendedDatabasePath
};

if (process.exitCode === 1) {
    // Validation already reported the fail-closed condition.
}
else if (!npmCli || !fs.existsSync(npmCli)) {
    console.error("Development launch must be started through npm run dev.");
    process.exitCode = 1;
}
else if (process.argv.includes("--verify-env")) {
    const childCheck = `
        const fs = require("node:fs");
        const path = require("node:path");
        const db = process.env.${databaseVariable};
        if (process.env.${bypassVariable} !== "1" || !path.isAbsolute(db) ||
            path.resolve(db) !== ${JSON.stringify(developmentDatabasePath)} ||
            !fs.existsSync(db) || !fs.statSync(db).isFile() ||
            fs.realpathSync(db) === ${JSON.stringify(canonicalPath(referenceDatabasePath))}) {
            process.exit(1);
        }
        console.log("PASS — bypass=1; development DB path is absolute, exists, and is not the reference DB");
        console.log("Development DB: " + fs.realpathSync(db));
        console.log("PASS — npm start remains electron .; no GUI, SQLite business write, or external integration was invoked");
    `;
    if (packageJson.scripts.start !== "electron ." || launchEnvironment[bypassVariable] !== "1" ||
        launchEnvironment[databaseVariable] !== developmentDatabasePath) {
        console.error("Development launch alias verification failed.");
        process.exitCode = 1;
    }
    else {
        const child = spawn(process.execPath, ["-e", childCheck], { env: launchEnvironment, stdio: "inherit" });
        child.once("error", error => {
            console.error(`Development launch verification failed: ${error.message}`);
            process.exitCode = 1;
        });
        child.once("exit", (code, signal) => {
            process.exitCode = signal ? 1 : (code === null ? 1 : code);
        });
    }
}
else {
    console.log(`Starting development KLBS with database: ${developmentDatabasePath}`);
    const child = spawn(process.execPath, [npmCli, "start"], {
        cwd: path.join(__dirname, ".."),
        env: launchEnvironment,
        stdio: "inherit"
    });

    child.once("error", error => {
        console.error(`Development launch failed: ${error.message}`);
        process.exitCode = 1;
    });
    child.once("exit", (code, signal) => {
        if (signal) {
            process.exitCode = signal === "SIGINT" ? 130 : 143;
            return;
        }
        process.exitCode = code === null ? 1 : code;
    });
}
