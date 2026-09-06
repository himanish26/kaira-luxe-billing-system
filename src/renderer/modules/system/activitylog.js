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

if (typeof module !== "undefined") module.exports = {
    formatActivityBusinessDate, formatActivityTime, formatActivityValue
};

async function showActivityLogPage() {
    const activities = await window.electronAPI.getActivities();

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
            <div class="activity-actions">
                <button id="exportActivityBtn" class="export-report-btn">
                    📤 Export to Excel
                </button>
            </div>
        `
    });

    renderActivityRows(activities);

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
        const keyword = event.target.value.trim().toLowerCase();
        document.querySelectorAll("#activityTableBody tr").forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(keyword) ? "" : "none";
        });
    });
}
