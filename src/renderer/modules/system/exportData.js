/* =====================================
   EXPORT DATA
===================================== */

function showExportDataPage() {

    renderSettingsPage({

        title: "EXPORT DATA",

        icon: "📤",

        subtitle: "Export your business data for reporting or migration.",

        backText: "← System",

        backAction: showSystemPage,

        content: `

<div class="settings-grid">

    <div
        class="settings-card"
        id="exportNowCard">

        <div class="settings-icon">📤</div>

        <h2>Export Data</h2>

        <p>
            Export business data
        </p>

    </div>

    <div
        class="settings-card">

        <div class="settings-icon">📊</div>

        <h2>Export Type</h2>

        <p>
            Excel / CSV / PDF
        </p>

    </div>

    <div
        class="settings-card">

        <div class="settings-icon">🔒</div>

        <h2>Security</h2>

        <p>
            Administrator PIN Required
        </p>

    </div>

</div>

`

    });

}
