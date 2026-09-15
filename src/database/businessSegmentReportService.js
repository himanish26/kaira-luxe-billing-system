const {
    BUSINESS_SEGMENT_CODES,
    businessSegmentLabel,
    normalizeBusinessSegment
} = require("../shared/businessSegment");

function all(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => {
            if (error) reject(error);
            else resolve(rows || []);
        });
    });
}

function toPaise(value, description) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) {
        throw new Error(`Invalid ${description} in Business Segment report data.`);
    }
    const paise = Math.round((amount + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(paise)) {
        throw new Error(`Business Segment ${description} exceeds safe limits.`);
    }
    return paise;
}

function addSafe(left, right, description) {
    const result = left + right;
    if (!Number.isSafeInteger(result)) {
        throw new Error(`Business Segment ${description} exceeds safe limits.`);
    }
    return result;
}

function fromPaise(value) {
    if (!Number.isSafeInteger(value)) {
        throw new Error("Business Segment monetary total exceeds safe limits.");
    }
    return value / 100;
}

function roundToTwo(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function createTotals() {
    return {
        grossSalesPaise: 0,
        discountAmountPaise: 0,
        taxableValuePaise: 0,
        gstAmountPaise: 0,
        netBillingPaise: 0,
        qtySold: 0,
        bills: new Set(),
        creditNotes: new Set(),
        qtyReturned: 0,
        returnValuePaise: 0
    };
}

function addSale(totals, row) {
    totals.qtySold = addSafe(
        totals.qtySold,
        Number(row.quantity || 0),
        "sold quantity"
    );
    totals.grossSalesPaise = addSafe(
        totals.grossSalesPaise,
        toPaise(row.gross_sales, "gross sales"),
        "gross sales total"
    );
    for (const [target, source, label] of [
        ["discountAmountPaise", "discount_amount", "discount total"],
        ["taxableValuePaise", "taxable_value", "taxable total"],
        ["gstAmountPaise", "gst_amount", "GST total"],
        ["netBillingPaise", "net_billing", "net billing total"]
    ]) {
        totals[target] = addSafe(
            totals[target],
            toPaise(row[source], label),
            label
        );
    }
    totals.bills.add(String(row.bill_id));
}

function addReturn(totals, row) {
    totals.qtyReturned = addSafe(
        totals.qtyReturned,
        Number(row.quantity_returned || 0),
        "returned quantity"
    );
    totals.returnValuePaise = addSafe(
        totals.returnValuePaise,
        toPaise(row.return_value, "Credit Note value"),
        "Credit Note total"
    );
    totals.creditNotes.add(String(row.credit_note_id));
}

function serializeTotals(totals) {
    const netSalesAfterReturnsPaise =
        totals.netBillingPaise - totals.returnValuePaise;
    const bills = totals.bills.size;
    return {
        grossSales: fromPaise(totals.grossSalesPaise),
        discountAmount: fromPaise(totals.discountAmountPaise),
        taxableValue: fromPaise(totals.taxableValuePaise),
        gstAmount: fromPaise(totals.gstAmountPaise),
        netBilling: fromPaise(totals.netBillingPaise),
        qtySold: totals.qtySold,
        bills,
        creditNotes: totals.creditNotes.size,
        qtyReturned: totals.qtyReturned,
        returnValue: fromPaise(totals.returnValuePaise),
        netQty: totals.qtySold - totals.qtyReturned,
        netSalesAfterReturns: fromPaise(netSalesAfterReturnsPaise),
        // Transaction KPIs intentionally use pre-return sale activity.
        atv: bills === 0 ? 0 : fromPaise(Math.round(totals.netBillingPaise / bills)),
        upt: bills === 0 ? 0 : roundToTwo(totals.qtySold / bills)
    };
}

function sumSegmentMoney(segments, field) {
    return fromPaise(Object.values(segments).reduce(
        (total, segment) => addSafe(
            total,
            toPaise(segment[field], `${field} reconciliation`),
            `${field} reconciliation`
        ),
        0
    ));
}

function createBusinessSegmentReportService({ database }) {
    if (!database || typeof database.all !== "function") {
        throw new TypeError("A SQLite database connection is required.");
    }

    return {
        async calculateBusinessSegmentReport(businessDate) {
            const [salesRows, returnRows] = await Promise.all([
                all(database, `
                    SELECT
                        b.id AS bill_id,
                        b.bill_no,
                        bi.id AS bill_item_id,
                        bi.business_segment,
                        bi.qty AS quantity,
                        ROUND(bi.mrp * bi.qty, 2) AS gross_sales,
                        ROUND(bi.discount_amount, 2) AS discount_amount,
                        ROUND(bi.taxable_amount, 2) AS taxable_value,
                        ROUND(bi.gst_amount, 2) AS gst_amount,
                        ROUND(bi.net_amount, 2) AS net_billing,
                        bi.barcode
                    FROM bills b
                    INNER JOIN bill_items bi ON bi.bill_no = b.bill_no
                    WHERE DATE(b.bill_date) = ?
                    ORDER BY b.id, bi.id
                `, [businessDate]),
                all(database, `
                    SELECT
                        r.id AS credit_note_id,
                        r.credit_note_no,
                        ri.id AS return_item_id,
                        ri.quantity AS quantity_returned,
                        ri.net_reversal AS return_value,
                        obi.business_segment,
                        obi.id AS original_bill_item_id,
                        ri.barcode
                    FROM returns r
                    INNER JOIN return_items ri ON ri.return_id = r.id
                    LEFT JOIN bill_items obi ON obi.id = ri.original_bill_item_id
                    WHERE r.accounting_status = 'COMPLETED'
                      AND r.credit_note_no IS NOT NULL
                      AND TRIM(r.credit_note_no) <> ''
                      AND r.accounting_snapshot_version = 1
                      AND DATE(r.business_date) = ?
                    ORDER BY r.id, ri.id
                `, [businessDate])
            ]);

            const overallTotals = createTotals();
            const segmentTotals = Object.fromEntries(
                BUSINESS_SEGMENT_CODES.map(code => [code, createTotals()])
            );
            const unclassified = {
                saleItems: [],
                returnItems: []
            };

            for (const row of salesRows) {
                addSale(overallTotals, row);
                const code = normalizeBusinessSegment(row.business_segment, {
                    allowLabels: false
                });
                if (!code) {
                    unclassified.saleItems.push({
                        billId: row.bill_id,
                        billNo: row.bill_no,
                        billItemId: row.bill_item_id,
                        barcode: row.barcode || "",
                        rawBusinessSegment: row.business_segment == null
                            ? null
                            : String(row.business_segment),
                        qty: Number(row.quantity || 0),
                        netBilling: Number(row.net_billing || 0)
                    });
                    continue;
                }
                addSale(segmentTotals[code], row);
            }

            for (const row of returnRows) {
                addReturn(overallTotals, row);
                const code = normalizeBusinessSegment(row.business_segment, {
                    allowLabels: false
                });
                if (!code) {
                    unclassified.returnItems.push({
                        creditNoteId: row.credit_note_id,
                        creditNoteNo: row.credit_note_no,
                        returnItemId: row.return_item_id,
                        originalBillItemId: row.original_bill_item_id,
                        barcode: row.barcode || "",
                        rawBusinessSegment: row.business_segment == null
                            ? null
                            : String(row.business_segment),
                        qtyReturned: Number(row.quantity_returned || 0),
                        returnValue: Number(row.return_value || 0)
                    });
                    continue;
                }
                addReturn(segmentTotals[code], row);
            }

            const segments = Object.fromEntries(
                BUSINESS_SEGMENT_CODES.map(code => [code, {
                    code,
                    label: businessSegmentLabel(code),
                    ...serializeTotals(segmentTotals[code])
                }])
            );
            const overall = serializeTotals(overallTotals);
            const unclassifiedSaleItems = unclassified.saleItems.length;
            const unclassifiedReturnItems = unclassified.returnItems.length;

            return {
                businessDate,
                kairaLuxe: segments.KL,
                mensWear: segments.MENS,
                kidsWear: segments.KIDS,
                overall,
                reconciliation: {
                    classified: unclassifiedSaleItems === 0 && unclassifiedReturnItems === 0,
                    segmentGrossSales: sumSegmentMoney(segments, "grossSales"),
                    segmentNetBilling: sumSegmentMoney(segments, "netBilling"),
                    segmentQtySold: Object.values(segments).reduce((n, s) => n + s.qtySold, 0),
                    segmentReturnValue: sumSegmentMoney(segments, "returnValue"),
                    segmentQtyReturned: Object.values(segments).reduce((n, s) => n + s.qtyReturned, 0),
                    segmentNetSalesAfterReturns: sumSegmentMoney(segments, "netSalesAfterReturns"),
                    segmentNetQty: Object.values(segments).reduce((n, s) => n + s.netQty, 0),
                    billCountSumIsNotExpectedToEqualOverall: true
                },
                dataQuality: {
                    complete: unclassifiedSaleItems === 0 && unclassifiedReturnItems === 0,
                    unclassifiedSaleItemCount: unclassifiedSaleItems,
                    unclassifiedReturnItemCount: unclassifiedReturnItems,
                    unclassified
                }
            };
        }
    };
}

module.exports = { createBusinessSegmentReportService };
