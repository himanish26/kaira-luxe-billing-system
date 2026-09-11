/* =====================================
   RESTORE BACKUP
===================================== */

function formatRestoreDateTime(value) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).formatToParts(new Date(value));

    const get = type =>
        parts.find(part => part.type === type)?.value || "";

    return `${get("day")} ${get("month")}, ${get("year")}, ${get("hour").padStart(2, "0")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

function showRestorePage() {

    renderSettingsPage({

    title: "RESTORE BACKUP",

    icon: "♻️",

    subtitle: "Restore a previously created database backup.",

    backText: "← Backup",

    backAction: showBackupPage,

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
            Restoring replaces current local business data with the backup state.
            A durable safety copy of the current database is created first.
            The application restarts after a successful restore.
        </p>

    </div>

</div>

`

});

document
    .getElementById("restoreNowCard")
    .addEventListener(
        "click",
        () => {

            requireAdminAuthorization("RESTORE", async grant => {

        const result =
    await window.electronAPI.selectRestoreFile();

if (
    result.canceled ||
    !result.filePath
) {
    return;
}

const backup =
    await window.electronAPI.validateBackup(
        result.filePath
    );

if (!backup.success) {

    await window.electronAPI.showMessageBox({

        type: "error",

        title: "Invalid Backup",

        message: backup.message

    });

    return;

}

const m = backup.metadata;

const confirmation =
    await window.electronAPI.showMessageBox({

        type: "question",

        title: "Restore Backup",

        buttons: [

            "Cancel",

            "Restore"

        ],

        defaultId: 1,

        cancelId: 0,

        message:

`Application : ${m.application}

Version : ${m.appVersion}

Created : ${formatRestoreDateTime(m.createdOn)}

Database : ${backup.databaseExists ? "✓ Present" : "✗ Missing"}

Logs : ${backup.logsExists ? "✓ Present" : "✗ None"}

Settings : ${backup.settingsExists ? "✓ Present" : "✗ None"}

This operation will replace your current local business data.
The current database will be safety-backed up first, and the application will restart after success.

This operation cannot be undone.`

    });

if (confirmation.response !== 1) {

    return;

}

const restoreResult =
    await window.electronAPI.restoreBackup(
        result.filePath,
        grant
    );

if (!restoreResult.success) {

    await window.electronAPI.showMessageBox({

        type: "error",

        title: "Restore Failed",

        message: restoreResult.message

    });

    return;

}

await window.electronAPI.showMessageBox({

    type: "info",

    title: "Restore Complete",

    message:
        "Backup restored successfully. Administrator Security settings were restored with the database.\n\nThe application will now restart."

});

await window.electronAPI.restartApp(
    result.filePath
);

            });

        }

    );

}
