const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "src", "main", "main.js");
const integrationPath = path.join(root, "src", "services", "integrationConfigService.js");
const dsrPath = path.join(root, "src", "services", "dsrSyncService.js");
const databasePath = path.join(root, "src", "database", "databasePath.js");

const main = fs.readFileSync(mainPath, "utf8");
const integration = fs.readFileSync(integrationPath, "utf8");
const dsr = fs.readFileSync(dsrPath, "utf8");
const database = fs.readFileSync(databasePath, "utf8");

const sourceFiles = [];
function collectSourceFiles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) collectSourceFiles(target);
        else if (entry.isFile() && entry.name.endsWith(".js")) sourceFiles.push(target);
    }
}
collectSourceFiles(path.join(root, "src"));

const dotenvSites = sourceFiles.filter(file => /require\(["']dotenv["']\)|dotenv\.config\s*\(/.test(
    fs.readFileSync(file, "utf8")
));
assert.deepStrictEqual(dotenvSites, [mainPath], "main.js must be the only source dotenv load site");

const guard = /if\s*\(\s*!app\.isPackaged\s*\)\s*{([\s\S]*?)}\s*const fs/;
const guardedBlock = main.match(guard);
assert(guardedBlock, "dotenv loading must be structurally guarded by !app.isPackaged");
assert(/require\(["']dotenv["']\)\.config\s*\(\s*{/.test(guardedBlock[1]),
    "unpackaged development must use explicit dotenv configuration");
assert(/path\s*:\s*path\.resolve\(\s*__dirname\s*,\s*["']\.\.["']\s*,\s*["']\.\.["']\s*,\s*["']\.env["']\s*\)/.test(guardedBlock[1]),
    "development .env must resolve explicitly from main.js to the project root");
assert(!/process\.cwd\s*\(/.test(guardedBlock[1]),
    "development dotenv loading must not depend on process.cwd()");
assert.strictEqual(path.resolve(path.dirname(mainPath), "..", "..", ".env"), path.join(root, ".env"),
    "the development dotenv path must resolve to the repository-root .env");

assert(integration.includes("options.environment || process.env"),
    "integration service must retain inherited process.env fallback");
for (const name of [
    "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM",
    "DAY_CLOSING_EMAIL", "KLBS_DSR_WEB_APP_URL", "KLBS_DSR_SYNC_SECRET"
]) {
    assert(integration.includes(`environment.${name}`), `integration fallback missing ${name}`);
}
assert(dsr.includes("process.env.KLBS_DSR_WEB_APP_URL") &&
    dsr.includes("process.env.KLBS_DSR_SYNC_SECRET"),
"DSR service must retain direct inherited environment fallback for standalone construction");

assert(database.includes("if (isPackaged)") &&
    database.includes("path.resolve(userDataPath, DATABASE_FILE_NAME)"),
"packaged database path must remain under Electron userData");
assert(database.includes("path.resolve(projectRoot, DATABASE_FILE_NAME)"),
    "development database path must remain project-root based");
assert(database.includes("process.env[DEVELOPMENT_OVERRIDE_NAME]") &&
    database.includes("isPackaged: app.isPackaged"),
"development database override and packaged-state authority must remain intact");

console.log("R10.7A production environment isolation static regression test passed.");
