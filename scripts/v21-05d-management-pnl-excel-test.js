"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ExcelJS = require("exceljs");
const {
    createManagementPnlWorkbook,
    exportManagementPnlFinancialYear,
    managementPnlFilename,
    MONEY_FORMAT,
    PERCENT_FORMAT,
    VARIANCE_PERCENT_FORMAT
} = require("../src/database/managementPnlExcelExporter");

const categories = [
    "Rent", "Electricity", "Internet & Communication", "Salary & Wages", "Staff Welfare",
    "Marketing & Advertising", "Maintenance & Repairs", "Cleaning & Housekeeping", "Packaging",
    "Stationery & Printing", "Transport & Local Conveyance", "Freight & Courier", "Bank & Payment Charges",
    "Software & Subscriptions", "Professional Fees", "Licences & Statutory Fees", "Security & Surveillance",
    "Insurance", "Petty Cash / General Expense", "Miscellaneous"
];
const groupRows = [
    ["Employee Costs", ["Salary & Wages", "Staff Welfare"]],
    ["Occupancy", ["Rent", "Security & Surveillance", "Insurance"]],
    ["Utilities & Communications", ["Electricity", "Internet & Communication"]],
    ["Marketing", ["Marketing & Advertising"]],
    ["Operating / Store Support", ["Maintenance & Repairs", "Cleaning & Housekeeping", "Packaging", "Transport & Local Conveyance", "Freight & Courier"]],
    ["Administrative & Professional", ["Stationery & Printing", "Software & Subscriptions", "Professional Fees", "Licences & Statutory Fees", "Petty Cash / General Expense", "Miscellaneous"]],
    ["Payment Charges", ["Bank & Payment Charges"]]
];

function expenseGroups(rentPaise = 1000) {
    return groupRows.map(([name, groupCategories]) => ({
        name, categories: groupCategories,
        amountPaise: groupCategories.includes("Rent") ? rentPaise : 0,
        expenseCount: groupCategories.includes("Rent") && rentPaise ? 1 : 0
    }));
}

function summary({ segment = "ALL", incomplete = false, netSales = 10000, rentPaise = 1000 } = {}) {
    const cogs = {
        capturedSaleCogsPaise: 4000, capturedReturnCogsReversalPaise: 0, netCapturedCogsPaise: 4000,
        capturedNetSalesPaise: incomplete ? 7000 : 10000,
        unknownNetSalesPaise: incomplete ? 3000 : 0,
        notApplicableNetSalesPaise: 0,
        eligibleNetSalesPaise: 10000,
        costCoveragePercent: incomplete ? 70 : 100,
        coverageStatus: incomplete ? "INCOMPLETE" : "COMPLETE",
        fullGrossProfitAvailable: !incomplete,
        fullGrossProfitPaise: incomplete ? null : 6000,
        fullGrossMarginPercent: incomplete ? null : 60
    };
    const categoriesOut = categories.map(category => ({ category, amountPaise: category === "Rent" ? rentPaise : 0, expenseCount: category === "Rent" && rentPaise ? 1 : 0 }));
    const expenses = {
        available: true, totalOperatingExpensesPaise: rentPaise, directOperatingExpensesPaise: rentPaise,
        commonOperatingExpensesPaise: 0, categories: categoriesOut, managementGroups: expenseGroups(rentPaise),
        commonCategories: categoriesOut.map(row => ({ ...row, amountPaise: 0, expenseCount: 0 }))
    };
    const operatingAvailable = !incomplete;
    return {
        revenue: {
            available: true, grossBillingsInclGstPaise: netSales + 2000,
            discountsInclGstEffectPaise: 1000, completedReturnNetReversalPaise: 0,
            netGstOnSalesPaise: 1000, netSalesExGstPaise: netSales,
            salesTaxableBeforeReturnsPaise: netSales, salesGstPaise: 1000,
            salesNetInclGstPaise: netSales + 1000,
            completedReturnGrossReversalPaise: 0, completedReturnDiscountReversalPaise: 0,
            completedReturnTaxableReversalPaise: 0, completedReturnGstReversalPaise: 0,
            saleLineCount: 1, returnLineCount: 0, grossCompatibilityAppliedCount: 0
        },
        cogs,
        expenses,
        operatingResult: {
            operatingProfitAvailable: operatingAvailable,
            operatingProfitPaise: operatingAvailable ? 5000 : null,
            operatingMarginPercent: operatingAvailable ? 50 : null,
            segmentDirectOperatingResultAvailable: segment !== "ALL" && operatingAvailable,
            segmentDirectOperatingResultPaise: segment !== "ALL" && operatingAvailable ? 5000 : null,
            segmentDirectOperatingMarginPercent: segment !== "ALL" && operatingAvailable ? 50 : null
        },
        profitability: {
            available: !incomplete,
            ebitdaPaise: incomplete ? null : 5000, ebitdaMarginPercent: incomplete ? null : 50,
            depreciationPaise: 0, ebitaPaise: incomplete ? null : 5000, ebitaMarginPercent: incomplete ? null : 50,
            amortisationPaise: 0, ebitPaise: incomplete ? null : 5000, ebitMarginPercent: incomplete ? null : 50,
            interestIncomePaise: 100, otherNonOperatingIncomePaise: 200, totalOtherIncomePaise: 300,
            financeCostsPaise: 50, otherNonOperatingExpensePaise: 25, exceptionalAdjustmentPaise: 10,
            pbtPaise: incomplete ? null : 5235, pbtMarginPercent: incomplete ? null : 52.35,
            incomeTaxProvisionPaise: 100, patPaise: incomplete ? null : 5135, netProfitMarginPercent: incomplete ? null : 51.35
        },
        otherAccounting: { rows: [{ entry_code: "KLPAE000001", accounting_date: "2026-04-10", accounting_head: "INTEREST_INCOME",
            business_segment: "KL", adjustment_effect: null, amount_paise: 100, pnl_effect_paise: 100,
            reference_no: "REF-1", remarks: "Test", reverses_entry_code: null, reversed_by_entry_code: null, store_code: "KL001", posted_at: "2026-04-10T08:00:00Z" },
            { entry_code: "KLPAE000002", accounting_date: "2026-04-11", accounting_head: "INTEREST_FINANCE_CHARGES",
                business_segment: "COMMON", adjustment_effect: null, amount_paise: 300, pnl_effect_paise: -300,
                reference_no: "COMMON-1", remarks: "Common charge", reverses_entry_code: null, reversed_by_entry_code: null,
                store_code: "KL001", posted_at: "2026-04-11T08:00:00Z" }] },
        dataQuality: { warnings: [] },
        reconciliation: { expense: { reconciles: true } }
    };
}

function resultFixture({ segment = "ALL", incomplete = false, comparisonNetSales = 5000, completed = false } = {}) {
    const months = Array.from({ length: 12 }, (_, index) => {
        const future = !completed && index > 6;
        const result = summary({ segment, incomplete: incomplete && index === 2, netSales: index === 2 ? 0 : 10000, rentPaise: index === 0 ? 1000 : 0 });
        return { index, label: ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"][index], future,
            result: future ? null : result };
    });
    const selectedSummary = summary({ segment, incomplete, netSales: 60000, rentPaise: 1000 });
    const comparisonSummary = summary({ segment, netSales: comparisonNetSales, rentPaise: 500 });
    const detailRows = [{ expense_code: "KLEXP000001", batch_code: "KLEXPB000001", expense_date: "2026-04-10",
        category: "Rent", management_group: "Occupancy", business_segment: segment === "ALL" ? "COMMON" : segment,
        payment_mode: "Bank Transfer", reference: "RENT-APR", amount_paise: 1000,
        remarks: "April rent", posted_at: "2026-04-10T08:00:00.000Z" }];
    return {
        metadata: { store: { storeCode: "KL001", storeName: "Kaira Luxe" }, financialYearStart: 2026,
            financialYearLabel: "FY 2026-27", activeFinancialYear: !completed, asOfDate: "2026-10-07",
            businessSegment: segment, generatedAt: "2026-10-07T12:00:00.000Z" },
        months, selectedSummary, comparisonSummary,
        varianceByKey: {},
        postedExpenseDetails: { rows: detailRows, totalCount: 1, totalAmountPaise: 1000 }
    };
}

function rowByLabel(sheet, label) {
    for (let row = 9; row <= sheet.rowCount; row += 1) if (sheet.getCell(row, 1).value === label) return row;
    throw new Error(`Workbook row not found: ${label}`);
}

function columnNumber(letters) {
    return [...letters].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
}

function cellAddress(column, row) {
    let letters = "";
    while (column > 0) {
        const remainder = (column - 1) % 26;
        letters = String.fromCharCode(65 + remainder) + letters;
        column = Math.floor((column - 1) / 26);
    }
    return `${letters}${row}`;
}

function inspectFormulaGraph(workbook) {
    const formulas = new Map();
    const references = new Map();
    for (const sheet of workbook.worksheets) {
        sheet.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
            const formula = cell.value && typeof cell.value === "object" ? cell.value.formula : null;
            if (typeof formula !== "string") return;
            const source = `${sheet.name}!${cell.address}`;
            formulas.set(source, formula);
            let expression = formula.replace(/"(?:[^"]|"")*"/g, "");
            const ranges = [];
            const quotedSheetReference = /'((?:[^']|'')+)'!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g;
            expression = expression.replace(quotedSheetReference, (_match, escapedName, firstColumn, firstRow, lastColumn, lastRow) => {
                ranges.push({
                    sheetName: escapedName.replace(/''/g, "'"),
                    firstColumn: columnNumber(firstColumn), firstRow: Number(firstRow),
                    lastColumn: columnNumber(lastColumn || firstColumn), lastRow: Number(lastRow || firstRow)
                });
                return " ";
            });
            const localReference = /\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g;
            expression.replace(localReference, (_match, firstColumn, firstRow, lastColumn, lastRow) => {
                ranges.push({ sheetName: sheet.name, firstColumn: columnNumber(firstColumn), firstRow: Number(firstRow),
                    lastColumn: columnNumber(lastColumn || firstColumn), lastRow: Number(lastRow || firstRow) });
                return _match;
            });
            references.set(source, ranges);
        }));
    }
    const formulasBySheet = Object.fromEntries(workbook.worksheets.map(sheet => [sheet.name, 0]));
    for (const source of formulas.keys()) formulasBySheet[source.slice(0, source.lastIndexOf("!"))] += 1;

    const edges = new Map([...formulas.keys()].map(source => [source, []]));
    for (const [source, ranges] of references) {
        for (const range of ranges) {
            const sheet = workbook.getWorksheet(range.sheetName);
            assert(sheet, `${source} refers to missing worksheet ${range.sheetName}`);
            assert(range.firstRow > 0 && range.firstColumn > 0 && range.lastRow >= range.firstRow && range.lastColumn >= range.firstColumn,
                `${source} has invalid formula range`);
            assert(range.lastRow <= sheet.rowCount && range.lastColumn <= sheet.columnCount,
                `${source} refers outside ${sheet.name} worksheet bounds`);
            for (let row = range.firstRow; row <= range.lastRow; row += 1) {
                for (let column = range.firstColumn; column <= range.lastColumn; column += 1) {
                    const target = `${sheet.name}!${cellAddress(column, row)}`;
                    if (formulas.has(target)) edges.get(source).push(target);
                }
            }
        }
    }

    const cycles = [];
    const complete = new Set();
    const stack = [];
    const active = new Set();
    function visit(node) {
        if (active.has(node)) {
            const start = stack.indexOf(node);
            cycles.push([...stack.slice(start), node]);
            return;
        }
        if (complete.has(node)) return;
        active.add(node);
        stack.push(node);
        for (const dependency of edges.get(node) || []) visit(dependency);
        stack.pop();
        active.delete(node);
        complete.add(node);
    }
    for (const node of formulas.keys()) visit(node);
    return { formulas, references, edges, cycles, formulasBySheet };
}

function assertAcyclicWorkbook(workbook) {
    const audit = inspectFormulaGraph(workbook);
    assert(audit.formulas.size > 0, "formula graph inspects formula cells throughout the workbook");
    assert.deepStrictEqual(audit.cycles, [], `workbook formula dependency graph must be acyclic: ${JSON.stringify(audit.cycles)}`);
    for (const [address, formula] of audit.formulas) {
        assert.doesNotMatch(formula, /#(?:REF!|NAME\?|VALUE!|DIV\/0!)/i, `${address} must not contain an Excel error reference`);
    }
    return audit;
}

async function main() {
    const fixture = resultFixture();
    const workbook = await createManagementPnlWorkbook(fixture, { version: "2.0.0", schemaVersion: 9 });
    assert.deepStrictEqual(workbook.worksheets.map(sheet => sheet.name), [
        "Management P&L", "Sales & GST Bridge", "COGS Coverage", "Posted Expenses", "Data Quality", "Other Accounting Entries"
    ]);
    const pnl = workbook.getWorksheet("Management P&L");
    const formulaAudit = assertAcyclicWorkbook(workbook);
    assert.strictEqual(pnl.getCell("B2").value, "KL001");
    assert.strictEqual(pnl.getCell("D2").value, "Kaira Luxe");
    assert.strictEqual(pnl.getCell("F2").value, "FY 2026-27");
    assert.strictEqual(pnl.getCell("B3").value, "ALL");
    assert.strictEqual(pnl.getCell("D3").value, "2026-10-07");
    assert.strictEqual(pnl.getCell("B4").value, "2.0.0");
    assert.strictEqual(pnl.getCell("D4").value, 9);
    assert.strictEqual(managementPnlFilename("KL001", "FY 2026-27", "2026-10-07"),
        "KLBS_KL001_Management_PnL_FY2026-27_2026-10-07.xlsx");

    const netSalesRow = rowByLabel(pnl, "NET SALES (EXCL. GST)");
    const netCogsRow = rowByLabel(pnl, "NET CAPTURED COGS");
    assert.match(pnl.getCell(`B${netSalesRow}`).value.formula, /B\d+-B\d+-B\d+-B\d+/);
    assert.match(pnl.getCell(`N${netSalesRow}`).value.formula, /COUNT\(N\d+,N\d+,N\d+,N\d+\)=4/);
    assert.match(pnl.getCell(`B${netCogsRow}`).value.formula, /B\d+-B\d+/);
    const groupRow = rowByLabel(pnl, "Occupancy");
    assert.match(pnl.getCell(`B${groupRow}`).value.formula, /SUM\(/);
    const totalExpenseRow = rowByLabel(pnl, "TOTAL OPERATING EXPENSES");
    assert.match(pnl.getCell(`N${totalExpenseRow}`).value.formula, /SUM\(/);
    assert.match(pnl.getCell(`N${totalExpenseRow}`).value.formula, /COGS Coverage/);
    assert.match(pnl.getCell(`P${netSalesRow}`).value.formula, /N\d+-O\d+/);
    assert.match(pnl.getCell(`Q${netSalesRow}`).value.formula, /O\d+=0/);
    assert.match(pnl.getCell(`Q${netSalesRow}`).value.formula, /P\d+\/O\d+/);
    const grossRow = rowByLabel(pnl, "GROSS PROFIT");
    const operatingRow = rowByLabel(pnl, "EBIT / OPERATING PROFIT");
    const opexRow = rowByLabel(pnl, "TOTAL OPERATING EXPENSES");
    const ebitdaRow = rowByLabel(pnl, "EBITDA");
    const depreciationRow = rowByLabel(pnl, "Depreciation");
    const ebitaRow = rowByLabel(pnl, "EBITA");
    const amortisationRow = rowByLabel(pnl, "Amortisation");
    const otherIncomeRow = rowByLabel(pnl, "TOTAL OTHER INCOME");
    const financeDetailRow = rowByLabel(pnl, "Interest / Finance Charges");
    const financeCostRow = rowByLabel(pnl, "TOTAL FINANCE COSTS");
    const otherExpenseRow = rowByLabel(pnl, "Other Non-Operating Expense");
    const adjustmentRow = rowByLabel(pnl, "Exceptional / Adjustment Items");
    const pbtRow = rowByLabel(pnl, "PBT");
    const taxRow = rowByLabel(pnl, "Income Tax / Tax Provision");
    const patRow = rowByLabel(pnl, "PAT / NET PROFIT");
    assert.match(pnl.getCell(`B${grossRow}`).value.formula, /COGS Coverage/);
    assert.match(pnl.getCell(`B${operatingRow}`).value.formula, /COGS Coverage/);
    assert.match(pnl.getCell(`B${ebitdaRow}`).value.formula, new RegExp(`B${grossRow}-B${opexRow}`));
    assert.match(pnl.getCell(`B${ebitaRow}`).value.formula, new RegExp(`B${ebitdaRow}-B${depreciationRow}`));
    assert.match(pnl.getCell(`B${operatingRow}`).value.formula, new RegExp(`B${ebitaRow}-B${amortisationRow}`));
    assert.strictEqual(pnl.getCell(`B${financeCostRow}`).value.formula, `B${financeDetailRow}`);
    assert.strictEqual(pnl.getCell(`N${financeCostRow}`).value.formula, `N${financeDetailRow}`);
    assert.match(pnl.getCell(`B${pbtRow}`).value.formula, new RegExp(`B${operatingRow}\\+B${otherIncomeRow}-B${financeCostRow}-B${otherExpenseRow}\\+B${adjustmentRow}`));
    assert.match(pnl.getCell(`B${patRow}`).value.formula, new RegExp(`B${pbtRow}-B${taxRow}`));
    for (const [label, numerator] of [["EBITDA MARGIN %", ebitdaRow], ["EBITA MARGIN %", ebitaRow],
        ["EBIT / OPERATING PROFIT MARGIN %", operatingRow], ["PBT MARGIN %", pbtRow], ["NET PROFIT MARGIN %", patRow]]) {
        const marginRow = rowByLabel(pnl, label);
        assert.match(pnl.getCell(`B${marginRow}`).value.formula, new RegExp(`B${numerator}\\/B${rowByLabel(pnl, "NET SALES (EXCL. GST)")}\\*100`));
    }
    assert.match(pnl.getCell(`N${patRow}`).value.formula, new RegExp(`N${pbtRow}-N${taxRow}`), "FYTD PAT uses the FYTD formula inputs");
    assert.match(pnl.getCell(`P${patRow}`).value.formula, /N\d+-O\d+/, "variance amount is derived from FYTD and Last FYTD");
    assert.match(pnl.getCell(`Q${patRow}`).value.formula, /O\d+=0/, "variance percentage guards zero prior-period denominator");
    assert.strictEqual(pnl.getCell(`I${patRow}`).value, "—", "future PAT month is not a numeric zero");
    assert.strictEqual(pnl.getCell(`I${rowByLabel(pnl, "Gross Billings (incl. GST)")}`).value, "—", "future months are not numeric zero");
    assert.strictEqual(pnl.getCell(`B${netSalesRow}`).numFmt, MONEY_FORMAT);
    assert.strictEqual(pnl.getCell(`B${rowByLabel(pnl, "Cost Coverage")}`).numFmt, PERCENT_FORMAT);
    assert.strictEqual(pnl.getCell(`Q${netSalesRow}`).numFmt, VARIANCE_PERCENT_FORMAT);
    assert.strictEqual(pnl.views[0].state, "frozen");
    assert.strictEqual(pnl.views[0].xSplit, 1);
    assert.strictEqual(pnl.views[0].ySplit, 8);
    assert(pnl.conditionalFormattings.length > 0, "business-impact variance formatting is present");
    console.log(`PASS workbook formula graph: ${formulaAudit.formulas.size} formula cells across ${workbook.worksheets.length} sheets; no invalid refs or cycles`);

    const cycleProbes = [
        [[pnl.getCell(`B${financeCostRow}`), `B${financeCostRow}`]],
        [[pnl.getCell(`C${financeCostRow}`), `SUM(C${financeDetailRow}:C${financeCostRow})`]],
        [[pnl.getCell(`D${financeDetailRow}`), `D${financeCostRow}`], [pnl.getCell(`D${financeCostRow}`), `D${financeDetailRow}`]],
        [[pnl.getCell(`E${financeCostRow}`), `'COGS Coverage'!E18`],
            [workbook.getWorksheet("COGS Coverage").getCell("E18"), `'Management P&L'!E${financeCostRow}`]]
    ];
    for (const assignments of cycleProbes) {
        const originals = assignments.map(([cell]) => cell.value);
        assignments.forEach(([cell, formula]) => { cell.value = { formula }; });
        assert.throws(() => assertAcyclicWorkbook(workbook), /dependency graph must be acyclic/,
            "cycle detector rejects direct, range, indirect, and cross-sheet cycles");
        assignments.forEach(([cell], index) => { cell.value = originals[index]; });
        assertAcyclicWorkbook(workbook);
    }

    const bridge = workbook.getWorksheet("Sales & GST Bridge");
    assert.strictEqual(bridge.getCell("B9").value, 120, "bridge monthly gross source matches service input");
    assert.strictEqual(bridge.getCell("B10").value, 10, "bridge monthly discount source matches service input");
    assert.strictEqual(bridge.getCell("B12").value, 10, "bridge monthly GST source matches service input");
    assert.strictEqual(bridge.getCell("B20").value, 100, "bridge monthly Net Sales source matches service input");
    assert.strictEqual(bridge.getCell("N20").value, 600, "bridge FYTD net sales source matches service summary");
    const cogs = workbook.getWorksheet("COGS Coverage");
    assert.strictEqual(cogs.getCell("B9").value, 40, "COGS sheet monthly captured cost matches service input");
    assert.strictEqual(cogs.getCell("B12").value, 100, "COGS sheet monthly captured Net Sales matches service input");
    assert.strictEqual(cogs.getCell("B17").value, "AVAILABLE");
    assert.strictEqual(cogs.getCell("N17").value, "AVAILABLE");
    const expenses = workbook.getWorksheet("Posted Expenses");
    assert.strictEqual(expenses.getCell("A11").value, "KLEXP000001");
    assert.strictEqual(expenses.getCell("E11").value, "Occupancy");
    assert.strictEqual(expenses.getCell("I11").value, 10);
    assert.match(expenses.getCell("I12").value.formula, /SUM\(I11:I11\)/);
    assert.strictEqual(expenses.getCell("B8").value, 10, "posted expense sheet total metadata matches selected P&L expense total");
    const accounting = workbook.getWorksheet("Other Accounting Entries");
    assert.strictEqual(accounting.getCell("A9").value, "KLPAE000001");
    assert.strictEqual(accounting.getCell("G9").value, 1);
    assert.strictEqual(accounting.getCell("A2").value, "Store Code");
    for (const sheet of [workbook.getWorksheet("Sales & GST Bridge"), workbook.getWorksheet("COGS Coverage"), accounting]) {
        assert.strictEqual(sheet.getCell("D2").value, "Kaira Luxe");
        assert.strictEqual(sheet.getCell("B3").value, "ALL");
        assert.strictEqual(sheet.getCell("D3").value, "2026-10-07");
        assert.strictEqual(sheet.getCell("D4").value, 9);
    }
    for (const sheet of [expenses, workbook.getWorksheet("Data Quality")]) {
        assert.strictEqual(sheet.getCell("M2").value, "Store Code");
        assert.strictEqual(sheet.getCell("N2").value, "KL001");
        assert.strictEqual(sheet.getCell("M5").value, "Schema Version");
        assert.strictEqual(sheet.getCell("N5").value, 9);
    }

    const incomplete = await createManagementPnlWorkbook(resultFixture({ incomplete: true, comparisonNetSales: 0 }), { version: "2.0.0", schemaVersion: 9 });
    assertAcyclicWorkbook(incomplete);
    const incompletePnl = incomplete.getWorksheet("Management P&L");
    const incompleteGrossRow = rowByLabel(incompletePnl, "GROSS PROFIT");
    const incompleteOpRow = rowByLabel(incompletePnl, "EBIT / OPERATING PROFIT");
    assert.match(incompletePnl.getCell(`D${incompleteGrossRow}`).value.formula, /AVAILABLE.*N\/A/);
    assert.match(incompletePnl.getCell(`D${incompleteOpRow}`).value.formula, /AVAILABLE.*N\/A/);
    assert.match(incompletePnl.getCell(`D${rowByLabel(incompletePnl, "EBIT / OPERATING PROFIT MARGIN %")}`).value.formula, /ISNUMBER.*IFERROR.*N\/A/);
    assert.match(incompletePnl.getCell(`N${incompleteGrossRow}`).value.formula, /AVAILABLE.*N\/A/);
    assert.match(incompletePnl.getCell(`N${incompleteOpRow}`).value.formula, /AVAILABLE.*N\/A/);
    assert.match(incompletePnl.getCell(`N${rowByLabel(incompletePnl, "GROSS MARGIN")}`).value.formula, /AVAILABLE.*IFERROR.*N\/A/);
    assert.match(incompletePnl.getCell(`N${rowByLabel(incompletePnl, "EBIT / OPERATING PROFIT MARGIN %")}`).value.formula, /ISNUMBER.*IFERROR.*N\/A/);
    for (const label of ["EBITDA", "EBITA", "EBIT / OPERATING PROFIT", "PBT", "PAT / NET PROFIT"]) {
        assert.match(incompletePnl.getCell(`N${rowByLabel(incompletePnl, label)}`).value.formula, /COGS Coverage.*N\/A/,
            `${label} remains guarded when cost completeness is unavailable`);
    }
    assert.strictEqual(incompletePnl.getCell(`O${incompleteGrossRow}`).value, 60, "prior FYTD remains sourced from its own complete comparison result");
    assert.match(incompletePnl.getCell(`Q${netSalesRow}`).value.formula, /O\d+=0/);
    const zeroProfitFixture = resultFixture();
    zeroProfitFixture.months[4].result.cogs.capturedSaleCogsPaise = 10000;
    zeroProfitFixture.months[4].result.cogs.netCapturedCogsPaise = 10000;
    zeroProfitFixture.months[4].result.cogs.fullGrossProfitPaise = 0;
    zeroProfitFixture.months[4].result.cogs.fullGrossMarginPercent = 0;
    zeroProfitFixture.months[4].result.operatingResult.operatingProfitPaise = 0;
    zeroProfitFixture.months[4].result.operatingResult.operatingMarginPercent = 0;
    const zeroProfitMonth = await createManagementPnlWorkbook(zeroProfitFixture, { version: "2.0.0", schemaVersion: 9 });
    assertAcyclicWorkbook(zeroProfitMonth);
    const zeroProfitSheet = zeroProfitMonth.getWorksheet("Management P&L");
    const zeroProfitGross = rowByLabel(zeroProfitSheet, "GROSS PROFIT");
    const zeroProfitOperating = rowByLabel(zeroProfitSheet, "EBIT / OPERATING PROFIT");
    assert.match(zeroProfitSheet.getCell(`F${zeroProfitGross}`).value.formula, /AVAILABLE.*F\d+-F\d+/,
        "complete month keeps formula-driven numeric zero available when source arithmetic yields zero");
    assert.match(zeroProfitSheet.getCell(`F${zeroProfitOperating}`).value.formula, /AVAILABLE.*F\d+-F\d+/);

    const segmentWorkbook = await createManagementPnlWorkbook(resultFixture({ segment: "MENS" }), { version: "2.0.0", schemaVersion: 9 });
    assertAcyclicWorkbook(segmentWorkbook);
    assert.strictEqual(segmentWorkbook.getWorksheet("Management P&L").getCell("B3").value, "MENS");
    assert.notStrictEqual(rowByLabel(segmentWorkbook.getWorksheet("Management P&L"), "COMMON EXPENSES — NOT ALLOCATED"), 0);
    const segmentAccounting = segmentWorkbook.getWorksheet("Other Accounting Entries");
    assert.strictEqual(segmentAccounting.getCell("A9").value, "KLPAE000002");
    assert.strictEqual(segmentAccounting.getCell("G9").value, "NOT ALLOCATED", "COMMON detail is disclosed but excluded from selected-segment P&L effect");

    const completedWorkbook = await createManagementPnlWorkbook(resultFixture({ completed: true }), { version: "2.0.0", schemaVersion: 9 });
    assertAcyclicWorkbook(completedWorkbook);
    assert.strictEqual(completedWorkbook.getWorksheet("Management P&L").getCell("N8").value, "FY TOTAL");
    assert.strictEqual(completedWorkbook.getWorksheet("Management P&L").getCell("O8").value, "Last FY");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-v21-05d-"));
    try {
        const filename = managementPnlFilename("KL001", fixture.metadata.financialYearLabel, "2026-10-07");
        const filePath = path.join(tempDir, filename);
        const exported = await exportManagementPnlFinancialYear(fixture, filePath, { version: "2.0.0", schemaVersion: 9 });
        assert.strictEqual(exported.success, true);
        const reopened = new ExcelJS.Workbook();
        await reopened.xlsx.readFile(filePath);
        assertAcyclicWorkbook(reopened);
        assert.deepStrictEqual(reopened.worksheets.map(sheet => sheet.name), workbook.worksheets.map(sheet => sheet.name));
        assert(reopened.getWorksheet("Management P&L").getCell(`B${netSalesRow}`).value.formula);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
    console.log("V21-05D Management P&L formula-driven Excel workbook contracts: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
