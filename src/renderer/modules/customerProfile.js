(() => {
    const byId = id => document.getElementById(id);
    const mobileInput = byId("customerMobile");
    const nameInput = byId("customerName");
    const selectedId = byId("selectedCustomerProfileId");
    const customerButton = byId("customerProfileOpen");
    const drawer = byId("customerProfileModal");
    const panel = drawer.querySelector(".customer-drawer-panel");
    const drawerBody = byId("customerDrawerBody");
    const chooserView = byId("customerDrawerChooser");
    const profileView = byId("customerDrawerProfileView");
    const formView = byId("customerDrawerFormView");
    const drawerError = byId("customerDrawerError");
    const newBillScreen = byId("newBillScreen");
    const focusableSelector = 'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    let selectedProfile = null;
    let latestLookup = 0;
    let pendingMobile = "";
    let chooserShownFor = "";
    let managementSaveHandler = null;
    let storeCreditMobile = "";
    let availableStoreCredit = null;
    let attentionActive = false;
    let attentionResolutionKey = "";
    let purchaseHistoryPage = 1;
    let purchaseHistoryTotalPages = 1;
    let purchaseHistoryRequest = 0;
    let drawerMode = "closed";
    let drawerEditing = false;
    let drawerProfileRequest = 0;
    let drawerCloseTimer = null;
    let drawerCloseFinish = null;
    let drawerFocusSequence = 0;
    let expandedBillNo = "";
    let drawerReturnFocus = null;
    let expandedBillButton = null;
    let expandedBillRow = null;
    let expandedPurchaseRow = null;
    let expandedBillRequest = 0;

    function digitsOnly(value, maximum) { return String(value || "").replace(/\D/g, "").slice(0, maximum); }
    function formatDdMmInput(value) {
        const digits = digitsOnly(value, 4);
        return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    }
    function isValidDdMm(value) {
        if (!/^\d{2}\/\d{2}$/.test(value)) return false;
        const [day, month] = value.split("/").map(Number);
        const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
    }
    const EMAIL_PATTERN = /^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?\.)+[A-Z]{2,}$/i;
    function normalizeOptionalEmail(value) {
        const email = String(value ?? "").trim();
        if (!email) return "";
        return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
    }
    function normalizeMobile(value) {
        const text = String(value || "").trim();
        return /^\d{10}$/.test(text) ? text : null;
    }
    function validMonth(value) {
        if (!/^\d{2}\/\d{2}$/.test(String(value || ""))) return null;
        const [day, month] = value.split("/").map(Number);
        const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? month : null;
    }
    function updateValidation(includeIncomplete = false) {
        const errors = [];
        for (const [id, label] of [["profileBirthday", "Birthday"], ["profileAnniversary", "Marriage Anniversary"]]) {
            const input = byId(id);
            const digits = digitsOnly(input.value, 4);
            const completed = digits.length === 4;
            const invalid = Boolean(input.value) && (completed ? !isValidDdMm(formatDdMmInput(digits)) : includeIncomplete);
            input.setCustomValidity(invalid ? `Enter a valid ${label} as DD/MM.` : "");
            input.classList.toggle("is-invalid", invalid);
            input.setAttribute("aria-invalid", invalid ? "true" : "false");
            if (invalid) errors.push(`${label} must be a valid DD/MM date.`);
        }
        const email = byId("profileEmail");
        const emailInvalid = Boolean(String(email.value ?? "").trim()) && normalizeOptionalEmail(email.value) === null;
        email.setCustomValidity(emailInvalid ? "Enter a valid email address." : "");
        email.classList.toggle("is-invalid", emailInvalid);
        email.setAttribute("aria-invalid", emailInvalid ? "true" : "false");
        if (emailInvalid) errors.push("Email must be a valid email address.");
        byId("customerProfileValidation").textContent = errors.join(" ");
        return errors.length === 0;
    }
    function bindDigitInput(input, maximum, dateOnly = false) {
        input.addEventListener("input", () => {
            const start = input.selectionStart ?? input.value.length;
            const before = digitsOnly(input.value.slice(0, start), maximum).length;
            const digits = digitsOnly(input.value, maximum);
            input.value = dateOnly ? formatDdMmInput(digits) : digits;
            if (dateOnly) updateValidation();
            const caret = dateOnly && before > 2 ? before + 1 : before;
            input.setSelectionRange(caret, caret);
        });
        input.addEventListener("paste", event => {
            event.preventDefault();
            const pasted = event.clipboardData?.getData("text") || "";
            const inserted = pasted.replace(/\D/g, "");
            if (!dateOnly && inserted.length > maximum) return;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? start;
            const current = digitsOnly(input.value, maximum);
            const first = digitsOnly(input.value.slice(0, start), maximum).length;
            const last = digitsOnly(input.value.slice(0, end), maximum).length;
            const next = (current.slice(0, first) + inserted + current.slice(last)).slice(0, maximum);
            input.value = dateOnly ? formatDdMmInput(next) : next;
            const after = Math.min(maximum, first + inserted.length);
            const caret = dateOnly && after > 2 ? after + 1 : after;
            input.setSelectionRange(caret, caret);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }

    function updateCustomerButton() {
        const mobile = normalizeMobile(mobileInput.value);
        const month = new Date().getMonth() + 1;
        const profile = selectedProfile;
        const event = Boolean(profile && (validMonth(profile.birthday_ddmm) === month || validMonth(profile.marriage_anniversary_ddmm) === month));
        const credit = Boolean(mobile && mobile === storeCreditMobile && availableStoreCredit && availableStoreCredit.status === "ISSUED" && Number(availableStoreCredit.remaining_balance) > 0);
        const attention = event || credit;
        const key = profile ? `${profile.id}:${mobile || ""}` : `mobile:${mobile || ""}`;
        const burst = attention && (!attentionActive || attentionResolutionKey !== key);
        customerButton.classList.toggle("is-customer-resolved", Boolean(profile) || credit);
        customerButton.classList.toggle("is-customer-attention", attention);
        customerButton.classList.remove("is-attention-burst", "is-attention-repeat");
        if (attention) {
            customerButton.classList.add(burst ? "is-attention-burst" : "is-attention-repeat");
            attentionResolutionKey = key;
        } else attentionResolutionKey = profile ? key : "";
        attentionActive = attention;
    }
    customerButton.addEventListener("animationend", event => {
        if (event.animationName === "customerAttentionBurst" && customerButton.classList.contains("is-customer-attention")) {
            customerButton.classList.remove("is-attention-burst");
            customerButton.classList.add("is-attention-repeat");
        }
    });
    function setSelected(profile) {
        selectedProfile = profile || null;
        selectedId.value = profile ? String(profile.id) : "";
        updateCustomerButton();
    }
    async function hydrateSelectedProfile(profile, request) {
        if (!profile) return;
        try {
            const full = await window.electronAPI.getCustomerProfile(profile.id);
            if (request !== latestLookup || selectedId.value !== String(profile.id)) return;
            if (full) { selectedProfile = full; updateCustomerButton(); }
        } catch (error) { console.error("Customer profile details could not be loaded:", error.message); }
    }
    function currentCredit(mobile = normalizeMobile(mobileInput.value)) {
        return mobile && mobile === storeCreditMobile && availableStoreCredit && availableStoreCredit.status === "ISSUED" && Number(availableStoreCredit.remaining_balance) > 0 ? availableStoreCredit : null;
    }
    function setStoreCredit(mobile, credit) {
        const normalized = normalizeMobile(mobile);
        if (!normalized) {
            if (!normalizeMobile(mobileInput.value)) { storeCreditMobile = ""; availableStoreCredit = null; updateCustomerButton(); }
            return;
        }
        if (normalizeMobile(mobileInput.value) !== normalized) return;
        storeCreditMobile = normalized;
        availableStoreCredit = credit && credit.status === "ISSUED" && Number(credit.remaining_balance) > 0 ? credit : null;
        updateCustomerButton();
        renderDrawerCredit();
    }
    window.updateNewBillCustomerStoreCredit = setStoreCredit;

    function setDrawerView(view) {
        chooserView.hidden = view !== "chooser";
        profileView.hidden = view !== "profile";
        formView.hidden = view !== "form";
        drawerMode = view;
        renderDrawerCredit();
    }
    function setDrawerTitle(title) { byId("customerProfileTitle").textContent = title; }
    function drawerIsOpen() { return drawer.dataset.customerContext === "new-bill" && drawer.style.display !== "none"; }
    function drawerInitialFocusTarget() {
        if (drawerMode === "form") {
            const currentName = String(byId("profileName").value || "").trim();
            const currentMobile = normalizeMobile(byId("profileMobile").value);
            return currentName ? (currentMobile ? byId("profileBirthday") : byId("profileMobile")) : byId("profileName");
        }
        return drawer.querySelector(`${focusableSelector}:not([hidden])`);
    }
    function openDrawer(view, title) {
        const focusSequence = ++drawerFocusSequence;
        drawerReturnFocus = document.activeElement;
        drawerError.textContent = "";
        drawer.dataset.customerContext = "new-bill";
        drawer.style.display = "block";
        drawer.classList.add("customer-drawer-open");
        newBillScreen.inert = true;
        newBillScreen.setAttribute("aria-hidden", "true");
        setDrawerView(view);
        setDrawerTitle(title);
        requestAnimationFrame(() => {
            // Resolve the offscreen panel transform before the next frame applies its visible state.
            window.getComputedStyle(panel).transform;
            requestAnimationFrame(() => {
                if (focusSequence !== drawerFocusSequence || !drawerIsOpen() || !drawer.classList.contains("customer-drawer-open")) return;
                drawer.classList.add("customer-drawer-visible");
                requestAnimationFrame(() => {
                    if (focusSequence !== drawerFocusSequence || !drawerIsOpen() || !drawer.classList.contains("customer-drawer-visible")) return;
                    const target = drawerInitialFocusTarget();
                    if (!target || !drawer.contains(target) || target.hidden || target.disabled || !target.isConnected || target.getClientRects().length === 0) return;
                    target.focus({ preventScroll: true });
                });
            });
        });
    }
    function closeDrawer() {
        if (!drawerIsOpen() || drawer.classList.contains("customer-drawer-closing")) return;
        drawerFocusSequence += 1;
        drawerProfileRequest += 1;
        purchaseHistoryRequest += 1;
        clearExpandedBill();
        drawerError.textContent = "";
        drawer.classList.remove("customer-drawer-open", "customer-drawer-visible");
        drawer.classList.add("customer-drawer-closing");
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            if (drawerCloseTimer !== null) clearTimeout(drawerCloseTimer);
            drawerCloseTimer = null;
            drawerCloseFinish = null;
            drawer.style.display = "none";
            drawer.classList.remove("customer-drawer-closing");
            newBillScreen.inert = false;
            newBillScreen.removeAttribute("aria-hidden");
            drawer.dataset.customerContext = "management";
            drawerMode = "closed";
            drawerReturnFocus = null;
            byId("barcodeInput")?.focus();
        };
        drawerCloseFinish = finish;
        panel.addEventListener("transitionend", finish, { once: true });
        drawerCloseTimer = window.setTimeout(finish, 280);
    }
    window.closeNewBillCustomerDrawer = closeDrawer;
    byId("customerDrawerBack").addEventListener("click", closeDrawer);
    drawer.addEventListener("click", event => { if (event.target === drawer) event.preventDefault(); });
    document.addEventListener("keydown", event => {
        if (!drawerIsOpen() || event.key !== "Tab") return;
        const items = [...drawer.querySelectorAll(focusableSelector)].filter(item => !item.hidden && item.getClientRects().length > 0);
        if (!items.length) { event.preventDefault(); return; }
        const first = items[0], last = items[items.length - 1];
        if (!drawer.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }, true);

    function showForm(profile, { newBill = false, editing = false } = {}) {
        drawerEditing = editing;
        const newBillContext = newBill || drawerIsOpen();
        drawerError.textContent = "";
        byId("customerProfileTitle").textContent = profile ? (editing ? "EDIT CUSTOMER DETAILS" : "CUSTOMER PROFILE") : "NEW CUSTOMER";
        byId("customerDrawerHelper").textContent = newBillContext ? "Customer details are optional for billing." : "Customer Profile · Optional";
        byId("customerProfileCancel").textContent = newBillContext ? (editing ? "CANCEL EDIT" : "CANCEL") : "CANCEL";
        byId("customerProfileSave").textContent = newBillContext ? (editing ? "SAVE CHANGES" : "SAVE CUSTOMER") : "SAVE";
        byId("profileName").value = profile?.name || nameInput.value || "";
        byId("profileMobile").value = profile?.mobile || mobileInput.value || "";
        byId("profileBirthday").value = profile?.birthday_ddmm || "";
        byId("profileAnniversary").value = profile?.marriage_anniversary_ddmm || "";
        byId("profileEmail").value = profile?.email || "";
        byId("profileNotes").value = profile?.notes || "";
        byId("customerProfileValidation").textContent = "";
        detailsSetProfileId(profile?.id);
        setDrawerView("form");
        if (newBill) {
            drawer.classList.add("customer-drawer-open");
            drawer.style.display = "block";
            newBillScreen.inert = true;
            newBillScreen.setAttribute("aria-hidden", "true");
        }
        const currentName = String(profile?.name || nameInput.value || "").trim();
        const currentMobile = String(profile?.mobile || mobileInput.value || "").trim();
        const focus = currentName && normalizeMobile(currentMobile) ? byId("profileBirthday") : currentName ? byId("profileMobile") : byId("profileName");
        requestAnimationFrame(() => { drawer.classList.add("customer-drawer-visible"); focus.focus(); });
    }
    function detailsSetProfileId(id) { drawer.dataset.profileId = id ? String(id) : ""; }

    function showManagementModal(profile = null) {
        drawer.classList.remove("customer-drawer-open", "customer-drawer-closing");
        drawer.dataset.customerContext = "management";
        drawer.style.display = "flex";
        drawerError.textContent = "";
        setDrawerView("form");
        byId("customerDrawerHelper").textContent = "Customer Profile · Optional";
        byId("customerProfileCancel").textContent = "CANCEL";
        byId("customerProfileSave").textContent = "SAVE";
        byId("customerProfileTitle").textContent = profile ? "EDIT CUSTOMER DETAILS" : "CUSTOMER DETAILS";
        byId("profileName").value = profile?.name || "";
        byId("profileMobile").value = profile?.mobile || "";
        byId("profileBirthday").value = profile?.birthday_ddmm || "";
        byId("profileAnniversary").value = profile?.marriage_anniversary_ddmm || "";
        byId("profileEmail").value = profile?.email || "";
        byId("profileNotes").value = profile?.notes || "";
        byId("customerProfileValidation").textContent = "";
        detailsSetProfileId(profile?.id);
        let focus = byId("profileName");
        if (profile?.name && normalizeMobile(profile.mobile)) focus = byId("profileBirthday");
        else if (profile?.name) focus = byId("profileMobile");
        requestAnimationFrame(() => focus.focus());
    }

    function showChooser(matches) {
        pendingMobile = normalizeMobile(mobileInput.value) || pendingMobile;
        const list = byId("customerDrawerChoices");
        list.replaceChildren();
        for (const profile of matches) {
            const row = document.createElement("div");
            row.className = "customer-choice";
            const label = document.createElement("span");
            label.textContent = `${profile.name} · ${profile.customer_code || "Customer ID unavailable"}`;
            const choose = document.createElement("button");
            choose.type = "button"; choose.textContent = "SELECT";
            choose.addEventListener("click", async () => {
                const request = ++latestLookup;
                setSelected(profile);
                if (!nameInput.value.trim()) nameInput.value = profile.name;
                setDrawerView("profile");
                await hydrateSelectedProfile(profile, request);
                await loadDrawerProfile(profile.id);
            });
            row.append(label, choose); list.append(row);
        }
        openDrawer("chooser", "SELECT CUSTOMER");
    }
    byId("customerDrawerNewChoice").addEventListener("click", () => {
        setSelected(null);
        showForm(null, { newBill: true });
        byId("profileMobile").value = pendingMobile;
    });

    function displayDdMm(value) {
        if (!value || !isValidDdMm(value)) return "—";
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const [day, month] = value.split("/").map(Number);
        return `${day.toString().padStart(2, "0")}-${months[month - 1]}`;
    }
    function displayDate(value) {
        if (!value) return "—";
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
        if (!match) return String(value);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = Number(match[2]);
        return month >= 1 && month <= 12 ? `${String(Number(match[3])).padStart(2, "0")}-${months[month - 1]}-${match[1]}` : String(value);
    }
    function money(value) { return `₹${Number(value || 0).toFixed(2)}`; }
    function creditDate(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
        if (!match) return value || "—";
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = Number(match[2]);
        return month >= 1 && month <= 12 ? `${String(Number(match[3])).padStart(2, "0")}-${months[month - 1]}-${match[1]}` : String(value);
    }
    function renderDrawerCredit() {
        const credit = currentCredit();
        const profileCredit = byId("drawerStoreCreditSection");
        const onlyCredit = byId("drawerStoreCreditOnly");
        const resolvedProfile = drawerMode === "profile" && Boolean(selectedProfile);
        const mobileOnlyCredit = drawerIsOpen() && drawerMode === "form" &&
            !selectedProfile && /^\d{10}$/.test(normalizeMobile(mobileInput.value)) && Boolean(credit);
        profileCredit.hidden = !resolvedProfile;
        profileCredit.classList.toggle("is-available", resolvedProfile && Boolean(credit));
        onlyCredit.hidden = !mobileOnlyCredit;
        onlyCredit.classList.toggle("is-available", mobileOnlyCredit);
        byId("drawerStoreCreditEmpty").hidden = Boolean(credit);
        for (const id of ["drawerStoreCreditAmount", "drawerStoreCreditValidity", "drawerStoreCreditReference"]) byId(id).hidden = !credit;
        if (!credit) return;
        const amount = `${money(credit.remaining_balance)} AVAILABLE`;
        const validity = `Valid Until: ${creditDate(credit.valid_until)}`;
        const reference = credit.store_credit_no ? `SC Ref: ${credit.store_credit_no}` : "";
        byId("drawerStoreCreditAmount").textContent = amount;
        byId("drawerStoreCreditValidity").textContent = validity;
        byId("drawerStoreCreditReference").textContent = reference;
        byId("drawerCreditOnlyAmount").textContent = amount;
        byId("drawerCreditOnlyValidity").textContent = validity;
        byId("drawerCreditOnlyReference").textContent = reference;
    }
    function appendTextCell(row, text) { const cell = document.createElement("td"); cell.textContent = text; row.append(cell); return cell; }
    function clearExpandedBill() {
        expandedBillRequest += 1;
        if (expandedBillRow) expandedBillRow.remove();
        if (expandedPurchaseRow) expandedPurchaseRow.classList.remove("is-purchase-expanded");
        if (expandedBillButton) { expandedBillButton.textContent = "DETAILS ▾"; expandedBillButton.disabled = false; }
        expandedBillButton = null;
        expandedBillRow = null;
        expandedPurchaseRow = null;
        expandedBillNo = "";
    }
    function renderInlineBill(details, root) {
        root.replaceChildren();
        const bill = details.bill;
        const heading = document.createElement("h5"); heading.textContent = `${bill.bill_no} · ${displayDate(bill.bill_date)}`; root.append(heading);
        const table = document.createElement("table"); table.className = "customer-info-table customer-drawer-inline-table";
        const head = document.createElement("thead"); head.innerHTML = "<tr><th>ITEM</th><th>QTY</th><th>AMOUNT</th></tr>";
        const body = document.createElement("tbody");
        for (const item of details.items || []) {
            const row = document.createElement("tr");
            appendTextCell(row, [item.product_name, item.size, item.colour].filter(Boolean).join(" · ") || item.barcode || "Item");
            appendTextCell(row, String(item.qty ?? "—"));
            appendTextCell(row, money(item.net_amount)); body.append(row);
        }
        table.append(head, body); root.append(table);
        const summary = document.createElement("dl"); summary.className = "customer-drawer-bill-summary";
        const fields = [["Taxable", bill.taxable_amount], ["Gross", bill.gross_amount], ["Discount", bill.discount_amount], ["CGST", bill.cgst_amount], ["SGST", bill.sgst_amount], ["GST", bill.gst_amount], ["Net", bill.net_amount], ["Cash", bill.cash_amount], ["UPI", bill.upi_amount], ["Card", bill.card_amount], ["Store Credit", bill.store_credit_amount], ["Gift Voucher", bill.gift_voucher_amount]];
        for (const [label, value] of fields) { const wrapper = document.createElement("div"); const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = money(value); wrapper.append(dt, dd); summary.append(wrapper); }
        root.append(summary);
    }
    async function toggleInlineBill(billNo, button, row) {
        if (expandedBillNo === billNo) { clearExpandedBill(); return; }
        clearExpandedBill(); expandedBillNo = billNo; button.disabled = true; button.textContent = "LOADING…";
        const request = ++expandedBillRequest;
        expandedBillButton = button;
        try {
            const details = await window.electronAPI.getBillDetails(billNo);
            if (request !== expandedBillRequest || expandedBillNo !== billNo) return;
            const detailRow = document.createElement("tr"); detailRow.className = "customer-drawer-inline";
            const detailCell = document.createElement("td"); detailCell.colSpan = 4; detailRow.append(detailCell);
            renderInlineBill(details, detailCell); row.after(detailRow);
            expandedBillRow = detailRow; expandedPurchaseRow = row; row.classList.add("is-purchase-expanded");
            button.textContent = "DETAILS ▴";
        } catch (error) {
            if (expandedBillNo === billNo) { drawerError.textContent = error.message || "Bill details could not be loaded."; clearExpandedBill(); }
        } finally { button.disabled = false; if (expandedBillNo !== billNo) button.textContent = "DETAILS ▾"; }
    }
    function renderHistory(result) {
        const body = byId("drawerPurchaseRows"); body.replaceChildren();
        for (const bill of result.rows || []) {
            const row = document.createElement("tr");
            appendTextCell(row, displayDate(bill.bill_date)); appendTextCell(row, bill.bill_no); appendTextCell(row, money(bill.net_amount));
            const action = document.createElement("td"); const view = document.createElement("button");
            view.type = "button"; view.className = "customer-drawer-details-toggle"; view.textContent = expandedBillNo === bill.bill_no ? "DETAILS ▴" : "DETAILS ▾";
            view.addEventListener("click", () => toggleInlineBill(bill.bill_no, view, row)); action.append(view); row.append(action); body.append(row);
        }
        const empty = result.totalCount === 0;
        byId("drawerPurchaseEmpty").hidden = !empty;
        byId("drawerPurchaseTableWrap").hidden = empty;
        const pagination = byId("drawerPurchasePagination"); pagination.hidden = empty;
        purchaseHistoryPage = result.page; purchaseHistoryTotalPages = result.totalPages;
        if (!empty) {
            const first = (result.page - 1) * result.pageSize + 1;
            const noun = result.totalCount === 1 ? "purchase" : "purchases";
            byId("drawerPurchaseRange").textContent = `Showing ${first}–${Math.min(result.page * result.pageSize, result.totalCount)} of ${result.totalCount} ${noun}`;
            byId("drawerPurchasePage").textContent = `Page ${result.page} of ${result.totalPages}`;
            byId("drawerPurchaseControls").hidden = result.totalPages <= 1;
            byId("drawerPurchasePrevious").disabled = result.page <= 1;
            byId("drawerPurchaseNext").disabled = result.page >= result.totalPages;
            byId("drawerPurchaseJump").value = String(result.page); byId("drawerPurchaseJump").max = String(result.totalPages);
        }
    }
    async function loadDrawerHistory(requestedPage = purchaseHistoryPage) {
        const id = Number(selectedId.value); if (!id) return;
        clearExpandedBill();
        const request = ++purchaseHistoryRequest;
        const profileRequest = drawerProfileRequest;
        try {
            const result = await window.electronAPI.getCustomerPurchaseHistoryPage(id, { page: requestedPage, pageSize: 100 });
            if (request !== purchaseHistoryRequest || profileRequest !== drawerProfileRequest || id !== Number(selectedId.value)) return;
            renderHistory(result);
        } catch (error) { drawerError.textContent = error.message || "Purchase history could not be loaded."; }
    }
    byId("drawerPurchasePrevious").addEventListener("click", () => { if (purchaseHistoryPage > 1) loadDrawerHistory(purchaseHistoryPage - 1); });
    byId("drawerPurchaseNext").addEventListener("click", () => { if (purchaseHistoryPage < purchaseHistoryTotalPages) loadDrawerHistory(purchaseHistoryPage + 1); });
    byId("drawerPurchaseJump").addEventListener("keydown", event => {
        if (event.key !== "Enter") return; event.preventDefault();
        const target = Number(byId("drawerPurchaseJump").value);
        if (Number.isInteger(target) && target >= 1 && target <= purchaseHistoryTotalPages) loadDrawerHistory(target);
        else byId("drawerPurchaseJump").value = String(purchaseHistoryPage);
    });
    async function loadDrawerProfile(id, { preservePage = false } = {}) {
        const request = ++drawerProfileRequest;
        const historyRequest = ++purchaseHistoryRequest;
        selectedProfile = null;
        updateCustomerButton();
        drawerError.textContent = "Loading customer profile…"; clearExpandedBill();
        byId("drawerCustomerName").textContent = "";
        byId("drawerCustomerCode").textContent = "";
        byId("drawerCustomerMobile").textContent = "";
        for (const field of ["drawerBirthday", "drawerAnniversary", "drawerEmail", "drawerNotes"]) byId(field).textContent = "—";
        byId("drawerBirthday").classList.remove("is-drawer-event");
        byId("drawerAnniversary").classList.remove("is-drawer-event");
        byId("drawerCustomerEvents").hidden = true;
        byId("drawerCustomerEventText").textContent = "";
        byId("drawerBillCount").textContent = "0";
        byId("drawerSpend").textContent = "₹0.00";
        byId("drawerLastVisit").textContent = "Never";
        byId("drawerAverage").textContent = "₹0.00";
        byId("drawerPurchaseRows").replaceChildren();
        byId("drawerPurchaseEmpty").hidden = true;
        byId("drawerPurchaseTableWrap").hidden = true;
        byId("drawerPurchasePagination").hidden = true;
        setDrawerView("profile"); setDrawerTitle("CUSTOMER PROFILE");
        try {
            const [profile, history] = await Promise.all([
                window.electronAPI.getCustomerManagementProfile(id),
                window.electronAPI.getCustomerPurchaseHistoryPage(id, { page: preservePage ? purchaseHistoryPage : 1, pageSize: 100 })
            ]);
            if (request !== drawerProfileRequest || historyRequest !== purchaseHistoryRequest || id !== Number(selectedId.value)) return;
            if (!profile) { drawerError.textContent = "This customer profile is no longer available."; return; }
            selectedProfile = profile; updateCustomerButton();
            byId("drawerCustomerName").textContent = profile.name || "";
            byId("drawerCustomerCode").textContent = profile.customer_code ? `Customer ID: ${profile.customer_code}` : "Customer ID unavailable";
            byId("drawerCustomerMobile").textContent = profile.mobile || "—";
            byId("drawerBirthday").textContent = displayDdMm(profile.birthday_ddmm);
            byId("drawerAnniversary").textContent = displayDdMm(profile.marriage_anniversary_ddmm);
            byId("drawerEmail").textContent = profile.email || "—";
            byId("drawerNotes").textContent = profile.notes || "—";
            byId("drawerBillCount").textContent = String(profile.total_bills || 0);
            byId("drawerSpend").textContent = money(profile.total_spend);
            byId("drawerLastVisit").textContent = profile.last_visit ? displayDate(profile.last_visit) : "Never";
            byId("drawerAverage").textContent = money(profile.average_bill);
            const month = new Date().getMonth() + 1;
            const birthdayThisMonth = validMonth(profile.birthday_ddmm) === month;
            const anniversaryThisMonth = validMonth(profile.marriage_anniversary_ddmm) === month;
            byId("drawerBirthday").classList.toggle("is-drawer-event", birthdayThisMonth);
            byId("drawerAnniversary").classList.toggle("is-drawer-event", anniversaryThisMonth);
            byId("drawerBirthdayLabel").textContent = "Birthday";
            byId("drawerAnniversaryLabel").textContent = "Marriage Anniversary";
            const events = [birthdayThisMonth ? "Birthday this month" : "", anniversaryThisMonth ? "Marriage Anniversary this month" : ""].filter(Boolean);
            byId("drawerCustomerEvents").hidden = events.length === 0;
            byId("drawerCustomerEventText").textContent = events.join(" · ");
            drawerError.textContent = "";
            renderHistory(history); renderDrawerCredit();
        } catch (error) { if (request === drawerProfileRequest) drawerError.textContent = error.message || "Customer profile could not be loaded."; }
    }

    bindDigitInput(mobileInput, 10);
    bindDigitInput(byId("profileMobile"), 10);
    bindDigitInput(byId("profileBirthday"), 4, true);
    bindDigitInput(byId("profileAnniversary"), 4, true);
    byId("profileBirthday").addEventListener("input", () => updateValidation());
    byId("profileAnniversary").addEventListener("input", () => updateValidation());
    byId("profileEmail").addEventListener("input", () => updateValidation());

    async function lookupMobile(mobile, openAmbiguous = true) {
        const normalized = normalizeMobile(mobile); const request = ++latestLookup;
        setSelected(null);
        if (!normalized) return;
        try {
            const matches = await window.electronAPI.findCustomersByMobile(normalized);
            if (request !== latestLookup || normalizeMobile(mobileInput.value) !== normalized) return;
            if (matches.length === 1) {
                setSelected(matches[0]); if (!nameInput.value.trim()) nameInput.value = matches[0].name;
                hydrateSelectedProfile(matches[0], request);
            } else if (matches.length > 1) {
                pendingMobile = normalized;
                if (openAmbiguous && chooserShownFor !== normalized) { chooserShownFor = normalized; showChooser(matches); }
            }
        } catch (error) { console.error("Customer profile lookup failed:", error.message); }
    }
    mobileInput.addEventListener("input", () => {
        setSelected(null); storeCreditMobile = ""; availableStoreCredit = null; updateCustomerButton();
        clearTimeout(mobileInput._customerLookupTimer);
        const normalized = normalizeMobile(mobileInput.value);
        mobileInput._customerLookupTimer = setTimeout(() => lookupMobile(normalized, true), 180);
    });
    customerButton.addEventListener("click", async () => {
        const mobile = normalizeMobile(mobileInput.value);
        const id = Number(selectedId.value);
        if (id) {
            openDrawer("profile", "CUSTOMER PROFILE");
            await loadDrawerProfile(id);
            return;
        }
        let matches = [];
        if (mobile) {
            const request = ++latestLookup;
            try { matches = await window.electronAPI.findCustomersByMobile(mobile); }
            catch (error) {
                openDrawer("form", "NEW CUSTOMER");
                byId("customerDrawerHelper").textContent = "Customer details are optional for billing.";
                byId("customerProfileSave").textContent = "SAVE CUSTOMER";
                byId("profileName").value = nameInput.value || "";
                byId("profileMobile").value = mobileInput.value || "";
                drawerError.textContent = error.message || "Customer profiles could not be loaded.";
                return;
            }
            if (request !== latestLookup || normalizeMobile(mobileInput.value) !== mobile) return;
        }
        if (matches.length > 1) { pendingMobile = mobile; showChooser(matches); return; }
        if (matches.length === 1) {
            setSelected(matches[0]); if (!nameInput.value.trim()) nameInput.value = matches[0].name;
            const request = ++latestLookup; await hydrateSelectedProfile(matches[0], request);
            openDrawer("profile", "CUSTOMER PROFILE"); await loadDrawerProfile(matches[0].id); return;
        }
        openDrawer("form", "NEW CUSTOMER");
        byId("customerDrawerHelper").textContent = "Customer details are optional for billing.";
        byId("customerProfileCancel").textContent = "CANCEL";
        byId("customerProfileSave").textContent = "SAVE CUSTOMER";
        byId("profileName").value = nameInput.value || ""; byId("profileMobile").value = mobileInput.value || "";
        byId("profileBirthday").value = ""; byId("profileAnniversary").value = ""; byId("profileEmail").value = ""; byId("profileNotes").value = "";
        byId("drawerCustomerName").textContent = "";
        if (mobile && currentCredit(mobile)) renderDrawerCredit();
        else if (mobile) {
            try { setStoreCredit(mobile, await window.electronAPI.getAvailableStoreCreditByMobile(mobile)); }
            catch (error) { console.error("Store Credit lookup failed:", error.message); }
        }
    });

    byId("customerProfileCancel").addEventListener("click", () => {
        if (drawerIsOpen() && drawerEditing) { drawerEditing = false; loadDrawerProfile(Number(selectedId.value)); return; }
        if (drawerIsOpen()) { closeDrawer(); return; }
        managementSaveHandler = null; drawer.style.display = "none";
    });
    byId("customerDrawerEdit").addEventListener("click", async () => {
        try {
            const profile = await window.electronAPI.getCustomerProfile(Number(selectedId.value));
            if (profile) showForm(profile, { newBill: true, editing: true });
            else drawerError.textContent = "This customer profile is no longer available.";
        } catch (error) {
            drawerError.textContent = error.message || "Customer details could not be loaded for editing.";
        }
    });
    byId("customerProfileSave").addEventListener("click", async () => {
        const validation = byId("customerProfileValidation");
        updateValidation(true);
        for (const id of ["profileBirthday", "profileAnniversary"]) {
            const input = byId(id); if (input.value && !isValidDdMm(input.value)) { input.focus(); return; }
        }
        const email = normalizeOptionalEmail(byId("profileEmail").value); if (email === null) { byId("profileEmail").focus(); return; }
        const data = { name: byId("profileName").value, mobile: byId("profileMobile").value, birthday_ddmm: byId("profileBirthday").value, marriage_anniversary_ddmm: byId("profileAnniversary").value, email, notes: byId("profileNotes").value };
        const id = Number(drawer.dataset.profileId); const save = byId("customerProfileSave"); save.disabled = true;
        try {
            const profile = id ? await window.electronAPI.updateCustomerProfile(id, data) : await window.electronAPI.createCustomerProfile(data);
            if (managementSaveHandler) { const done = managementSaveHandler; managementSaveHandler = null; drawer.style.display = "none"; await done(profile); return; }
            setSelected(profile);
            if (!id) { nameInput.value = profile.name; mobileInput.value = profile.mobile; }
            if (drawerIsOpen()) {
                drawerEditing = false; pendingMobile = profile.mobile || "";
                await loadDrawerProfile(profile.id); drawerBody.scrollTop = 0;
            } else { drawer.style.display = "none"; }
        } catch (error) { validation.textContent = error.message || "Customer profile could not be saved."; }
        finally { save.disabled = false; }
    });
    window.openCustomerDetailsForManagement = (profile, onSaved) => {
        managementSaveHandler = typeof onSaved === "function" ? onSaved : null;
        showManagementModal(profile || null);
    };
    // Customer Management continues to use the shared, accepted modal form.
    window.customerProfileInputHelpers = { digitsOnly, formatDdMmInput, isValidDdMm, normalizeOptionalEmail };
    window.clearSelectedCustomerProfile = () => { setSelected(null); chooserShownFor = ""; };
    window.resetCustomerProfileDraft = () => {
        clearTimeout(mobileInput._customerLookupTimer); latestLookup += 1; drawerProfileRequest += 1; purchaseHistoryRequest += 1;
        pendingMobile = ""; chooserShownFor = ""; selectedProfile = null; selectedId.value = "";
        storeCreditMobile = ""; availableStoreCredit = null; updateCustomerButton();
        if (drawerCloseTimer !== null) clearTimeout(drawerCloseTimer);
        if (drawerCloseFinish) panel.removeEventListener("transitionend", drawerCloseFinish);
        drawerCloseTimer = null; drawerCloseFinish = null;
        drawer.style.display = "none"; drawer.classList.remove("customer-drawer-open", "customer-drawer-visible", "customer-drawer-closing");
        newBillScreen.inert = false; newBillScreen.removeAttribute("aria-hidden"); drawer.dataset.customerContext = "management";
        byId("customerProfileValidation").textContent = ""; drawerError.textContent = "";
        for (const id of ["profileName", "profileMobile", "profileBirthday", "profileAnniversary", "profileEmail", "profileNotes"]) {
            const input = byId(id); input.value = ""; input.setCustomValidity?.(""); input.classList?.remove("is-invalid"); input.setAttribute?.("aria-invalid", "false");
        }
        byId("customerDrawerChoices").replaceChildren(); byId("drawerPurchaseRows").replaceChildren(); clearExpandedBill();
        setDrawerView("form"); drawerEditing = false;
        customerButton.classList.remove("is-customer-resolved", "is-customer-attention", "is-attention-burst", "is-attention-repeat");
    };
    window.isNewBillCustomerDrawerOpen = drawerIsOpen;
})();
