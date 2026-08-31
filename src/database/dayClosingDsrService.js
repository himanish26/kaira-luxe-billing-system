const { CONTRACT_VERSION } = require("../services/dsrSyncService");

const INTEGER_COLUMNS = Object.freeze([
    "id", "close_sequence", "snapshot_version", "total_bills", "qty_sold",
    "gross_sales_paise", "total_discount_paise", "net_billing_paise",
    "credit_note_count", "qty_returned", "return_cn_value_paise",
    "net_sales_after_returns_paise", "cash_paise", "upi_paise", "card_paise",
    "store_credit_redeemed_paise", "gift_voucher_redeemed_paise",
    "settlement_total_paise", "actual_money_collection_paise",
    "store_credit_issued_paise", "settlement_difference_paise"
]);

function get(database, sql, params = []) {
    return new Promise((resolve, reject) => database.get(sql, params,
        (error, row) => error ? reject(error) : resolve(row || null)));
}

async function readClosedDsrPayload(database, snapshotId, klbsVersion) {
    const row = await get(database, `
        SELECT id, business_date, close_sequence, snapshot_version, close_status,
               closed_at, total_bills, qty_sold, gross_sales_paise,
               total_discount_paise, net_billing_paise, credit_note_count,
               qty_returned, return_cn_value_paise, net_sales_after_returns_paise,
               cash_paise, upi_paise, card_paise, store_credit_redeemed_paise,
               gift_voucher_redeemed_paise, settlement_total_paise,
               actual_money_collection_paise, store_credit_issued_paise,
               settlement_difference_paise, backup_status, email_status
        FROM day_closing_snapshots WHERE id = ?
    `, [snapshotId]);
    if (!row) throw new Error("DSR snapshot was not found.");
    if (row.close_status !== "CLOSED") throw new Error("DSR requires a CLOSED snapshot.");
    if (Number(row.snapshot_version) !== 1) throw new Error("DSR requires snapshot version 1.");
    for (const column of INTEGER_COLUMNS) {
        if (!Number.isSafeInteger(row[column])) {
            throw new Error(`DSR snapshot column is not a safe integer: ${column}.`);
        }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.business_date || "")) ||
        !row.closed_at || !Number.isFinite(Date.parse(row.closed_at)) ||
        row.backup_status !== "SUCCESS" ||
        !["SUCCESS", "FAILED"].includes(row.email_status)) {
        throw new Error("DSR snapshot metadata is invalid or incomplete.");
    }
    return {
        contractVersion: CONTRACT_VERSION,
        businessDate: row.business_date,
        closingId: row.id,
        closeSequence: row.close_sequence,
        snapshotVersion: row.snapshot_version,
        closedAt: row.closed_at,
        totalBills: row.total_bills,
        qtySold: row.qty_sold,
        grossSalesPaise: row.gross_sales_paise,
        totalDiscountPaise: row.total_discount_paise,
        netBillingPaise: row.net_billing_paise,
        creditNoteCount: row.credit_note_count,
        qtyReturned: row.qty_returned,
        returnCnValuePaise: row.return_cn_value_paise,
        netSalesAfterReturnsPaise: row.net_sales_after_returns_paise,
        cashPaise: row.cash_paise,
        upiPaise: row.upi_paise,
        cardPaise: row.card_paise,
        storeCreditRedeemedPaise: row.store_credit_redeemed_paise,
        giftVoucherRedeemedPaise: row.gift_voucher_redeemed_paise,
        settlementTotalPaise: row.settlement_total_paise,
        actualMoneyCollectionPaise: row.actual_money_collection_paise,
        storeCreditIssuedPaise: row.store_credit_issued_paise,
        settlementDifferencePaise: row.settlement_difference_paise,
        backupStatus: row.backup_status,
        emailStatus: row.email_status,
        klbsVersion: String(klbsVersion || "").trim()
    };
}

module.exports = { readClosedDsrPayload, INTEGER_COLUMNS };
