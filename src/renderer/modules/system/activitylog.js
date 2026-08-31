/* =====================================
   ACTIVITY LOG
===================================== */

function appendActivityCell(row, value, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = value === null || value === undefined ? "" : String(value);
    row.appendChild(cell);
}

function renderActivityRows(activities) {
    const body = document.getElementById("activityTableBody");
    body.replaceChildren();
    activities.forEach(activity => {
        const row = document.createElement("tr");
        const dateTime = [activity.activity_date, activity.activity_time]
            .filter(Boolean).join("\n");
        appendActivityCell(row, dateTime, "activity-date-time");
        appendActivityCell(row, activity.category);
        appendActivityCell(row, activity.action);
        appendActivityCell(row, activity.reference_no);
        appendActivityCell(row, activity.details, "activity-details");
        appendActivityCell(row, activity.status);
        body.appendChild(row);
    });
}

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
