"use strict";

const ExcelJS = require("exceljs");

const MONTH_NAMES = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];
const MONEY_FORMAT = '"₹"#,##,##0.00;[Red]("₹"#,##,##0.00);-';
const PERCENT_FORMAT = '0.00"%";[Red](0.00"%");-';
const VARIANCE_PERCENT_FORMAT = '0.00%;[Red](0.00%);-';
const BURGUNDY = "FF5E1931";
const PALE_BURGUNDY = "FFF4ECEF";
const GREEN = "FF24713D";
const RED = "FFA01635";
const NEUTRAL = "FF51464C";
const CATEGORY_GROUPS = [
    ["Employee Costs", ["Salary & Wages", "Staff Welfare"]],
    ["Occupancy", ["Rent", "Security & Surveillance", "Insurance"]],
    ["Utilities & Communications", ["Electricity", "Internet & Communication"]],
    ["Marketing", ["Marketing & Advertising"]],
    ["Operating / Store Support", ["Maintenance & Repairs", "Cleaning & Housekeeping", "Packaging", "Transport & Local Conveyance", "Freight & Courier"]],
    ["Administrative & Professional", ["Stationery & Printing", "Software & Subscriptions", "Professional Fees", "Licences & Statutory Fees", "Petty Cash / General Expense", "Miscellaneous"]],
    ["Payment Charges", ["Bank & Payment Charges"]]
];

function amount(paise) {
    if (paise === null || paise === undefined || !Number.isSafeInteger(Number(paise))) return "N/A";
    return Number(paise) / 100;
}

function summaryAmount(summary, key) {
    const revenue = summary.revenue;
    const cogs = summary.cogs;
    const expenses = summary.expenses;
    const operating = summary.operatingResult;
    const profit = summary.profitability || {};
    const values = {
        gross: revenue.available === false ? null : revenue.grossBillingsInclGstPaise,
        discounts: revenue.available === false ? null : revenue.discountsInclGstEffectPaise,
        returns: revenue.available === false ? null : revenue.completedReturnNetReversalPaise,
        netGst: revenue.available === false ? null : revenue.netGstOnSalesPaise,
        saleCogs: cogs.capturedSaleCogsPaise,
        returnCogs: cogs.capturedReturnCogsReversalPaise,
        capturedSales: cogs.capturedNetSalesPaise,
        unknownSales: cogs.unknownNetSalesPaise,
        vvpSales: cogs.notApplicableNetSalesPaise,
        totalExpenses: expenses.available === false ? null : expenses.totalOperatingExpensesPaise,
        commonExpenses: expenses.available === false ? null : expenses.commonOperatingExpensesPaise,
        grossProfit: cogs.fullGrossProfitAvailable ? cogs.fullGrossProfitPaise : null,
        grossMargin: cogs.fullGrossProfitAvailable ? cogs.fullGrossMarginPercent : null,
        operatingProfit: operating.operatingProfitAvailable === true ? operating.operatingProfitPaise :
            operating.segmentDirectOperatingResultAvailable === true ? operating.segmentDirectOperatingResultPaise : null,
        operatingMargin: operating.operatingProfitAvailable === true ? operating.operatingMarginPercent :
            operating.segmentDirectOperatingResultAvailable === true ? operating.segmentDirectOperatingMarginPercent : null,
        ebitda: profit.ebitdaPaise, ebitdaMargin: profit.ebitdaMarginPercent,
        depreciation: profit.depreciationPaise, ebita: profit.ebitaPaise, ebitaMargin: profit.ebitaMarginPercent,
        amortisation: profit.amortisationPaise, ebit: profit.ebitPaise, ebitMargin: profit.ebitMarginPercent,
        interestIncome: profit.interestIncomePaise, otherNonOperatingIncome: profit.otherNonOperatingIncomePaise,
        totalOtherIncome: profit.totalOtherIncomePaise, financeCosts: profit.financeCostsPaise,
        totalFinanceCosts: profit.financeCostsPaise,
        otherNonOperatingExpense: profit.otherNonOperatingExpensePaise,
        exceptionalAdjustment: profit.exceptionalAdjustmentPaise, pbt: profit.pbtPaise,
        pbtMargin: profit.pbtMarginPercent, taxProvision: profit.incomeTaxProvisionPaise,
        pat: profit.patPaise, netProfitMargin: profit.netProfitMarginPercent
    };
    values.netSales = revenue.available === false ? null : revenue.netSalesExGstPaise;
    values.netCogs = cogs.netCapturedCogsPaise;
    values.coverage = cogs.costCoveragePercent;
    values.grossProfit = cogs.fullGrossProfitAvailable ? cogs.fullGrossProfitPaise : null;
    values.grossMargin = cogs.fullGrossProfitAvailable ? cogs.fullGrossMarginPercent : null;
    if (key.startsWith("group:")) return expenses.available === false ? null : expenses.managementGroups.find(group => group.name === key.slice(6))?.amountPaise ?? null;
    if (key.startsWith("category:")) return expenses.available === false ? null : expenses.categories.find(category => category.category === key.slice(9))?.amountPaise ?? null;
    return values[key] ?? null;
}

function monthlyAmount(month, key) {
    if (month.future) return "—";
    return amount(summaryAmount(month.result, key));
}

function setHeader(row) {
    row.height = 25;
    row.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BURGUNDY } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = { bottom: { style: "medium", color: { argb: BURGUNDY } } };
    });
}

function setSection(row) {
    for (let column = 1; column <= 17; column += 1) row.getCell(column);
    row.eachCell(cell => {
        cell.font = { bold: true, color: { argb: BURGUNDY } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE_BURGUNDY } };
    });
}

function setMetadata(sheet, result, version, schemaVersion, title) {
    const store = result.metadata.store;
    const summary = result.selectedSummary;
    const rows = [
        ["Store Code", store?.storeCode || "Unavailable", "Store Name", store?.storeName || "Unavailable", "Financial Year", result.metadata.financialYearLabel],
        ["Business Segment", result.metadata.businessSegment, "As-of Date", result.metadata.asOfDate, "Generated At", result.metadata.generatedAt],
        ["KLBS Version", version, "Schema Version", schemaVersion, "COGS Basis", "Sale-time Product Master Cost / reference cost"],
        ["Cost Coverage", summary.cogs.costCoveragePercent === null ? "N/A" : `${summary.cogs.costCoveragePercent.toFixed(2)}%`, "Cost Status", summary.cogs.coverageStatus, "", ""]
    ];
    sheet.getCell("A1").value = title;
    for (let column = 1; column <= 17; column += 1) {
        const cell = sheet.getCell(1, column);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BURGUNDY } };
        cell.font = { size: 16, bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { vertical: "middle" };
    }
    sheet.getRow(1).height = 30;
    rows.forEach((values, index) => {
        const rowNumber = index + 2;
        values.forEach((value, columnIndex) => {
            const cell = sheet.getCell(rowNumber, columnIndex + 1);
            cell.value = value;
            if (columnIndex % 2 === 0) cell.font = { bold: true, color: { argb: BURGUNDY } };
        });
    });
    if (summary.cogs.fullGrossProfitAvailable !== true) {
        sheet.mergeCells("A6:Q6");
        const warning = sheet.getCell("A6");
        warning.value = "WARNING: Cost coverage is incomplete or includes cost-pending sales. Full-period profitability is unavailable.";
        warning.font = { bold: true, color: { argb: "FF654900" } };
        warning.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3D2" } };
    }
    sheet.getColumn(1).width = 34;
    sheet.getColumn(2).width = 16;
    sheet.getColumn(3).width = 20;
    sheet.getColumn(4).width = 18;
    sheet.getColumn(5).width = 20;
    sheet.getColumn(6).width = 24;
    return 8;
}

function buildStatementDescriptors(segment) {
    const rows = [];
    const addSection = label => rows.push({ type: "section", label });
    const addLine = (label, key, kind = "money", favorable = "HIGHER") => {
        const descriptor = { type: "line", label, key, kind, favorable };
        rows.push(descriptor);
        return descriptor;
    };
    addSection("REVENUE");
    addLine("Gross Billings (incl. GST)", "gross");
    addLine("Less: Discounts", "discounts", "money", "LOWER");
    addLine("Less: Sales Returns", "returns", "money", "LOWER");
    addLine("Less: Net GST", "netGst", "money", "LOWER");
    addLine("NET SALES (EXCL. GST)", "netSales", "formula", "HIGHER").total = true;
    addSection("COST OF GOODS SOLD");
    addLine("Captured Sale COGS", "saleCogs", "money", "LOWER");
    addLine("Less: Return COGS Reversal", "returnCogs", "money", "LOWER");
    addLine("NET CAPTURED COGS", "netCogs", "formula", "LOWER").total = true;
    addLine("Captured-cost Net Sales", "capturedSales", "money", "NEUTRAL");
    addLine("Unknown-cost Net Sales", "unknownSales", "money", "NEUTRAL");
    addLine("VVP / Cost Pending Net Sales", "vvpSales", "money", "NEUTRAL");
    addLine("Cost Coverage", "coverage", "coverage", "NEUTRAL");
    addLine("GROSS PROFIT", "grossProfit", "profit", "HIGHER").total = true;
    addLine("GROSS MARGIN", "grossMargin", "margin", "HIGHER").total = true;
    addSection("OPERATING EXPENSES");
    for (const [groupName, categories] of CATEGORY_GROUPS) {
        rows.push({ type: "group", label: groupName, key: `group:${groupName}`, categories, kind: "money", favorable: "LOWER" });
        for (const category of categories) rows.push({ type: "category", label: category, key: `category:${category}`, kind: "money", favorable: "LOWER" });
    }
    addLine("TOTAL OPERATING EXPENSES", "totalExpenses", "expenseTotal", "LOWER").total = true;
    // COMMON is shown separately for selected segment reports and included in ALL totals.
    if (segment !== "ALL") addLine("COMMON EXPENSES — NOT ALLOCATED", "commonExpenses", "money", "LOWER");
    addLine("EBITDA", "ebitda", "ebitda", "HIGHER").total = true;
    addLine("EBITDA MARGIN %", "ebitdaMargin", "profitMargin", "HIGHER").total = true;
    addSection("DEPRECIATION & AMORTISATION");
    addLine("Depreciation", "depreciation", "money", "LOWER");
    addLine("EBITA", "ebita", "ebita", "HIGHER").total = true;
    addLine("EBITA MARGIN %", "ebitaMargin", "profitMargin", "HIGHER").total = true;
    addLine("Amortisation", "amortisation", "money", "LOWER");
    addLine("EBIT / OPERATING PROFIT", "ebit", "ebit", "HIGHER").total = true;
    addLine("EBIT / OPERATING PROFIT MARGIN %", "ebitMargin", "profitMargin", "HIGHER").total = true;
    addSection("OTHER INCOME");
    addLine("Interest Income", "interestIncome", "money", "HIGHER");
    addLine("Other Non-Operating Income", "otherNonOperatingIncome", "money", "HIGHER");
    addLine("TOTAL OTHER INCOME", "totalOtherIncome", "totalOtherIncome", "HIGHER").total = true;
    addSection("FINANCE COSTS");
    addLine("Interest / Finance Charges", "financeCosts", "money", "LOWER");
    addLine("TOTAL FINANCE COSTS", "totalFinanceCosts", "totalFinanceCosts", "LOWER").total = true;
    addSection("OTHER NON-OPERATING ITEMS");
    addLine("Other Non-Operating Expense", "otherNonOperatingExpense", "money", "LOWER");
    addLine("Exceptional / Adjustment Items", "exceptionalAdjustment", "money", "HIGHER");
    addSection("PROFIT BEFORE TAX");
    addLine("PBT", "pbt", "pbt", "HIGHER").total = true;
    addLine("PBT MARGIN %", "pbtMargin", "profitMargin", "HIGHER").total = true;
    addSection("TAX");
    addLine("Income Tax / Tax Provision", "taxProvision", "money", "LOWER");
    addSection("PROFIT AFTER TAX");
    addLine("PAT / NET PROFIT", "pat", "pat", "HIGHER").total = true;
    addLine("NET PROFIT MARGIN %", "netProfitMargin", "profitMargin", "HIGHER").total = true;
    return rows;
}

function addFormula(cell, formula) { cell.value = { formula }; }
function ref(column, row, sheetName) {
    const address = `${column}${row}`;
    return sheetName ? `'${sheetName}'!${address}` : address;
}

function styleAmountCell(cell, kind) {
    if (kind === "coverage" || kind === "margin" || kind === "operatingMargin" || kind === "profitMargin") cell.numFmt = PERCENT_FORMAT;
    else if (kind === "variancePercent") cell.numFmt = VARIANCE_PERCENT_FORMAT;
    else if (kind !== "profit" && kind !== "operatingProfit" && kind !== "expenseTotal") cell.numFmt = MONEY_FORMAT;
    else cell.numFmt = MONEY_FORMAT;
}

function varianceFormula(sheet, rowNumber, descriptor) {
    const amountCell = sheet.getCell(rowNumber, 16);
    const percentCell = sheet.getCell(rowNumber, 17);
    addFormula(amountCell, `IF(AND(ISNUMBER(N${rowNumber}),ISNUMBER(O${rowNumber})),N${rowNumber}-O${rowNumber},"—")`);
    addFormula(percentCell, `IF(OR(NOT(ISNUMBER(N${rowNumber})),NOT(ISNUMBER(O${rowNumber})),O${rowNumber}=0),"—",IFERROR(P${rowNumber}/O${rowNumber},"—"))`);
    amountCell.numFmt = ["coverage", "margin", "operatingMargin", "profitMargin"].includes(descriptor.kind) ? '0.00" pp";[Red](0.00" pp");-' : MONEY_FORMAT;
    percentCell.numFmt = VARIANCE_PERCENT_FORMAT;
    const colorRule = descriptor.favorable === "NEUTRAL" ? [] : descriptor.favorable === "LOWER"
        ? [{ type: "cellIs", operator: "lessThan", formulae: ["0"], style: { font: { color: { argb: GREEN }, bold: true } } },
            { type: "cellIs", operator: "greaterThan", formulae: ["0"], style: { font: { color: { argb: RED }, bold: true } } }]
        : descriptor.favorable === "HIGHER"
            ? [{ type: "cellIs", operator: "greaterThan", formulae: ["0"], style: { font: { color: { argb: GREEN }, bold: true } } },
                { type: "cellIs", operator: "lessThan", formulae: ["0"], style: { font: { color: { argb: RED }, bold: true } } }]
            : [{ type: "cellIs", operator: "greaterThan", formulae: ["0"], style: { font: { color: { argb: GREEN }, bold: true } } },
                { type: "cellIs", operator: "lessThan", formulae: ["0"], style: { font: { color: { argb: RED }, bold: true } } }];
    for (const column of [16, 17]) {
        if (colorRule.length) sheet.addConditionalFormatting({ ref: `${sheet.getColumn(column).letter}${rowNumber}`, rules: colorRule });
        sheet.getCell(rowNumber, column).font = { color: { argb: NEUTRAL } };
    }
}

function profitFormula(kind, column, rows) {
    const ref = key => `${column}${rows.get(key)}`;
    const available = `'COGS Coverage'!${column}${COGS_ROWS.operatingAvailable}="AVAILABLE"`;
    if (kind === "ebitda") return `IF(AND(${available},ISNUMBER(${ref("grossProfit")}),ISNUMBER(${ref("totalExpenses")})),${ref("grossProfit")}-${ref("totalExpenses")},"N/A")`;
    if (kind === "ebita") return `IF(AND(${available},ISNUMBER(${ref("ebitda")}),ISNUMBER(${ref("depreciation")})),${ref("ebitda")}-${ref("depreciation")},"N/A")`;
    if (kind === "ebit") return `IF(AND(${available},ISNUMBER(${ref("ebita")}),ISNUMBER(${ref("amortisation")})),${ref("ebita")}-${ref("amortisation")},"N/A")`;
    if (kind === "totalOtherIncome") return `SUM(${ref("interestIncome")},${ref("otherNonOperatingIncome")})`;
    if (kind === "totalFinanceCosts") return `=${ref("financeCosts")}`.slice(1);
    if (kind === "pbt") return `IF(AND(${available},ISNUMBER(${ref("ebit")})),${ref("ebit")}+${ref("totalOtherIncome")}-${ref("totalFinanceCosts")}-${ref("otherNonOperatingExpense")}+${ref("exceptionalAdjustment")},"N/A")`;
    if (kind === "pat") return `IF(AND(${available},ISNUMBER(${ref("pbt")}),ISNUMBER(${ref("taxProvision")})),${ref("pbt")}-${ref("taxProvision")},"N/A")`;
    const numerator = ({ ebitdaMargin: "ebitda", ebitaMargin: "ebita", ebitMargin: "ebit", pbtMargin: "pbt", netProfitMargin: "pat" })[kind];
    if (numerator) return `IF(AND(${available},ISNUMBER(${ref(numerator)}),ISNUMBER(${ref("netSales")})),IFERROR(${ref(numerator)}/${ref("netSales")}*100,"N/A"),"N/A")`;
    return null;
}

function buildManagementSheet(workbook, result, version, schemaVersion) {
    const sheet = workbook.addWorksheet("Management P&L");
    const headerRow = setMetadata(sheet, result, version, schemaVersion, `MANAGEMENT P&L · ${result.metadata.financialYearLabel}`);
    const headers = ["Particular", ...MONTH_NAMES, result.metadata.activeFinancialYear ? "FYTD" : "FY TOTAL",
        result.metadata.activeFinancialYear ? "Last FYTD" : "Last FY", "Variance Amount", "Variance %"];
    sheet.getRow(headerRow).values = headers;
    setHeader(sheet.getRow(headerRow));
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow, topLeftCell: `B${headerRow + 1}`, activePane: "bottomRight" }];
    const descriptors = buildStatementDescriptors(result.metadata.businessSegment);
    const rows = new Map();
    let rowCursor = headerRow + 1;
    for (const descriptor of descriptors) {
        if (descriptor.type === "section") rowCursor += 1;
        else {
            if (rows.has(descriptor.key)) throw new Error(`Duplicate Management P&L workbook row key: ${descriptor.key}`);
            rows.set(descriptor.key, rowCursor);
            rowCursor += 1;
        }
    }
    const availability = result.months.map(month => month.future ? "FUTURE" : month.result.cogs.fullGrossProfitAvailable ? "AVAILABLE" : "UNAVAILABLE");
    const reachedMonths = result.months.filter(month => !month.future).length;
    let rowNumber = headerRow + 1;
    for (const descriptor of descriptors) {
        const row = sheet.getRow(rowNumber);
        if (descriptor.type === "section") {
            row.getCell(1).value = descriptor.label;
            row.height = 21;
            setSection(row);
            rowNumber += 1;
            continue;
        }
        row.getCell(1).value = descriptor.label;
        if (descriptor.type === "category") {
            row.getCell(1).alignment = { indent: 1, vertical: "middle" };
            row.getCell(1).font = { color: { argb: NEUTRAL } };
        }
        if (descriptor.type === "group") row.getCell(1).font = { bold: true, color: { argb: BURGUNDY } };
        for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
            const column = monthIndex + 2;
            const letter = sheet.getColumn(column).letter;
            const future = result.months[monthIndex].future;
            const cell = row.getCell(column);
            if (future) {
                cell.value = "—";
                continue;
            }
            if (["group", "category"].includes(descriptor.type)) {
                if (descriptor.type === "category") cell.value = monthlyAmount(result.months[monthIndex], descriptor.key);
                else cell.value = { formula: `IF('COGS Coverage'!${letter}${COGS_ROWS.expensesAvailable}="AVAILABLE",SUM(${letter}${rows.get(`category:${descriptor.categories[0]}`)}:${letter}${rows.get(`category:${descriptor.categories[descriptor.categories.length - 1]}`)}),"N/A")` };
            } else if (descriptor.kind === "formula") {
                const formula = descriptor.key === "netSales"
                    ? `IF(COUNT(${letter}${rows.get("gross")},${letter}${rows.get("discounts")},${letter}${rows.get("returns")},${letter}${rows.get("netGst")})=4,${letter}${rows.get("gross")}-${letter}${rows.get("discounts")}-${letter}${rows.get("returns")}-${letter}${rows.get("netGst")},"N/A")`
                    : `IF(COUNT(${letter}${rows.get("saleCogs")},${letter}${rows.get("returnCogs")})=2,${letter}${rows.get("saleCogs")}-${letter}${rows.get("returnCogs")},"N/A")`;
                addFormula(cell, formula);
            } else if (descriptor.kind === "coverage") {
                const capturedRow = rows.get("capturedSales");
                const unknownRow = rows.get("unknownSales");
                addFormula(cell, `IF(COUNT(${letter}${capturedRow},${letter}${unknownRow})=2,IF(${letter}${capturedRow}+${letter}${unknownRow}=0,"N/A",${letter}${capturedRow}/(${letter}${capturedRow}+${letter}${unknownRow})*100),"N/A")`);
            } else if (descriptor.kind === "profit") {
                addFormula(cell, `IF('COGS Coverage'!${letter}${COGS_ROWS.grossProfitAvailable}="AVAILABLE",${letter}${rows.get("netSales")}-${letter}${rows.get("netCogs")},"N/A")`);
            } else if (descriptor.kind === "margin") {
                addFormula(cell, `IF(ISNUMBER(${letter}${rows.get("grossProfit")}),IFERROR(${letter}${rows.get("grossProfit")}/${letter}${rows.get("netSales")}*100,"N/A"),"N/A")`);
            } else if (descriptor.kind === "expenseTotal") {
                const groupKeys = CATEGORY_GROUPS.map(([name]) => `group:${name}`);
                addFormula(cell, `IF('COGS Coverage'!${letter}${COGS_ROWS.expensesAvailable}="AVAILABLE",SUM(${groupKeys.map(key => `${letter}${rows.get(key)}`).join(",")}),"N/A")`);
            } else if (["ebitda", "ebita", "ebit", "totalOtherIncome", "totalFinanceCosts", "pbt", "pat", "profitMargin"].includes(descriptor.kind)) {
                const kind = descriptor.kind === "profitMargin" ? descriptor.key : descriptor.kind;
                addFormula(cell, profitFormula(kind, letter, rows));
            } else if (descriptor.kind === "operatingProfit") {
                addFormula(cell, `IF('COGS Coverage'!${letter}${COGS_ROWS.operatingAvailable}="AVAILABLE",${letter}${rows.get("grossProfit")}-${letter}${rows.get("totalExpenses")},"N/A")`);
            } else if (descriptor.kind === "operatingMargin") {
                addFormula(cell, `IF(ISNUMBER(${letter}${rows.get("operatingProfit")}),IFERROR(${letter}${rows.get("operatingProfit")}/${letter}${rows.get("netSales")}*100,"N/A"),"N/A")`);
            } else {
                const value = monthlyAmount(result.months[monthIndex], descriptor.key);
                cell.value = value;
            }
            styleAmountCell(cell, descriptor.kind);
        }
        const currentColumn = 14;
        const currentCell = row.getCell(currentColumn);
        const currentAvail = descriptor.kind === "profit" || descriptor.kind === "margin"
            ? result.selectedSummary.cogs.fullGrossProfitAvailable
            : descriptor.kind === "operatingProfit" || descriptor.kind === "operatingMargin"
                ? (result.selectedSummary.operatingResult.operatingProfitAvailable === true || result.selectedSummary.operatingResult.segmentDirectOperatingResultAvailable === true)
                : true;
        if (descriptor.kind === "formula" || descriptor.type === "group" || descriptor.type === "category" || descriptor.kind === "expenseTotal") {
            const expectedCount = reachedMonths;
            const sumFormula = descriptor.kind === "formula" && descriptor.key === "netSales" ?
                `IF(COUNT(N${rows.get("gross")},N${rows.get("discounts")},N${rows.get("returns")},N${rows.get("netGst")})=4,N${rows.get("gross")}-N${rows.get("discounts")}-N${rows.get("returns")}-N${rows.get("netGst")},"N/A")` :
                descriptor.kind === "formula" ? `IF(COUNT(N${rows.get("saleCogs")},N${rows.get("returnCogs")})=2,N${rows.get("saleCogs")}-N${rows.get("returnCogs")},"N/A")` :
                descriptor.type === "group" ? `IF('COGS Coverage'!N${COGS_ROWS.expensesAvailable}="AVAILABLE",SUM(${descriptor.categories.map(category => `N${rows.get(`category:${category}`)}`).join(",")}),"N/A")` :
                descriptor.kind === "expenseTotal" ? `IF('COGS Coverage'!N${COGS_ROWS.expensesAvailable}="AVAILABLE",SUM(${CATEGORY_GROUPS.map(([name]) => `N${rows.get(`group:${name}`)}`).join(",")}),"N/A")` :
                `IF('COGS Coverage'!N${COGS_ROWS.expensesAvailable}="AVAILABLE",SUM(${Array.from({ length: reachedMonths }, (_, index) => `${sheet.getColumn(index + 2).letter}${rowNumber}`).join(",")}),"N/A")`;
            if (descriptor.type === "category") addFormula(currentCell, `IF('COGS Coverage'!N${COGS_ROWS.expensesAvailable}="AVAILABLE",SUM(${Array.from({ length: reachedMonths }, (_, index) => `${sheet.getColumn(index + 2).letter}${rowNumber}`).join(",")}),"N/A")`);
            else addFormula(currentCell, sumFormula);
            if (expectedCount < 12 && descriptor.type !== "category") { /* FYTD formula only includes reached month columns. */ }
        } else if (descriptor.kind === "coverage") {
            addFormula(currentCell, `IFERROR(N${rows.get("capturedSales")}/(N${rows.get("capturedSales")}+N${rows.get("unknownSales")})*100,"N/A")`);
        } else if (descriptor.kind === "profit") {
            addFormula(currentCell, `IF('COGS Coverage'!N${COGS_ROWS.grossProfitAvailable}="AVAILABLE",N${rows.get("netSales")}-N${rows.get("netCogs")},"N/A")`);
        } else if (descriptor.kind === "margin") {
            addFormula(currentCell, `IF(ISNUMBER(N${rows.get("grossProfit")}),IFERROR(N${rows.get("grossProfit")}/N${rows.get("netSales")}*100,"N/A"),"N/A")`);
        } else if (["ebitda", "ebita", "ebit", "totalOtherIncome", "totalFinanceCosts", "pbt", "pat", "profitMargin"].includes(descriptor.kind)) {
            const kind = descriptor.kind === "profitMargin" ? descriptor.key : descriptor.kind;
            addFormula(currentCell, profitFormula(kind, "N", rows));
        } else if (descriptor.kind === "operatingProfit") {
            addFormula(currentCell, `IF('COGS Coverage'!N${COGS_ROWS.operatingAvailable}="AVAILABLE",N${rows.get("grossProfit")}-N${rows.get("totalExpenses")},"N/A")`);
        } else if (descriptor.kind === "operatingMargin") {
            addFormula(currentCell, `IF(ISNUMBER(N${rows.get("operatingProfit")}),IFERROR(N${rows.get("operatingProfit")}/N${rows.get("netSales")}*100,"N/A"),"N/A")`);
        } else {
            addFormula(currentCell, `IF(COUNT(B${rowNumber}:M${rowNumber})=${reachedMonths},SUM(B${rowNumber}:M${rowNumber}),"N/A")`);
        }
        styleAmountCell(currentCell, descriptor.kind);
        const prior = amount(summaryAmount(result.comparisonSummary, descriptor.key));
        const priorCell = row.getCell(15);
        if (["group", "category"].includes(descriptor.type)) {
            const groupOrCatValue = summaryAmount(result.comparisonSummary, descriptor.key);
            priorCell.value = groupOrCatValue === null ? "N/A" : Number(groupOrCatValue) / 100;
        } else if (descriptor.kind === "coverage") {
            priorCell.value = result.comparisonSummary.cogs.costCoveragePercent === null ? "N/A" : result.comparisonSummary.cogs.costCoveragePercent;
        } else {
            priorCell.value = prior;
        }
        styleAmountCell(priorCell, descriptor.kind);
        if (descriptor.kind === "coverage" || descriptor.kind === "profitMargin") {
            if (descriptor.kind === "profitMargin") {
                const priorPercentage = summaryAmount(result.comparisonSummary, descriptor.key);
                priorCell.value = priorPercentage === null || priorPercentage === undefined ? "N/A" : priorPercentage;
            }
        }
        if (descriptor.kind === "coverage") {
            const captured = amount(result.comparisonSummary.cogs.capturedNetSalesPaise);
            const unknown = amount(result.comparisonSummary.cogs.unknownNetSalesPaise);
            priorCell.value = Number.isFinite(captured) && Number.isFinite(unknown) && captured + unknown !== 0 ? captured / (captured + unknown) * 100 : "N/A";
        }
        if (["profit", "margin"].includes(descriptor.kind) && currentAvail !== true) currentCell.value = { formula: `IF('COGS Coverage'!N${COGS_ROWS.grossProfitAvailable}="AVAILABLE",${descriptor.kind === "profit" ? `N${rows.get("netSales")}-N${rows.get("netCogs")}` : `IFERROR(N${rows.get("grossProfit")}/N${rows.get("netSales")}*100,\"N/A\")`},"N/A")` };
        if (["operatingProfit", "operatingMargin"].includes(descriptor.kind) && currentAvail !== true) {
            const formula = descriptor.kind === "operatingProfit" ? `IF('COGS Coverage'!N${COGS_ROWS.operatingAvailable}="AVAILABLE",N${rows.get("grossProfit")}-N${rows.get("totalExpenses")},"N/A")` : `IF(ISNUMBER(N${rows.get("operatingProfit")}),IFERROR(N${rows.get("operatingProfit")}/N${rows.get("netSales")}*100,"N/A"),"N/A")`;
            addFormula(currentCell, formula);
        }
        varianceFormula(sheet, rowNumber, descriptor);
        if (descriptor.total || descriptor.type === "group") {
            for (let column = 1; column <= 17; column += 1) {
                row.getCell(column).font = { ...(row.getCell(column).font || {}), bold: true, color: { argb: descriptor.type === "group" ? BURGUNDY : NEUTRAL } };
            }
        }
        rowNumber += 1;
    }
    sheet.getColumn(1).width = 36;
    for (let column = 2; column <= 13; column += 1) sheet.getColumn(column).width = 15;
    sheet.getColumn(14).width = 17;
    sheet.getColumn(15).width = 17;
    sheet.getColumn(16).width = 20;
    sheet.getColumn(17).width = 15;
    sheet.eachRow((row, index) => { if (index > headerRow) row.getCell(1).alignment = { ...(row.getCell(1).alignment || {}), vertical: "middle" }; });
    return { sheet, descriptors, rows, headerRow };
}

const COGS_ROWS = { grossProfitAvailable: 0, operatingAvailable: 0, expensesAvailable: 0 };

function buildBridgeSheet(workbook, result, version, schemaVersion) {
    const sheet = workbook.addWorksheet("Sales & GST Bridge");
    setMetadata(sheet, result, version, schemaVersion, "SALES & GST BRIDGE");
    const headers = ["Particular", ...MONTH_NAMES, result.metadata.activeFinancialYear ? "FYTD" : "FY TOTAL", result.metadata.activeFinancialYear ? "Last FYTD" : "Last FY"];
    sheet.getRow(8).values = headers;
    setHeader(sheet.getRow(8));
    const rows = [
        ["Gross Billings (incl. GST)", summary => summary.revenue.available === false ? null : summary.revenue.grossBillingsInclGstPaise],
        ["Discounts", summary => summary.revenue.available === false ? null : summary.revenue.discountsInclGstEffectPaise],
        ["Sales Taxable Before Returns", summary => summary.revenue.available === false ? null : summary.revenue.salesTaxableBeforeReturnsPaise],
        ["Sales GST", summary => summary.revenue.available === false ? null : summary.revenue.salesGstPaise],
        ["Sales Net (incl. GST)", summary => summary.revenue.available === false ? null : summary.revenue.salesNetInclGstPaise],
        ["Return Gross Reversal", summary => summary.revenue.available === false ? null : summary.revenue.completedReturnGrossReversalPaise],
        ["Return Discount Reversal", summary => summary.revenue.available === false ? null : summary.revenue.completedReturnDiscountReversalPaise],
        ["Return Taxable Reversal", summary => summary.revenue.available === false ? null : summary.revenue.completedReturnTaxableReversalPaise],
        ["Return GST Reversal", summary => summary.revenue.available === false ? null : summary.revenue.completedReturnGstReversalPaise],
        ["Return Net Reversal", summary => summary.revenue.available === false ? null : summary.revenue.completedReturnNetReversalPaise],
        ["Net GST on Sales", summary => summary.revenue.available === false ? null : summary.revenue.netGstOnSalesPaise],
        ["Net Sales (excl. GST)", summary => summary.revenue.available === false ? null : summary.revenue.netSalesExGstPaise]
    ];
    rows.forEach(([label, valueOf], index) => {
        const rowNumber = 9 + index;
        sheet.getCell(rowNumber, 1).value = label;
        result.months.forEach((month, monthIndex) => {
            sheet.getCell(rowNumber, monthIndex + 2).value = month.future ? "—" : amount(valueOf(month.result));
            sheet.getCell(rowNumber, monthIndex + 2).numFmt = MONEY_FORMAT;
        });
        sheet.getCell(rowNumber, 14).value = amount(valueOf(result.selectedSummary));
        sheet.getCell(rowNumber, 15).value = amount(valueOf(result.comparisonSummary));
        sheet.getCell(rowNumber, 14).numFmt = MONEY_FORMAT;
        sheet.getCell(rowNumber, 15).numFmt = MONEY_FORMAT;
    });
    sheet.getColumn(1).width = 34;
    for (let column = 2; column <= 15; column += 1) sheet.getColumn(column).width = 15;
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 8, topLeftCell: "B9" }];
    return sheet;
}

function buildCogsSheet(workbook, result, version, schemaVersion) {
    const sheet = workbook.addWorksheet("COGS Coverage");
    setMetadata(sheet, result, version, schemaVersion, "COGS COVERAGE");
    sheet.getRow(8).values = ["Particular", ...MONTH_NAMES, result.metadata.activeFinancialYear ? "FYTD" : "FY TOTAL", result.metadata.activeFinancialYear ? "Last FYTD" : "Last FY"];
    setHeader(sheet.getRow(8));
    const rows = [
        ["Captured Sale COGS", summary => summary.cogs.capturedSaleCogsPaise, "money"],
        ["Return COGS Reversal", summary => summary.cogs.capturedReturnCogsReversalPaise, "money"],
        ["Net Captured COGS", summary => summary.cogs.netCapturedCogsPaise, "money"],
        ["Captured-cost Net Sales", summary => summary.cogs.capturedNetSalesPaise, "money"],
        ["Unknown-cost Net Sales", summary => summary.cogs.unknownNetSalesPaise, "money"],
        ["VVP / Cost Pending Net Sales", summary => summary.cogs.notApplicableNetSalesPaise, "money"],
        ["Eligible Net Sales", summary => summary.cogs.eligibleNetSalesPaise, "money"],
        ["Cost Coverage", summary => summary.cogs.costCoveragePercent, "percent"],
        ["Gross Profit Availability", summary => summary.cogs.fullGrossProfitAvailable ? "AVAILABLE" : "UNAVAILABLE", "status"],
        ["Core Profitability Availability", summary => (summary.operatingResult.operatingProfitAvailable === true || summary.operatingResult.segmentDirectOperatingResultAvailable === true) ? "AVAILABLE" : "UNAVAILABLE", "status"],
        ["Posted Expense Availability", summary => summary.expenses.available !== false && summary.reconciliation.expense.reconciles === true ? "AVAILABLE" : "UNAVAILABLE", "status"]
    ];
    const rowIndex = new Map();
    rows.forEach(([label, valueOf, kind], index) => {
        const rowNumber = 9 + index;
        rowIndex.set(label, rowNumber);
        sheet.getCell(rowNumber, 1).value = label;
        result.months.forEach((month, monthIndex) => {
            const cell = sheet.getCell(rowNumber, monthIndex + 2);
            cell.value = month.future ? "—" : valueOf(month.result);
            if (kind === "money") cell.value = amount(cell.value), cell.numFmt = MONEY_FORMAT;
            if (kind === "percent" && cell.value !== "—" && cell.value !== "N/A") cell.value = Number(cell.value), cell.numFmt = PERCENT_FORMAT;
        });
        const selectedValue = valueOf(result.selectedSummary);
        const priorValue = valueOf(result.comparisonSummary);
        sheet.getCell(rowNumber, 14).value = kind === "money" ? amount(selectedValue) : selectedValue === null ? "N/A" : selectedValue;
        sheet.getCell(rowNumber, 15).value = kind === "money" ? amount(priorValue) : priorValue === null ? "N/A" : priorValue;
        if (kind === "money") { sheet.getCell(rowNumber, 14).numFmt = MONEY_FORMAT; sheet.getCell(rowNumber, 15).numFmt = MONEY_FORMAT; }
        if (kind === "percent") { sheet.getCell(rowNumber, 14).numFmt = PERCENT_FORMAT; sheet.getCell(rowNumber, 15).numFmt = PERCENT_FORMAT; }
    });
    sheet.getColumn(1).width = 34;
    for (let column = 2; column <= 15; column += 1) sheet.getColumn(column).width = 15;
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 8, topLeftCell: "B9" }];
    return rowIndex;
}

function buildExpenseSheet(workbook, result, version, schemaVersion) {
    const sheet = workbook.addWorksheet("Posted Expenses");
    sheet.mergeCells("A1:K1");
    sheet.getCell("A1").value = "POSTED EXPENSES SUPPORTING MANAGEMENT P&L";
    sheet.getCell("A1").font = { size: 15, bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: BURGUNDY } };
    const info = [
        ["Store Code", result.metadata.store?.storeCode || "Unavailable"], ["Store Name", result.metadata.store?.storeName || "Unavailable"],
        ["Financial Year", result.metadata.financialYearLabel], ["Business Segment", result.metadata.businessSegment],
        ["Period Through", result.metadata.asOfDate], ["Matching Expense Count", result.postedExpenseDetails.totalCount],
        ["Matching Amount", Number(result.postedExpenseDetails.totalAmountPaise || 0) / 100]
    ];
    writeSupplementalMetadata(sheet, result, version, schemaVersion);
    info.forEach(([label, value], index) => { sheet.getCell(index + 2, 1).value = label; sheet.getCell(index + 2, 1).font = { bold: true, color: { argb: BURGUNDY } }; sheet.getCell(index + 2, 2).value = value; });
    sheet.getCell("B8").numFmt = MONEY_FORMAT;
    sheet.getRow(10).values = ["Expense ID", "Batch ID", "Expense Date", "Expense Header", "Management Group", "Business Segment", "Transaction Type", "Receipt / Reference No.", "Amount", "Remarks", "Posted At"];
    setHeader(sheet.getRow(10));
    const details = result.postedExpenseDetails;
    details.rows.forEach((item, index) => {
        const rowNumber = index + 11;
        sheet.getRow(rowNumber).values = [item.expense_code, item.batch_code, item.expense_date, item.category, item.management_group,
            item.business_segment, item.payment_mode, item.reference || "", amount(item.amount_paise), item.remarks || "", item.posted_at];
        sheet.getCell(rowNumber, 9).numFmt = MONEY_FORMAT;
    });
    const totalRow = 11 + details.rows.length;
    sheet.getCell(totalRow, 8).value = "TOTAL POSTED EXPENSES";
    if (details.rows.length) addFormula(sheet.getCell(totalRow, 9), `SUM(I11:I${totalRow - 1})`);
    else sheet.getCell(totalRow, 9).value = 0;
    sheet.getCell(totalRow, 9).numFmt = MONEY_FORMAT;
    sheet.getRow(totalRow).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 10 }];
    [17, 17, 15, 30, 30, 18, 20, 26, 17, 44, 28].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    return sheet;
}

function buildQualitySheet(workbook, result, version, schemaVersion) {
    const sheet = workbook.addWorksheet("Data Quality");
    sheet.getCell("A1").value = "DATA QUALITY & ACCOUNTING COMPLETENESS";
    sheet.getCell("A1").font = { size: 15, bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: BURGUNDY } };
    sheet.mergeCells("A1:E1");
    sheet.getCell("A2").value = "COGS Basis";
    sheet.getCell("B2").value = "Sale-time Product Master Cost / reference cost";
    sheet.getCell("A3").value = "Full Gross Profit Available";
    sheet.getCell("B3").value = result.selectedSummary.cogs.fullGrossProfitAvailable ? "YES" : "NO";
    sheet.getCell("A4").value = "Cost Coverage";
    sheet.getCell("B4").value = result.selectedSummary.cogs.costCoveragePercent === null ? "N/A" : `${result.selectedSummary.cogs.costCoveragePercent.toFixed(2)}%`;
    sheet.getCell("A5").value = "Management entries";
    sheet.getCell("B5").value = "Management-entered accounting values; entries may be incomplete.";
    writeSupplementalMetadata(sheet, result, version, schemaVersion);
    sheet.getRow(6).values = ["Severity", "Code", "Message", "Affected Count", "Affected Value"];
    setHeader(sheet.getRow(6));
    const warnings = result.selectedSummary.dataQuality.warnings || [];
    warnings.forEach((warning, index) => {
        const rowNumber = index + 7;
        sheet.getRow(rowNumber).values = [warning.severity, warning.code, warning.message, warning.affectedCount || 0, amount(warning.affectedValuePaise)];
        sheet.getCell(rowNumber, 5).numFmt = MONEY_FORMAT;
    });
    if (!warnings.length) sheet.getCell("A7").value = "No accounting or reconciliation warnings for this selection.";
    sheet.getColumn(1).width = 18;
    sheet.getColumn(2).width = 38;
    sheet.getColumn(3).width = 80;
    sheet.getColumn(4).width = 18;
    sheet.getColumn(5).width = 20;
    sheet.views = [{ state: "frozen", ySplit: 6 }];
    return sheet;
}

function writeSupplementalMetadata(sheet, result, version, schemaVersion) {
    const metadata = [
        ["Store Code", result.metadata.store?.storeCode || "Unavailable", "Store Name", result.metadata.store?.storeName || "Unavailable"],
        ["Financial Year", result.metadata.financialYearLabel, "Business Segment", result.metadata.businessSegment],
        ["As-of Date", result.metadata.asOfDate, "KLBS Version", version],
        ["Schema Version", schemaVersion, "Generated At", result.metadata.generatedAt]
    ];
    metadata.forEach((values, index) => values.forEach((value, offset) => {
        const column = 13 + offset;
        const cell = sheet.getCell(index + 2, column);
        cell.value = value;
        if (offset % 2 === 0) cell.font = { bold: true, color: { argb: BURGUNDY } };
    }));
    sheet.getColumn(13).width = 19;
    sheet.getColumn(14).width = 20;
    sheet.getColumn(15).width = 20;
    sheet.getColumn(16).width = 28;
}

function buildAccountingEntriesSheet(workbook, result, version, schemaVersion) {
    const sheet = workbook.addWorksheet("Other Accounting Entries");
    setMetadata(sheet, result, version, schemaVersion, "OTHER ACCOUNTING ENTRIES SUPPORTING MANAGEMENT P&L");
    sheet.getRow(8).values = ["Accounting Entry ID", "Accounting Date", "Accounting Head", "Business Segment", "Effect", "Amount", "P&L Effect", "Reference No.", "Remarks", "Entry Type", "Original Entry ID", "Reversed By ID", "Store Code", "Posted At"];
    setHeader(sheet.getRow(8));
    const selected = result.metadata.businessSegment;
    const entries = (result.selectedSummary.otherAccounting?.rows || [])
        .filter(entry => selected === "ALL" || entry.business_segment === selected || entry.business_segment === "COMMON")
        .sort((left, right) => left.accounting_date.localeCompare(right.accounting_date) || left.entry_code.localeCompare(right.entry_code));
    entries.forEach((entry, index) => {
        const row = sheet.getRow(index + 9);
        const commonNotAllocated = selected !== "ALL" && entry.business_segment === "COMMON";
        row.values = [entry.entry_code, entry.accounting_date, entry.accounting_head, entry.business_segment,
            entry.adjustment_effect || "", Number(entry.amount_paise) / 100, commonNotAllocated ? "NOT ALLOCATED" : Number(entry.pnl_effect_paise) / 100,
            entry.reference_no || "", entry.remarks || "", entry.reverses_entry_code ? "REVERSAL" : entry.reversed_by_entry_code ? "POSTED — REVERSED" : "POSTED",
            entry.reverses_entry_code || "", entry.reversed_by_entry_code || "", entry.store_code || result.metadata.store.storeCode, entry.posted_at || ""];
        row.getCell(6).numFmt = MONEY_FORMAT;
        row.getCell(7).numFmt = MONEY_FORMAT;
    });
    const totalRow = entries.length + 9;
    sheet.getCell(totalRow, 6).value = "TOTAL IN-SCOPE P&L EFFECT";
    if (entries.length) addFormula(sheet.getCell(totalRow, 7), `SUM(G9:G${totalRow - 1})`);
    else sheet.getCell(totalRow, 7).value = 0;
    sheet.getCell(totalRow, 7).numFmt = MONEY_FORMAT;
    sheet.getRow(totalRow).font = { bold: true };
    [22, 15, 34, 18, 18, 17, 17, 24, 44, 19, 22, 22, 16, 28].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.views = [{ state: "frozen", xSplit: 4, ySplit: 8, topLeftCell: "E9" }];
    return sheet;
}

function styleWorkbook(workbook) {
    workbook.calcProperties.fullCalcOnLoad = true;
    workbook.calcProperties.forceFullCalc = true;
    for (const sheet of workbook.worksheets) {
        sheet.properties.defaultRowHeight = 19;
        sheet.eachRow(row => row.eachCell(cell => {
            if (!cell.alignment) cell.alignment = { vertical: "middle" };
        }));
    }
}

async function createManagementPnlWorkbook(result, { version = "", schemaVersion = "" } = {}) {
    if (!result?.metadata?.store?.storeCode || !Array.isArray(result.months) || !result.selectedSummary || !result.comparisonSummary || !result.postedExpenseDetails) {
        throw new Error("A complete authoritative Management P&L Financial Year result is required for export.");
    }
    COGS_ROWS.grossProfitAvailable = 17;
    COGS_ROWS.operatingAvailable = 18;
    COGS_ROWS.expensesAvailable = 19;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KLBS";
    workbook.subject = "Management P&L Financial Year Export";
    workbook.created = new Date(result.metadata.generatedAt);
    buildManagementSheet(workbook, result, version, schemaVersion);
    buildBridgeSheet(workbook, result, version, schemaVersion);
    buildCogsSheet(workbook, result, version, schemaVersion);
    buildExpenseSheet(workbook, result, version, schemaVersion);
    buildQualitySheet(workbook, result, version, schemaVersion);
    buildAccountingEntriesSheet(workbook, result, version, schemaVersion);
    styleWorkbook(workbook);
    return workbook;
}

function managementPnlFilename(storeCode, financialYearLabel, date) {
    const year = String(financialYearLabel || "").match(/^(?:FY\s*)?(\d{4})-(\d{2,4})$/);
    if (!/^[A-Z0-9]{2,12}$/.test(String(storeCode || "")) || !year) throw new Error("A valid Store Code and Financial Year are required for the export filename.");
    return `KLBS_${storeCode}_Management_PnL_FY${year[1]}-${year[2].slice(-2)}_${date}.xlsx`;
}

async function exportManagementPnlFinancialYear(result, filePath, options = {}) {
    if (typeof filePath !== "string" || !filePath.trim()) throw new Error("A destination file path is required.");
    const workbook = await createManagementPnlWorkbook(result, options);
    await workbook.xlsx.writeFile(filePath);
    return { success: true, filePath, sheetNames: workbook.worksheets.map(sheet => sheet.name) };
}

module.exports = { createManagementPnlWorkbook, exportManagementPnlFinancialYear, managementPnlFilename, MONEY_FORMAT, PERCENT_FORMAT, VARIANCE_PERCENT_FORMAT };
