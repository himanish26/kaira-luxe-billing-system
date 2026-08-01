/* =====================================
   ACTIVITY LOG
===================================== */

function showActivityLogPage() {

    renderSettingsPage({

        title: "ACTIVITY LOG",

        icon: "📜",

        subtitle: "View all important system activities.",

        backText: "← System",

        backAction: showSystemPage,

        content: `

<div class="settings-grid">

    <div
        class="settings-card"
        id="viewActivityCard">

        <div class="settings-icon">📜</div>

        <h2>View Activity</h2>

        <p>
            View system activity history
        </p>

    </div>

    <div
        class="settings-card">

        <div class="settings-icon">🗓️</div>

        <h2>Last Activity</h2>

        <p>
            No recent activity
        </p>

    </div>

    <div
        class="settings-card">

        <div class="settings-icon">🧹</div>

        <h2>Clear History</h2>

        <p>
            Administrator Only
        </p>

    </div>

</div>

`

    });

}