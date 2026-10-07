"use strict";

(() => {
    const $ = id => document.getElementById(id);
    const screen = $("managementAccountingEntriesScreen");
    if (!screen) return;

    const state = { heads: [], segments: [], businessDate: "", store: null, currentEntry: null, detailReturnFocus: null, searchTimer: null, listSequence: 0, optionsLoaded: false };
    const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dateLabel = value => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
        return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
    };
    const money = paise => Number.isSafeInteger(Number(paise)) ? currency.format(Number(paise) / 100) : "—";
    const headLabel = code => state.heads.find(head => head.code === code)?.label || code || "—";
    const effectLabel = effect => effect === "INCOME" ? "Increases Profit" : effect === "EXPENSE" ? "Reduces Profit" : "—";
    const announce = (id, message) => { $(id).textContent = message || ""; };

    function fillSelect(select, values, label) {
        for (const item of values) {
            const option = document.createElement("option");
            option.value = typeof item === "string" ? item : item.code;
            option.textContent = typeof item === "string" ? item : (item.label || item.code);
            select.appendChild(option);
        }
    }

    function resetForm() {
        $("managementAccountingEntryForm").reset();
        $("managementAccountingDate").value = state.businessDate;
        $("managementAccountingDate").max = state.businessDate;
        $("managementAccountingEffectField").hidden = true;
        $("managementAccountingRemarksHint").hidden = true;
        $("managementAccountingEffect").value = "";
        $("managementAccountingRemarks").required = false;
        $("managementAccountingSuccess").hidden = true;
        announce("managementAccountingFormMessage", "");
        $("managementAccountingPostBtn").disabled = false;
    }

    async function initializeOptions() {
        const [options, period, store] = await Promise.all([
            state.optionsLoaded ? Promise.resolve(null) : window.electronAPI.managementAccountingEntries.getOptions(),
            window.electronAPI.getManagementPnlPeriod({ preset: "FYTD" }),
            window.electronAPI.getCurrentStoreIdentity()
        ]);
        if ((!state.optionsLoaded && !options?.success) || !period?.success || !store?.storeCode) {
            throw new Error(options?.error || period?.error || "Store identity or accounting options are unavailable.");
        }
        if (!state.optionsLoaded) {
            state.heads = options.heads || [];
            state.segments = options.businessSegments || [];
            fillSelect($("managementAccountingHead"), state.heads);
            fillSelect($("managementAccountingSegment"), state.segments);
            fillSelect($("managementAccountingHistoryHead"), state.heads);
            fillSelect($("managementAccountingHistorySegment"), state.segments);
            state.optionsLoaded = true;
        }
        state.businessDate = period.businessDate;
        state.store = store;
        $("managementAccountingStore").textContent = `Store: ${store.storeCode} · ${store.storeName}`;
        $("managementAccountingDate").max = state.businessDate;
        $("managementAccountingDate").value = state.businessDate;
        const currentFyStart = Number(period.period.fromDate.slice(0, 4));
        $("managementAccountingHistoryFrom").value = `${currentFyStart}-04-01`;
        $("managementAccountingHistoryTo").value = state.businessDate;
    }

    function readForm() {
        return {
            accountingDate: $("managementAccountingDate").value,
            accountingHead: $("managementAccountingHead").value,
            businessSegment: $("managementAccountingSegment").value,
            adjustmentEffect: $("managementAccountingEffect").value || null,
            referenceNo: $("managementAccountingReference").value,
            amount: $("managementAccountingAmount").value,
            remarks: $("managementAccountingRemarks").value
        };
    }

    async function postEntry(event) {
        event.preventDefault();
        const button = $("managementAccountingPostBtn");
        button.disabled = true;
        $("managementAccountingSuccess").hidden = true;
        announce("managementAccountingFormMessage", "Checking entry details…");
        try {
            const validation = await window.electronAPI.managementAccountingEntries.validate(readForm());
            if (!validation?.success || !validation.entry) throw new Error(validation?.error || "Check the entry fields.");
            const entry = validation.entry;
            const selectedHead = headLabel(entry.accountingHead);
            const effect = entry.adjustmentEffect ? `\nEffect: ${effectLabel(entry.adjustmentEffect)}` : "";
            const confirmed = await window.showNativeConfirm(
                `Post this management accounting entry?\n\n${dateLabel(entry.accountingDate)} · ${selectedHead}\n${entry.businessSegment} · ${money(entry.amountPaise)}${effect}\n\nPosted entries are immutable. Corrections require a separate reversal.`, button
            );
            if (!confirmed) return;
            const grant = await window.requestAdminAuthorization("P_AND_L_ENTRY_POST");
            if (!grant) return;
            announce("managementAccountingFormMessage", "Posting entry…");
            const response = await window.electronAPI.managementAccountingEntries.post(entry, grant);
            if (!response?.success || !response.entry) throw new Error(response?.error || "Accounting entry was not posted.");
            const posted = response.entry;
            resetForm();
            const success = $("managementAccountingSuccess");
            success.replaceChildren();
            success.append(document.createTextNode(`${posted.entry_code} posted · ${headLabel(posted.accounting_head)} · ${posted.business_segment} · ${money(posted.amount_paise)}`));
            success.hidden = false;
        } catch (error) {
            announce("managementAccountingFormMessage", error?.message || "Accounting entry was not posted.");
        } finally {
            button.disabled = false;
        }
    }

    function historyFilters() {
        return {
            fromDate: $("managementAccountingHistoryFrom").value || undefined,
            toDate: $("managementAccountingHistoryTo").value || undefined,
            accountingHead: $("managementAccountingHistoryHead").value || undefined,
            businessSegment: $("managementAccountingHistorySegment").value || undefined,
            search: $("managementAccountingHistorySearch").value.trim()
        };
    }

    function cell(row, value) {
        const td = document.createElement("td");
        td.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
        row.appendChild(td);
    }

    async function loadHistory() {
        const sequence = ++state.listSequence;
        announce("managementAccountingHistoryMessage", "Loading posted accounting entries…");
        $("managementAccountingHistoryEmpty").hidden = true;
        try {
            const response = await window.electronAPI.managementAccountingEntries.list(historyFilters());
            if (sequence !== state.listSequence || !screen || screen.style.display !== "block") return;
            if (!response?.success) throw new Error(response?.error || "Accounting entry history could not be loaded.");
            const rows = $("managementAccountingHistoryRows");
            rows.replaceChildren();
            for (const entry of response.entries || []) {
                const tr = document.createElement("tr");
                tr.tabIndex = 0;
                tr.setAttribute("role", "button");
                tr.setAttribute("aria-label", `Open ${entry.entry_code}, ${headLabel(entry.accounting_head)}, ${money(entry.amount_paise)}`);
                const effect = effectLabel(entry.adjustment_effect);
                [entry.entry_code, dateLabel(entry.accounting_date), headLabel(entry.accounting_head), entry.business_segment,
                    effect, money(entry.amount_paise), entry.reference_no,
                    entry.reverses_entry_code ? "REVERSAL" : entry.reversed_by_entry_code ? "POSTED · REVERSED" : "POSTED"].forEach(value => cell(tr, value));
                const open = () => openDetail(entry.entry_code, tr);
                tr.addEventListener("click", open);
                tr.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
                rows.appendChild(tr);
            }
            const hasRows = (response.entries || []).length > 0;
            $("managementAccountingHistoryEmpty").hidden = hasRows;
            announce("managementAccountingHistoryMessage", hasRows ? `${response.entries.length} posted accounting entr${response.entries.length === 1 ? "y" : "ies"}.` : "");
        } catch (error) {
            if (sequence === state.listSequence) {
                $("managementAccountingHistoryRows").replaceChildren();
                $("managementAccountingHistoryEmpty").hidden = true;
                announce("managementAccountingHistoryMessage", error?.message || "Accounting entry history could not be loaded.");
            }
        }
    }

    function detailPairs(entry) {
        const isReversal = Boolean(entry.reverses_entry_code);
        const values = [
            ["Entry ID", entry.entry_code], ["Accounting Date", dateLabel(entry.accounting_date)],
            ["Accounting Head", headLabel(entry.accounting_head)], ["Business Segment", entry.business_segment],
            ["Effect on Profit", effectLabel(entry.adjustment_effect)], ["Amount", money(entry.amount_paise)],
            ["Reference No.", entry.reference_no], ["Remarks", entry.remarks],
            ["Store", `${entry.store_code || "—"} · ${entry.store_name || "—"}`],
            ["Status", entry.reversed_by_entry_code ? "REVERSED" : entry.status],
            ["Entry Type", isReversal ? "REVERSAL" : "POSTED"], ["Source / Posted Role", `${entry.source || "—"} · ${entry.posted_by || "—"}`],
            ["Posted At", entry.posted_at], ["Reversal Reason", entry.reversal_reason],
            ["Reverses Entry", entry.reverses_entry_code], ["Reversed By", entry.reversed_by_entry_code]
        ];
        return values;
    }

    async function openDetail(code, returnFocus = null) {
        const response = await window.electronAPI.managementAccountingEntries.get(code);
        if (!response?.success || !response.entry) {
            announce("managementAccountingHistoryMessage", response?.error || "Entry detail could not be loaded.");
            return;
        }
        const entry = response.entry;
        state.currentEntry = entry;
        if (returnFocus) state.detailReturnFocus = returnFocus;
        const fields = $("managementAccountingDetailFields");
        fields.replaceChildren();
        for (const [name, value] of detailPairs(entry)) {
            const dt = document.createElement("dt"); dt.textContent = name;
            const dd = document.createElement("dd"); dd.textContent = value || "—";
            fields.append(dt, dd);
        }
        const eligible = entry.status === "POSTED" && !entry.reverses_entry_code && !entry.reversed_by_entry_code;
        $("managementAccountingReversalReasonField").hidden = !eligible;
        $("managementAccountingReversalReason").value = "";
        $("managementAccountingReverseBtn").hidden = !eligible;
        $("managementAccountingReverseBtn").disabled = false;
        announce("managementAccountingDetailMessage", entry.reversed_by_entry_code ? `REVERSED by ${entry.reversed_by_entry_code}. The original remains in history.` : "");
        $("managementAccountingDetailOverlay").hidden = false;
        $("managementAccountingDetailCloseBtn").focus({ preventScroll: true });
    }

    async function reverseCurrent() {
        const entry = state.currentEntry;
        const reason = $("managementAccountingReversalReason").value.trim();
        if (!entry || !reason) {
            announce("managementAccountingDetailMessage", "Enter a reversal reason before continuing.");
            $("managementAccountingReversalReason").focus();
            return;
        }
        const confirmed = await window.showNativeConfirm(
            `Reverse this posted entry?\n\n${entry.entry_code}\n${dateLabel(entry.accounting_date)} · ${headLabel(entry.accounting_head)}\n${entry.business_segment} · ${money(entry.amount_paise)}\n\nThe original remains unchanged. The reversal is dated the current business date and negates its accounting effect. Any replacement must be entered separately.`, $("managementAccountingReverseBtn")
        );
        if (!confirmed) return;
        const grant = await window.requestAdminAuthorization("P_AND_L_ENTRY_REVERSE");
        if (!grant) return;
        const button = $("managementAccountingReverseBtn");
        button.disabled = true;
        announce("managementAccountingDetailMessage", "Recording reversal…");
        try {
            const response = await window.electronAPI.managementAccountingEntries.reverse(entry.entry_code, { reason }, grant);
            if (!response?.success || !response.entry) throw new Error(response?.error || "Entry reversal was not recorded.");
            announce("managementAccountingDetailMessage", `Reversal ${response.entry.entry_code} posted on ${dateLabel(response.entry.accounting_date)}. The original remains in history.`);
            button.hidden = true;
            $("managementAccountingReversalReasonField").hidden = true;
            await loadHistory();
            await openDetail(entry.entry_code);
            announce("managementAccountingDetailMessage", `REVERSED by ${response.entry.entry_code}. Original remains in history; reversal date ${dateLabel(response.entry.accounting_date)}.`);
        } catch (error) {
            announce("managementAccountingDetailMessage", error?.message || "Entry reversal was not recorded.");
            button.disabled = false;
        }
    }

    async function open() {
        window.hideAllScreens();
        screen.style.display = "block";
        $("managementAccountingEntryView").hidden = false;
        $("managementAccountingHistoryView").hidden = true;
        $("managementAccountingEntriesBackBtn").textContent = "← Management P&L";
        $("managementAccountingDetailOverlay").hidden = true;
        resetForm();
        state.currentEntry = null;
        announce("managementAccountingDetailMessage", "");
        try { await initializeOptions(); resetForm(); }
        catch (error) { announce("managementAccountingFormMessage", error?.message || "Accounting entry workflow could not be initialized."); }
    }

    function showHistory() {
        $("managementAccountingEntryView").hidden = true;
        $("managementAccountingHistoryView").hidden = false;
        $("managementAccountingEntriesBackBtn").textContent = "← Accounting Entries";
        loadHistory();
    }

    function showEntryForm() {
        $("managementAccountingHistoryView").hidden = true;
        $("managementAccountingEntryView").hidden = false;
        $("managementAccountingEntriesBackBtn").textContent = "← Management P&L";
        $("managementAccountingHistoryOpenBtn").focus({ preventScroll: true });
    }

    function backToManagementPnl() {
        resetForm();
        window.openManagementPnl?.();
    }

    function closeDetail() {
        $("managementAccountingDetailOverlay").hidden = true;
        state.currentEntry = null;
        const returnFocus = state.detailReturnFocus;
        state.detailReturnFocus = null;
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        else $("managementAccountingHistorySearch").focus({ preventScroll: true });
    }

    $("managementAccountingHead").addEventListener("change", () => {
        const exceptional = $("managementAccountingHead").value === "EXCEPTIONAL_ADJUSTMENT";
        $("managementAccountingEffectField").hidden = !exceptional;
        $("managementAccountingRemarksHint").hidden = !exceptional;
        $("managementAccountingRemarks").required = exceptional;
        if (!exceptional) $("managementAccountingEffect").value = "";
    });
    $("managementAccountingEntryForm").addEventListener("submit", postEntry);
    $("managementAccountingHistoryOpenBtn").addEventListener("click", showHistory);
    $("managementAccountingEntriesBackBtn").addEventListener("click", () => {
        if (!$("managementAccountingHistoryView").hidden) {
            showEntryForm();
            return;
        }
        backToManagementPnl();
    });
    $("managementAccountingHistoryFrom").addEventListener("change", loadHistory);
    $("managementAccountingHistoryTo").addEventListener("change", loadHistory);
    $("managementAccountingHistoryHead").addEventListener("change", loadHistory);
    $("managementAccountingHistorySegment").addEventListener("change", loadHistory);
    $("managementAccountingHistorySearch").addEventListener("input", () => {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(loadHistory, 250);
    });
    $("managementAccountingDetailCloseBtn").addEventListener("click", closeDetail);
    $("managementAccountingDetailOverlay").addEventListener("click", event => { if (event.target === $("managementAccountingDetailOverlay")) closeDetail(); });
    $("managementAccountingReverseBtn").addEventListener("click", reverseCurrent);
    window.openManagementAccountingEntries = open;
    window.isManagementAccountingEntryDetailOpen = () => !$("managementAccountingDetailOverlay").hidden;
    window.closeManagementAccountingEntryDetail = closeDetail;
})();
