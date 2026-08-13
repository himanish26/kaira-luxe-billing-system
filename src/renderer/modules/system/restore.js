/* =====================================
   RESTORE BACKUP
===================================== */

function showRestorePage() {

    renderSettingsPage({

    title: "RESTORE BACKUP",

    icon: "♻️",

    subtitle: "Restore a previously created database backup.",

    backText: "← System",

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
            Restoring will replace the current database.
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

            requireAdminAuthorization(async () => {

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

Created : ${new Date(m.createdOn).toLocaleString()}

Database : ${backup.databaseExists ? "✓ Present" : "✗ Missing"}

Logs : ${backup.logsExists ? "✓ Present" : "✗ None"}

Settings : ${backup.settingsExists ? "✓ Present" : "✗ None"}

This operation will replace your current database.

This operation cannot be undone.`

    });

if (confirmation.response !== 1) {

    return;

}

const restoreResult =
    await window.electronAPI.restoreBackup(
        result.filePath
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
        "Backup restored successfully.\n\nThe application will now restart."

});

await window.electronAPI.restartApp(
    result.filePath
);

            });

        }

    );

}
