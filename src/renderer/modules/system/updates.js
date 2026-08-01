/* =====================================
   UPDATES
===================================== */

async function showUpdatesPage() {

    try {

    APP_INFO = await window.electronAPI.getAppInfo();

} catch (error) {

    console.error("Failed to load app information:", error);

    APP_INFO = {

        version: "Unknown"

    };

}

    renderSettingsPage({

        title: "CHECK FOR UPDATES",

        icon: "⬆️",

        subtitle: "Keep Kaira Luxe Billing System up to date.",

        backText: "← System",

        backAction: showSystemPage,

        content: `

<div class="settings-grid">

    <div
        class="settings-card"
        id="checkUpdatesCard">

        <div class="settings-icon">🔍</div>

        <h2>Check for Updates</h2>

        <p>
            Search for the latest version
        </p>

    </div>

    <div
        class="settings-card">

        <div class="settings-icon">📦</div>

        <h2>Current Version</h2>

        <p>
    Version - ${APP_INFO.version}
</p>

    </div>

    <div
        class="settings-card">

        <div class="settings-icon">⚡</div>

        <h2>Install Update</h2>

        <p>
            Administrator Password Required
        </p>

    </div>

</div>

`

    });

}