const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const { createIntegrationOutboxService } = require("../src/services/integrationOutboxService");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function (error) {
        error ? reject(error) : resolve({ changes: this.changes });
    }));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params,
        (error, rows) => error ? reject(error) : resolve(rows)));
}

async function main() {
    const db = new sqlite3.Database(":memory:");
    await run(db, `CREATE TABLE day_closing_snapshots (
        id INTEGER PRIMARY KEY,
        business_date TEXT,
        close_sequence INTEGER,
        close_status TEXT,
        backup_reference TEXT,
        backup_status TEXT,
        email_status TEXT,
        dsr_sync_status TEXT,
        dsr_synced_at TEXT,
        dsr_sync_error TEXT,
        updated_at TEXT
    )`);
    await run(db, `CREATE TABLE integration_outbox (
        id INTEGER PRIMARY KEY,
        business_date TEXT,
        closing_id INTEGER,
        close_sequence INTEGER,
        delivery_type TEXT,
        status TEXT,
        attempt_count INTEGER,
        created_at TEXT,
        last_attempt_at TEXT,
        completed_at TEXT,
        last_error TEXT
    )`);
    await run(db, `INSERT INTO day_closing_snapshots
        (id, business_date, close_sequence, close_status, backup_reference, backup_status,
         email_status, dsr_sync_status, updated_at)
        VALUES (1, '2026-09-13', 1, 'CLOSED', 'backup.zip', 'SUCCESS',
                'SUCCESS', 'NOT_ATTEMPTED', NULL)`);
    await run(db, `INSERT INTO integration_outbox
        (id, business_date, closing_id, close_sequence, delivery_type, status,
         attempt_count, created_at, last_attempt_at, completed_at, last_error)
        VALUES
        (1, '2026-09-13', 1, 1, 'DSR_DAY_CLOSING', 'PROCESSING', 7,
         '2026-09-13T08:00:00.000Z', '2026-09-14T09:59:30.000Z', NULL, NULL),
        (2, '2026-09-13', 1, 1, 'DSR_DAY_CLOSING', 'PROCESSING', 3,
         '2026-09-13T08:00:00.000Z', '2026-09-14T08:00:00.000Z', NULL, 'interrupted'),
        (3, '2026-09-13', 1, 1, 'DSR_DAY_CLOSING', 'SUCCESS', 5,
         '2026-09-13T08:00:00.000Z', '2026-09-14T08:00:00.000Z',
         '2026-09-14T08:01:00.000Z', NULL)`);

    let dsrAttempts = 0;
    const service = createIntegrationOutboxService({
        database: db,
        now: () => new Date("2026-09-14T10:00:00.000Z"),
        syncDsr: async () => {
            dsrAttempts += 1;
            return { success: true, action: "UPDATED" };
        },
        readDsrPayload: async () => ({ businessDate: "2026-09-13" })
    });

    await service.drain();
    const rows = await all(db, `SELECT id, status, attempt_count
        FROM integration_outbox ORDER BY id`);
    assert.deepStrictEqual(rows, [
        { id: 1, status: "PROCESSING", attempt_count: 7 },
        { id: 2, status: "SUCCESS", attempt_count: 4 },
        { id: 3, status: "SUCCESS", attempt_count: 5 }
    ]);
    assert.strictEqual(dsrAttempts, 1, "only the recovered stale row should be retried");

    await service.drain();
    assert.strictEqual(dsrAttempts, 1, "successful delivery must not retry");

    await new Promise(resolve => db.close(resolve));
    console.log("PASS stale PROCESSING recovery, fresh-row protection, normal retry, and SUCCESS preservation");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
