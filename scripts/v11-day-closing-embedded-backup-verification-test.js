const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");
const sqlite3 = require("sqlite3").verbose();

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-v11-day-close-backup-"));
fs.mkdirSync(path.join(tempRoot, "temp"), { recursive: true });
fs.mkdirSync(path.join(tempRoot, "userData"), { recursive: true });
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (parent && parent.filename.endsWith("backupService.js")) {
        if (request === "electron") return { app: {
            getPath: name => path.join(tempRoot, name),
            relaunch() {},
            exit() {}
        } };
        if (request === "../database/database") return { closeDatabase: async () => {} };
        if (request === "../database/databasePath") return {
            getAuthoritativeDatabasePath: () => path.join(tempRoot, "live.db"),
            assertAuthoritativeDatabaseConnection: async () => true
        };
        if (request === "../database/settingsService") return {
            getSettings: async () => ({}),
            recordScheduledBackupSuccess: async () => {}
        };
        if (request === "../database/logService") return {
            logBackupCreated: async () => {},
            logAutomaticBackupCreated: async () => {},
            logAutomaticBackupFailed: async () => {},
            logBackupFailed: async () => {},
            logRestoreFailed: async () => {}
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const { validateDayClosingBackup } = require("../src/services/backupService");
Module._load = originalLoad;

const run = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, error => error ? reject(error) : resolve()));
const close = db => new Promise((resolve, reject) =>
    db.close(error => error ? reject(error) : resolve()));

async function makeDatabase(filePath, state = "CLOSED") {
    const db = new sqlite3.Database(filePath);
    await run(db, `CREATE TABLE business_day_state (
        business_date TEXT PRIMARY KEY, state TEXT NOT NULL, opened_at TEXT, closed_at TEXT, updated_at TEXT
    )`);
    await run(db, `CREATE TABLE day_closing_snapshots (
        id INTEGER PRIMARY KEY, business_date TEXT, close_sequence INTEGER, close_status TEXT,
        total_bills INTEGER, qty_sold INTEGER, gross_sales_paise INTEGER, total_discount_paise INTEGER,
        net_billing_paise INTEGER, credit_note_count INTEGER, qty_returned INTEGER, return_cn_value_paise INTEGER,
        net_sales_after_returns_paise INTEGER, cash_paise INTEGER, upi_paise INTEGER, card_paise INTEGER,
        store_credit_redeemed_paise INTEGER, gift_voucher_redeemed_paise INTEGER, settlement_total_paise INTEGER,
        actual_money_collection_paise INTEGER, store_credit_issued_paise INTEGER, settlement_difference_paise INTEGER,
        store_credit_ledger_redeemed_paise INTEGER, store_credit_ledger_difference_paise INTEGER
    )`);
    await run(db, "INSERT INTO business_day_state VALUES (?,?,?,?,?)", [
        "2026-09-27", state, "2026-09-27T04:00:00Z", state === "CLOSED" ? "2026-09-27T12:00:00Z" : null, "2026-09-27T12:00:00Z"
    ]);
    await run(db, `INSERT INTO day_closing_snapshots VALUES (
        7,'2026-09-27',1,'CLOSED',
        3,5,100000,10000,90000,1,1,5000,85000,30000,30000,30000,0,0,90000,90000,5000,0,0,0
    )`);
    await close(db);
}

function makeZip(databasePath, zipPath) {
    const zip = new AdmZip();
    zip.addFile("backup-info.json", Buffer.from(JSON.stringify({
        application: require("../package.json").productName || "KAIRA LUXE Billing System",
        backupSchema: 1,
        appVersion: require("../package.json").version,
        database: "billing.db"
    })));
    zip.addLocalFile(databasePath, "Database", "billing.db");
    zip.writeZip(zipPath);
}

(async () => {
    const expected = {
        id: 7, business_date: "2026-09-27", close_sequence: 1,
        total_bills: 3, qty_sold: 5, gross_sales_paise: 100000, total_discount_paise: 10000,
        net_billing_paise: 90000, credit_note_count: 1, qty_returned: 1, return_cn_value_paise: 5000,
        net_sales_after_returns_paise: 85000, cash_paise: 30000, upi_paise: 30000, card_paise: 30000,
        store_credit_redeemed_paise: 0, gift_voucher_redeemed_paise: 0, settlement_total_paise: 90000,
        actual_money_collection_paise: 90000, store_credit_issued_paise: 5000, settlement_difference_paise: 0,
        store_credit_ledger_redeemed_paise: 0, store_credit_ledger_difference_paise: 0
    };

    const goodDb = path.join(tempRoot, "good.db");
    const goodZip = path.join(tempRoot, "good.zip");
    await makeDatabase(goodDb, "CLOSED");
    makeZip(goodDb, goodZip);
    const good = await validateDayClosingBackup(goodZip, expected);
    assert.strictEqual(good.success, true);
    assert.strictEqual(good.dayClosingVerified, true);

    const badDb = path.join(tempRoot, "bad.db");
    const badZip = path.join(tempRoot, "bad.zip");
    await makeDatabase(badDb, "OPEN");
    makeZip(badDb, badZip);
    const bad = await validateDayClosingBackup(badZip, expected);
    assert.strictEqual(bad.success, false);
    assert(/CLOSED business-day state/.test(bad.message));

    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log("V1.1 Day Closing embedded backup verification test: PASS");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
