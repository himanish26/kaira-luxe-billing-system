const { readClosedDsrPayload } = require("./dayClosingDsrService");
const { createDsrSyncService } = require("../services/dsrSyncService");
const { getBusinessDate } = require("./businessDate");
const { SNAPSHOT_VERSION } = require("./dayClosingMigration");
const technicalLogger = require("../services/technicalLogger");

function toPaise(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) {
        throw new Error("Invalid Day Closing monetary value.");
    }
    const paise = Math.round((amount + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(paise)) {
        throw new Error("Day Closing monetary value exceeds safe limits.");
    }
    return paise;
}

function addSafe(current, addition, label) {
    const result = current + addition;
    if (!Number.isSafeInteger(result)) {
        throw new Error(`${label} exceeds safe limits.`);
    }
    return result;
}

function formatBusinessDateDisplay(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return value || "—";
    return `${match[3]}/${match[2]}/${match[1]}`;
}

function createDayClosingService(options = {}) {
    if (!options.database) {
        throw new Error("Day Closing database dependency is required.");
    }
    const database = options.database;
    const now = options.now || (() => new Date());
    const getBusinessDateFn = options.getBusinessDate || getBusinessDate;
    const backupService = options.createBackup && options.validateBackup
        ? null : require("../services/backupService");
    const createBackupFn = options.createBackup || backupService.createBackup;
    const validateBackupFn = options.validateBackup || backupService.validateBackup;
    const sendEmailFn = options.sendEmail || require("../services/emailService").sendEmail;
    const noActivityLog = async () => {};
    const logClosedFn = options.logBusinessDayClosed || noActivityLog;
    const logReopenedFn = options.logBusinessDayReopened || noActivityLog;
    const logDsrSuccessFn = options.logDsrSyncSucceeded || noActivityLog;
    const logDsrFailedFn = options.logDsrSyncFailed || noActivityLog;
    const dsrSyncService = options.dsrSyncService || createDsrSyncService();
    const readDsrPayloadFn = options.readClosedDsrPayload || readClosedDsrPayload;
    const klbsVersion = String(options.klbsVersion || "").trim();
    const closingEmail = options.closingEmail === undefined
        ? process.env.DAY_CLOSING_EMAIL
        : options.closingEmail;
    let closeInFlight = null;

    function run(sql, params = []) {
        return new Promise((resolve, reject) => {
            database.run(sql, params, function (error) {
                if (error) reject(error);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    function get(sql, params = []) {
        return new Promise((resolve, reject) => {
            database.get(sql, params, (error, row) => {
                if (error) reject(error);
                else resolve(row || null);
            });
        });
    }

    function all(sql, params = []) {
        return new Promise((resolve, reject) => {
            database.all(sql, params, (error, rows) => {
                if (error) reject(error);
                else resolve(rows || []);
            });
        });
    }

    async function calculateAccounting(businessDate) {
        const [bills, creditNotes, creditMovements] = await Promise.all([
            all(`
                SELECT
                    total_qty,
                    gross_amount,
                    discount_amount,
                    net_amount,
                    cash_amount,
                    upi_amount,
                    card_amount,
                    store_credit_amount,
                    gift_voucher_amount
                FROM bills
                WHERE bill_date = ?
                ORDER BY id
            `, [businessDate]),
            all(`
                SELECT
                    r.id,
                    r.net_reversal,
                    COALESCE(SUM(ri.quantity), 0) AS qty_returned
                FROM returns r
                LEFT JOIN return_items ri ON ri.return_id = r.id
                WHERE r.accounting_status = 'COMPLETED'
                  AND r.credit_note_no IS NOT NULL
                  AND TRIM(r.credit_note_no) <> ''
                  AND r.accounting_snapshot_version = 1
                  AND r.business_date = ?
                GROUP BY r.id
                ORDER BY r.id
            `, [businessDate]),
            all(`
                SELECT transaction_type, amount, created_at
                FROM customer_credit_transactions
                WHERE transaction_type IN ('RETURN_CREDIT', 'CREDIT_REDEEMED')
                ORDER BY id
            `)
        ]);

        const totals = {
            totalBills: bills.length,
            qtySold: 0,
            grossSalesPaise: 0,
            totalDiscountPaise: 0,
            netBillingPaise: 0,
            creditNoteCount: creditNotes.length,
            qtyReturned: 0,
            returnCnValuePaise: 0,
            cashPaise: 0,
            upiPaise: 0,
            cardPaise: 0,
            storeCreditRedeemedPaise: 0,
            giftVoucherRedeemedPaise: 0,
            storeCreditIssuedPaise: 0,
            storeCreditLedgerRedeemedPaise: 0
        };

        for (const bill of bills) {
            totals.qtySold = addSafe(
                totals.qtySold,
                Number(bill.total_qty || 0),
                "Day Closing sold quantity"
            );
            for (const [target, source] of [
                ["grossSalesPaise", "gross_amount"],
                ["totalDiscountPaise", "discount_amount"],
                ["netBillingPaise", "net_amount"],
                ["cashPaise", "cash_amount"],
                ["upiPaise", "upi_amount"],
                ["cardPaise", "card_amount"],
                ["storeCreditRedeemedPaise", "store_credit_amount"],
                ["giftVoucherRedeemedPaise", "gift_voucher_amount"]
            ]) {
                totals[target] = addSafe(
                    totals[target],
                    toPaise(bill[source]),
                    "Day Closing bill total"
                );
            }
        }

        for (const creditNote of creditNotes) {
            totals.qtyReturned = addSafe(
                totals.qtyReturned,
                Number(creditNote.qty_returned || 0),
                "Day Closing returned quantity"
            );
            totals.returnCnValuePaise = addSafe(
                totals.returnCnValuePaise,
                toPaise(creditNote.net_reversal),
                "Day Closing Credit Note total"
            );
        }

        for (const movement of creditMovements) {
            const timestamp = String(movement.created_at || "").trim();
            const normalizedTimestamp =
                /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)
                    ? `${timestamp.replace(" ", "T")}Z`
                    : timestamp;
            if (
                !normalizedTimestamp ||
                getBusinessDateFn(normalizedTimestamp) !== businessDate
            ) continue;
            const amountPaise = toPaise(movement.amount);
            if (movement.transaction_type === "RETURN_CREDIT" && amountPaise > 0) {
                totals.storeCreditIssuedPaise = addSafe(
                    totals.storeCreditIssuedPaise,
                    amountPaise,
                    "Day Closing Store Credit issuance"
                );
            }
            if (movement.transaction_type === "CREDIT_REDEEMED" && amountPaise < 0) {
                totals.storeCreditLedgerRedeemedPaise = addSafe(
                    totals.storeCreditLedgerRedeemedPaise,
                    Math.abs(amountPaise),
                    "Day Closing Store Credit redemption ledger"
                );
            }
        }

        totals.netSalesAfterReturnsPaise =
            totals.netBillingPaise - totals.returnCnValuePaise;
        totals.settlementTotalPaise =
            totals.cashPaise +
            totals.upiPaise +
            totals.cardPaise +
            totals.storeCreditRedeemedPaise +
            totals.giftVoucherRedeemedPaise;
        totals.actualMoneyCollectionPaise =
            totals.cashPaise + totals.upiPaise + totals.cardPaise;
        totals.settlementDifferencePaise =
            totals.netBillingPaise - totals.settlementTotalPaise;
        totals.storeCreditLedgerDifferencePaise =
            totals.storeCreditRedeemedPaise -
            totals.storeCreditLedgerRedeemedPaise;

        for (const [key, value] of Object.entries(totals)) {
            if (!Number.isSafeInteger(value)) {
                throw new Error(`Invalid Day Closing total: ${key}.`);
            }
        }
        return totals;
    }

    function snapshotToSummary(row) {
        if (!row) return null;
        const rupees = key => row[key] === null || row[key] === undefined
            ? null
            : Number(row[key]) / 100;
        return {
            snapshotId: row.id,
            snapshotVersion: row.snapshot_version,
            closeSequence: row.close_sequence,
            closeStatus: row.close_status,
            businessDate: row.business_date,
            closedAt: row.closed_at,
            closedBy: row.closed_by,
            totalBills: row.total_bills,
            qtySold: row.qty_sold,
            grossSales: rupees("gross_sales_paise"),
            totalDiscount: rupees("total_discount_paise"),
            netBilling: rupees("net_billing_paise"),
            creditNoteCount: row.credit_note_count,
            qtyReturned: row.qty_returned,
            returnCnValue: rupees("return_cn_value_paise"),
            netSalesAfterReturns: rupees("net_sales_after_returns_paise"),
            cash: rupees("cash_paise"),
            upi: rupees("upi_paise"),
            card: rupees("card_paise"),
            storeCreditRedeemed: rupees("store_credit_redeemed_paise"),
            giftVoucherRedeemed: rupees("gift_voucher_redeemed_paise"),
            settlementTotal: rupees("settlement_total_paise"),
            actualMoneyCollection: rupees("actual_money_collection_paise"),
            storeCreditIssued: rupees("store_credit_issued_paise"),
            settlementDifference: rupees("settlement_difference_paise"),
            storeCreditLedgerRedeemed: rupees("store_credit_ledger_redeemed_paise"),
            storeCreditLedgerDifference: rupees("store_credit_ledger_difference_paise"),
            backupStatus: row.backup_status,
            backupReference: row.backup_reference,
            emailStatus: row.email_status,
            dsrSyncStatus: row.dsr_sync_status,
            dsrSyncedAt: row.dsr_synced_at,
            dsrSyncError: row.dsr_sync_error,
            dsrSyncAttempts: row.dsr_sync_attempts,
            remarks: row.remarks,
            reopenedAt: row.reopened_at,
            reopenedBy: row.reopened_by,
            reopenReason: row.reopen_reason,
            legacy: Number(row.snapshot_version) === 0,
            source: "SNAPSHOT"
        };
    }

    function accountingToSummary(totals, businessDate) {
        const rupees = key => totals[key] / 100;
        return {
            snapshotId: null,
            snapshotVersion: SNAPSHOT_VERSION,
            closeStatus: "OPEN",
            businessDate,
            totalBills: totals.totalBills,
            qtySold: totals.qtySold,
            grossSales: rupees("grossSalesPaise"),
            totalDiscount: rupees("totalDiscountPaise"),
            netBilling: rupees("netBillingPaise"),
            creditNoteCount: totals.creditNoteCount,
            qtyReturned: totals.qtyReturned,
            returnCnValue: rupees("returnCnValuePaise"),
            netSalesAfterReturns: rupees("netSalesAfterReturnsPaise"),
            cash: rupees("cashPaise"),
            upi: rupees("upiPaise"),
            card: rupees("cardPaise"),
            storeCreditRedeemed: rupees("storeCreditRedeemedPaise"),
            giftVoucherRedeemed: rupees("giftVoucherRedeemedPaise"),
            settlementTotal: rupees("settlementTotalPaise"),
            actualMoneyCollection: rupees("actualMoneyCollectionPaise"),
            storeCreditIssued: rupees("storeCreditIssuedPaise"),
            settlementDifference: rupees("settlementDifferencePaise"),
            storeCreditLedgerRedeemed: rupees("storeCreditLedgerRedeemedPaise"),
            storeCreditLedgerDifference: rupees("storeCreditLedgerDifferencePaise"),
            backupStatus: "PENDING",
            emailStatus: "PENDING",
            legacy: false,
            source: "LIVE"
        };
    }

    async function getActiveSnapshot(businessDate) {
        return get(`
            SELECT *
            FROM day_closing_snapshots
            WHERE business_date = ?
              AND close_status IN ('PREPARING', 'CLOSED')
            ORDER BY close_sequence DESC
            LIMIT 1
        `, [businessDate]);
    }

    async function getDayClosingSnapshot(snapshotId) {
        const row = await get(
            `SELECT * FROM day_closing_snapshots WHERE id = ?`,
            [snapshotId]
        );
        return snapshotToSummary(row);
    }

    async function getDayClosingSummary() {
        const businessDate = getBusinessDateFn(now());
        const active = await getActiveSnapshot(businessDate);
        if (active && active.close_status === "CLOSED") {
            return snapshotToSummary(active);
        }
        return accountingToSummary(
            await calculateAccounting(businessDate),
            businessDate
        );
    }

    async function isBusinessDayClosed() {
        const businessDate = getBusinessDateFn(now());
        return get(`
            SELECT id, business_date, closed_at, closed_by, close_sequence,
                   snapshot_version, close_status
            FROM day_closing_snapshots
            WHERE business_date = ? AND close_status = 'CLOSED'
            ORDER BY close_sequence DESC LIMIT 1
        `, [businessDate]);
    }

    async function getBusinessDayState() {
        const businessDate = getBusinessDateFn(now());
        const active = await getActiveSnapshot(businessDate);
        return {
            businessDate,
            closed: !!active && active.close_status === "CLOSED",
            closing: !!active && active.close_status === "PREPARING",
            snapshot: active ? snapshotToSummary(active) : null
        };
    }

    async function reserveClose() {
        const businessDate = getBusinessDateFn(now());
        let transactionStarted = false;
        try {
            await run("BEGIN IMMEDIATE TRANSACTION");
            transactionStarted = true;
            const active = await getActiveSnapshot(businessDate);
            if (active) {
                await run("COMMIT");
                transactionStarted = false;
                return { active };
            }
            const sequenceRow = await get(`
                SELECT COALESCE(MAX(close_sequence), 0) + 1 AS next_sequence
                FROM day_closing_snapshots WHERE business_date = ?
            `, [businessDate]);
            const totals = await calculateAccounting(businessDate);
            const createdAt = now().toISOString();
            const values = [
                businessDate,
                Number(sequenceRow.next_sequence),
                SNAPSHOT_VERSION,
                createdAt,
                "Administrator",
                totals.totalBills,
                totals.qtySold,
                totals.grossSalesPaise,
                totals.totalDiscountPaise,
                totals.netBillingPaise,
                totals.creditNoteCount,
                totals.qtyReturned,
                totals.returnCnValuePaise,
                totals.netSalesAfterReturnsPaise,
                totals.cashPaise,
                totals.upiPaise,
                totals.cardPaise,
                totals.storeCreditRedeemedPaise,
                totals.giftVoucherRedeemedPaise,
                totals.settlementTotalPaise,
                totals.actualMoneyCollectionPaise,
                totals.storeCreditIssuedPaise,
                totals.settlementDifferencePaise,
                totals.storeCreditLedgerRedeemedPaise,
                totals.storeCreditLedgerDifferencePaise,
                createdAt,
                createdAt
            ];
            const insert = await run(`
                INSERT INTO day_closing_snapshots (
                    business_date, close_sequence, snapshot_version,
                    close_status, closed_at, closed_by,
                    total_bills, qty_sold, gross_sales_paise,
                    total_discount_paise, net_billing_paise,
                    credit_note_count, qty_returned, return_cn_value_paise,
                    net_sales_after_returns_paise, cash_paise, upi_paise,
                    card_paise, store_credit_redeemed_paise,
                    gift_voucher_redeemed_paise, settlement_total_paise,
                    actual_money_collection_paise, store_credit_issued_paise,
                    settlement_difference_paise,
                    store_credit_ledger_redeemed_paise,
                    store_credit_ledger_difference_paise,
                    backup_status, email_status, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, 'PREPARING', ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    'PENDING', 'PENDING', ?, ?
                )
            `, values);
            await run("COMMIT");
            transactionStarted = false;
            return {
                snapshotId: insert.lastID,
                businessDate,
                totals
            };
        }
        catch (error) {
            if (transactionStarted) await run("ROLLBACK").catch(() => {});
            throw error;
        }
    }

    function buildEmailText(summary) {
        const money = value => `₹${Number(value || 0).toFixed(2)}`;
        return [
            "KAIRA LUXE",
            "Business Day Closing Report",
            "",
            `Business Date: ${formatBusinessDateDisplay(summary.businessDate)}`,
            `Bills Generated: ${summary.totalBills}`,
            `Qty Sold: ${summary.qtySold}`,
            `Gross Sales: ${money(summary.grossSales)}`,
            `Total Discount: ${money(summary.totalDiscount)}`,
            `Net Billing: ${money(summary.netBilling)}`,
            `Credit Notes: ${summary.creditNoteCount}`,
            `Qty Returned: ${summary.qtyReturned}`,
            `Return / CN Value: ${money(summary.returnCnValue)}`,
            `Net Sales After Returns: ${money(summary.netSalesAfterReturns)}`,
            `Cash: ${money(summary.cash)}`,
            `UPI: ${money(summary.upi)}`,
            `Card: ${money(summary.card)}`,
            `Store Credit Redeemed: ${money(summary.storeCreditRedeemed)}`,
            `Gift Voucher Redeemed: ${money(summary.giftVoucherRedeemed)}`,
            `Actual Money Collection: ${money(summary.actualMoneyCollection)}`,
            `Store Credit Issued: ${money(summary.storeCreditIssued)}`,
            `Settlement Difference: ${money(summary.settlementDifference)}`,
            `Backup: ${summary.backupStatus} (${summary.backupReference || "-"})`,
            "Email outcome: dispatch in progress; final status is persisted after this message.",
            "",
            "The accounting snapshot and mandatory backup are complete."
        ].join("\n");
    }

    async function markFailed(snapshotId, message, backupStatus = "FAILED") {
        await run(`
            UPDATE day_closing_snapshots
            SET close_status = 'FAILED',
                backup_status = ?,
                email_status = 'FAILED',
                remarks = ?,
                updated_at = ?
            WHERE id = ? AND close_status = 'PREPARING'
        `, [backupStatus, message, now().toISOString(), snapshotId]);
    }

    function sanitizeDsrError(value) {
        return String(value || "DSR sync failed.")
            .replace(/https?:\/\/\S+/gi, "[ENDPOINT]")
            .slice(0, 500);
    }

    async function attemptDsrSync(snapshotId) {
        let payload;
        try {
            payload = await readDsrPayloadFn(database, snapshotId, klbsVersion);
        }
        catch (error) {
            return { status: "FAILED", warning: sanitizeDsrError(error.message) };
        }

        let persistenceWarning = null;
        try {
            await run(`
                UPDATE day_closing_snapshots
                SET dsr_sync_attempts = dsr_sync_attempts + 1, updated_at = ?
                WHERE id = ? AND close_status = 'CLOSED' AND snapshot_version = 1
            `, [now().toISOString(), snapshotId]);
        }
        catch (error) {
            persistenceWarning = "DSR attempt status could not be persisted.";
            console.error("DSR attempt persistence failed:", error.message);
        }

        const result = await dsrSyncService.sync(payload);
        if (!result.success) {
            technicalLogger.warn("DSR_SYNC", "Day Closing DSR synchronization failed", {
                closingId: payload.closingId,
                closeSequence: payload.closeSequence,
                classification: sanitizeDsrError(result.error)
            });
        }
        const status = result.success ? "SYNCED" : "FAILED";
        const warning = result.success ? persistenceWarning : sanitizeDsrError(result.error);
        try {
            await run(`
                UPDATE day_closing_snapshots
                SET dsr_sync_status = ?, dsr_synced_at = ?, dsr_sync_error = ?, updated_at = ?
                WHERE id = ? AND close_status = 'CLOSED' AND snapshot_version = 1
            `, [
                status,
                result.success ? result.syncedAt : null,
                result.success ? null : warning,
                now().toISOString(),
                snapshotId
            ]);
        }
        catch (error) {
            persistenceWarning = "DSR outcome could not be persisted.";
            console.error("DSR outcome persistence failed:", error.message);
        }

        try {
            if (result.success) {
                await logDsrSuccessFn(payload.businessDate, payload.closeSequence, result.action);
            }
            else {
                await logDsrFailedFn(payload.businessDate, payload.closeSequence, warning);
            }
        }
        catch (error) {
            console.error("DSR Activity Log failed:", error.message);
        }
        return {
            status,
            warning: result.success ? persistenceWarning : warning,
            action: result.success ? result.action : null
        };
    }

    async function executeClose() {
        const reservation = await reserveClose();
        if (reservation.active) {
            const active = snapshotToSummary(reservation.active);
            return active.closeStatus === "CLOSED"
                ? { success: false, alreadyClosed: true, ...active }
                : { success: false, alreadyClosing: true, ...active };
        }

        let backup;
        try {
            backup = await createBackupFn();
            const verification = await validateBackupFn(backup.backupFilePath);
            if (!verification || verification.success !== true) {
                throw new Error(
                    verification && verification.message ||
                    "Backup verification failed."
                );
            }
        }
        catch (error) {
            technicalLogger.error(
                "DAY_CLOSING",
                "Mandatory Day Closing backup failed",
                error,
                { snapshotId: reservation.snapshotId }
            );
            await markFailed(reservation.snapshotId, error.message, "FAILED");
            return {
                success: false,
                backupFailed: true,
                businessDate: reservation.businessDate,
                error: error.message
            };
        }

        const closedAt = now().toISOString();
        try {
            await run("BEGIN IMMEDIATE TRANSACTION");
            const update = await run(`
                UPDATE day_closing_snapshots
                SET close_status = 'CLOSED',
                    closed_at = ?,
                    backup_status = 'SUCCESS',
                    backup_reference = ?,
                    email_status = 'PENDING',
                    updated_at = ?
                WHERE id = ? AND close_status = 'PREPARING'
            `, [closedAt, backup.backupFileName, closedAt, reservation.snapshotId]);
            if (update.changes !== 1) {
                throw new Error("Day Closing reservation changed before completion.");
            }
            await run("COMMIT");
        }
        catch (error) {
            technicalLogger.error(
                "DAY_CLOSING",
                "Day Closing finalization failed",
                error,
                { snapshotId: reservation.snapshotId }
            );
            await run("ROLLBACK").catch(() => {});
            await markFailed(
                reservation.snapshotId,
                `Backup succeeded but closing finalization failed: ${error.message}`,
                "SUCCESS"
            ).catch(() => {});
            throw error;
        }

        let summary = await getDayClosingSnapshot(reservation.snapshotId);
        let emailStatus = "FAILED";
        let emailWarning = null;
        try {
            if (!closingEmail) {
                throw new Error("Day Closing email recipient is not configured.");
            }
            await sendEmailFn({
                to: closingEmail,
                subject: `KAIRA LUXE - Day Closing - ${formatBusinessDateDisplay(summary.businessDate)}`,
                text: buildEmailText(summary),
                attachments: [{
                    filename: backup.backupFileName,
                    path: backup.backupFilePath
                }]
            });
            emailStatus = "SUCCESS";
        }
        catch (error) {
            emailWarning = error.message;
            technicalLogger.warn("DAY_CLOSING", "Day Closing email delivery failed", {
                snapshotId: reservation.snapshotId,
                classification: sanitizeDsrError(error.message)
            });
        }

        await run(`
            UPDATE day_closing_snapshots
            SET email_status = ?,
                remarks = CASE WHEN ? IS NULL THEN remarks ELSE ? END,
                updated_at = ?
            WHERE id = ? AND close_status = 'CLOSED'
        `, [
            emailStatus,
            emailWarning,
            emailWarning ? `Email failed: ${emailWarning}` : null,
            now().toISOString(),
            reservation.snapshotId
        ]);

        let activityWarning = null;
        try {
            await logClosedFn(summary.businessDate);
        }
        catch (error) {
            activityWarning = error.message;
            technicalLogger.warn("DAY_CLOSING", "Day Closing Activity Log write failed", {
                snapshotId: reservation.snapshotId
            });
            console.error("Day Closing Activity Log Error:", error);
        }

        summary = await getDayClosingSnapshot(reservation.snapshotId);
        const dsrResult = await attemptDsrSync(reservation.snapshotId);
        summary = await getDayClosingSnapshot(reservation.snapshotId);
        return {
            success: true,
            snapshotId: reservation.snapshotId,
            snapshot: summary,
            backupStatus: "SUCCESS",
            emailStatus,
            emailWarning,
            activityWarning,
            dsrSyncStatus: dsrResult.status,
            dsrSyncWarning: dsrResult.warning,
            dsrSyncAction: dsrResult.action
        };
    }

    async function closeBusinessDay() {
        if (closeInFlight) {
            const state = await getBusinessDayState();
            return {
                success: false,
                alreadyClosing: true,
                businessDate: state.businessDate,
                message: "Business Day closing is already in progress."
            };
        }
        closeInFlight = executeClose();
        try {
            return await closeInFlight;
        }
        finally {
            closeInFlight = null;
        }
    }

    async function reopenBusinessDay(reason) {
        const normalizedReason = String(reason || "").trim();
        if (!normalizedReason) {
            return {
                success: false,
                reasonRequired: true,
                message: "A non-empty Day Re-open reason is required."
            };
        }
        const businessDate = getBusinessDateFn(now());
        let transactionStarted = false;
        let closure;
        const reopenedAt = now().toISOString();
        try {
            await run("BEGIN IMMEDIATE TRANSACTION");
            transactionStarted = true;
            closure = await get(`
                SELECT * FROM day_closing_snapshots
                WHERE business_date = ? AND close_status = 'CLOSED'
                ORDER BY close_sequence DESC LIMIT 1
            `, [businessDate]);
            if (!closure) {
                await run("COMMIT");
                transactionStarted = false;
                return {
                    success: false,
                    alreadyOpen: true,
                    message: "Business Day is already open."
                };
            }
            const update = await run(`
                UPDATE day_closing_snapshots
                SET close_status = 'REOPENED',
                    reopened_at = ?,
                    reopened_by = 'Manager',
                    reopen_reason = ?,
                    updated_at = ?
                WHERE id = ? AND close_status = 'CLOSED'
            `, [reopenedAt, normalizedReason, reopenedAt, closure.id]);
            if (update.changes !== 1) {
                throw new Error("Business Day closing changed before Re-open completed.");
            }
            await run("COMMIT");
            transactionStarted = false;
        }
        catch (error) {
            if (transactionStarted) await run("ROLLBACK").catch(() => {});
            technicalLogger.error(
                "DAY_CLOSING",
                "Business Day Re-open failed",
                error,
                { businessDate }
            );
            throw error;
        }

        let activityWarning = null;
        try {
            await logReopenedFn(businessDate);
        }
        catch (error) {
            activityWarning = error.message;
            technicalLogger.warn("DAY_CLOSING", "Day Re-open Activity Log write failed", {
                businessDate
            });
            console.error("Day Re-open Activity Log Error:", error);
        }
        return {
            success: true,
            businessDate,
            snapshotId: closure.id,
            reason: normalizedReason,
            activityWarning,
            message: activityWarning
                ? "Business Day re-opened; Activity Log recording failed."
                : "Business Day re-opened successfully."
        };
    }

    return {
        calculateAccounting,
        getDayClosingSummary,
        getDayClosingSnapshot,
        getBusinessDayState,
        isBusinessDayClosed,
        closeBusinessDay,
        reopenBusinessDay,
        retryDsrSync: attemptDsrSync
    };
}

module.exports = {
    createDayClosingService,
    toPaise,
    formatBusinessDateDisplay
};
