/* =====================================
   RESTORE BACKUP
===================================== */

function showRestorePage() {

    renderSettingsPage({

    title: "RESTORE BACKUP",

    icon: "♻️",

    subtitle: "Restore a previously created database backup.",

    backText: "← System",

    backAction: showSystemPage,

    content: `

<div class="settings-grid">

    <div
        class="settings-card"
        id="restoreNowCard">

        <div class="settings-icon">📂</div>

        <h2>Restore Backup</h2>

        <p>Select a backup file</p>

    </div>

    <div class="settings-card">

        <div class="settings-icon">⚠️</div>

        <h2>Warning</h2>

        <p>
            Restoring will replace the current database.
        </p>

    </div>

</div>

`

});

}
