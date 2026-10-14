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

    return `${get("day")} ${get("month")} ${get("year")}, ${get("hour").padStart(2, "0")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

async function showRestorePage() {

    let lastRestore = null;
    try {
        lastRestore = await window.electronAPI.getLastRestore();
    }
    catch (error) {
        console.error("Unable to load restore history:", error);
    }

    const lastRestoreText = lastRestore
        ? `LAST RESTORE - ${lastRestore.activity_date}, ${lastRestore.activity_time}`
        : "LAST RESTORE - History unavailable";

    renderSettingsPage({

    title: "RESTORE BACKUP",

    icon: "♻️",

    subtitle: "Restore a previously created database backup.",

    backText: "← Backup",

    backAction: showBackupPage,

    content: `

<div class="settings-grid restore-page-sections">

    <div
        class="settings-card restore-primary-card"
        id="restoreNowCard">

        <div class="settings-icon">📂</div>

        <h2>Restore Backup</h2>

        <p>Select a backup file</p>

    </div>

    <div class="restore-last-panel" role="status">
        <span>🕒</span>
        <strong>${lastRestoreText}</strong>
    </div>

    <section class="danger-zone restore-danger-zone">
        <h2>⚠️ DANGER ZONE</h2>
        <p>Restoring a backup will replace the current local business database with the data contained in the selected backup.</p>
        <p>Transactions and changes made after the selected backup was created may be lost.</p>
        <p>A safety copy of the current database will be created automatically before restoration.</p>
        <p>KLBS will restart automatically after a successful restore.</p>
        <p class="danger-warning">This operation cannot be undone through the restore workflow.</p>
    </section>

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

// Successful restore/restart is owned by the main process. The renderer
// must never decide the post-restore database location or launch sequence.
return;

            });

        }

    );

}
