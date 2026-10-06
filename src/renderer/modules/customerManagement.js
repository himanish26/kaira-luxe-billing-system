(() => {
    const byId = id => document.getElementById(id);
    const directoryView = byId("customerDirectoryView");
    const profileView = byId("customerManagementProfile");
    if (!directoryView || !profileView) return;

    const CUSTOMER_DIRECTORY_PAGE_SIZE = 100;
    const CUSTOMER_PURCHASE_PAGE_SIZE = 100;
    const RETURN_TO_CUSTOMER_DIRECTORY = "RETURN_TO_CUSTOMER_DIRECTORY";
    const FRESH_CUSTOMER_DIRECTORY_ENTRY = "FRESH_CUSTOMER_DIRECTORY_ENTRY";
    let activeCustomerId = null;
    let directoryScrollTop = 0;
    let profileScrollTop = 0;
    let directoryPage = 1;
    let directoryTotalCount = 0;
    let directoryTotalPages = 1;
    let directorySearch = "";
    let searchTimer = null;
    let latestSearch = 0;
    let purchaseHistoryPage = 1;
    let purchaseHistoryTotalCount = 0;
    let purchaseHistoryTotalPages = 1;
    let latestPurchaseRequest = 0;

    function money(value) {
        return `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function displayDate(value) {
        if (!value) return "—";
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
        return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
    }

    function displayDdMm(value) {
        const text = String(value ?? "").trim();
        if (!text) return "—";
        const match = /^(\d{2})\/(\d{2})$/.exec(text);
        if (!match) return "—";
        const day = Number(match[1]);
        const month = Number(match[2]);
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return "—";
        return `${match[1]}-${monthNames[month - 1]}`;
    }

    function textCell(row, value, className = "") {
        const cell = document.createElement("td");
        if (className) cell.className = className;
        cell.textContent = value == null || value === "" ? "—" : String(value);
        row.append(cell);
        return cell;
    }

    function showMessage(targetId, message, isError = false) {
        const target = byId(targetId);
        target.textContent = message || "";
        target.classList.toggle("is-error", Boolean(message && isError));
    }

    function setDirectoryPresentation({ rows, totalCount, search, loading = false, error = false }) {
        const hasSearch = Boolean(String(search || "").trim());
        const hasRows = totalCount > 0;
        byId("customerDirectoryEmpty").hidden = loading || error || hasSearch || hasRows;
        byId("customerDirectoryNoResults").hidden = loading || error || !hasSearch || hasRows;
        byId("customerDirectoryTableWrap").hidden = loading || error || !hasRows;
        byId("customerDirectoryPagination").hidden = loading || error || !hasRows;
    }

    function updateDirectoryPagination() {
        const previous = byId("customerDirectoryPrevious");
        const next = byId("customerDirectoryNext");
        const pageLabel = byId("customerDirectoryPageLabel");
        const rangeLabel = byId("customerDirectoryRangeLabel");
        const jump = byId("customerDirectoryPageJump");
        const first = directoryTotalCount === 0 ? 0 : ((directoryPage - 1) * CUSTOMER_DIRECTORY_PAGE_SIZE) + 1;
        const last = Math.min(directoryPage * CUSTOMER_DIRECTORY_PAGE_SIZE, directoryTotalCount);
        previous.disabled = directoryPage <= 1;
        next.disabled = directoryPage >= directoryTotalPages;
        pageLabel.textContent = `Page ${directoryPage.toLocaleString("en-US")} of ${directoryTotalPages.toLocaleString("en-US")}`;
        jump.value = String(directoryPage);
        jump.max = String(directoryTotalPages);
        rangeLabel.textContent = `Showing ${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")} of ${directoryTotalCount.toLocaleString("en-US")} customers`;
    }

    async function loadDirectory({ search = byId("customerDirectorySearch").value, page = directoryPage, restoreScroll = false } = {}) {
        directorySearch = String(search ?? "").trim();
        const requestedPage = Number.parseInt(page, 10);
        const request = ++latestSearch;
        showMessage("customerDirectoryMessage", "Loading customers…");
        setDirectoryPresentation({ rows: [], totalCount: 0, search: directorySearch, loading: true });
        try {
            const result = await window.electronAPI.listCustomerDirectory({
                search: directorySearch,
                page: Number.isFinite(requestedPage) ? requestedPage : 1,
                pageSize: CUSTOMER_DIRECTORY_PAGE_SIZE
            });
            if (request !== latestSearch) return;
            directoryPage = result.page;
            directoryTotalCount = result.totalCount;
            directoryTotalPages = result.totalPages;
            const body = byId("customerDirectoryRows");
            body.replaceChildren();
            for (const customer of result.rows) {
                const row = document.createElement("tr");
                textCell(row, customer.customer_code || "—", "customer-directory-code");
                textCell(row, customer.name, "customer-directory-name");
                textCell(row, customer.mobile);
                textCell(row, Number(customer.total_bills || 0));
                textCell(row, money(customer.total_spend));
                textCell(row, displayDate(customer.last_visit));
                const actionCell = document.createElement("td");
                const open = document.createElement("button");
                open.type = "button";
                open.className = "customer-open-profile";
                open.textContent = "VIEW PROFILE";
                open.addEventListener("click", () => openCustomerProfile(customer.id));
                actionCell.append(open);
                row.append(actionCell);
                body.append(row);
            }
            setDirectoryPresentation({ rows: result.rows, totalCount: result.totalCount, search: directorySearch });
            updateDirectoryPagination();
            showMessage("customerDirectoryMessage", "");
            if (restoreScroll) requestAnimationFrame(() => window.scrollTo(0, directoryScrollTop));
        } catch (error) {
            if (request !== latestSearch) return;
            byId("customerDirectoryRows").replaceChildren();
            setDirectoryPresentation({ rows: [], totalCount: 0, search: directorySearch, error: true });
            showMessage("customerDirectoryMessage", error.message || "Customer directory could not be loaded.", true);
            if (restoreScroll) requestAnimationFrame(() => window.scrollTo(0, directoryScrollTop));
        }
    }

    function showDirectory({ context = RETURN_TO_CUSTOMER_DIRECTORY, restoreScroll = false } = {}) {
        if (context === FRESH_CUSTOMER_DIRECTORY_ENTRY) {
            directorySearch = "";
            directoryPage = 1;
            directoryScrollTop = 0;
            byId("customerDirectorySearch").value = "";
        } else {
            byId("customerDirectorySearch").value = directorySearch;
        }
        activeCustomerId = null;
        profileView.hidden = true;
        directoryView.hidden = false;
        showMessage("customerManagementMessage", "");
        return loadDirectory({ search: directorySearch, page: directoryPage, restoreScroll });
    }

    async function openCustomerProfile(id, { saveDirectoryScroll = true } = {}) {
        if (saveDirectoryScroll) directoryScrollTop = window.scrollY || 0;
        directoryView.hidden = true;
        profileView.hidden = false;
        activeCustomerId = Number(id);
        purchaseHistoryPage = 1;
        showMessage("customerManagementMessage", "Loading customer profile…");
        byId("customerPurchaseRows").replaceChildren();
        setPurchaseHistoryPresentation({ loading: true });
        try {
            const [profile, purchaseHistory] = await Promise.all([
                window.electronAPI.getCustomerManagementProfile(activeCustomerId),
                window.electronAPI.getCustomerPurchaseHistoryPage(activeCustomerId, {
                    page: 1,
                    pageSize: CUSTOMER_PURCHASE_PAGE_SIZE
                })
            ]);
            if (activeCustomerId !== Number(id)) return;
            if (!profile) {
                showDirectory({ context: RETURN_TO_CUSTOMER_DIRECTORY, restoreScroll: true });
                showMessage("customerDirectoryMessage", "This customer profile is no longer available.", true);
                return;
            }
            renderProfile(profile);
            renderPurchaseHistory(purchaseHistory);
            showMessage("customerManagementMessage", "");
            window.scrollTo(0, 0);
        } catch (error) {
            if (activeCustomerId !== Number(id)) return;
            setPurchaseHistoryPresentation({ error: true });
            showMessage("customerManagementMessage", error.message || "Customer profile could not be loaded.", true);
        }
    }

    function renderProfile(profile) {
        byId("managementCustomerName").textContent = profile.name;
        byId("managementCustomerCode").textContent = profile.customer_code ? `Customer ID · ${profile.customer_code}` : "Customer ID pending normalization";
        byId("managementCustomerMobile").textContent = profile.mobile || "—";
        byId("managementCustomerBirthday").textContent = displayDdMm(profile.birthday_ddmm);
        byId("managementCustomerAnniversary").textContent = displayDdMm(profile.marriage_anniversary_ddmm);
        byId("managementCustomerEmail").textContent = profile.email || "—";
        byId("managementCustomerNotes").textContent = profile.notes || "—";
        byId("managementCustomerBillCount").textContent = String(profile.total_bills || 0);
        byId("managementCustomerSpend").textContent = money(profile.total_spend);
        byId("managementCustomerLastVisit").textContent = profile.last_visit ? displayDate(profile.last_visit) : "Never";
        byId("managementCustomerAverage").textContent = money(profile.average_bill);

    }

    function setPurchaseHistoryPresentation({ totalCount = purchaseHistoryTotalCount, loading = false, error = false } = {}) {
        const hasRows = totalCount > 0;
        byId("customerPurchaseEmpty").hidden = loading || error || hasRows;
        byId("customerPurchaseTableWrap").hidden = loading || error || !hasRows;
        byId("customerPurchasePagination").hidden = loading || error || !hasRows;
    }

    function updatePurchaseHistoryPagination() {
        const previous = byId("customerPurchasePrevious");
        const next = byId("customerPurchaseNext");
        const first = purchaseHistoryTotalCount === 0 ? 0 : ((purchaseHistoryPage - 1) * CUSTOMER_PURCHASE_PAGE_SIZE) + 1;
        const last = Math.min(purchaseHistoryPage * CUSTOMER_PURCHASE_PAGE_SIZE, purchaseHistoryTotalCount);
        previous.disabled = purchaseHistoryPage <= 1;
        next.disabled = purchaseHistoryPage >= purchaseHistoryTotalPages;
        byId("customerPurchasePageLabel").textContent = `Page ${purchaseHistoryPage.toLocaleString("en-US")} of ${purchaseHistoryTotalPages.toLocaleString("en-US")}`;
        const jump = byId("customerPurchasePageJump");
        jump.value = String(purchaseHistoryPage);
        jump.max = String(purchaseHistoryTotalPages);
        byId("customerPurchaseRangeLabel").textContent = `Showing ${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")} of ${purchaseHistoryTotalCount.toLocaleString("en-US")} purchases`;
    }

    function renderPurchaseHistory(result) {
        purchaseHistoryPage = result.page;
        purchaseHistoryTotalCount = result.totalCount;
        purchaseHistoryTotalPages = result.totalPages;
        const body = byId("customerPurchaseRows");
        body.replaceChildren();
        for (const bill of result.rows) {
            const row = document.createElement("tr");
            textCell(row, displayDate(bill.bill_date));
            textCell(row, bill.bill_no);
            textCell(row, `${Number(bill.total_items || 0)} items · ${Number(bill.total_qty || 0)} qty`);
            textCell(row, money(bill.net_amount));
            const actionCell = document.createElement("td");
            const open = document.createElement("button");
            open.type = "button";
            open.className = "customer-open-profile";
            open.textContent = "VIEW BILL";
            open.addEventListener("click", () => {
                profileScrollTop = window.scrollY || 0;
                window.viewBill(bill.bill_no, {
                    type: "customer-profile",
                    customerId: activeCustomerId,
                    historyPage: purchaseHistoryPage
                });
            });
            actionCell.append(open);
            row.append(actionCell);
            body.append(row);
        }
        setPurchaseHistoryPresentation({ totalCount: result.totalCount });
        updatePurchaseHistoryPagination();
    }

    async function loadPurchaseHistory(requestedPage = purchaseHistoryPage) {
        if (!activeCustomerId) return;
        const customerId = activeCustomerId;
        const request = ++latestPurchaseRequest;
        setPurchaseHistoryPresentation({ loading: true });
        try {
            const result = await window.electronAPI.getCustomerPurchaseHistoryPage(customerId, {
                page: requestedPage,
                pageSize: CUSTOMER_PURCHASE_PAGE_SIZE
            });
            if (request !== latestPurchaseRequest || customerId !== activeCustomerId) return;
            renderPurchaseHistory(result);
        } catch (error) {
            if (request !== latestPurchaseRequest || customerId !== activeCustomerId) return;
            setPurchaseHistoryPresentation({ error: true });
            showMessage("customerManagementMessage", error.message || "Purchase history could not be loaded.", true);
        }
    }

    byId("customerDirectoryAdd").addEventListener("click", () => {
        clearTimeout(searchTimer);
        window.openCustomerDetailsForManagement(null, async profile => {
            byId("customerDirectorySearch").value = "";
            directoryPage = 1;
            directorySearch = "";
            await loadDirectory({ search: "", page: 1 });
            await openCustomerProfile(profile.id);
        });
    });
    byId("customerDirectorySearch").addEventListener("input", () => {
        clearTimeout(searchTimer);
        latestSearch += 1;
        directoryPage = 1;
        showMessage("customerDirectoryMessage", "Loading customers…");
        setDirectoryPresentation({ rows: [], totalCount: 0, search: byId("customerDirectorySearch").value, loading: true });
        searchTimer = setTimeout(() => loadDirectory({ search: byId("customerDirectorySearch").value, page: 1 }), 120);
    });
    byId("customerProfileBackToDirectory").addEventListener("click", () => showDirectory({
        context: RETURN_TO_CUSTOMER_DIRECTORY,
        restoreScroll: true
    }));
    byId("customerDirectoryPrevious").addEventListener("click", () => {
        if (directoryPage > 1) loadDirectory({ search: directorySearch, page: directoryPage - 1 });
    });
    byId("customerPurchasePrevious").addEventListener("click", () => {
        if (purchaseHistoryPage > 1) loadPurchaseHistory(purchaseHistoryPage - 1);
    });
    byId("customerPurchaseNext").addEventListener("click", () => {
        if (purchaseHistoryPage < purchaseHistoryTotalPages) loadPurchaseHistory(purchaseHistoryPage + 1);
    });
    byId("customerPurchasePageJump").addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const input = byId("customerPurchasePageJump");
        const rawValue = input.value.trim();
        const target = Number(rawValue);
        if (!/^\d+$/.test(rawValue) || !Number.isSafeInteger(target) || target < 1 || target > purchaseHistoryTotalPages) {
            input.value = String(purchaseHistoryPage);
            return;
        }
        loadPurchaseHistory(target);
    });
    byId("customerDirectoryNext").addEventListener("click", () => {
        if (directoryPage < directoryTotalPages) loadDirectory({ search: directorySearch, page: directoryPage + 1 });
    });
    byId("customerDirectoryPageJump").addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const input = byId("customerDirectoryPageJump");
        const rawValue = input.value.trim();
        const target = Number(rawValue);
        if (!/^\d+$/.test(rawValue) || !Number.isSafeInteger(target) || target < 1 || target > directoryTotalPages) {
            input.value = String(directoryPage);
            return;
        }
        loadDirectory({ search: directorySearch, page: target });
    });
    byId("customerProfileEdit").addEventListener("click", async () => {
        if (!activeCustomerId) return;
        try {
            const profile = await window.electronAPI.getCustomerProfile(activeCustomerId);
            if (!profile) throw new Error("This customer profile is no longer available.");
            const currentScroll = window.scrollY || 0;
            window.openCustomerDetailsForManagement(profile, async () => {
                profileScrollTop = currentScroll;
                await openCustomerProfile(activeCustomerId, { saveDirectoryScroll: false });
                requestAnimationFrame(() => window.scrollTo(0, profileScrollTop));
            });
        } catch (error) {
            showMessage("customerManagementMessage", error.message || "Customer profile could not be opened.", true);
        }
    });

    window.showCustomerDirectory = () => {
        clearTimeout(searchTimer);
        return showDirectory({ context: FRESH_CUSTOMER_DIRECTORY_ENTRY });
    };
    window.restoreCustomerProfileContext = (customerId, historyPage = purchaseHistoryPage) => {
        if (Number(customerId) !== activeCustomerId) return;
        profileView.hidden = false;
        directoryView.hidden = true;
        window.scrollTo(0, profileScrollTop);
        loadPurchaseHistory(historyPage);
    };
    window.openCustomerManagementProfile = openCustomerProfile;
})();
