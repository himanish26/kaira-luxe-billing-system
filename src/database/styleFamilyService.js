const MAX_STYLE_ROWS = 250;

function normalizeLabel(value) {
    return String(value ?? "").trim().toLocaleLowerCase("en-IN");
}

function displayProduct(row) {
    return {
        productId: row.id,
        sku: row.sku ?? "",
        barcode: String(row.barcode ?? "").trim(),
        brand: row.brand ?? "",
        styleCode: row.style_code ?? "",
        category: isPlaceholderCategory(row.category) ? "" : (row.category ?? ""),
        productName: row.product_name ?? "",
        size: row.size ?? "",
        colour: row.colour ?? "",
        mrp: row.mrp ?? null,
        active: row.active ?? null,
        currentStock: Number(row.current_stock ?? 0)
    };
}

function isPlaceholderCategory(value) {
    const category = normalizeLabel(value);
    return category === "" || category === "na" || category === "n/a";
}

function makeFamilyToken(brand, styleCode, category) {
    return Buffer.from(JSON.stringify([
        normalizeLabel(brand),
        normalizeLabel(styleCode),
        normalizeLabel(category)
    ])).toString("base64url");
}

function createStyleFamilyService(db) {
    function get(sql, params = []) {
        return new Promise((resolve, reject) => db.get(sql, params, (error, row) => {
            if (error) reject(error);
            else resolve(row || null);
        }));
    }

    function all(sql, params = []) {
        return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => {
            if (error) reject(error);
            else resolve(rows || []);
        }));
    }

    const stockSelect = `
        SELECT p.id, p.sku, p.barcode, p.brand, p.style_code, p.category,
               p.product_name, p.size, p.colour, p.mrp, p.active,
               COALESCE(SUM(it.quantity), 0) AS current_stock
        FROM products p
        LEFT JOIN inventory_transactions it ON it.product_id = p.id
    `;

    async function rowsForBrandStyle(brand, styleCode) {
        return all(`${stockSelect}
            WHERE lower(trim(COALESCE(p.brand, ''))) = lower(trim(?))
              AND lower(trim(COALESCE(p.style_code, ''))) = lower(trim(?))
            GROUP BY p.id
            ORDER BY p.colour COLLATE NOCASE, p.size COLLATE NOCASE, p.id
            LIMIT ?`, [brand, styleCode, MAX_STYLE_ROWS + 1]);
    }

    async function rowsForStyleCode(styleCode) {
        return all(`${stockSelect}
            WHERE lower(trim(COALESCE(p.style_code, ''))) = lower(trim(?))
            GROUP BY p.id
            ORDER BY p.brand COLLATE NOCASE, p.category COLLATE NOCASE,
                     p.colour COLLATE NOCASE, p.size COLLATE NOCASE, p.id
            LIMIT ?`, [styleCode, MAX_STYLE_ROWS + 1]);
    }

    function makeFamily(brand, styleCode, category, rows, exactProduct = null) {
        const products = rows.map(displayProduct);
        const representative = products.find(product => !isPlaceholderCategory(product.category)) || products[0];
        return {
            token: makeFamilyToken(brand, styleCode, category),
            brand: representative?.brand ?? brand ?? "",
            styleCode: representative?.styleCode ?? styleCode ?? "",
            category: representative?.category ?? category ?? "",
            productName: exactProduct?.productName || representative?.productName || "",
            variants: products,
            summary: {
                variants: products.length,
                available: products.filter(product => product.currentStock > 0).length,
                totalStock: products.reduce((total, product) => total + product.currentStock, 0)
            }
        };
    }

    function groupStyleRows(rows) {
        const groups = new Map();
        for (const row of rows) {
            const product = displayProduct(row);
            const key = [normalizeLabel(product.brand), normalizeLabel(product.styleCode), normalizeLabel(product.category)].join("\u0000");
            if (!groups.has(key)) groups.set(key, { brand: product.brand, styleCode: product.styleCode, category: product.category, rows: [] });
            groups.get(key).rows.push(row);
        }
        return [...groups.values()];
    }

    function reconcilePlaceholders(rows, brand, styleCode, exactProduct = null) {
        const namedCategories = new Map();
        const placeholders = [];
        for (const row of rows) {
            if (isPlaceholderCategory(row.category)) placeholders.push(row);
            else namedCategories.set(normalizeLabel(row.category), row.category);
        }
        if (!placeholders.length) return { status: "OK", groups: groupStyleRows(rows) };
        if (namedCategories.size !== 1) {
            return { status: "UNRESOLVED", placeholders };
        }
        const [categoryKey, categoryLabel] = [...namedCategories.entries()][0];
        const grouped = rows.filter(row => isPlaceholderCategory(row.category) || normalizeLabel(row.category) === categoryKey);
        return {
            status: "OK",
            groups: [{ brand, styleCode, category: categoryLabel, rows: grouped }],
            exactProduct
        };
    }

    async function resolveBarcode(barcode) {
        const row = await get(`${stockSelect}
            WHERE trim(CAST(p.barcode AS TEXT)) = ?
            GROUP BY p.id
            LIMIT 1`, [barcode]);
        if (!row) return { status: "NOT_FOUND", exactProduct: null, family: null, candidates: [], diagnostic: "BARCODE_NOT_FOUND" };

        const exactProduct = displayProduct(row);
        if (!normalizeLabel(exactProduct.styleCode)) {
            return { status: "STYLE_UNAVAILABLE", exactProduct, family: null, candidates: [], variants: [exactProduct], diagnostic: "BLANK_STYLE_CODE" };
        }
        if (!normalizeLabel(exactProduct.brand)) {
            return { status: "UNRESOLVED_FAMILY", exactProduct, family: null, candidates: [], variants: [exactProduct], diagnostic: "BLANK_BRAND" };
        }

        const rows = await rowsForBrandStyle(exactProduct.brand, exactProduct.styleCode);
        if (rows.length > MAX_STYLE_ROWS) {
            return { status: "TOO_MANY_VARIANTS", exactProduct, family: null, candidates: [], variants: [], diagnostic: "FAMILY_LIMIT_EXCEEDED" };
        }
        const resolution = reconcilePlaceholders(rows, exactProduct.brand, exactProduct.styleCode, exactProduct);
        if (resolution.status === "UNRESOLVED") {
            return { status: "UNRESOLVED_FAMILY", exactProduct, family: null, candidates: [], variants: [exactProduct], diagnostic: "PLACEHOLDER_CATEGORY_AMBIGUITY" };
        }

        const categoryKey = normalizeLabel(exactProduct.category);
        const familyGroup = resolution.groups.find(group => group.rows.some(candidate => candidate.id === row.id)) ||
            resolution.groups.find(group => normalizeLabel(group.category) === categoryKey) || resolution.groups[0];
        const family = makeFamily(familyGroup.brand, familyGroup.styleCode, familyGroup.category, familyGroup.rows, exactProduct);
        return { status: "FAMILY", exactProduct, family, candidates: [], diagnostic: null };
    }

    async function resolveStyleCode(styleCode, candidateToken) {
        const rows = await rowsForStyleCode(styleCode);
        if (!rows.length) return { status: "NOT_FOUND", exactProduct: null, family: null, candidates: [], diagnostic: "STYLE_NOT_FOUND" };
        if (rows.length > MAX_STYLE_ROWS) return { status: "TOO_MANY_VARIANTS", exactProduct: null, family: null, candidates: [], diagnostic: "STYLE_LIMIT_EXCEEDED" };

        const groups = [];
        const byBrandStyle = new Map();
        for (const row of rows) {
            const key = [normalizeLabel(row.brand), normalizeLabel(row.style_code)].join("\u0000");
            if (!byBrandStyle.has(key)) byBrandStyle.set(key, []);
            byBrandStyle.get(key).push(row);
        }
        for (const brandRows of byBrandStyle.values()) {
            const first = brandRows[0];
            const resolution = reconcilePlaceholders(brandRows, first.brand, first.style_code);
            if (resolution.status === "UNRESOLVED") {
                return { status: "UNRESOLVED_FAMILY", exactProduct: null, family: null, candidates: [], diagnostic: "PLACEHOLDER_CATEGORY_AMBIGUITY" };
            }
            groups.push(...resolution.groups);
        }

        const families = groups.map(group => makeFamily(group.brand, group.styleCode, group.category, group.rows));
        if (candidateToken) {
            const selected = families.find(family => family.token === candidateToken);
            return selected
                ? { status: "FAMILY", exactProduct: null, family: selected, candidates: [], diagnostic: null }
                : { status: "NOT_FOUND", exactProduct: null, family: null, candidates: [], diagnostic: "STYLE_CANDIDATE_STALE" };
        }
        if (families.length === 1) return { status: "FAMILY", exactProduct: null, family: families[0], candidates: [], diagnostic: null };
        return {
            status: "AMBIGUOUS_STYLE",
            exactProduct: null,
            family: null,
            candidates: families.map(({ token, brand, styleCode: code, category, productName, summary }) => ({ token, brand, styleCode: code, category, productName, summary })),
            diagnostic: null
        };
    }

    async function resolveStyleFamily(input) {
        const query = typeof input === "string" ? input : String(input?.query ?? "");
        const value = query.trim();
        if (!value) return { status: "EMPTY", exactProduct: null, family: null, candidates: [], diagnostic: null };
        if (typeof input === "object" && input.candidateToken) {
            return resolveStyleCode(value, input.candidateToken);
        }
        const barcodeMatch = await get("SELECT 1 AS found FROM products WHERE trim(CAST(barcode AS TEXT)) = ? LIMIT 1", [value]);
        if (barcodeMatch) return resolveBarcode(value);
        return resolveStyleCode(value, typeof input === "object" ? input.candidateToken : null);
    }

    return { resolveStyleFamily };
}

module.exports = { createStyleFamilyService, MAX_STYLE_ROWS };
