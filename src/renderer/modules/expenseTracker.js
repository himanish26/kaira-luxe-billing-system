"use strict";

(() => {
    const $ = id => document.getElementById(id);
    const trackerScreen = $("expenseTrackerScreen");
    const historyScreen = $("expenseHistoryScreen");
    if (!trackerScreen || !historyScreen) return;

    const draftState = window.KLBSExpenseDraftState.createExpenseDraftState();
    const monthCalendar = window.KLBSExpenseHistoryCalendar;
    const paymentModes = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];
    let postedBatch = null;
    let historyPage = 1;
    let historyLoadSequence = 0;
    let searchTimer = null;
    let detailReturnFocus = null;
    let historySummaryVisible = false;

    function localDate(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function currentMonth() { return localDate().slice(0, 7); }

    function formatMoney(paise) {
        return new Intl.NumberFormat("en-IN", {
            style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(Number(paise || 0) / 100);
    }

    function formatDate(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
        return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
    }

    function makeCell(row, value, className = "") {
        const cell = document.createElement("td");
        if (className) cell.className = className;
        cell.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
        row.appendChild(cell);
        return cell;
    }

    function appendOptions(select, values) {
        for (const value of values) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        }
    }

    function fillOptions(options) {
        appendOptions($("expenseHeader"), options.expenseHeaders);
        appendOptions($("expenseHistoryCategory"), options.expenseHeaders);
        appendOptions($("expenseBusinessSegment"), options.businessSegments);
        appendOptions($("expenseHistorySegment"), options.businessSegments);
        appendOptions($("expensePaymentMode"), options.transactionTypes);
        appendOptions($("expenseHistoryPaymentMode"), options.transactionTypes);
    }

    function readEntry() {
        return {
            expenseDate: $("expenseDate").value,
            category: $("expenseHeader").value,
            businessSegment: $("expenseBusinessSegment").value,
            paymentMode: $("expensePaymentMode").value,
            reference: $("expenseReference").value,
            amount: $("expenseAmount").value,
            remarks: $("expenseRemarks").value
        };
    }

    function resetEntryFields() {
        const today = localDate();
        $("expenseDate").value = today;
        $("expenseDate").max = today;
        $("expenseHeader").value = "";
        $("expenseBusinessSegment").value = "";
        $("expensePaymentMode").value = "";
        $("expenseReference").value = "";
        $("expenseAmount").value = "";
        $("expenseRemarks").value = "";
        $("expenseRemarksRequiredHint").hidden = true;
        $("expenseEntryMessage").textContent = "";
        $("expenseHeader").focus({ preventScroll: true });
    }

    function sortedDrafts() {
        return draftState.getEntries().sort((a, b) =>
            b.expenseDate.localeCompare(a.expenseDate) || a.draftKey - b.draftKey);
    }

    function renderDraft() {
        const rowsNode = $("expenseDraftRows");
        rowsNode.replaceChildren();
        const rows = sortedDrafts();
        const hasRows = rows.length > 0;
        $("expenseDraftEmpty").hidden = hasRows;
        $("expenseDraftTableWrap").hidden = !hasRows;
        $("expenseClearAllBtn").disabled = !hasRows || Boolean(postedBatch);
        $("expensePostBtn").disabled = !hasRows || Boolean(postedBatch);

        rows.forEach((entry, index) => {
            const row = document.createElement("tr");
            makeCell(row, index + 1);
            makeCell(row, formatDate(entry.expenseDate));
            makeCell(row, entry.category);
            makeCell(row, entry.businessSegment);
            makeCell(row, entry.paymentMode);
            makeCell(row, entry.reference);
            makeCell(row, formatMoney(entry.amountPaise));
            makeCell(row, entry.remarks);
            const actionCell = document.createElement("td");
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "expense-delete-btn";
            remove.textContent = "DELETE";
            remove.disabled = Boolean(postedBatch);
            remove.addEventListener("click", () => {
                draftState.remove(entry.draftKey);
                renderDraft();
            });
            actionCell.appendChild(remove);
            row.appendChild(actionCell);
            rowsNode.appendChild(row);
        });

        const totals = draftState.summarize(paymentModes);
        $("expenseDraftSummary").replaceChildren();
        const summaryEntries = [
            ["Expense Count", String(totals.count)],
            ...paymentModes.map(mode => [`${mode} Total`, formatMoney(totals[mode])]),
            ["DRAFT TOTAL", formatMoney(totals.grand)]
        ];
        for (const [label, value] of summaryEntries) {
            const item = document.createElement("span");
            const strong = document.createElement("strong");
            strong.textContent = `${label}: `;
            item.append(strong, document.createTextNode(value));
            $("expenseDraftSummary").appendChild(item);
        }
    }

    async function addDraftEntry(event) {
        event.preventDefault();
        const button = $("expenseAddBtn");
        button.disabled = true;
        $("expenseEntryMessage").textContent = "";
        try {
            const result = await window.electronAPI.validateExpenseEntry(readEntry());
            if (!result.success) {
                $("expenseEntryMessage").textContent = result.error || "Check the expense fields.";
                return;
            }
            draftState.add(result.entry);
            renderDraft();
            resetEntryFields();
        }
        catch (error) {
            $("expenseEntryMessage").textContent = error.message || "Expense could not be added to the draft batch.";
        }
        finally {
            button.disabled = false;
        }
    }

    function openAccounting() {
        window.hideAllScreens();
        $("accountingDataScreen").style.display = "block";
    }

    function showTracker() {
        window.hideAllScreens();
        trackerScreen.style.display = "block";
        if (!$("expenseDate").value) $("expenseDate").value = localDate();
        $("expenseDate").max = localDate();
        renderDraft();
    }

    function showHistory() {
        window.hideAllScreens();
        historyScreen.style.display = "block";
        renderHistory();
    }

    function renderPostedBatch(batch) {
        const rowsNode = $("expensePostedBatchRows");
        rowsNode.replaceChildren();
        batch.expenses.forEach((entry, index) => {
            const row = document.createElement("tr");
            makeCell(row, index + 1);
            makeCell(row, formatDate(entry.expense_date));
            makeCell(row, entry.category);
            makeCell(row, entry.business_segment);
            makeCell(row, entry.payment_mode);
            makeCell(row, entry.reference);
            makeCell(row, formatMoney(entry.amount_paise));
            makeCell(row, entry.remarks);
            makeCell(row, entry.expense_code);
            rowsNode.appendChild(row);
        });
        $("expensePostedBatchMessage").textContent =
            `Batch: ${batch.batch_code} · ${batch.expense_count} expenses · ${formatMoney(batch.total_amount_paise)}`;
        $("expenseEntryPanel").hidden = true;
        $("expenseDraftPanel").hidden = true;
        $("expensePostedPanel").hidden = false;
        $("expenseBatchExportBtn").disabled = false;
    }

    async function requestManagerGrant() {
        if (typeof window.requestAdminAuthorization !== "function") {
            throw new Error("Manager authorization is unavailable.");
        }
        return window.requestAdminAuthorization("EXPENSE_POST");
    }

    async function postDraftBatch() {
        const draftEntries = draftState.getEntries();
        if (!draftEntries.length || postedBatch) return;
        const entries = draftEntries.map(({ draftKey, ...entry }) => entry);
        const total = entries.reduce((sum, entry) => sum + entry.amountPaise, 0);
        const duplicateResult = await window.electronAPI.findPostedExpenseDuplicates(entries);
        if (!duplicateResult.success) {
            await window.showNativeAlert(duplicateResult.error || "Duplicate check could not be completed.");
            return;
        }
        let duplicateAcknowledged = false;
        if (duplicateResult.duplicates.length) {
            const duplicateSummary = duplicateResult.duplicates.map(item =>
                `${item.expenseDate} · ${item.category} · ${formatMoney(item.amountPaise)} · ${item.reference} (${item.matches.map(match => match.expense_code).join(", ")})`
            ).join("\n");
            duplicateAcknowledged = await window.showNativeConfirm(
                `Possible duplicate posted expense(s) were found:\n\n${duplicateSummary}\n\nContinue to posting? This warning does not merge expenses.`,
                $("expensePostBtn")
            );
            if (!duplicateAcknowledged) return;
        }

        const confirmed = await window.showNativeConfirm(
            `Post ${entries.length} expense${entries.length === 1 ? "" : "s"} totaling ${formatMoney(total)}?\n\nPosting creates permanent expense records. Posted expenses cannot be edited or deleted.`,
            $("expensePostBtn")
        );
        if (!confirmed) return;

        let grant;
        try { grant = await requestManagerGrant(); }
        catch (error) {
            await window.showNativeAlert(error.message || "Manager authorization could not be opened.");
            return;
        }
        if (!grant) return;

        const postButton = $("expensePostBtn");
        postButton.disabled = true;
        postButton.textContent = "POSTING...";
        try {
            let result = await window.electronAPI.postExpenseBatch(entries, duplicateAcknowledged, grant);
            if (!result.success && result.code === "EXPENSE_DUPLICATE_ACK_REQUIRED" && result.duplicates?.length) {
                const accepted = await window.showNativeConfirm(
                    "A matching posted expense appeared during authorization. Acknowledge this duplicate warning and authorize posting again?",
                    postButton
                );
                if (accepted) {
                    const retryGrant = await requestManagerGrant();
                    if (!retryGrant) return;
                    result = await window.electronAPI.postExpenseBatch(entries, true, retryGrant);
                }
            }
            if (!result.success) {
                await window.showNativeAlert(result.error || "Expense batch was not posted.");
                return;
            }
            postedBatch = result.batch;
            renderPostedBatch(postedBatch);
        }
        catch (error) {
            await window.showNativeAlert(error.message || "Expense batch was not posted.");
        }
        finally {
            postButton.textContent = "POST EXPENSES";
            renderDraft();
        }
    }

    function clearDraft() {
        const totals = draftState.summarize(paymentModes);
        if (!totals.count || postedBatch) return;
        window.showNativeConfirm(
            `Clear all ${totals.count} unposted expenses totaling ${formatMoney(totals.grand)}?`,
            $("expenseClearAllBtn")
        ).then(confirmed => {
            if (!confirmed) return;
            draftState.clear();
            renderDraft();
        });
    }

    function startNewBatch() {
        draftState.clear();
        postedBatch = null;
        resetEntryFields();
        $("expenseEntryPanel").hidden = false;
        $("expenseDraftPanel").hidden = false;
        $("expensePostedPanel").hidden = true;
        renderDraft();
    }

    function historyOptions() {
        return {
            month: $("expenseHistoryMonth").value,
            category: $("expenseHistoryCategory").value,
            businessSegment: $("expenseHistorySegment").value,
            paymentMode: $("expenseHistoryPaymentMode").value,
            search: $("expenseHistorySearch").value.trim(),
            page: historyPage
        };
    }

    function renderHistoryRows(rows, page) {
        const body = $("expenseHistoryRows");
        body.replaceChildren();
        rows.forEach((expense, index) => {
            const row = document.createElement("tr");
            row.tabIndex = 0;
            row.setAttribute("role", "button");
            makeCell(row, (page - 1) * 100 + index + 1);
            makeCell(row, formatDate(expense.expense_date));
            makeCell(row, expense.expense_code);
            makeCell(row, expense.batch_code);
            makeCell(row, expense.category);
            makeCell(row, expense.business_segment);
            makeCell(row, expense.payment_mode);
            makeCell(row, expense.reference);
            makeCell(row, formatMoney(expense.amount_paise));
            makeCell(row, expense.remarks);
            const open = () => openExpenseDetails(expense.expense_code, row);
            row.addEventListener("click", open);
            row.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open();
                }
            });
            body.appendChild(row);
        });
    }

    async function renderHistory() {
        if (historyScreen.style.display !== "block") return;
        const sequence = ++historyLoadSequence;
        const options = historyOptions();
        const result = await window.electronAPI.getPostedExpenseHistory(options);
        if (sequence !== historyLoadSequence || historyScreen.style.display !== "block") return;
        if (!result.success) {
            $("expenseHistoryEmpty").hidden = false;
            $("expenseHistoryEmpty").textContent = result.error || "Expense History could not be loaded.";
            $("expenseHistoryTableWrap").hidden = true;
            $("expenseHistoryPagination").hidden = true;
            $("expenseHistoryExportBtn").disabled = true;
            $("expenseHistorySummaryBtn").disabled = true;
            $("expenseHistoryPageJump").disabled = true;
            $("expenseHistoryPrevious").disabled = true;
            $("expenseHistoryNext").disabled = true;
            return;
        }
        historyPage = result.page;
        renderHistoryRows(result.rows, result.page);
        const hasRows = result.totalCount > 0;
        $("expenseHistoryEmpty").hidden = hasRows;
        $("expenseHistoryTableWrap").hidden = !hasRows;
        $("expenseHistoryPagination").hidden = !hasRows;
        $("expenseHistoryTotals").textContent =
            `${result.totalCount} matching expense${result.totalCount === 1 ? "" : "s"} · ${formatMoney(result.totalAmountPaise)}`;
        $("expenseHistoryPageLabel").textContent = `Page ${result.page} of ${result.totalPages}`;
        $("expenseHistoryPageJump").value = String(result.page);
        $("expenseHistoryPrevious").disabled = result.page <= 1;
        $("expenseHistoryNext").disabled = result.page >= result.totalPages;
        $("expenseHistoryNextMonth").disabled = options.month >= currentMonth();
        $("expenseHistoryExportBtn").disabled = !hasRows;
        $("expenseHistorySummaryBtn").disabled = !hasRows;
        $("expenseHistoryPageJump").disabled = !hasRows;
        if (!hasRows) {
            $("expenseHistoryPrevious").disabled = true;
            $("expenseHistoryNext").disabled = true;
        }
        const start = result.totalCount ? (result.page - 1) * result.pageSize + 1 : 0;
        const end = Math.min(result.page * result.pageSize, result.totalCount);
        $("expenseHistoryRangeLabel").textContent =
            `Showing ${start}–${end} of ${result.totalCount} expenses`;
        if (historySummaryVisible) await renderHeaderSummary(options);
    }

    async function renderHeaderSummary(options = historyOptions()) {
        const result = await window.electronAPI.getExpenseHeaderSummary(options);
        if (!result.success) {
            $("expenseHeaderSummary").textContent = result.error || "Summary could not be loaded.";
            return;
        }
        const summary = $("expenseHeaderSummary");
        summary.replaceChildren();
        if (!result.rows.length) {
            summary.textContent = "No matching expenses to summarize.";
        } else {
            for (const row of result.rows) {
                const item = document.createElement("span");
                const strong = document.createElement("strong");
                strong.textContent = `${row.category}: `;
                item.append(strong, document.createTextNode(formatMoney(row.total_amount_paise)));
                summary.appendChild(item);
            }
        }
        summary.hidden = !historySummaryVisible;
    }

    async function openExpenseDetails(expenseCode, returnFocus) {
        const result = await window.electronAPI.getPostedExpenseDetails(expenseCode);
        if (!result.success) {
            await window.showNativeAlert(result.error || "Expense details could not be loaded.");
            return;
        }
        detailReturnFocus = returnFocus;
        const expense = result.expense;
        const values = [
            ["Expense ID", expense.expense_code], ["Batch ID", expense.batch_code],
            ["Date", formatDate(expense.expense_date)], ["Expense Header", expense.category],
            ["Business Segment", expense.business_segment], ["Transaction Type", expense.payment_mode],
            ["Receipt / Reference No.", expense.reference], ["Amount", formatMoney(expense.amount_paise)],
            ["Remarks", expense.remarks], ["Store Code", expense.store_code], ["Posted At", expense.posted_at]
        ];
        const details = $("expenseDetailFields");
        details.replaceChildren();
        for (const [label, value] of values) {
            const dt = document.createElement("dt");
            dt.textContent = label;
            const dd = document.createElement("dd");
            dd.textContent = value || "—";
            details.append(dt, dd);
        }
        $("expenseDetailOverlay").hidden = false;
        $("expenseDetailCloseBtn").focus({ preventScroll: true });
    }

    function closeExpenseDetails() {
        $("expenseDetailOverlay").hidden = true;
        if (detailReturnFocus?.isConnected) detailReturnFocus.focus({ preventScroll: true });
        detailReturnFocus = null;
    }

    async function exportCurrentBatch() {
        if (!postedBatch) return;
        const result = await window.electronAPI.exportPostedExpenseBatch(postedBatch.batch_code);
        if (result.success) await window.showNativeAlert("Posted expense batch exported successfully.");
        else if (!result.cancelled) await window.showNativeAlert(result.error || "Batch export failed.");
    }

    async function exportHistory() {
        const result = await window.electronAPI.exportPostedExpenseHistory(historyOptions());
        if (result.success) await window.showNativeAlert(`${result.rowCount} matching posted expenses exported successfully.`);
        else if (!result.cancelled) await window.showNativeAlert(result.error || "Expense History export failed.");
    }

    function changeMonth(delta) {
        const value = monthCalendar.stepMonth($("expenseHistoryMonth").value, delta, currentMonth());
        if (!value) return;
        $("expenseHistoryMonth").value = value;
        $("expenseHistoryNextMonth").disabled = !monthCalendar.stepMonth(value, 1, currentMonth());
        historyPage = 1;
        renderHistory();
    }

    async function initialize() {
        const optionResult = await window.electronAPI.getExpenseTrackerOptions();
        if (!optionResult.success) throw new Error(optionResult.error || "Expense setup could not be loaded.");
        fillOptions(optionResult);
        $("expenseDate").value = localDate();
        $("expenseDate").max = localDate();
        $("expenseHistoryMonth").value = currentMonth();
        $("expenseHistoryMonth").max = currentMonth();
        $("expenseHistoryNextMonth").disabled = true;
        $("expenseEntryForm").addEventListener("submit", addDraftEntry);
        $("expenseHeader").addEventListener("change", () => {
            $("expenseRemarksRequiredHint").hidden = $("expenseHeader").value !== "Miscellaneous";
        });
        $("expenseClearAllBtn").addEventListener("click", clearDraft);
        $("expensePostBtn").addEventListener("click", postDraftBatch);
        $("expenseBatchExportBtn").addEventListener("click", exportCurrentBatch);
        $("expenseNewBatchBtn").addEventListener("click", startNewBatch);
        $("expenseTrackerBackBtn").addEventListener("click", openAccounting);
        $("expenseHistoryOpenBtn").addEventListener("click", showHistory);
        $("expenseHistoryBackBtn").addEventListener("click", showTracker);
        $("expenseHistoryPreviousMonth").addEventListener("click", () => changeMonth(-1));
        $("expenseHistoryNextMonth").addEventListener("click", () => changeMonth(1));
        $("expenseHistoryMonth").addEventListener("change", () => {
            const month = $("expenseHistoryMonth").value;
            if (month > currentMonth()) $("expenseHistoryMonth").value = currentMonth();
            $("expenseHistoryNextMonth").disabled = !monthCalendar.stepMonth($("expenseHistoryMonth").value, 1, currentMonth());
            historyPage = 1;
            renderHistory();
        });
        for (const id of ["expenseHistoryCategory", "expenseHistorySegment", "expenseHistoryPaymentMode"]) {
            $(id).addEventListener("change", () => { historyPage = 1; renderHistory(); });
        }
        $("expenseHistorySearch").addEventListener("input", () => {
            historyPage = 1;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(renderHistory, 180);
        });
        $("expenseHistoryPrevious").addEventListener("click", () => { historyPage -= 1; renderHistory(); });
        $("expenseHistoryNext").addEventListener("click", () => { historyPage += 1; renderHistory(); });
        $("expenseHistoryPageJump").addEventListener("change", () => {
            const target = Number.parseInt($("expenseHistoryPageJump").value, 10);
            historyPage = Number.isFinite(target) ? target : 1;
            renderHistory();
        });
        $("expenseHistoryPageJump").addEventListener("keydown", event => {
            if (event.key === "Enter") { event.preventDefault(); $("expenseHistoryPageJump").dispatchEvent(new Event("change")); }
        });
        $("expenseHistorySummaryBtn").addEventListener("click", async () => {
            historySummaryVisible = !historySummaryVisible;
            $("expenseHeaderSummary").hidden = !historySummaryVisible;
            $("expenseHistorySummaryBtn").textContent = historySummaryVisible ? "HIDE SUMMARY" : "VIEW SUMMARY";
            if (historySummaryVisible) await renderHeaderSummary();
        });
        $("expenseHistoryExportBtn").addEventListener("click", exportHistory);
        $("expenseDetailCloseBtn").addEventListener("click", closeExpenseDetails);
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !$("expenseDetailOverlay").hidden) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                closeExpenseDetails();
            }
        }, true);
        window.openExpenseTracker = showTracker;
    }

    initialize().catch(error => {
        $("expenseEntryMessage").textContent = error.message || "Expense Tracker could not be initialized.";
        $("expenseAddBtn").disabled = true;
        $("expensePostBtn").disabled = true;
        $("expenseHistoryOpenBtn").disabled = true;
    });
})();
