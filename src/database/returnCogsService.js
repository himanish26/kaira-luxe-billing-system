"use strict";

const BUSINESS_SEGMENTS = new Set(["KL", "MENS", "KIDS"]);

function isValidDate(value) {
    const text = String(value || "");
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) &&
        date.getUTCMonth() === Number(match[2]) - 1 &&
        date.getUTCDate() === Number(match[3]);
}

function createReturnCogsService(database) {
    if (!database || typeof database.all !== "function") {
        throw new TypeError("A SQLite database connection is required.");
    }

    async function listCompletedReturnCogsReversals({ fromDate, toDate, businessSegment = null } = {}) {
        if (!isValidDate(fromDate) || !isValidDate(toDate) || fromDate > toDate) {
            throw new Error("A valid return business-date range is required.");
        }
        if (businessSegment !== null && !BUSINESS_SEGMENTS.has(businessSegment)) {
            throw new Error("Select a valid Business Segment.");
        }

        const params = [fromDate, toDate];
        let segmentClause = "";
        if (businessSegment) {
            segmentClause = "AND original_bi.business_segment = ?";
            params.push(businessSegment);
        }

        return new Promise((resolve, reject) => database.all(`
            SELECT
                r.id AS return_id,
                r.return_no,
                r.credit_note_no,
                r.business_date AS return_business_date,
                r.original_bill_no,
                ri.id AS return_item_id,
                ri.original_bill_item_id,
                ri.quantity AS returned_quantity,
                ri.gross_reversal,
                ri.discount_reversal,
                ri.taxable_reversal,
                ri.gst_reversal,
                ri.net_reversal,
                ri.return_unit_cost_paise,
                ri.return_cost_paise,
                ri.return_cost_basis_status,
                ri.return_cost_source,
                ri.return_cost_method,
                original_bi.business_segment,
                original_bi.cost_basis_status AS original_cost_basis_status,
                original_bi.unit_cost_paise AS original_unit_cost_paise,
                original_bi.cost_source AS original_cost_source,
                original_bi.cost_method AS original_cost_method,
                original_bi.qty AS original_sold_quantity
            FROM returns AS r
            INNER JOIN return_items AS ri
                ON ri.return_id = r.id
            LEFT JOIN bill_items AS original_bi
                ON original_bi.id = ri.original_bill_item_id
               AND original_bi.bill_no = r.original_bill_no
            WHERE r.accounting_status = 'COMPLETED'
              AND r.accounting_snapshot_version = 1
              AND r.credit_note_no GLOB 'CN[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
              AND r.business_date >= ?
              AND r.business_date <= ?
              ${segmentClause}
            ORDER BY r.business_date, r.id, ri.id
        `, params, (error, rows) => {
            if (error) reject(error);
            else resolve(rows || []);
        }));
    }

    return { listCompletedReturnCogsReversals };
}

let defaultService;
function getDefaultService() {
    if (!defaultService) defaultService = createReturnCogsService(require("./database"));
    return defaultService;
}

module.exports = {
    createReturnCogsService,
    listCompletedReturnCogsReversals: options =>
        getDefaultService().listCompletedReturnCogsReversals(options)
};
