const SNAPSHOT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function all(database, sql, params = []) {
    return new Promise((resolve, reject) => database.all(sql, params,
        (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function get(database, sql, params = []) {
    return new Promise((resolve, reject) => database.get(sql, params,
        (error, row) => error ? reject(error) : resolve(row || null)));
}

function requireBusinessDate(value) {
    const businessDate = String(value || "");
    if (!SNAPSHOT_DATE_PATTERN.test(businessDate)) throw new Error("A valid business date is required.");
    return businessDate;
}

function requireSnapshotId(value) {
    const snapshotId = Number(value);
    if (!Number.isSafeInteger(snapshotId) || snapshotId <= 0) throw new Error("A valid Day Closing snapshot is required.");
    return snapshotId;
}

function rupees(value) {
    return value === null || value === undefined ? null : Number(value) / 100;
}

function snapshotToHistory(row) {
    if (!row) return null;
    return {
        snapshotId: row.id, businessDate: row.business_date, closeSequence: row.close_sequence,
        snapshotVersion: row.snapshot_version, closeStatus: row.close_status,
        closedAt: row.closed_at, closedBy: row.closed_by, totalBills: row.total_bills,
        qtySold: row.qty_sold, grossSales: rupees(row.gross_sales_paise),
        totalDiscount: rupees(row.total_discount_paise), netBilling: rupees(row.net_billing_paise),
        creditNoteCount: row.credit_note_count, qtyReturned: row.qty_returned,
        returnCnValue: rupees(row.return_cn_value_paise),
        netSalesAfterReturns: rupees(row.net_sales_after_returns_paise),
        cash: rupees(row.cash_paise), upi: rupees(row.upi_paise), card: rupees(row.card_paise),
        storeCreditRedeemed: rupees(row.store_credit_redeemed_paise),
        giftVoucherRedeemed: rupees(row.gift_voucher_redeemed_paise),
        settlementTotal: rupees(row.settlement_total_paise),
        actualMoneyCollection: rupees(row.actual_money_collection_paise),
        storeCreditIssued: rupees(row.store_credit_issued_paise),
        settlementDifference: rupees(row.settlement_difference_paise),
        backupStatus: row.backup_status, emailStatus: row.email_status,
        dsrSyncStatus: row.dsr_sync_status, dsrSyncedAt: row.dsr_synced_at,
        remarks: row.remarks, legacy: Number(row.snapshot_version) === 0, source: "SNAPSHOT"
    };
}

function createDayClosingHistoryService({ database }) {
    if (!database) throw new Error("Day Closing history database is required.");

    async function listSnapshotBusinessDates() {
        const rows = await all(database, `SELECT DISTINCT business_date FROM day_closing_snapshots
            WHERE business_date IS NOT NULL ORDER BY business_date ASC`);
        return rows.map(row => row.business_date);
    }

    async function listSnapshotsForDate(value) {
        const businessDate = requireBusinessDate(value);
        const rows = await all(database, `SELECT * FROM day_closing_snapshots
            WHERE business_date = ? ORDER BY close_sequence DESC`, [businessDate]);
        return rows.map(snapshotToHistory);
    }

    async function getSnapshot(value) {
        const snapshotId = requireSnapshotId(value);
        return snapshotToHistory(await get(database, "SELECT * FROM day_closing_snapshots WHERE id = ?", [snapshotId]));
    }

    async function getLatestSnapshotForDate(value) {
        const businessDate = requireBusinessDate(value);
        return snapshotToHistory(await get(database, `SELECT * FROM day_closing_snapshots
            WHERE business_date = ? ORDER BY close_sequence DESC LIMIT 1`, [businessDate]));
    }

    return { listSnapshotBusinessDates, listSnapshotsForDate, getSnapshot, getLatestSnapshotForDate };
}

module.exports = { createDayClosingHistoryService, snapshotToHistory };
