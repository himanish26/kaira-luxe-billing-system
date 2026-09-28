const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { createDayClosingDeliveryCoordinator } = require("../src/main/dayClosingDeliveryCoordinator");

const run = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, error => error ? reject(error) : resolve()));
const get = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const close = db => new Promise(resolve => db.close(resolve));
const deferred = () => {
    let resolve;
    const promise = new Promise(next => { resolve = next; });
    return { promise, resolve };
};

async function main() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-day-close-delivery-"));
    const dbPath = path.join(temp, "jobs.sqlite");
    let db = new sqlite3.Database(dbPath);
    try {
        await run(db, `CREATE TABLE consolidated_reporting_jobs (
            id INTEGER PRIMARY KEY, closing_id INTEGER,
            sheet_status TEXT, sheet_attempt_count INTEGER, sheet_last_error TEXT,
            email_status TEXT, email_attempt_count INTEGER, email_last_error TEXT
        )`);
        await run(db, "INSERT INTO consolidated_reporting_jobs VALUES (1, 101, 'PENDING', 0, NULL, 'PENDING', 0, NULL)");
        await run(db, "INSERT INTO consolidated_reporting_jobs VALUES (2, 102, 'PENDING', 0, NULL, 'PENDING', 0, NULL)");

        const sheetStarted = deferred();
        const releaseSheet = deferred();
        const sheetCalls = [];
        let emailBehavior = null;
        const emailCalls = [];
        let onWait = async () => {};
        const coordinator = createDayClosingDeliveryCoordinator({
            database: db,
            sheetWorker: {
                async processForJob(id) {
                    sheetCalls.push(id);
                    sheetStarted.resolve();
                    await releaseSheet.promise;
                    await run(db, "UPDATE consolidated_reporting_jobs SET sheet_status='DELIVERED', sheet_attempt_count=1 WHERE id=?", [id]);
                }
            },
            emailWorker: {
                async processForJob(id) {
                    emailCalls.push(id);
                    await emailBehavior(id);
                }
            },
            waitForChange: () => onWait()
        });

        let sheetSettled = false;
        const sheetPromise = coordinator.settle(2, "sheet", true).then(value => {
            sheetSettled = true;
            return value;
        });
        await sheetStarted.promise;
        assert.strictEqual(sheetSettled, false, "slow DSR remains active until its real worker result");
        assert.deepStrictEqual(sheetCalls, [2], "the current job ID is targeted despite an older queued job");
        assert.strictEqual((await coordinator.readJob(1)).sheet_status, "PENDING");
        releaseSheet.resolve();
        assert.strictEqual((await sheetPromise).status, "DELIVERED");

        const emailStarted = deferred();
        const releaseEmail = deferred();
        emailBehavior = async id => {
            emailStarted.resolve();
            await releaseEmail.promise;
            await run(db, "UPDATE consolidated_reporting_jobs SET email_status='DELIVERED', email_attempt_count=1 WHERE id=?", [id]);
        };
        let emailSettled = false;
        const emailPromise = coordinator.settle(2, "email", true).then(value => {
            emailSettled = true;
            return value;
        });
        await emailStarted.promise;
        assert.strictEqual(emailSettled, false, "slow email remains active until its real send result");
        releaseEmail.resolve();
        assert.strictEqual((await emailPromise).status, "DELIVERED");

        await run(db, "UPDATE consolidated_reporting_jobs SET email_status='PROCESSING', email_attempt_count=1 WHERE id=2");
        let competingWaits = 0;
        onWait = async () => {
            competingWaits += 1;
            await run(db, "UPDATE consolidated_reporting_jobs SET email_status='DELIVERED' WHERE id=2");
        };
        const competing = await coordinator.settle(2, "email", true);
        assert.strictEqual(competing.status, "DELIVERED");
        assert.strictEqual(competingWaits, 1, "a competing worker's persisted result is observed");
        assert.deepStrictEqual(emailCalls, [2], "the coordinator must not duplicate the competing email send");

        await run(db, "UPDATE consolidated_reporting_jobs SET email_status='PENDING', email_attempt_count=0, email_last_error=NULL WHERE id=2");
        emailBehavior = async id => run(db, "UPDATE consolidated_reporting_jobs SET email_status='PENDING', email_attempt_count=1, email_last_error='RETRYABLE_EMAIL_FAILURE' WHERE id=?", [id]);
        const queued = await coordinator.settle(2, "email", true);
        assert.strictEqual(queued.status, "PENDING");
        assert.strictEqual(queued.durable, true);
        assert.strictEqual(queued.attemptCount, 1);
        assert.deepStrictEqual(emailCalls, [2, 2]);
        await run(db, "UPDATE consolidated_reporting_jobs SET email_status='DELIVERED', email_last_error=NULL WHERE id=2");
        assert.strictEqual((await coordinator.observeForPrint(2)).emailStatus, "DELIVERED",
            "a later background retry success replaces the queued state before printing");

        await run(db, "UPDATE consolidated_reporting_jobs SET email_status='PENDING', email_attempt_count=0, email_last_error=NULL WHERE id=2");
        emailBehavior = async id => run(db, "UPDATE consolidated_reporting_jobs SET email_status='FAILED', email_attempt_count=1, email_last_error='MISSING_CONFIGURATION' WHERE id=?", [id]);
        const failed = await coordinator.settle(2, "email", true);
        assert.strictEqual(failed.status, "FAILED", "terminal failure is never called queued");
        assert.strictEqual(failed.durable, true);

        await run(db, "UPDATE consolidated_reporting_jobs SET email_status='PENDING', email_attempt_count=0 WHERE id=2");
        const callsBeforeOffline = emailCalls.length;
        const offline = await coordinator.settle(2, "email", false);
        assert.strictEqual(offline.status, "PENDING");
        assert.strictEqual(offline.durable, true);
        assert.strictEqual(emailCalls.length, callsBeforeOffline, "offline delivery remains durably queued without a send");

        await run(db, "UPDATE consolidated_reporting_jobs SET sheet_status='PROCESSING', sheet_attempt_count=2 WHERE id=2");
        let printWaits = 0;
        onWait = async () => {
            printWaits += 1;
            await run(db, "UPDATE consolidated_reporting_jobs SET sheet_status='DELIVERED' WHERE id=2");
        };
        const printStatus = await coordinator.observeForPrint(2);
        assert.strictEqual(printWaits, 1, "printing waits for the real in-flight DSR result");
        assert.deepStrictEqual(printStatus, { dsrStatus: "DELIVERED", emailStatus: "PENDING", durable: true });

        await close(db);
        db = new sqlite3.Database(dbPath);
        const afterRestart = await get(db, "SELECT email_status, email_attempt_count FROM consolidated_reporting_jobs WHERE id=2");
        assert.deepStrictEqual(afterRestart, { email_status: "PENDING", email_attempt_count: 0 },
            "the online queue survives database close and restart");
        const restartedCoordinator = createDayClosingDeliveryCoordinator({
            database: db,
            sheetWorker: { processForJob: async () => { throw new Error("Sheet already delivered."); } },
            emailWorker: { processForJob: async id => {
                await run(db, "UPDATE consolidated_reporting_jobs SET email_status='DELIVERED', email_attempt_count=1 WHERE id=?", [id]);
            } }
        });
        assert.strictEqual((await restartedCoordinator.settle(2, "email", true)).status, "DELIVERED",
            "a restarted process can resume and deliver the persisted email job");

        const sheetSource = fs.readFileSync("src/services/consolidatedSheetDeliveryWorker.js", "utf8");
        const emailSource = fs.readFileSync("src/services/consolidatedReportingEmailWorker.js", "utf8");
        assert(sheetSource.includes("async function processForJob(jobId)"));
        assert(emailSource.includes("async function processForJob(jobId)"));
        assert(sheetSource.includes('jobId === null ? [] : [jobId]'));
        assert(emailSource.includes('jobId === null ? [] : [jobId]'));
        console.log("Day Closing current-job delivery coordination tests: PASS");
    } finally {
        await close(db);
        fs.rmSync(temp, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
