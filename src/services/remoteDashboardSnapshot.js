const { getBusinessDate, BUSINESS_TIME_ZONE } = require("../database/businessDate");

const CONTRACT_ID = "klbs.remote-dashboard.snapshot.v1";
const IDENTITY = { merchant_id: "KAIRA_LUXE", store_code: "KL001", terminal_id: "POS01" };
const DISPLAY = { merchant_name: "Kaira Luxe", store_name: "Kaira Luxe - Berhampur", terminal_name: "Main Billing Counter" };
const SEGMENTS = ["KL", "MENS", "KIDS"];

function isoWithBusinessOffset(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+05:30`;
}

function paise(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) throw new Error("Remote Dashboard amount is invalid.");
    const result = Math.round((amount + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(result) || result < 0) throw new Error("Remote Dashboard amount exceeds safe limits.");
    return result;
}

function metric(netSalesPaise, bills, qty) {
    return { net_sales_paise: netSalesPaise, bills, qty };
}

function query(database, method, sql, params = []) {
    return new Promise((resolve, reject) => database[method](sql, params, (error, rows) => error ? reject(error) : resolve(rows || (method === "get" ? null : []))));
}

async function buildRemoteDashboardSnapshot(options = {}) {
    const database = options.database;
    if (!database) throw new Error("Remote Dashboard snapshot database dependency is required.");
    const now = options.now || (() => new Date());
    const generatedAt = isoWithBusinessOffset(now());
    const businessDate = options.businessDate || getBusinessDate(now());
    const month = businessDate.slice(0, 7);
    const sessionStartedAt = options.sessionStartedAt || generatedAt;
    const snapshotId = String(options.snapshotId || `snapshot-${sessionStartedAt}-${generatedAt}`);
    const requestId = String(options.requestId || `snapshot-request-${snapshotId}`);
    const [todayRows, mtdRows, segmentRows, recentBills, status] = await Promise.all([
        query(database, "get", `SELECT COALESCE(SUM(net_amount),0) AS sales, COUNT(*) AS bills, COALESCE(SUM(total_qty),0) AS qty,
            COALESCE(SUM(cash_amount),0) AS cash, COALESCE(SUM(upi_amount),0) AS upi, COALESCE(SUM(card_amount),0) AS card
            FROM bills WHERE bill_date = ?`, [businessDate]),
        query(database, "get", `SELECT COALESCE(SUM(net_amount),0) AS sales, COUNT(*) AS bills, COALESCE(SUM(total_qty),0) AS qty
            FROM bills WHERE substr(bill_date,1,7) = ?`, [month]),
        query(database, "all", `SELECT business_segment AS segment, COALESCE(SUM(ROUND(net_amount, 2)),0) AS sales,
            COUNT(DISTINCT bill_no) AS bills
            FROM bill_items WHERE bill_no IN (SELECT bill_no FROM bills WHERE bill_date = ?)
            GROUP BY business_segment`, [businessDate]),
        query(database, "all", `SELECT bill_no, created_at, net_amount FROM bills ORDER BY id DESC LIMIT 10`),
        typeof options.getStatus === "function" ? options.getStatus(businessDate) : Promise.resolve({})
    ]);
    const segmentMap = Object.fromEntries(SEGMENTS.map(segment => [segment, { net_sales_paise: 0, bills: 0 }]));
    for (const row of segmentRows) {
        const segment = SEGMENTS.includes(row.segment) ? row.segment : null;
        if (segment) segmentMap[segment] = { net_sales_paise: paise(row.sales), bills: Number(row.bills) || 0 };
    }
    const today = metric(paise(todayRows.sales), Number(todayRows.bills) || 0, Number(todayRows.qty) || 0);
    return {
        contract_id: CONTRACT_ID,
        snapshot_id: snapshotId,
        request_id: requestId,
        ...IDENTITY,
        ...DISPLAY,
        business_date: businessDate,
        generated_at: generatedAt,
        session_started_at: sessionStartedAt,
        today,
        segments: segmentMap,
        payments: {
            cash_paise: paise(todayRows.cash),
            upi_paise: paise(todayRows.upi),
            card_paise: paise(todayRows.card)
        },
        mtd: metric(paise(mtdRows.sales), Number(mtdRows.bills) || 0, Number(mtdRows.qty) || 0),
        recent_bills: recentBills.map(row => ({ bill_no: row.bill_no, bill_time: row.created_at || generatedAt, net_amount_paise: paise(row.net_amount) })),
        day_closing: status.day_closing || { status: "UNAVAILABLE" },
        backup: status.backup || { status: "UNAVAILABLE" },
        dsr: status.dsr || { status: "UNAVAILABLE" }
    };
}

module.exports = { CONTRACT_ID, IDENTITY, DISPLAY, SEGMENTS, buildRemoteDashboardSnapshot, isoWithBusinessOffset, paise };
