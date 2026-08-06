/* =====================================
   ACTIVITY LOG
===================================== */

async function showActivityLogPage() {

    const activities =
        await window.electronAPI.getActivities();

    let rows = "";

    activities.forEach(activity => {

rows += `

<tr>

    <td>

    ${activity.activity_date}<br>

    ${activity.activity_time.toUpperCase()}

    </td>

    <td>${activity.category}</td>

    <td>${activity.action}</td>

    <td>${activity.details || ""}</td>

    <td>${activity.status}</td>

</tr>

`;

    });

    renderSettingsPage({

        title: "ACTIVITY LOG",

        icon: "📜",

        subtitle: "System activity history",

        backText: "← System",

        backAction: showSystemPage,

        content: `

    <div class="activity-toolbar">

    <div class="activity-search">

        <input
            id="activitySearch"
            type="text"
            placeholder="🔍 Search by Date or Category..." />

    </div>

    

</div>

<div class="activity-table-container">

    <table id="historyTable">

    <thead>

        <tr>

            <th>Date & Time</th>

            <th>Category</th>

            <th>Action</th>

            <th>Details</th>

            <th>Status</th>

        </tr>

    </thead>

    <tbody id="activityTableBody">

        ${rows}

    </tbody>

</table>

</div>

<div class="activity-actions">

        <button
            id="exportActivityBtn"
            class="export-report-btn">

            📤 Export to Excel

        </button>

    </div>

`

    });

    document
    .getElementById(
        "exportActivityBtn"
    )
    .addEventListener(

        "click",

        async () => {

            const result =
                await window
                .electronAPI
                .exportActivityLog();

            if (
                result.success
            ) {

                await window
                .electronAPI
                .showMessageBox({

                    type: "info",

                    title: "Export Complete",

                    message:
                        "Activity Log exported successfully."

                });

            }

        }

        

    );

    const searchBox =
    document.getElementById("activitySearch");

searchBox.addEventListener("input", () => {

    const keyword =
        searchBox.value.trim().toLowerCase();

    const rows =
        document.querySelectorAll(
            "#activityTableBody tr"
        );

    rows.forEach(row => {

        const date =
            row.cells[0].innerText.toLowerCase();

        const category =
            row.cells[1].innerText.toLowerCase();

        if (

            date.includes(keyword) ||

            category.includes(keyword)

        ) {

            row.style.display = "";

        }

        else {

            row.style.display = "none";

        }

    });

});

}