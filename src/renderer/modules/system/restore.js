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

function requestBackupPassword() {
    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(18,16,18,.58);display:grid;place-items:center;padding:24px";
        const panel = document.createElement("form");
        panel.style.cssText = "width:min(520px,100%);background:#fff;border-radius:18px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.3);display:grid;gap:16px";
        panel.innerHTML = '<h2 style="margin:0">Unlock Backup</h2><p style="margin:0">Enter the recovery password used when this ZIP backup was created.</p><input type="password" autocomplete="current-password" aria-label="Backup recovery password" style="padding:14px;border:1px solid #aaa;border-radius:8px;font-size:18px"><div style="display:flex;justify-content:flex-end;gap:12px"><button type="button" data-cancel>Cancel</button><button type="submit">Continue</button></div><p data-error role="alert" style="display:none;color:#a00;margin:0"></p>';
        const input = panel.querySelector("input");
        const finish = value => { overlay.remove(); resolve(value); };
        panel.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
        panel.addEventListener("submit", event => {
            event.preventDefault();
            if (!input.value) {
                const error = panel.querySelector("[data-error]");
                error.textContent = "Enter the recovery password to continue.";
                error.style.display = "block";
                input.focus();
                return;
            }
            finish(input.value);
        });
        overlay.addEventListener("click", event => { if (event.target === overlay) finish(null); });
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        input.focus();
    });
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
        ? `LAST RESTORE - ${lastRestore.activity_date}, ${lastRestore.activity_time}${lastRestore.restore_mode ? ` • ${lastRestore.restore_mode.replaceAll("_", " ")}` : ""}`
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
        <p>A full or database-only restore replaces the current local business database. Transactions made after the selected backup may be lost.</p>
        <p>KLBS creates a safety copy before replacing the database. Integration Profile Only replaces saved integration settings and does not change business records.</p>
        <p>KLBS restarts after a database restore. An integration-only restore takes effect immediately.</p>
        <p class="danger-warning">Choose the restore type carefully. The selected operation cannot be undone through this workflow.</p>
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

let password;
let backup = await window.electronAPI.validateBackup(result.filePath);
while (backup.needsPassword) {
    password = await requestBackupPassword();
    if (password === null) return;
    backup = await window.electronAPI.validateBackup(result.filePath, password);
}

if (!backup.success) {

    await window.electronAPI.showMessageBox({

        type: "error",

        title: "Invalid Backup",

        message: backup.message

    });

    return;

}

const m = backup.metadata;

const restoreChoices = ["Cancel", "Full Restore", "Database Only"];
if (backup.integrationProfileExists) restoreChoices.push("Integration Profile Only");
const confirmation =
    await window.electronAPI.showMessageBox({

        type: "question",

        title: "Restore Backup",

        buttons: restoreChoices,

        defaultId: 1,

        cancelId: 0,

        message:

`Application : ${m.application}

Version : ${m.appVersion}

Created : ${formatRestoreDateTime(m.createdOn)}

Database : ${backup.databaseExists ? "✓ Present" : "✗ Missing"}

Logs : ${backup.logsExists ? "✓ Present" : "✗ None"}

Settings : ${backup.settingsExists ? "✓ Present" : "✗ None"}

Choose Full Restore to restore database, logs, and integrations; Database Only to restore business records; or Integration Profile Only to restore saved integration settings.

The current database is safety-backed up before a database restore. Database restores restart KLBS.`

    });

if (confirmation.response < 1) {

    return;

}

const mode = confirmation.response === 1
    ? "FULL"
    : confirmation.response === 2
        ? "DATABASE_ONLY"
        : "INTEGRATIONS_ONLY";
const modeLabel = mode === "FULL" ? "Full Restore" : mode === "DATABASE_ONLY" ? "Database Only" : "Integration Profile Only";
const finalConfirmation = await window.electronAPI.showMessageBox({
    type: "warning",
    title: `Confirm ${modeLabel}`,
    buttons: ["Cancel", "Continue"],
    defaultId: 0,
    cancelId: 0,
    message: mode === "INTEGRATIONS_ONLY"
        ? "This replaces the saved email, DSR, dashboard, and customer CRM integration profile on this computer. Continue?"
        : mode === "DATABASE_ONLY"
            ? "This replaces the current business database. The current database will be saved in the restore safety folder first. Continue?"
            : "This replaces the current database and restores integrations from the backup. The current database will be safety-backed up first. Continue?"
});
if (finalConfirmation.response !== 1) return;

const restoreResult =
    await window.electronAPI.restoreBackup(
        result.filePath,
        grant,
        password,
        mode
    );

if (!restoreResult.success) {

    await window.electronAPI.showMessageBox({

        type: "error",

        title: "Restore Failed",

        message: restoreResult.message

    });

    return;

}

if (mode === "INTEGRATIONS_ONLY") {
    await window.electronAPI.showMessageBox({
        type: "info",
        title: "Integration Profile Restored",
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
