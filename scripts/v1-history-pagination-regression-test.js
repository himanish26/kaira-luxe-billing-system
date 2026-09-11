const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        error ? reject(error) : resolve(this);
    }));
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function seed(db, billCount, activityCount) {
    await run(db, "BEGIN");
    try {
        for (let index = 1; index <= billCount; index += 1) {
            await run(db, `
                INSERT INTO bills
                    (bill_no, bill_date, bill_time, customer_name, customer_mobile,
                     net_amount, payment_status, created_at)
                VALUES (?, '2026-09-11', '10:00:00 AM', ?, ?, 100, 'PAID', ?)
            `, [
                `HISTORY-BILL-${String(index).padStart(5, "0")}`,
                `Customer ${index}`,
                `90000${String(index).padStart(5, "0")}`,
                `2026-09-11T10:${String(index % 60).padStart(2, "0")}:00.000Z`
            ]);
        }
        for (let index = 1; index <= activityCount; index += 1) {
            await run(db, `
                INSERT INTO activities
                    (activity_date, activity_time, category, action, details,
                     user_name, status, entity_type, reference_no, created_at)
                VALUES ('11 Sep 2026', '10:00:00 AM', 'SYSTEM', 'TEST_ACTIVITY',
                        ?, 'SYSTEM', 'SUCCESS', 'TEST', ?, ?)
            `, [
                `History activity ${index}`,
                `HISTORY-ACT-${String(index).padStart(5, "0")}`,
                `2026-09-11T10:${String(index % 60).padStart(2, "0")}:00.000Z`
            ]);
        }
        await run(db, "COMMIT");
    }
    catch (error) {
        await run(db, "ROLLBACK").catch(() => {});
        throw error;
    }
}

async function assertPages(fetchPage, totalCount, label) {
    const pageSize = 100;
    const first = await fetchPage(1, "");
    assert.strictEqual(first.totalCount, totalCount, `${label} count`);
    const rows = first.bills || first.activities;
    assert(rows.length <= pageSize, `${label} page size`);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    assert.strictEqual(first.totalPages, totalPages);
    const middle = await fetchPage(Math.max(1, Math.ceil(totalPages / 2)), "");
    const last = await fetchPage(totalPages, "");
    assert((last.bills || last.activities).length <= pageSize, `${label} last page size`);
    const seen = new Set();
    let previousKey = null;
    for (let page = 1; page <= totalPages; page += 1) {
        const result = await fetchPage(page, "");
        const pageRows = result.bills || result.activities;
        for (const row of pageRows) {
            assert(!seen.has(row.sort_id || row.id), `${label} duplicate`);
            seen.add(row.sort_id || row.id);
            const orderingId = row.sort_id || row.id || 0;
            const orderingKey = row.sort_id !== undefined
                ? `${row.sort_timestamp || ""}\u0000${String(orderingId).padStart(12, "0")}`
                : String(orderingId).padStart(12, "0");
            if (previousKey !== null) assert(orderingKey <= previousKey);
            previousKey = orderingKey;
        }
    }
    assert.strictEqual(seen.size, totalCount, `${label} traversal`);
    return { totalPages, middle, last };
}

async function child(tempRoot, billCount, activityCount) {
    const { app } = require("electron");
    app.setPath("userData", path.join(tempRoot, "user data"));
    const db = require("../src/database/database");
    await db.databaseReady;
    await seed(db, billCount, activityCount);
    const billService = require("../src/database/billService");
    const activityService = require("../src/database/activityService");
    const measurements = { billCount, activityCount };

    if (billCount > 0) {
        const billStart = process.hrtime.bigint();
        const billResult = await assertPages(async (page, keyword) => {
            const start = process.hrtime.bigint();
            const result = await billService.getTransactionHistoryPage({ page, pageSize: 100, keyword });
            const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
            if (!measurements.billPageMs) measurements.billPageMs = elapsed;
            return result;
        }, billCount, "bills");
        measurements.billCountMs = Number((Number(process.hrtime.bigint() - billStart) / 1e6).toFixed(3));
        const searchStart = process.hrtime.bigint();
        const billSearch = await billService.getTransactionHistoryPage({ page: 1, pageSize: 100, keyword: `HISTORY-BILL-${String(billCount).padStart(5, "0")}` });
        measurements.billSearchMs = Number((Number(process.hrtime.bigint() - searchStart) / 1e6).toFixed(3));
        assert.strictEqual(billSearch.totalCount, 1);
        const broad = await billService.getTransactionHistoryPage({ page: 1, pageSize: 100, keyword: "HISTORY-BILL" });
        assert.strictEqual(broad.totalCount, billCount);
        assert(broad.bills.length <= 100);
        assert(billResult.middle.bills.length <= 100 && billResult.last.bills.length <= 100);
    }

    if (activityCount > 0) {
        const activityStart = process.hrtime.bigint();
        const activityResult = await assertPages(async (page, keyword) => {
            const start = process.hrtime.bigint();
            const result = await activityService.getActivityPage({ page, pageSize: 100, keyword });
            const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
            if (!measurements.activityPageMs) measurements.activityPageMs = elapsed;
            return result;
        }, activityCount, "activities");
        measurements.activityCountMs = Number((Number(process.hrtime.bigint() - activityStart) / 1e6).toFixed(3));
        const searchStart = process.hrtime.bigint();
        const activitySearch = await activityService.getActivityPage({ page: 1, pageSize: 100, keyword: `HISTORY-ACT-${String(activityCount).padStart(5, "0")}` });
        measurements.activitySearchMs = Number((Number(process.hrtime.bigint() - searchStart) / 1e6).toFixed(3));
        assert.strictEqual(activitySearch.totalCount, 1);
        const broad = await activityService.getActivityPage({ page: 1, pageSize: 100, keyword: "HISTORY-ACT" });
        assert.strictEqual(broad.totalCount, activityCount);
        assert(broad.activities.length <= 100);
        assert(activityResult.middle.activities.length <= 100 && activityResult.last.activities.length <= 100);
    }

    process.stdout.write(JSON.stringify(measurements) + "\n");
    await close(db);
    app.exit(0);
}

if (process.argv.includes("--child")) {
    const index = process.argv.indexOf("--child");
    child(process.argv[index + 1], Number(process.argv[index + 2]), Number(process.argv[index + 3]))
        .catch(error => { console.error(error); try { require("electron").app.exit(1); } catch (_) {} process.exitCode = 1; });
}
else {
    const electronBinary = require("electron");
    const cases = [[1000, 1000], [5000, 5000], [10000, 10000], [0, 25000]];
    const measurements = [];
    for (const [billCount, activityCount] of cases) {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-history-pagination-"));
        const result = spawnSync(electronBinary, ["--disable-gpu", "--in-process-gpu", __filename, "--child", tempRoot, billCount, activityCount], {
            cwd: path.resolve(__dirname, ".."),
            env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "billing.db") },
            encoding: "utf8", timeout: 180000, windowsHide: true
        });
        if (result.error) throw result.error;
        if (result.status !== 0) {
            process.stdout.write(result.stdout || "");
            process.stderr.write(result.stderr || "");
            process.exit(result.status || 1);
        }
        const line = result.stdout.split("\n").find(value => value.trim().startsWith("{"));
        measurements.push(JSON.parse(line));
    }
    console.log(JSON.stringify({ measurements }, null, 2));
    console.log("History pagination disposable scale tests: PASS");
}
