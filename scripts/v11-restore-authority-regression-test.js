const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const main = read("src/main/main.js");
const renderer = read("src/renderer/modules/system/restore.js");
const database = read("src/database/database.js");
const databasePath = read("src/database/databasePath.js");
const backup = read("src/services/backupService.js");

assert(
    backup.includes("liveDatabase = getAuthoritativeDatabasePath()"),
    "restore must resolve the authoritative database path"
);
assert(
    backup.includes("await assertAuthoritativeDatabaseConnection(database)"),
    "restore must reject a non-authoritative active database connection"
);
assert(
    backup.includes("fs.copyFileSync(stagedDatabase, authoritativeTemporary"),
    "restore must copy the staged database to an authoritative-path temporary file"
);
assert(
    backup.includes("fs.renameSync(authoritativeTemporary, liveDatabase)"),
    "restore must establish the restored database at the authoritative path"
);
assert(
    main.includes('"--restore-completed"') &&
    main.includes("path.basename(zipPath)") &&
    main.includes("app.relaunch({ args: relaunchArgs })"),
    "main process must own successful restore relaunch"
);
assert(
    !renderer.includes("window.electronAPI.restartApp("),
    "renderer must not independently relaunch after restore"
);
assert(
    database.includes("await assertAuthoritativeDatabaseConnection(db);") &&
    database.includes("KLBS final startup SQLite integrity_check failed.") &&
    database.includes("KLBS final startup foreign_key_check failed."),
    "startup readiness must verify authoritative identity and SQLite integrity"
);
assert(
    databasePath.includes('path.resolve(PROJECT_ROOT, "billing.db")') &&
    databasePath.includes('path.resolve(userDataPath, "billing.db")'),
    "database resolver must retain dev repo-root and packaged userData authority"
);

console.log("V1.1 restore authority regression test: PASS");
