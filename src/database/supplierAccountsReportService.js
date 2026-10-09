"use strict";

const { createStoreIdentityService } = require("./storeIdentityService");

class SupplierAccountsReportError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "SupplierAccountsReportError";
        this.code = code;
    }
}

function validIsoDate(value, label) {
    const text = String(value || "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) throw new SupplierAccountsReportError(`A valid ${label} is required.`, "SUPPLIER_REPORT_DATE_INVALID");
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
        throw new SupplierAccountsReportError(`A valid ${label} is required.`, "SUPPLIER_REPORT_DATE_INVALID");
    }
    return text;
}

function safeAdd(left, right, label) {
    const result = Number(left) + Number(right);
    if (!Number.isSafeInteger(result)) {
        throw new SupplierAccountsReportError(`${label} exceeds the safe paise range.`, "SUPPLIER_REPORT_AMOUNT_OVERFLOW");
    }
    return result;
}

function safeSubtract(left, right, label) {
    return safeAdd(left, -Number(right), label);
}

function dateDifference(startDate, endDate) {
    return Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000);
}

function agingStatus(dueDate, _fallbackDate, asOfDate) {
    if (!dueDate) return "NO DUE DATE";
    const daysLate = dateDifference(dueDate, asOfDate);
    if (daysLate <= 0) return "NOT YET DUE";
    if (daysLate <= 30) return "1–30 DAYS OVERDUE";
    if (daysLate <= 60) return "31–60 DAYS OVERDUE";
    if (daysLate <= 90) return "61–90 DAYS OVERDUE";
    return "90+ DAYS OVERDUE";
}

function createSupplierAccountsReportService(database, options = {}) {
    if (!database || typeof database.all !== "function") throw new TypeError("SQLite database connection required.");
    const storeIdentityService = options.storeIdentityService || createStoreIdentityService(database);
    const all = (sql, params = []) => new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
    });

    async function getSupplierAccountsReportData(fromDateValue, toDateValue) {
        const fromDate = validIsoDate(fromDateValue, "report start date");
        const toDate = validIsoDate(toDateValue, "report end date");
        if (fromDate > toDate) {
            throw new SupplierAccountsReportError("Report start date cannot be after report end date.", "SUPPLIER_REPORT_DATE_ORDER_INVALID");
        }
        const store = await storeIdentityService.getCurrentStore();
        if (!store || !Number.isSafeInteger(Number(store.id)) || store.status !== "ACTIVE") {
            throw new SupplierAccountsReportError("The active Store identity could not be resolved.", "SUPPLIER_REPORT_STORE_UNAVAILABLE");
        }
        const storeId = Number(store.id);

        const eventSql = `
            SELECT supplier_id, 'OPENING' AS event_type, as_on_date AS event_date,
                   amount_paise AS signed_amount_paise, opening_code AS document_code
            FROM supplier_opening_balances
            WHERE store_id=? AND status='POSTED' AND as_on_date<=?
            UNION ALL
            SELECT supplier_id, 'INVOICE', posting_date, invoice_total_paise, invoice_code
            FROM supplier_invoices
            WHERE store_id=? AND status='POSTED' AND posting_date<=?
            UNION ALL
            SELECT supplier_id, 'CREDIT_NOTE', posting_date, -amount_paise, credit_note_code
            FROM supplier_credit_notes
            WHERE store_id=? AND status='POSTED' AND posting_date<=?
            UNION ALL
            SELECT supplier_id, 'PAYMENT', posting_date, -amount_paise, payment_code
            FROM supplier_payments
            WHERE store_id=? AND status='POSTED' AND posting_date<=?
            ORDER BY event_date, event_type, document_code`;

        const supplierSql = `
            SELECT s.id AS supplier_id, s.supplier_code, s.name AS supplier_name, s.status
            FROM supplier_master s
            WHERE EXISTS (
                SELECT 1 FROM supplier_opening_balances o
                WHERE o.supplier_id=s.id AND o.store_id=? AND o.status='POSTED' AND o.as_on_date<=?
            ) OR EXISTS (
                SELECT 1 FROM supplier_invoices i
                WHERE i.supplier_id=s.id AND i.store_id=? AND i.status='POSTED' AND i.posting_date<=?
            ) OR EXISTS (
                SELECT 1 FROM supplier_payments p
                WHERE p.supplier_id=s.id AND p.store_id=? AND p.status='POSTED' AND p.posting_date<=?
            ) OR EXISTS (
                SELECT 1 FROM supplier_credit_notes c
                WHERE c.supplier_id=s.id AND c.store_id=? AND c.status='POSTED' AND c.posting_date<=?
            )
            ORDER BY s.supplier_code`;

        const liabilitySql = `
            SELECT 'INVOICE' AS liability_type, i.id AS liability_id, i.supplier_id,
                   i.supplier_code_snapshot AS supplier_code, i.supplier_name_snapshot AS supplier_name,
                   i.invoice_code AS document_id, i.supplier_invoice_number AS document_reference,
                   i.supplier_invoice_date AS document_date, i.posting_date AS event_date,
                   i.due_date, i.invoice_total_paise AS original_amount_paise,
                   COALESCE((SELECT SUM(a.amount_paise)
                       FROM supplier_payment_allocations a
                       JOIN supplier_payments p ON p.id=a.payment_id
                       WHERE a.invoice_id=i.id AND p.status='POSTED' AND p.store_id=? AND p.posting_date<=?),0) AS paid_paise,
                   COALESCE((SELECT SUM(a.amount_paise)
                       FROM supplier_credit_note_invoice_allocations a
                       JOIN supplier_credit_notes c ON c.id=a.credit_note_id
                       WHERE a.invoice_id=i.id AND c.status='POSTED' AND c.store_id=? AND c.posting_date<=?),0) AS credited_paise,
                   i.due_date AS aging_due_date, i.capture_mode, i.total_quantity
            FROM supplier_invoices i
            WHERE i.store_id=? AND i.status='POSTED' AND i.posting_date<=?
            UNION ALL
            SELECT 'OPENING', o.id, o.supplier_id,
                   o.supplier_code_snapshot, o.supplier_name_snapshot,
                   o.opening_code, COALESCE(o.reference,''), o.as_on_date, o.as_on_date,
                   o.due_date, o.amount_paise,
                   COALESCE((SELECT SUM(a.amount_paise)
                       FROM supplier_payment_opening_allocations a
                       JOIN supplier_payments p ON p.id=a.payment_id
                       WHERE a.opening_balance_id=o.id AND p.status='POSTED' AND p.store_id=? AND p.posting_date<=?),0),
                   COALESCE((SELECT SUM(a.amount_paise)
                       FROM supplier_credit_note_opening_allocations a
                       JOIN supplier_credit_notes c ON c.id=a.credit_note_id
                       WHERE a.opening_balance_id=o.id AND c.status='POSTED' AND c.store_id=? AND c.posting_date<=?),0),
                   COALESCE(o.due_date,o.as_on_date), NULL, NULL
            FROM supplier_opening_balances o
            WHERE o.store_id=? AND o.status='POSTED' AND o.as_on_date<=?
            ORDER BY supplier_code, event_date, document_id`;

        const invoiceSql = `
            SELECT supplier_id, supplier_code_snapshot AS supplier_code,
                   supplier_name_snapshot AS supplier_name, invoice_code, supplier_invoice_number,
                   supplier_invoice_date, posting_date, business_segment, capture_mode,
                   total_quantity, due_date, invoice_total_paise
            FROM supplier_invoices
            WHERE store_id=? AND status='POSTED' AND posting_date BETWEEN ? AND ?
            ORDER BY supplier_code_snapshot, posting_date, invoice_code`;
        const paymentSql = `
            SELECT supplier_id, supplier_code_snapshot AS supplier_code,
                   supplier_name_snapshot AS supplier_name, payment_code, payment_date,
                   posting_date, payment_mode, reference, amount_paise
            FROM supplier_payments
            WHERE store_id=? AND status='POSTED' AND posting_date BETWEEN ? AND ?
            ORDER BY supplier_code_snapshot, posting_date, payment_code`;
        const creditSql = `
            SELECT supplier_id, supplier_code_snapshot AS supplier_code,
                   supplier_name_snapshot AS supplier_name, credit_note_code,
                   credit_note_date, posting_date, external_number, reference, reason, amount_paise
            FROM supplier_credit_notes
            WHERE store_id=? AND status='POSTED' AND posting_date BETWEEN ? AND ?
            ORDER BY supplier_code_snapshot, posting_date, credit_note_code`;

        const [supplierRows, eventRows, liabilityRows, invoiceRows, paymentRows, creditRows] = await Promise.all([
            all(supplierSql, [storeId, toDate, storeId, toDate, storeId, toDate, storeId, toDate]),
            all(eventSql, [storeId, toDate, storeId, toDate, storeId, toDate, storeId, toDate]),
            all(liabilitySql, [storeId, toDate, storeId, toDate, storeId, toDate, storeId, toDate, storeId, toDate, storeId, toDate]),
            all(invoiceSql, [storeId, fromDate, toDate]),
            all(paymentSql, [storeId, fromDate, toDate]),
            all(creditSql, [storeId, fromDate, toDate])
        ]);

        const bySupplier = new Map(supplierRows.map(row => [Number(row.supplier_id), {
            supplierId: Number(row.supplier_id), supplierCode: row.supplier_code,
            supplierName: row.supplier_name, status: row.status,
            totalPurchasesPaise: 0, totalPaidPaise: 0, totalCreditNotesPaise: 0,
            currentOutstandingPaise: 0, openInvoices: 0, overdueInvoices: 0,
            openingOutstandingPaise: 0, openingBalancesPostedPaise: 0, invoicesPostedPaise: 0,
            creditNotesPaise: 0, paymentsPaise: 0, closingOutstandingPaise: 0
        }]));

        for (const event of eventRows) {
            const row = bySupplier.get(Number(event.supplier_id));
            if (!row) continue;
            const amount = Number(event.signed_amount_paise);
            if (!Number.isSafeInteger(amount)) throw new SupplierAccountsReportError("Supplier ledger contains an invalid paise amount.", "SUPPLIER_REPORT_AMOUNT_INVALID");
            row.closingOutstandingPaise = safeAdd(row.closingOutstandingPaise, amount, "Closing outstanding");
            if (event.event_type === "INVOICE") row.totalPurchasesPaise = safeAdd(row.totalPurchasesPaise, amount, "Total purchases");
            if (event.event_type === "PAYMENT") row.totalPaidPaise = safeAdd(row.totalPaidPaise, -amount, "Total paid");
            if (event.event_type === "CREDIT_NOTE") row.totalCreditNotesPaise = safeAdd(row.totalCreditNotesPaise, -amount, "Total Credit Notes");
            if (event.event_date < fromDate) {
                row.openingOutstandingPaise = safeAdd(row.openingOutstandingPaise, amount, "Opening outstanding");
            } else {
                if (event.event_type === "OPENING") row.openingBalancesPostedPaise = safeAdd(row.openingBalancesPostedPaise, amount, "Period opening balances");
                if (event.event_type === "INVOICE") row.invoicesPostedPaise = safeAdd(row.invoicesPostedPaise, amount, "Period invoice total");
                if (event.event_type === "PAYMENT") row.paymentsPaise = safeAdd(row.paymentsPaise, -amount, "Period payment total");
                if (event.event_type === "CREDIT_NOTE") row.creditNotesPaise = safeAdd(row.creditNotesPaise, -amount, "Period Credit Note total");
            }
        }

        const invoiceLiabilities = new Map();
        for (const liability of liabilityRows) {
            const original = Number(liability.original_amount_paise);
            const paid = Number(liability.paid_paise || 0);
            const credited = Number(liability.credited_paise || 0);
            if (![original, paid, credited].every(Number.isSafeInteger) || original <= 0 || paid < 0 || credited < 0) {
                throw new SupplierAccountsReportError("Supplier liability data contains an invalid paise amount.", "SUPPLIER_REPORT_AMOUNT_INVALID");
            }
            const outstanding = safeSubtract(safeSubtract(original, paid, "Liability outstanding"), credited, "Liability outstanding");
            const normalized = { ...liability, paid_paise: paid, credited_paise: credited, outstanding_paise: outstanding };
            if (liability.liability_type === "INVOICE") invoiceLiabilities.set(liability.document_id, normalized);
            const row = bySupplier.get(Number(liability.supplier_id));
            if (!row) continue;
            row.currentOutstandingPaise = safeAdd(row.currentOutstandingPaise, outstanding, "Current outstanding");
            if (liability.liability_type === "INVOICE" && outstanding > 0) {
                row.openInvoices += 1;
                if (liability.aging_due_date && liability.aging_due_date < toDate) row.overdueInvoices += 1;
            }
        }

        const suppliers = [...bySupplier.values()].sort((a, b) => a.supplierCode.localeCompare(b.supplierCode));
        for (const row of suppliers) {
            const reconciled = safeSubtract(
                safeSubtract(safeAdd(safeAdd(row.openingOutstandingPaise, row.openingBalancesPostedPaise, "Period reconciliation"), row.invoicesPostedPaise, "Period reconciliation"), row.creditNotesPaise, "Period reconciliation"),
                row.paymentsPaise,
                "Period reconciliation"
            );
            if (reconciled !== row.closingOutstandingPaise) {
                throw new SupplierAccountsReportError(`Supplier report reconciliation failed for ${row.supplierCode}.`, "SUPPLIER_REPORT_RECONCILIATION_FAILED");
            }
            if (row.currentOutstandingPaise !== row.closingOutstandingPaise) {
                throw new SupplierAccountsReportError(`As-of liabilities do not reconcile to the Supplier Statement for ${row.supplierCode}.`, "SUPPLIER_REPORT_BALANCE_MISMATCH");
            }
            row.accountStatus = row.overdueInvoices > 0 ? "OVERDUE" : row.currentOutstandingPaise > 0 ? "DUE" : "CLEARED";
            row.overdue = row.overdueInvoices;
        }

        const outstanding = liabilityRows
            .map(liability => {
                const row = bySupplier.get(Number(liability.supplier_id));
                const outstandingPaise = Number(liability.original_amount_paise) - Number(liability.paid_paise || 0) - Number(liability.credited_paise || 0);
                if (outstandingPaise <= 0) return null;
                const fallbackDate = liability.liability_type === "OPENING" ? liability.event_date : null;
                return {
                    supplierId: Number(liability.supplier_id), supplierCode: liability.supplier_code,
                    supplierName: liability.supplier_name, liabilityType: liability.liability_type,
                    documentId: liability.document_id, documentReference: liability.document_reference,
                    documentDate: liability.document_date, eventDate: liability.event_date,
                    dueDate: liability.due_date || null, originalAmountPaise: Number(liability.original_amount_paise),
                    paidCreditedPaise: safeAdd(Number(liability.paid_paise || 0), Number(liability.credited_paise || 0), "Paid/credited amount"),
                    outstandingPaise, agingStatus: agingStatus(liability.due_date, fallbackDate, toDate),
                    captureMode: liability.capture_mode || null, totalQuantity: liability.total_quantity ?? null,
                    supplierStatus: row?.status || null
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.supplierCode.localeCompare(b.supplierCode) || a.eventDate.localeCompare(b.eventDate) || a.documentId.localeCompare(b.documentId));

        const invoices = invoiceRows.map(row => ({
            supplierId: Number(row.supplier_id), supplierCode: row.supplier_code,
            supplierName: row.supplier_name, invoiceId: row.invoice_code,
            supplierInvoiceNumber: row.supplier_invoice_number, invoiceDate: row.supplier_invoice_date,
            postingDate: row.posting_date, businessSegment: row.business_segment,
            captureMode: row.capture_mode, totalQuantity: row.total_quantity ?? null,
            dueDate: row.due_date || null, invoiceTotalPaise: Number(row.invoice_total_paise),
            outstandingAtPeriodEndPaise: invoiceLiabilities.get(row.invoice_code)?.outstanding_paise ?? Number(row.invoice_total_paise)
        }));
        const payments = paymentRows.map(row => ({
            supplierCode: row.supplier_code, supplierName: row.supplier_name,
            paymentId: row.payment_code, paymentDate: row.payment_date, postingDate: row.posting_date,
            paymentMode: row.payment_mode, reference: row.reference || null, amountPaise: Number(row.amount_paise)
        }));
        const creditNotes = creditRows.map(row => ({
            supplierCode: row.supplier_code, supplierName: row.supplier_name,
            creditNoteId: row.credit_note_code, creditNoteDate: row.credit_note_date,
            postingDate: row.posting_date,
            reference: row.external_number || row.reference || null,
            reason: row.reason, amountPaise: Number(row.amount_paise)
        }));

        return {
            store: { id: storeId, storeCode: store.storeCode, storeName: store.storeName },
            fromDate, toDate, suppliers, invoices, payments, creditNotes, outstanding
        };
    }

    return { getSupplierAccountsReportData };
}

module.exports = { createSupplierAccountsReportService, SupplierAccountsReportError };
