const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const logger = require("../src/services/technicalLogger");
const repositoryRoot = path.join(__dirname, "..");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-r09-10b-"));
const logDirectory = path.join(tempRoot, "logs");
const logPath = path.join(logDirectory, "KLBS.log");

function readLines(file = logPath) {
    return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

assert.doesNotThrow(() => {
    assert.strictEqual(logger.initialize({
        logDirectory,
        appVersion: "1.0.0-RC8",
        platform: process.platform,
        isPackaged: false,
        sensitivePaths: [
            { value: tempRoot, label: "[TEMP]" },
            { value: os.homedir(), label: "[HOME]" }
        ]
    }), true);
});
assert(fs.existsSync(logPath));
assert.strictEqual(logger.getLogDirectory(), logDirectory);

assert.strictEqual(logger.info("APPLICATION", "Started\r\ncleanly", { phase: "ready" }), true);
assert.strictEqual(logger.warn("BACKUP", "Backup warning", { count: 1 }), true);
assert.strictEqual(logger.error("DATABASE", "Database failed", new Error("password=hunter2")), true);
assert.strictEqual(logger.fatal("APPLICATION", "Fatal failure", new Error("token=abc")), true);
let lines = readLines();
assert.deepStrictEqual(lines.map(line => line.level), ["INFO", "WARN", "ERROR", "FATAL"]);
assert(lines.every(line => Number.isFinite(Date.parse(line.timestamp))));
assert(lines.every(line => /^[a-f0-9]{12}$/.test(line.sessionId)));
assert.strictEqual(new Set(lines.map(line => line.sessionId)).size, 1);
assert(!lines[0].message.includes("\n"));

const longMessage = "x".repeat(1500);
logger.info("C".repeat(100), longMessage, Object.fromEntries(
    Array.from({ length: 25 }, (_, index) => [`field${index}`, "v".repeat(700)])
));
const bounded = readLines().at(-1);
assert.strictEqual(bounded.component.length, 64);
assert.strictEqual(bounded.message.length, 1000);
assert.strictEqual(Object.keys(bounded.metadata).length, 20);
assert(Object.values(bounded.metadata).every(value => value.length === 500));

logger.error("SECURITY", "pin=1234 password:open secret=value signature=deadbeef token=abc hash=xyz grant=q", null, {
    adminPin: "1234", password: "open", token: "abc", signature: "sig",
    authorizationGrant: "grant", safe: "Bearer raw-token",
    nested: { customer: "must-not-leak" }, array: ["must-not-leak"],
    mobile: "not supplied by production integrations"
});
const security = readLines().at(-1);
logger.warn("SECURITY", "Administrator PIN 1234 Manager PIN is 5678 KLBS_DSR_SYNC_SECRET=dsr-value");
const namedSecrets = JSON.stringify(readLines().at(-1));
for (const secret of ["1234", "5678", "dsr-value"]) assert(!namedSecrets.includes(secret));
const serializedSecurity = JSON.stringify(security);
for (const secret of ["1234", "open", "deadbeef", "raw-token", "must-not-leak"]) {
    assert(!serializedSecurity.includes(secret));
}
assert.strictEqual(security.metadata.nested, "[OMITTED]");
assert.strictEqual(security.metadata.array, "[OMITTED]");

logger.error("FILESYSTEM", `Failed at ${tempRoot}/private/file.db and ${os.homedir()}/secret`,
    new Error(`Stack path ${tempRoot}/private/file.js password=hidden`));
const pathEntry = readLines().at(-1);
const serializedPath = JSON.stringify(pathEntry);
assert(!serializedPath.includes(tempRoot));
assert(!serializedPath.includes(os.homedir()));
assert(!serializedPath.includes("hidden"));
assert(serializedPath.includes("[TEMP]") || serializedPath.includes("[HOME]"));

logger.error(
    "PRIVACY",
    "Contact user@example.com at +91 9876543210 Authorization: Bearer private-token private_key=hidden-key",
    Object.assign(new Error("SMTP password=mail-secret"), {
        config: { headers: { Authorization: "Bearer axios-secret" } },
        request: { body: "must-not-serialize" },
        response: { data: "must-not-serialize" }
    }),
    {
        customerEmail: "user@example.com",
        customerMobile: "9876543210",
        environment: { KLBS_DSR_SYNC_SECRET: "environment-secret" },
        billData: { customer: "full-record" },
        storeCredit: { number: "SC1" }
    }
);
const privacy = JSON.stringify(readLines().at(-1));
for (const leaked of [
    "user@example.com", "9876543210", "private-token", "hidden-key",
    "mail-secret", "axios-secret", "must-not-serialize", "environment-secret",
    "full-record", "SC1"
]) assert(!privacy.includes(leaked));

// Exercise the production 5 MiB threshold and three-file retention.
fs.writeFileSync(logPath, "a".repeat(5 * 1024 * 1024 - 10));
logger.info("ROTATION", "first rotation");
assert(fs.existsSync(`${logPath}.1`));
for (let index = 0; index < 3; index += 1) {
    fs.writeFileSync(logPath, "b".repeat(5 * 1024 * 1024 - 10));
    logger.info("ROTATION", `rotation ${index + 2}`);
}
assert(fs.existsSync(`${logPath}.1`));
assert(fs.existsSync(`${logPath}.2`));
assert(fs.existsSync(`${logPath}.3`));
assert(!fs.existsSync(`${logPath}.4`));

const renameFailureDirectory = path.join(tempRoot, "rename-failure");
const renameFailureFs = Object.assign({}, fs, {
    renameSync() { throw new Error("injected rename failure"); }
});
assert.strictEqual(logger.initialize({
    logDirectory: renameFailureDirectory,
    fsImpl: renameFailureFs,
    maxBytes: 100
}), true);
fs.writeFileSync(path.join(renameFailureDirectory, "KLBS.log"), "r".repeat(100));
assert.doesNotThrow(() => logger.info("ROTATION", "rename failure stays nonfatal"));

const statFailureDirectory = path.join(tempRoot, "stat-failure");
const statFailureFs = Object.assign({}, fs, {
    statSync() { throw new Error("injected stat failure"); }
});
assert.strictEqual(logger.initialize({
    logDirectory: statFailureDirectory,
    fsImpl: statFailureFs,
    maxBytes: 100
}), true);
assert.doesNotThrow(() => logger.warn("ROTATION", "stat failure stays nonfatal"));

const failingFs = Object.assign({}, fs, {
    appendFileSync() { throw new Error("injected append failure"); }
});
assert.doesNotThrow(() => logger.initialize({
    logDirectory: path.join(tempRoot, "failure"), fsImpl: failingFs
}));
for (const method of ["info", "warn", "error", "fatal"]) {
    assert.doesNotThrow(() => logger[method]("TEST", "must not throw", new Error("failure")));
}
assert.strictEqual(logger.info("TEST", "must fail safely"), false);

const mkdirFailFs = Object.assign({}, fs, {
    mkdirSync() { throw new Error("injected mkdir failure"); }
});
assert.doesNotThrow(() => logger.initialize({
    logDirectory: path.join(tempRoot, "mkdir-failure"), fsImpl: mkdirFailFs
}));

const mainSource = fs.readFileSync(path.join(repositoryRoot, "src/main/main.js"), "utf8");
assert(mainSource.indexOf("technicalLogger.initialize") < mainSource.indexOf("../services/emailService"));
assert(mainSource.indexOf("technicalLogger.initialize") < mainSource.indexOf("../database/reportService"));
const printerSource = fs.readFileSync(path.join(repositoryRoot, "src/main/printer.js"), "utf8");
assert(!/console\.(?:log|dir)\s*\(\s*(?:billData|storeCreditData)/.test(printerSource));
const backupSource = fs.readFileSync(path.join(repositoryRoot, "src/services/backupService.js"), "utf8");
assert(backupSource.includes('ignore: ["KLBS.log", "KLBS.log.*"]'));
assert(backupSource.includes("!/^KLBS\\.log(?:\\.\\d+)?$/i.test"));

console.log("R09.10B technical logger focused tests: PASS");
console.log(`Temporary directory: ${tempRoot}`);
