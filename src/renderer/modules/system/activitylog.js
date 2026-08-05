/* =====================================
   ACTIVITY LOG
===================================== */

async function showActivityLogPage() {

    const activities =
        await window.electronAPI.getActivities();

    let html = "";

    activities.forEach(activity => {

        html += `

<div class="activity-item">

    <div class="activity-time">

        ${activity.activity_time}

    </div>

    <div class="activity-content">

        <div class="activity-category">

            ${activity.category}

        </div>

        <div class="activity-action">

            ${activity.action}

        </div>

        <div class="activity-details">

            ${activity.details || ""}

        </div>

    </div>

</div>

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
            placeholder="🔍 Search activities..." />

    </div>

    <div class="activity-actions">

        <button
            id="exportActivityBtn"
            class="primary-btn">

            📤 Export to Excel

        </button>

    </div>

</div>

<div
    id="activityCategoryBar"
    class="activity-category-bar">

</div>


<div class="activity-log-container">

    ${html}

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

    document
    .getElementById(
        "archiveActivityBtn"
    )
    .addEventListener(

        "click",

        async () => {

            const confirmation =
    await window
        .electronAPI
        .showMessageBox({

            type: "warning",

            title: "Archive Activity Log",

            buttons: [

                "Cancel",

                "Archive"

            ],

            defaultId: 1,

            cancelId: 0,

            message:

`This will

• Export the Activity Log to Excel

• Remove all archived activities

A new archive entry will be created automatically.

Do you want to continue?`

        });

if (confirmation.response !== 1) {

    return;

}

const result =
    await window
        .electronAPI
        .archiveActivities();

            if (result.cancelled) {

    return;

}

if (result.success) { 

                await window
                .electronAPI
                .showMessageBox({

                    type: "info",

                    title: "Archive Complete",

                    message:
                        "Activity Log archived successfully."

                });

            }

        }

    );

}