/* =====================================
   SYSTEM
===================================== */
console.log("system.js loaded");

function showComingSoon(featureName) {

    const modal = document.createElement("div");

    modal.className = "klbs-coming-soon-overlay";

    modal.innerHTML = `
        <div class="klbs-coming-soon-modal">

            <div class="klbs-coming-soon-icon">🚧</div>

            <h2>${featureName}</h2>

            <p>This feature is coming soon.</p>

            <button
                id="comingSoonOkBtn"
                class="klbs-modal-ok">

                OK

            </button>

        </div>
    `;

    document.body.appendChild(modal);

    document
        .getElementById("comingSoonOkBtn")
        .addEventListener("click", () => {
            modal.remove();
        });

}

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

    <h2>Backup & Restore</h2>

    <p>
        Backup, Restore<br>
        Google Drive
    </p>

</div>

<div
    class="settings-card"
    id="dayClosingCard">

    <div class="settings-icon">🌙</div>

    <h2>Day Closing</h2>

    <p>
        Close Business Day<br>
        Backup & Exit
    </p>

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

    const backupCard =
    document.getElementById("backupCard");

if (backupCard) {

    backupCard.addEventListener(
        "click",
        showBackupPage
    );

}


const dayClosingCard =
    document.getElementById("dayClosingCard");

if (dayClosingCard) {

    dayClosingCard.addEventListener(
        "click",
        showDayClosingPage
    );

}


const activityLogCard =
    document.getElementById("activityLogCard");

if (activityLogCard) {

    activityLogCard.addEventListener(
        "click",
        showActivityLogPage
    );

}


const diagnosticsCard =
    document.getElementById("diagnosticsCard");

if (diagnosticsCard) {

diagnosticsCard.addEventListener(
    "click",
    () => showComingSoon("System Health")
);

}


const exportCard =
    document.getElementById("exportCard");

if (exportCard) {

exportCard.addEventListener(
    "click",
    () => showComingSoon("Export Data")
);

}


const updatesCard =
    document.getElementById("updatesCard");

if (updatesCard) {

    updatesCard.addEventListener(
        "click",
        showUpdatesPage
    );

}

}