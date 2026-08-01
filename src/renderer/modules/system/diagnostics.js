/* =====================================
   DIAGNOSTICS
===================================== */

function showDiagnosticsPage() {

    renderSettingsPage({

        title: "SYSTEM HEALTH",

        icon: "🩺",

        subtitle: "Monitor the health and status of your billing system.",

        backText: "← System",

        backAction: showSystemPage,

        content: `

<div class="settings-grid">

    <div
        class="settings-card"
        id="runDiagnosticsCard">

        <div class="settings-icon">🩺</div>

        <h2>Run Diagnostics</h2>

        <p>
            Check system health
        </p>

    </div>

    <div
        class="settings-card">

        <div class="settings-icon">💻</div>

        <h2>System Status</h2>

        <p>
            All systems operational
        </p>

    </div>

    <div
        class="settings-card">

        <div class="settings-icon">📊</div>

        <h2>Performance</h2>

        <p>
            View system performance
        </p>

    </div>

</div>

`

    });

}