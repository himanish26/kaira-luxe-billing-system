const {
    buildConsolidatedPayload,
    canonicalizeSemanticPayload,
    hashSemanticPayload
} = require("../shared/consolidatedDsrBuilder");

function createConsolidatedReportingPersistenceService(options = {}) {
    const database = options.database;
    if (!database) throw new Error("Consolidated reporting persistence database dependency is required.");

    const run = (sql, params = []) => new Promise((resolve, reject) => {
        database.run(sql, params, function(error) {
            if (error) reject(error);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
    const get = (sql, params = []) => new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
    });
    const all = (sql, params = []) => new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
    });

    function snapshotOverall(snapshot) {
        return {
            totalBills: snapshot.total_bills,
            qtySold: snapshot.qty_sold,
            grossSalesPaise: snapshot.gross_sales_paise,
            totalDiscountPaise: snapshot.total_discount_paise,
            netBillingPaise: snapshot.net_billing_paise,
            creditNoteCount: snapshot.credit_note_count,
            qtyReturned: snapshot.qty_returned,
            returnCnValuePaise: snapshot.return_cn_value_paise,
            netSalesAfterReturnsPaise: snapshot.net_sales_after_returns_paise,
            cashPaise: snapshot.cash_paise,
            upiPaise: snapshot.upi_paise,
            cardPaise: snapshot.card_paise,
            storeCreditRedeemedPaise: snapshot.store_credit_redeemed_paise,
            giftVoucherRedeemedPaise: snapshot.gift_voucher_redeemed_paise,
            settlementTotalPaise: snapshot.settlement_total_paise,
            actualMoneyCollectionPaise: snapshot.actual_money_collection_paise,
            storeCreditIssuedPaise: snapshot.store_credit_issued_paise,
            settlementDifferencePaise: snapshot.settlement_difference_paise,
            storeCreditLedgerRedeemedPaise: snapshot.store_credit_ledger_redeemed_paise,
            storeCreditLedgerDifferencePaise: snapshot.store_credit_ledger_difference_paise,
            backupStatus: snapshot.backup_status,
            backupReference: snapshot.backup_reference,
            emailStatus: snapshot.email_status
        };
    }

    async function readAuthoritativeBills(businessDate) {
        const rows = await all(`
            SELECT id, bill_no, net_amount,
                   cash_amount, upi_amount, card_amount,
                   store_credit_amount, gift_voucher_amount
            FROM bills
            WHERE bill_date = ?
            ORDER BY id
        `, [businessDate]);
        const bills = [];
        for (const row of rows) {
            const items = await all(`
                SELECT id, qty, business_segment, net_amount
                FROM bill_items
                WHERE bill_no = ?
                ORDER BY id
            `, [row.bill_no]);
            bills.push({
                billId: row.id,
                billNo: row.bill_no,
                billNet: row.net_amount,
                items: items.map(item => ({
                    itemId: item.id,
                    qty: item.qty,
                    businessSegment: item.business_segment,
                    netAmount: item.net_amount
                })),
                payments: {
                    cash: row.cash_amount,
                    upi: row.upi_amount,
                    card: row.card_amount,
                    storeCreditRedeemed: row.store_credit_amount,
                    giftVoucherRedeemed: row.gift_voucher_amount
                }
            });
        }
        return bills;
    }

    async function createFrozenJobWithinTransaction(snapshot, createdAt, klbsVersion = "") {
        if (!snapshot || snapshot.close_status !== "CLOSED") throw new Error("A CLOSED snapshot is required for consolidated reporting.");
        const bills = await readAuthoritativeBills(snapshot.business_date);
        const payload = buildConsolidatedPayload({
            metadata: {
                businessDate: snapshot.business_date,
                closingId: snapshot.id,
                closeSequence: snapshot.close_sequence,
                closedAt: snapshot.closed_at,
                klbsVersion
            },
            overall: snapshotOverall(snapshot),
            bills
        });
        const payloadJson = canonicalizeSemanticPayload(payload);
        const payloadHash = hashSemanticPayload(payload);
        const insert = await run(`
            INSERT INTO consolidated_reporting_jobs (
                closing_id, business_date, close_sequence,
                contract_version, snapshot_version,
                payload_json, payload_hash, report_status,
                data_quality_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            snapshot.id,
            snapshot.business_date,
            snapshot.close_sequence,
            payload.contractVersion,
            payload.snapshotVersion,
            payloadJson,
            payloadHash,
            payload.reportStatus,
            payload.dataQuality.status,
            createdAt
        ]);
        return {
            jobId: insert.lastID,
            closingId: snapshot.id,
            businessDate: snapshot.business_date,
            closeSequence: snapshot.close_sequence,
            payload,
            payloadJson,
            payloadHash
        };
    }

    async function getByClosingId(closingId) {
        return get("SELECT * FROM consolidated_reporting_jobs WHERE closing_id = ?", [closingId]);
    }

    return {
        readAuthoritativeBills,
        createFrozenJobWithinTransaction,
        getByClosingId
    };
}

module.exports = { createConsolidatedReportingPersistenceService };
