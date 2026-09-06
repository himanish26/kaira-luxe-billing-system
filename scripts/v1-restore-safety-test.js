const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const Module = require("module");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-restore-safety-"));
const userData = path.join(temporary, "userData");
const live = path.join(userData, "billing.db");
fs.mkdirSync(userData, { recursive: true });

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: name => name === "userData" ? userData : temporary } };
    return originalLoad.call(this, request, parent, isMain);
};
const safety = require("../src/services/restoreSafety");
Module._load = originalLoad;

const close = database => new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));
const run = (database, sql) => new Promise((resolve, reject) => database.run(sql, error => error ? reject(error) : resolve()));
const createDb = async (filePath, marker) => {
    const database = new sqlite3.Database(filePath);
    await run(database, "CREATE TABLE marker (value TEXT NOT NULL)");
    await run(database, "INSERT INTO marker VALUES ('" + marker + "')");
    await close(database);
};
const readMarker = async filePath => {
    const database = new sqlite3.Database(filePath);
    const rows = await new Promise((resolve, reject) => database.all("SELECT value FROM marker", (error, result) => error ? reject(error) : resolve(result)));
    await close(database);
    return rows[0].value;
};
const fixture = name => {
    const folder = path.join(temporary, name);
    const userDataPath = path.join(folder, "userData");
    const databasePath = path.join(userDataPath, "billing.db");
    fs.mkdirSync(userDataPath, { recursive: true });
    return { folder, userDataPath, databasePath };
};

(async () => {
    assert.deepStrictEqual(safety.recoverInterruptedRestoreAtStartup(live, userData), { interrupted: false });
    await createDb(live, "A");

    const paths = safety.getRestoreSafetyPaths(live, userData);
    fs.copyFileSync(live, paths.recoveryPath);
    fs.unlinkSync(live);
    safety.atomicWriteJson(paths.statePath, safety.createState(live, {
        operationId: "test-1", phase: "LIVE_MOVED", safetyBackupPath: paths.recoveryPath
    }));
    const recovered = safety.recoverInterruptedRestoreAtStartup(live, userData);
    assert.strictEqual(recovered.recovered, true);
    assert(fs.existsSync(live));

    // With both copies present, a live SQLite file is never overwritten.
    fs.copyFileSync(live, paths.recoveryPath);
    safety.atomicWriteJson(paths.statePath, safety.createState(live, {
        operationId: "test-2", phase: "RESTORED_ESTABLISHED", safetyBackupPath: paths.recoveryPath
    }));
    const both = safety.recoverInterruptedRestoreAtStartup(live, userData);
    assert.strictEqual(both.recovered, false);
    assert(fs.existsSync(live) && fs.existsSync(paths.recoveryPath));

    fs.unlinkSync(live);
    fs.unlinkSync(paths.recoveryPath);
    assert.throws(() => safety.recoverInterruptedRestoreAtStartup(live, userData), /cannot recover/i);

    // A. Recovery consumes neither the source nor the authoritative copy.
    const sourceFixture = fixture("source-preserved");
    await createDb(sourceFixture.databasePath, "SOURCE");
    const sourcePaths = safety.getRestoreSafetyPaths(sourceFixture.databasePath, sourceFixture.userDataPath);
    fs.copyFileSync(sourceFixture.databasePath, sourcePaths.recoveryPath);
    fs.unlinkSync(sourceFixture.databasePath);
    safety.recoverInterruptedRestoreAtStartup(sourceFixture.databasePath, sourceFixture.userDataPath);
    assert.strictEqual(await readMarker(sourceFixture.databasePath), "SOURCE");
    assert.strictEqual(await readMarker(sourcePaths.recoveryPath), "SOURCE");

    // B. Candidate preparation failure does not touch the live database.
    const preparationFixture = fixture("candidate-failure");
    await createDb(preparationFixture.databasePath, "LIVE");
    const preparationPaths = safety.getRestoreSafetyPaths(preparationFixture.databasePath, preparationFixture.userDataPath);
    fs.copyFileSync(preparationFixture.databasePath, preparationPaths.recoveryPath);
    const originalCopyFileSync = fs.copyFileSync;
    fs.copyFileSync = (source, destination, flags) => {
        if (String(destination).endsWith(".recovery-tmp")) throw new Error("injected candidate preparation failure");
        return originalCopyFileSync(source, destination, flags);
    };
    assert.throws(() => safety.forceRecoverPreviousDatabase(preparationFixture.databasePath, preparationFixture.userDataPath), /preparation failure/i);
    fs.copyFileSync = originalCopyFileSync;
    assert.strictEqual(await readMarker(preparationFixture.databasePath), "LIVE");
    assert.strictEqual(await readMarker(preparationPaths.recoveryPath), "LIVE");

    // C. Replacement failure leaves a valid live DB and the source/candidate.
    const replacementFixture = fixture("replacement-failure");
    await createDb(replacementFixture.databasePath, "LIVE");
    const replacementPaths = safety.getRestoreSafetyPaths(replacementFixture.databasePath, replacementFixture.userDataPath);
    fs.copyFileSync(replacementFixture.databasePath, replacementPaths.recoveryPath);
    const originalRenameSync = fs.renameSync;
    fs.renameSync = (source, destination) => {
        if (String(source).endsWith(".recovery-tmp") && destination === replacementFixture.databasePath) {
            throw new Error("injected replacement failure");
        }
        return originalRenameSync(source, destination);
    };
    assert.throws(() => safety.forceRecoverPreviousDatabase(replacementFixture.databasePath, replacementFixture.userDataPath), /replacement failure/i);
    fs.renameSync = originalRenameSync;
    assert.strictEqual(await readMarker(replacementFixture.databasePath), "LIVE");
    assert(fs.existsSync(replacementPaths.recoveryPath));
    assert(fs.readdirSync(path.dirname(replacementFixture.databasePath)).some(name => name.includes(".recovery-tmp")));

    // D. Missing live DB is recovered from a valid source, never opened blank.
    const missingFixture = fixture("missing-live");
    await createDb(missingFixture.databasePath, "RECOVERABLE");
    const missingPaths = safety.getRestoreSafetyPaths(missingFixture.databasePath, missingFixture.userDataPath);
    fs.copyFileSync(missingFixture.databasePath, missingPaths.recoveryPath);
    fs.unlinkSync(missingFixture.databasePath);
    safety.recoverInterruptedRestoreAtStartup(missingFixture.databasePath, missingFixture.userDataPath);
    assert.strictEqual(await readMarker(missingFixture.databasePath), "RECOVERABLE");
    assert(fs.existsSync(missingPaths.recoveryPath));

    // E. Forced recovery does not unlink the only live DB before preparation.
    const unlinkFixture = fixture("no-early-unlink");
    await createDb(unlinkFixture.databasePath, "LIVE");
    const unlinkPaths = safety.getRestoreSafetyPaths(unlinkFixture.databasePath, unlinkFixture.userDataPath);
    fs.copyFileSync(unlinkFixture.databasePath, unlinkPaths.recoveryPath);
    const originalUnlinkSync = fs.unlinkSync;
    fs.unlinkSync = target => {
        if (target === unlinkFixture.databasePath) throw new Error("authoritative database was unlinked");
        return originalUnlinkSync(target);
    };
    assert.doesNotThrow(() => safety.forceRecoverPreviousDatabase(unlinkFixture.databasePath, unlinkFixture.userDataPath));
    fs.unlinkSync = originalUnlinkSync;
    assert.strictEqual(await readMarker(unlinkFixture.databasePath), "LIVE");

    console.log("V1 restore safety disposable startup recovery tests: PASS");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    try { fs.rmSync(temporary, { recursive: true, force: true }); } catch (_) {}
});
