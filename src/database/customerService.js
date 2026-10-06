const db = require("./database");

const EMAIL_PATTERN = /^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?\.)+[A-Z]{2,}$/i;

function normalizeIndianMobile(value) {
    const mobile = String(value ?? "").trim();
    return /^\d{10}$/.test(mobile) ? mobile : null;
}

function normalizeOptionalMobile(value) {
    const mobile = String(value ?? "").trim();
    if (!mobile) return null;
    if (!/^\d{10}$/.test(mobile)) throw new Error("Mobile Number must be exactly 10 digits, or left blank.");
    return mobile;
}

function normalizeDdMm(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const match = /^(\d{2})\/(\d{2})$/.exec(String(value).trim());
    if (!match) throw new Error("Date must use DD/MM format.");
    const day = Number(match[1]);
    const month = Number(match[2]);
    const date = new Date(Date.UTC(2000, month - 1, day));
    if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) {
        throw new Error("Enter a valid DD/MM date.");
    }
    return `${match[1]}/${match[2]}`;
}

function requiredName(value) {
    const name = String(value ?? "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 120) throw new Error("Customer name is required (maximum 120 characters).");
    return name;
}

function optionalText(value, max, label) {
    const text = String(value ?? "").trim();
    if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
    return text || null;
}

function normalizeOptionalEmail(value) {
    const email = String(value ?? "").trim();
    if (!email) return null;
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new Error("Enter a valid email address.");
    return email;
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    }));
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function publicProfile(row) {
    if (!row) return null;
    return {
        id: row.id,
        customer_code: row.customer_code || null,
        name: row.name,
        mobile: row.mobile,
        email: row.email || "",
        birthday_ddmm: row.birthday_ddmm || "",
        marriage_anniversary_ddmm: row.marriage_anniversary_ddmm || "",
        notes: row.remarks || ""
    };
}

const CUSTOMER_CODE_SEQUENCE = `COALESCE(MAX(CASE
    WHEN customer_code GLOB 'KLCUS[0-9][0-9][0-9][0-9][0-9][0-9]'
    THEN CAST(SUBSTR(customer_code, 6) AS INTEGER)
    ELSE NULL
END), 0)`;

async function createCustomerProfileWithCode(data) {
    const name = requiredName(data && data.name);
    const mobile = normalizeOptionalMobile(data && data.mobile);
    const email = normalizeOptionalEmail(data.email);
    const birthday = normalizeDdMm(data.birthday_ddmm);
    const anniversary = normalizeDdMm(data.marriage_anniversary_ddmm);
    const notes = optionalText(data.notes, 2000, "Notes");
    const now = new Date().toISOString();
    const inserted = await run(`
        INSERT INTO customers (customer_code, name, mobile, email, remarks, active,
                               created_at, updated_at, birthday_ddmm, marriage_anniversary_ddmm)
        SELECT 'KLCUS' || printf('%06d', ${CUSTOMER_CODE_SEQUENCE} + 1),
               ?, ?, ?, ?, 1, ?, ?, ?, ?
        FROM customers
        HAVING ${CUSTOMER_CODE_SEQUENCE} < 999999
    `, [name, mobile, email, notes, now, now, birthday, anniversary]);
    if (inserted.changes !== 1) {
        throw new Error("Customer ID sequence exhausted at KLCUS999999.");
    }
    return get("SELECT * FROM customers WHERE id = ?", [inserted.lastID]).then(publicProfile);
}

async function createCustomerProfile(data) {
    return createCustomerProfileWithCode(data);
}

async function updateCustomerProfile(id, data) {
    const customerId = Number(id);
    if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new Error("Invalid customer profile.");
    const name = requiredName(data && data.name);
    const mobile = normalizeOptionalMobile(data && data.mobile);
    const email = normalizeOptionalEmail(data.email);
    const birthday = normalizeDdMm(data.birthday_ddmm);
    const anniversary = normalizeDdMm(data.marriage_anniversary_ddmm);
    const notes = optionalText(data.notes, 2000, "Notes");
    const result = await run(`
        UPDATE customers SET name = ?, mobile = ?, email = ?, remarks = ?,
            birthday_ddmm = ?, marriage_anniversary_ddmm = ?, updated_at = ?
        WHERE id = ? AND active = 1
    `, [name, mobile, email, notes, birthday, anniversary, new Date().toISOString(), customerId]);
    if (!result.changes) throw new Error("Customer profile was not found or is inactive.");
    return get("SELECT * FROM customers WHERE id = ?", [customerId]).then(publicProfile);
}

async function getCustomerProfile(id) {
    const customerId = Number(id);
    if (!Number.isSafeInteger(customerId) || customerId <= 0) return null;
    return get("SELECT * FROM customers WHERE id = ? AND active = 1", [customerId]).then(publicProfile);
}

async function findCustomersByMobile(value) {
    const mobile = normalizeIndianMobile(value);
    if (!mobile) return [];
    const rows = await all("SELECT * FROM customers WHERE active = 1 AND mobile IS NOT NULL ORDER BY id");
    return rows.filter(row => normalizeIndianMobile(row.mobile) === mobile).map(row => ({
        id: row.id,
        customer_code: row.customer_code || null,
        name: row.name,
        mobile: row.mobile
    }));
}

async function getCustomerPurchaseHistory(id) {
    const customerId = Number(id);
    if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new Error("Invalid customer profile.");
    return all(`
        SELECT id, bill_no, bill_date, bill_time, customer_name, customer_mobile,
               total_items, total_qty, gross_amount, discount_amount, gst_amount, net_amount,
               cash_amount, upi_amount, card_amount, store_credit_amount, gift_voucher_amount
        FROM bills WHERE customer_id = ? ORDER BY bill_date DESC, id DESC
    `, [customerId]);
}

async function getCustomerPurchaseHistoryPage(id, options = {}) {
    const customerId = Number(id);
    if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new Error("Invalid customer profile.");
    const requestedPage = Number.parseInt(options.page, 10);
    const requestedPageSize = Number.parseInt(options.pageSize, 10);
    const pageSize = Number.isFinite(requestedPageSize)
        ? Math.min(Math.max(requestedPageSize, 1), 100)
        : 100;
    const countRow = await get("SELECT COUNT(*) AS total_count FROM bills WHERE customer_id = ?", [customerId]);
    const totalCount = Number(countRow?.total_count || 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = Number.isFinite(requestedPage)
        ? Math.min(Math.max(requestedPage, 1), totalPages)
        : 1;
    const offset = (page - 1) * pageSize;
    const rows = await all(`
        SELECT id, bill_no, bill_date, bill_time, customer_name, customer_mobile,
               total_items, total_qty, gross_amount, discount_amount, gst_amount, net_amount,
               cash_amount, upi_amount, card_amount, store_credit_amount, gift_voucher_amount
        FROM bills
        WHERE customer_id = ?
        ORDER BY bill_date DESC, id DESC
        LIMIT ? OFFSET ?
    `, [customerId, pageSize, offset]);
    return { rows, totalCount, page, pageSize, totalPages };
}

async function listCustomerDirectory(options = {}) {
    const search = String(options.search ?? "").trim().slice(0, 100);
    const requestedPage = Number.parseInt(options.page, 10);
    const requestedPageSize = Number.parseInt(options.pageSize, 10);
    const pageSize = Number.isFinite(requestedPageSize)
        ? Math.min(Math.max(requestedPageSize, 1), 100)
        : 100;
    const mobileSearch = search.replace(/\D/g, "");
    const where = search
        ? `WHERE c.active = 1 AND (LOWER(c.name) LIKE ? OR LOWER(COALESCE(c.customer_code, '')) LIKE ?${mobileSearch ? " OR REPLACE(REPLACE(REPLACE(c.mobile, ' ', ''), '-', ''), '+', '') LIKE ?" : ""})`
        : "WHERE c.active = 1";
    const params = search
        ? (mobileSearch
            ? [`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`, `%${mobileSearch}%`]
            : [`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`])
        : [];
    const countRow = await get(`SELECT COUNT(*) AS total_count FROM customers c ${where}`, params);
    const totalCount = Number(countRow?.total_count || 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = Number.isFinite(requestedPage)
        ? Math.min(Math.max(requestedPage, 1), totalPages)
        : 1;
    const offset = (page - 1) * pageSize;
    const rows = await all(`
        SELECT c.id, c.customer_code, c.name, c.mobile,
               COUNT(b.id) AS total_bills,
               COALESCE(SUM(b.net_amount), 0) AS total_spend,
               MAX(b.bill_date) AS last_visit
        FROM customers c
        LEFT JOIN bills b ON b.customer_id = c.id
        ${where}
        GROUP BY c.id
        ORDER BY c.name COLLATE NOCASE, c.id
        LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);
    return { rows, totalCount, page, pageSize, totalPages };
}

async function getCustomerManagementProfile(id) {
    const profile = await getCustomerProfile(id);
    if (!profile) return null;
    const summary = await get(`
        SELECT COUNT(*) AS total_bills,
               COALESCE(SUM(net_amount), 0) AS total_spend,
               MAX(bill_date) AS last_visit,
               CASE WHEN COUNT(*) = 0 THEN 0 ELSE AVG(net_amount) END AS average_bill
        FROM bills WHERE customer_id = ?
    `, [Number(id)]);
    return {
        ...profile,
        total_bills: Number(summary?.total_bills || 0),
        total_spend: Number(summary?.total_spend || 0),
        last_visit: summary?.last_visit || null,
        average_bill: Number(summary?.average_bill || 0)
    };
}

module.exports = {
    normalizeIndianMobile,
    normalizeOptionalMobile,
    normalizeDdMm,
    normalizeOptionalEmail,
    createCustomerProfile,
    createCustomerProfileWithCode,
    updateCustomerProfile,
    getCustomerProfile,
    findCustomersByMobile,
    getCustomerPurchaseHistory,
    getCustomerPurchaseHistoryPage,
    listCustomerDirectory,
    getCustomerManagementProfile
};
