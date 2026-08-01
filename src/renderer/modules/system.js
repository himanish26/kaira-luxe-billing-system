/* =====================================
   SYSTEM
===================================== */
console.log("system.js loaded");

function showSystemPage() {

    renderSettingsPage({

        title: "SYSTEM",

        icon: "🛠",

        subtitle: "Manage backups, diagnostics and system maintenance.",

        backText: "← Settings",

        backAction: null,

        content: `

<div class="settings-grid">

    <div
        class="settings-card"
        id="backupCard">

        <div class="settings-icon">💾</div>

        <h2>Backup</h2>

        <p>Create and manage backups</p>

    </div>

    <div
        class="settings-card"
        id="restoreCard">

        <div class="settings-icon">♻️</div>

        <h2>Restore Backup</h2>

        <p>Restore previous backup</p>

    </div>

    <div
        class="settings-card"
        id="activityLogCard">

        <div class="settings-icon">📜</div>

        <h2>Activity Log</h2>

        <p>View activity history</p>

    </div>

    <div
        class="settings-card"
        id="diagnosticsCard">

        <div class="settings-icon">🩺</div>

        <h2>System Health</h2>

        <p>Check application health</p>

    </div>

    <div
        class="settings-card"
        id="exportCard">

        <div class="settings-icon">📤</div>

        <h2>Export Data</h2>

        <p>Export application data</p>

    </div>

    <div
        class="settings-card"
        id="updatesCard">

        <div class="settings-icon">⬆️</div>

        <h2>Check for Updates</h2>

        <p>View application updates</p>

    </div>

</div>

`

    });

    document
    .getElementById("backupCard")
    .addEventListener(
        "click",
        showBackupPage
    );

document
    .getElementById("restoreCard")
    .addEventListener(
        "click",
        showRestorePage
    );

document
    .getElementById("activityLogCard")
    .addEventListener(
        "click",
        showActivityLogPage
    );

document
    .getElementById("diagnosticsCard")
    .addEventListener(
        "click",
        showDiagnosticsPage
    );

document
    .getElementById("exportCard")
    .addEventListener(
        "click",
        showExportDataPage
    );

document
    .getElementById("updatesCard")
    .addEventListener(
        "click",
        showUpdatesPage
    );

}