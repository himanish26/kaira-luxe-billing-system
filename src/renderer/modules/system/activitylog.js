/* =====================================
   ACTIVITY LOG
===================================== */

function appendActivityCell(row, value, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = value === null || value === undefined ? "" : String(value);
    row.appendChild(cell);
}

const ACTIVITY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ACTIVITY_PAGE_SIZE = 100;
let activityPage = 1;
let activityKeyword = "";
let activityTotalCount = 0;
let activityTotalPages = 1;
let activityRequestId = 0;

function formatActivityBusinessDate(value) {
    const text = String(value === null || value === undefined ? "" : value).trim();
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (match) return `${match[3]} ${ACTIVITY_MONTHS[Number(match[2]) - 1] || match[2]}, ${match[1]}`;
    match = /^(\d{2}) ([A-Za-z]{3})[ ,]+(\d{4})$/.exec(text);
    return match ? `${match[1]} ${match[2]}, ${match[3]}` : value;
}

function formatActivityTime(value) {
    const text = String(value === null || value === undefined ? "" : value).trim();
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i.exec(text);
    return match ? `${match[1].padStart(2, "0")}:${match[2]} ${match[3].toUpperCase()}` : value;
}

function formatActivityValue(value) {
    if (value === null || value === undefined) return value;
    return String(value).replace(/\b\d{4}-\d{2}-\d{2}\b/g, date => formatActivityBusinessDate(date));
}

function renderActivityRows(activities) {
    const body = document.getElementById("activityTableBody");
    body.replaceChildren();
    activities.forEach(activity => {
        const row = document.createElement("tr");
        const dateTime = [formatActivityBusinessDate(activity.activity_date), formatActivityTime(activity.activity_time)]
            .filter(Boolean).join(", ");
        appendActivityCell(row, dateTime, "activity-date-time");
        appendActivityCell(row, formatActivityValue(activity.category));
        appendActivityCell(row, formatActivityValue(activity.action));
        appendActivityCell(row, formatActivityValue(activity.reference_no));
        appendActivityCell(row, formatActivityValue(activity.details), "activity-details");
        const statusClass = `activity-status activity-status-${String(activity.status || "").toLowerCase()}`;
        appendActivityCell(row, formatActivityValue(activity.status), statusClass);
        body.appendChild(row);
    });
}

function updateActivityPagination() {
    const pagination = document.getElementById("activityPagination");
    const previous = document.getElementById("activityPreviousPage");
    const next = document.getElementById("activityNextPage");
    const pageLabel = document.getElementById("activityPageLabel");
    const rangeLabel = document.getElementById("activityRangeLabel");
    const jumpInput = document.getElementById("activityPageJump");

    if (!pagination || !previous || !next || !pageLabel || !rangeLabel) return;

    const first = activityTotalCount === 0
        ? 0
        : ((activityPage - 1) * ACTIVITY_PAGE_SIZE) + 1;
    const last = Math.min(activityPage * ACTIVITY_PAGE_SIZE, activityTotalCount);
    pagination.style.display = activityTotalCount === 0 ? "none" : "flex";
    previous.disabled = activityPage <= 1;
    next.disabled = activityPage >= activityTotalPages;
    pageLabel.textContent =
        `Page ${activityPage.toLocaleString("en-US")} of ${activityTotalPages.toLocaleString("en-US")}`;
    if (jumpInput) {
        jumpInput.value = String(activityPage);
        jumpInput.max = String(activityTotalPages);
    }
    rangeLabel.textContent =
        `Showing ${first.toLocaleString("en-US")}\u2013${last.toLocaleString("en-US")} of ${activityTotalCount.toLocaleString("en-US")} activities`;
}

async function loadActivityPage() {
    const requestId = ++activityRequestId;
    const result = await window.electronAPI.getActivities({
        page: activityPage,
        pageSize: ACTIVITY_PAGE_SIZE,
        keyword: activityKeyword
    });
    if (requestId !== activityRequestId) return;
    activityPage = result.page;
    activityTotalCount = result.totalCount;
    activityTotalPages = result.totalPages;
    renderActivityRows(result.activities);
    updateActivityPagination();
}

async function goToActivityPage(page) {
    const targetPage = Number.parseInt(page, 10);
    if (!Number.isFinite(targetPage)) return;
    activityPage = Math.min(Math.max(targetPage, 1), activityTotalPages);
    await loadActivityPage();
}

function handleActivityPageJump() {
    const input = document.getElementById("activityPageJump");
    const rawValue = input?.value.trim() || "";
    if (!/^\d+$/.test(rawValue)) {
        if (input) input.value = String(activityPage);
        return;
    }
    const targetPage = Number(rawValue);
    if (!Number.isSafeInteger(targetPage) || targetPage < 1 || targetPage > activityTotalPages) {
        if (input) input.value = String(activityPage);
        return;
    }
    goToActivityPage(targetPage);
}

if (typeof module !== "undefined") module.exports = {
    formatActivityBusinessDate, formatActivityTime, formatActivityValue
};

async function showActivityLogPage() {
    activityPage = 1;
    activityKeyword = "";

    renderSettingsPage({
        title: "ACTIVITY LOG",
        icon: "📜",
        subtitle: "System activity history",
        backText: "← System",
        backAction: showSystemPage,
        content: `
            <div class="activity-toolbar">
                <div class="activity-search">
                    <input id="activitySearch" type="text"
                        placeholder="🔍 Search Activity Log..." />
                </div>
            </div>
            <div class="activity-table-container">
                <table id="activityTable">
                    <thead><tr>
                        <th>Date &amp; Time</th>
                        <th>Category</th>
                        <th>Action</th>
                        <th>Reference</th>
                        <th>Details</th>
                        <th>Status</th>
                    </tr></thead>
                    <tbody id="activityTableBody"></tbody>
                </table>
            </div>
            <div id="activityPagination" class="activity-pagination" style="display:none;">
                <div class="pagination-controls">
                <button id="activityPreviousPage" class="pagination-nav-btn" type="button">Previous</button>
                <span id="activityPageLabel">Page 1 of 1</span>
                <label for="activityPageJump">Jump to page:</label>
                <input id="activityPageJump" type="number" min="1" step="1" inputmode="numeric" value="1" aria-label="Jump to activity page">
                <button id="activityNextPage" class="pagination-nav-btn" type="button">Next</button>
                </div>
                <span id="activityRangeLabel">Showing 0-0 of 0 activities</span>
            </div>
            <div class="activity-actions">
                <button id="exportActivityBtn" class="export-report-btn">
                    📤 Export to Excel
                </button>
            </div>
        `
    });

    await loadActivityPage();

    document.getElementById("exportActivityBtn").addEventListener("click", async () => {
        const grant = await requestAdminAuthorization("ACTIVITY_EXPORT");
        if (!grant) return;
        const result = await window.electronAPI.exportActivityLog(grant);
        if (result.success) {
            await window.electronAPI.showMessageBox({
                type: "info",
                title: "Export Complete",
                message: "Activity Log exported successfully."
            });
        }
        else if (!result.cancelled) {
            await window.electronAPI.showMessageBox({
                type: "error",
                title: "Export Failed",
                message: result.message || result.error || "Activity Log export failed."
            });
        }
    });

    document.getElementById("activitySearch").addEventListener("input", event => {
        activityKeyword = event.target.value.trim();
        activityPage = 1;
        loadActivityPage();
    });

    document.getElementById("activityPreviousPage").addEventListener("click", () => {
        goToActivityPage(activityPage - 1);
    });
    document.getElementById("activityNextPage").addEventListener("click", () => {
        goToActivityPage(activityPage + 1);
    });
    document.getElementById("activityPageJump").addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            handleActivityPageJump();
        }
    });
}
