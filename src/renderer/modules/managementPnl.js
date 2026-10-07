"use strict";

(function initializeManagementPnl() {
    const $ = id => document.getElementById(id);
    const screen = $("managementPnlScreen");
    if (!screen) return;

    const state = { requestId: 0, initialized: false, financialYearStart: null, currentFinancialYearStart: null, result: null, expandedGroups: new Set() };
    let exporting = false;
    const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const percent = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const months = ["APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "JAN", "FEB", "MAR"];
    const groups = [
        "Employee Costs", "Occupancy", "Utilities & Communications", "Marketing",
        "Operating / Store Support", "Administrative & Professional", "Payment Charges"
    ];
    const displayAmount = value => value === null || value === undefined ? "NOT AVAILABLE" : currency.format(Number(value) / 100);
    const displayPercent = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? "NOT AVAILABLE" : `${percent.format(Number(value))}%`;
    const displayMonthAmount = value => value === null || value === undefined ? "N/A" : currency.format(Number(value) / 100);
    const displayMonthPercent = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? "N/A" : `${percent.format(Number(value))}%`;
    const dateLabel = value => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
        return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
    };

    function setVisible(id, visible) { $(id).hidden = !visible; }

    function resetScreenSession() {
        state.expandedGroups.clear();
        const wrap = $("managementPnlTableWrap");
        wrap.scrollTop = 0;
        wrap.scrollLeft = 0;
    }

    function showLoading() {
        setVisible("managementPnlLoading", true);
        setVisible("managementPnlError", false);
        setVisible("managementPnlEmpty", false);
        setVisible("managementPnlTableWrap", false);
        $("managementPnlQualityStrip").replaceChildren(Object.assign(document.createElement("span"), { className: "is-neutral", textContent: "Reading authoritative accounting data…" }));
    }

    function showError(message) {
        $("managementPnlErrorMessage").textContent = message || "Management P&L could not be loaded.";
        setVisible("managementPnlLoading", false);
        setVisible("managementPnlError", true);
        setVisible("managementPnlEmpty", false);
        setVisible("managementPnlTableWrap", false);
    }

    function getValue(result, key) {
        if (!result) return null;
        const revenue = result.revenue;
        const cogs = result.cogs;
        const expenses = result.expenses;
        const operating = result.operatingResult;
        if (["gross", "discounts", "returns", "netGst", "netSales"].includes(key) && revenue.available === false) return null;
        const map = {
            gross: revenue.grossBillingsInclGstPaise,
            discounts: revenue.discountsInclGstEffectPaise,
            returns: revenue.completedReturnNetReversalPaise,
            netGst: revenue.netGstOnSalesPaise,
            netSales: revenue.netSalesExGstPaise,
            saleCogs: cogs.capturedSaleCogsPaise,
            returnCogs: cogs.capturedReturnCogsReversalPaise,
            netCogs: cogs.netCapturedCogsPaise,
            capturedSales: cogs.capturedNetSalesPaise,
            unknownSales: cogs.unknownNetSalesPaise,
            vvpSales: cogs.notApplicableNetSalesPaise,
            coverage: cogs.costCoveragePercent,
            grossProfit: cogs.fullGrossProfitAvailable ? cogs.fullGrossProfitPaise : null,
            grossMargin: cogs.fullGrossProfitAvailable ? cogs.fullGrossMarginPercent : null,
            totalExpenses: expenses.available === false ? null : expenses.totalOperatingExpensesPaise,
            commonExpenses: expenses.commonOperatingExpensesPaise,
            operatingResult: operating.operatingProfitAvailable === true ? operating.operatingProfitPaise :
                operating.segmentDirectOperatingResultAvailable === true ? operating.segmentDirectOperatingResultPaise : null,
            operatingMargin: operating.operatingProfitAvailable === true ? operating.operatingMarginPercent :
                operating.segmentDirectOperatingResultAvailable === true ? operating.segmentDirectOperatingMarginPercent : null
        };
        if (key.startsWith("group:")) return expenses.managementGroups.find(row => row.name === key.slice(6))?.amountPaise ?? null;
        if (key.startsWith("category:")) return expenses.categories.find(row => row.category === key.slice(9))?.amountPaise ?? null;
        return map[key] ?? null;
    }

    function line(label, key, options = {}) { return { label, key, ...options }; }

    function statementRows() {
        const rows = [
            { section: "REVENUE" },
            line("Gross Billings (incl. GST)", "gross", { varianceKey: "gross" }),
            line("Less: Discounts", "discounts", { varianceKey: "discounts", favorableWhen: "LOWER" }),
            line("Less: Sales Returns", "returns", { varianceKey: "returns", favorableWhen: "LOWER" }),
            line("Less: Net GST", "netGst", { varianceKey: "netGst", favorableWhen: "LOWER" }),
            line("NET SALES (EXCL. GST)", "netSales", { total: true, varianceKey: "netSales", favorableWhen: "HIGHER" }),
            { section: "COST OF GOODS SOLD" },
            line("Captured Sale COGS", "saleCogs", { varianceKey: "saleCogs", favorableWhen: "LOWER" }),
            line("Less: Return COGS Reversal", "returnCogs", { varianceKey: "returnCogs", favorableWhen: "LOWER" }),
            line("NET CAPTURED COGS", "netCogs", { total: true, varianceKey: "netCogs", favorableWhen: "LOWER" }),
            line("Captured-cost Net Sales", "capturedSales", { varianceKey: "capturedSales", diagnostic: true }),
            line("Unknown-cost Net Sales", "unknownSales", { varianceKey: "unknownSales", diagnostic: true }),
            line("VVP / Cost Pending Net Sales", "vvpSales", { varianceKey: "vvpSales", diagnostic: true }),
            line("Cost Coverage", "coverage", { percentValue: true, varianceKey: "coverage", diagnostic: true }),
            line("GROSS PROFIT", "grossProfit", { total: true, varianceKey: "grossProfit", favorableWhen: "HIGHER" }),
            line("GROSS MARGIN", "grossMargin", { total: true, percentValue: true, varianceKey: "grossMargin", favorableWhen: "HIGHER" }),
            { section: "OPERATING EXPENSES" },
            ...groups.map(name => ({ group: name, key: `group:${name}`, varianceKey: `group:${name}`, favorableWhen: "LOWER" })),
            line("TOTAL OPERATING EXPENSES", "totalExpenses", { total: true, varianceKey: "totalExpenses", favorableWhen: "LOWER" }),
            { section: "OPERATING RESULT" },
            line("OPERATING PROFIT", "operatingResult", { total: true, varianceKey: "operatingResult", favorableWhen: "HIGHER" }),
            line("OPERATING MARGIN", "operatingMargin", { total: true, percentValue: true, varianceKey: "operatingMargin", favorableWhen: "HIGHER" })
        ];
        if ($("managementPnlSegment").value !== "ALL") {
            rows.splice(rows.findIndex(row => row.section === "OPERATING RESULT"), 0,
                line("COMMON EXPENSES — NOT ALLOCATED", "commonExpenses", { varianceKey: "commonExpenses", favorableWhen: "LOWER" }));
        }
        return rows;
    }

    function formatVariance(variance, percentColumn, percentagePoint) {
        if (!variance) return "—";
        const value = percentColumn ? variance.percent : variance.amount;
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
        const sign = value > 0 ? "+" : value < 0 ? "−" : "";
        if (percentColumn) return `${sign}${percent.format(Math.abs(value))}%`;
        if (percentagePoint) return `${sign}${percent.format(Math.abs(value))} pp`;
        return `${sign}${currency.format(Math.abs(value) / 100)}`;
    }

    function appendCell(row, text, className = "") {
        const cell = document.createElement("td");
        cell.textContent = text;
        if (className) cell.className = className;
        row.appendChild(cell);
        return cell;
    }

    function varianceClass(variance) {
        if (!variance || variance.favorable === null || variance.favorable === undefined) return "variance-neutral";
        return variance.favorable ? "variance-favorable" : "variance-unfavorable";
    }

    function renderStatement(result, { preserveViewport = false, focusGroup = null } = {}) {
        const wrap = $("managementPnlTableWrap");
        const previousButton = focusGroup ? [...$("managementPnlTableBody").querySelectorAll(".management-pnl-group-toggle")]
            .find(button => button.dataset.group === focusGroup) : null;
        const previousGroupTop = previousButton?.closest("tr")?.getBoundingClientRect().top ?? null;
        const viewport = preserveViewport ? { top: wrap.scrollTop, left: wrap.scrollLeft, pageX: window.scrollX, pageY: window.scrollY } : null;
        const head = document.createElement("tr");
        const particular = document.createElement("th"); particular.scope = "col"; particular.className = "management-pnl-sticky-column management-pnl-sticky-header"; particular.textContent = "PARTICULAR"; head.appendChild(particular);
        for (const month of months) { const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = month; head.appendChild(cell); }
        for (const title of [result.metadata.activeFinancialYear ? "FYTD" : "FY TOTAL", result.metadata.activeFinancialYear ? "LAST FYTD" : "LAST FY", "VARIANCE AMOUNT", "VARIANCE %"]) {
            const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = title; head.appendChild(cell);
        }
        $("managementPnlTableHead").replaceChildren(head);
        const body = document.createElement("tbody");
        for (const descriptor of statementRows()) {
            if (descriptor.section) {
                const row = document.createElement("tr"); row.className = "management-pnl-section-row";
                const label = document.createElement("th"); label.scope = "rowgroup";
                label.className = "management-pnl-sticky-column management-pnl-section-label";
                label.textContent = descriptor.section; row.appendChild(label);
                const fill = document.createElement("td"); fill.colSpan = 16; fill.setAttribute("aria-hidden", "true"); row.appendChild(fill);
                body.appendChild(row); continue;
            }
            const isGroup = Boolean(descriptor.group);
            const row = document.createElement("tr");
            if (descriptor.total) row.classList.add("management-pnl-total-row");
            if (isGroup) row.classList.add("management-pnl-group-row");
            const labelCell = document.createElement("th"); labelCell.scope = "row"; labelCell.className = "management-pnl-sticky-column management-pnl-line-label";
            if (isGroup) {
                const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "management-pnl-group-toggle";
                toggle.dataset.group = descriptor.group; toggle.setAttribute("aria-expanded", state.expandedGroups.has(descriptor.group) ? "true" : "false");
                toggle.textContent = `${state.expandedGroups.has(descriptor.group) ? "⌄" : "›"} ${descriptor.group}`; labelCell.appendChild(toggle);
            } else labelCell.textContent = descriptor.label;
            row.appendChild(labelCell);
            for (const month of result.months) {
                const monthValue = month.future ? null : getValue(month.result, descriptor.key);
                const text = month.future ? "—" : descriptor.percentValue ? displayMonthPercent(monthValue) : displayMonthAmount(monthValue);
                appendCell(row, text, "management-pnl-number");
            }
            const currentValue = getValue(result.selectedSummary, descriptor.key);
            const priorValue = getValue(result.comparisonSummary, descriptor.key);
            appendCell(row, descriptor.percentValue ? displayPercent(currentValue) : displayAmount(currentValue), "management-pnl-number management-pnl-emphasis-cell");
            appendCell(row, descriptor.percentValue ? displayPercent(priorValue) : displayAmount(priorValue), "management-pnl-number");
            const variance = result.varianceByKey[descriptor.varianceKey];
            const varianceTone = descriptor.diagnostic ? "variance-neutral" : varianceClass(variance);
            appendCell(row, formatVariance(variance, false, Boolean(variance?.percentagePoint)), `management-pnl-number ${varianceTone}`);
            appendCell(row, formatVariance(variance, true, false), `management-pnl-number ${varianceTone}`);
            body.appendChild(row);
            if (isGroup && state.expandedGroups.has(descriptor.group)) {
                const categoryNames = result.selectedSummary.expenses.managementGroups.find(group => group.name === descriptor.group)?.categories || [];
                for (const categoryName of categoryNames) {
                    const category = line(categoryName, `category:${categoryName}`, { varianceKey: `category:${categoryName}`, favorableWhen: "LOWER" });
                    const categoryRow = document.createElement("tr"); categoryRow.className = "management-pnl-category-row";
                    const categoryLabel = document.createElement("th"); categoryLabel.scope = "row"; categoryLabel.className = "management-pnl-sticky-column management-pnl-line-label"; categoryLabel.textContent = `↳ ${category.label}`; categoryRow.appendChild(categoryLabel);
                    for (const month of result.months) {
                        const value = month.future ? null : getValue(month.result, category.key);
                        appendCell(categoryRow, month.future ? "—" : displayMonthAmount(value), "management-pnl-number");
                    }
                    appendCell(categoryRow, displayAmount(getValue(result.selectedSummary, category.key)), "management-pnl-number management-pnl-emphasis-cell");
                    appendCell(categoryRow, displayAmount(getValue(result.comparisonSummary, category.key)), "management-pnl-number");
                    const categoryVariance = result.varianceByKey[category.varianceKey];
                    const categoryTone = varianceClass(categoryVariance);
                    appendCell(categoryRow, formatVariance(categoryVariance, false, Boolean(categoryVariance?.percentagePoint)), `management-pnl-number ${categoryTone}`);
                    appendCell(categoryRow, formatVariance(categoryVariance, true, false), `management-pnl-number ${categoryTone}`);
                    body.appendChild(categoryRow);
                }
            }
        }
        $("managementPnlTableBody").replaceChildren(...body.childNodes);
        if (viewport) {
            wrap.scrollTop = viewport.top;
            wrap.scrollLeft = viewport.left;
            const currentButton = [...$("managementPnlTableBody").querySelectorAll(".management-pnl-group-toggle")]
                .find(button => button.dataset.group === focusGroup);
            currentButton?.focus({ preventScroll: true });
            if (currentButton && previousGroupTop !== null) {
                wrap.scrollTop += currentButton.closest("tr").getBoundingClientRect().top - previousGroupTop;
            }
            window.scrollTo(viewport.pageX, viewport.pageY);
        }
    }

    function renderQuality(result) {
        const summary = result.selectedSummary;
        const warnings = summary.dataQuality.warnings || [];
        const strip = $("managementPnlQualityStrip");
        strip.className = "management-pnl-quality-strip";
        const items = [];
        const revenueErrors = warnings.filter(item => item.severity === "ERROR" && /REVENUE|ACCOUNTING_AMOUNT|GROSS/.test(item.code));
        const otherErrors = warnings.filter(item => item.severity === "ERROR" && !/REVENUE|ACCOUNTING_AMOUNT|GROSS/.test(item.code));
        if (revenueErrors.length) items.push({ tone: "error", text: "Revenue reconciliation needs review" });
        else if (summary.revenue.available) items.push({ tone: "healthy", text: "✓ Revenue reconciled" });
        if (Number(summary.revenue.grossCompatibilityAppliedCount || 0) > 0) items.push({ tone: "info", text: "ℹ Historical compatibility applied" });
        if (summary.cogs.coverageStatus === "INCOMPLETE" || Number(summary.cogs.unknownNetSalesPaise || 0) > 0) items.push({ tone: "warning", text: "⚠ Cost data incomplete" });
        if (Number(summary.cogs.notApplicableNetSalesPaise || 0) > 0) items.push({ tone: "warning", text: "⚠ VVP cost provenance pending" });
        for (const issue of otherErrors) {
            if (!items.some(item => item.text === issue.message)) items.push({ tone: "error", text: issue.message });
        }
        for (const warning of warnings.filter(item => item.severity === "WARNING")) {
            if (/UNKNOWN_COST_SALES/.test(warning.code) || /NOT_APPLICABLE_VVP_SALES/.test(warning.code)) continue;
            if (!items.some(item => item.text === warning.message)) items.push({ tone: "warning", text: warning.message });
        }
        if (!items.length) items.push({ tone: "healthy", text: "✓ Accounting checks passed" });
        strip.replaceChildren(...items.map(item => {
            const tag = document.createElement("span"); tag.className = `is-${item.tone}`; tag.textContent = item.text; return tag;
        }));
    }

    function render(result) {
        state.result = result;
        $("managementPnlFyLabel").textContent = result.metadata.financialYearLabel.replace("-", "–");
        $("managementPnlStore").textContent = result.metadata.store ? `Store: ${result.metadata.store.storeCode} · ${result.metadata.store.storeName}` : "Store identity unavailable";
        $("managementPnlAsOf").textContent = dateLabel(result.metadata.asOfDate);
        $("managementPnlAsOf").dateTime = result.metadata.asOfDate;
        $("managementPnlNextFy").disabled = result.metadata.financialYearStart >= result.metadata.currentFinancialYearStart;
        $("managementPnlPreviousFy").disabled = result.metadata.financialYearStart <= 1900;
        renderQuality(result);
        renderStatement(result);
        const empty = result.selectedSummary.revenue.saleLineCount === 0 && result.selectedSummary.revenue.returnLineCount === 0 &&
            result.selectedSummary.expenses.totalOperatingExpensesPaise === 0 && result.selectedSummary.expenses.directOperatingExpensesPaise === 0;
        setVisible("managementPnlLoading", false);
        setVisible("managementPnlError", false);
        setVisible("managementPnlEmpty", empty);
        setVisible("managementPnlTableWrap", !empty);
    }

    async function load() {
        if (!Number.isInteger(state.financialYearStart)) return;
        const requestId = ++state.requestId;
        showLoading();
        try {
            const response = await window.electronAPI.getManagementPnlFinancialYear({
                financialYearStart: state.financialYearStart,
                businessSegment: $("managementPnlSegment").value
            });
            if (requestId !== state.requestId) return;
            if (!response?.success || !response.result) throw new Error(response?.error || "Financial Year statement could not be loaded.");
            render(response.result);
        } catch (error) {
            if (requestId === state.requestId) showError(error?.message || "Financial Year statement could not be loaded.");
        }
    }

    async function open() {
        window.hideAllScreens();
        screen.style.display = "block";
        resetScreenSession();
        if (state.initialized) return load();
        showLoading();
        try {
            const response = await window.electronAPI.getManagementPnlPeriod({ preset: "FYTD" });
            if (!response?.success) throw new Error(response?.error || "Current Financial Year could not be resolved.");
            state.currentFinancialYearStart = Number(response.period.fromDate.slice(0, 4));
            state.financialYearStart = state.currentFinancialYearStart;
            state.initialized = true;
            await load();
        } catch (error) { showError(error?.message || "Current Financial Year could not be resolved."); }
    }

    $("managementPnlBackBtn").addEventListener("click", () => {
        resetScreenSession();
        window.hideAllScreens();
        document.getElementById("accountingDataScreen").style.display = "block";
    });
    $("managementPnlRetryBtn").addEventListener("click", () => state.initialized ? load() : open());
    $("managementPnlPreviousFy").addEventListener("click", () => { if (state.financialYearStart > 1900) { state.financialYearStart -= 1; load(); } });
    $("managementPnlNextFy").addEventListener("click", () => { if (state.financialYearStart < state.currentFinancialYearStart) { state.financialYearStart += 1; load(); } });
    $("managementPnlSegment").addEventListener("change", load);
    $("managementPnlExportBtn").addEventListener("click", async () => {
        if (!state.initialized || exporting) return;
        exporting = true;
        const button = $("managementPnlExportBtn");
        button.disabled = true;
        try {
            const response = await window.electronAPI.exportManagementPnlFinancialYear({
                financialYearStart: state.financialYearStart,
                businessSegment: $("managementPnlSegment").value
            });
            if (response?.cancelled) return;
            if (!response?.success) throw new Error(response?.error || "Management P&L workbook could not be exported.");
            const note = response.activityWarning ? `\n\n${response.activityWarning}` : "";
            await window.electronAPI.showMessageBox({
                type: "info", buttons: ["OK"],
                message: `Management P&L workbook saved successfully.\n${response.filePath}${note}`
            });
        } catch (error) {
            await window.electronAPI.showMessageBox({
                type: "error", buttons: ["OK"],
                message: error?.message || "Management P&L workbook could not be exported."
            });
        } finally {
            exporting = false;
            button.disabled = !state.initialized;
        }
    });
    $("managementPnlTableBody").addEventListener("click", event => {
        const button = event.target.closest(".management-pnl-group-toggle");
        if (!button) return;
        const group = button.dataset.group;
        if (state.expandedGroups.has(group)) state.expandedGroups.delete(group); else state.expandedGroups.add(group);
        if (state.result) renderStatement(state.result, { preserveViewport: true, focusGroup: group });
    });
    window.openManagementPnl = open;
})();
