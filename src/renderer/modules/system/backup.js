/* =====================================
   BACKUP
===================================== */

let autoBackupAuthorizationGrant = null;

async function showBackupPage() {

    const settings =
        await window.electronAPI.getSettings();

    const backupTime =
        settings.auto_backup_time || "21:30";

    const [hour24, minute] =
        backupTime.split(":");

    let hour =
        parseInt(hour24);

    let meridian =
        "AM";

    if (hour >= 12) {

        meridian = "PM";

    }

    hour =
        hour % 12;

    if (hour === 0) {

        hour = 12;

    }

    const formattedBackupTime =
        `${String(hour).padStart(2, "0")}:${minute} ${meridian}`;

    renderSettingsPage({

        title: "BACKUP & RESTORE",

        icon: "💾",

        subtitle: "Create, restore and manage secure database backups.",
        
        backText: "← System",

        backAction: showSystemPage,

        content: `

<div class="settings-grid">


    <div
        class="settings-card"
        id="createBackupCard">

        <div class="settings-icon">💾</div>

        <h2>Create Backup</h2>

        <p>Create a manual database backup</p>

    </div>

    <div
    class="settings-card"
    id="restoreBackupCard">

    <div class="settings-icon">♻️</div>

    <h2>Restore Backup</h2>

    <p>

        Restore a verified<br>
        database backup

    </p>

</div>

    <div
        class="settings-card"
        id="backupLocationCard">

        <div class="settings-icon">📂</div>

        <h2>Backup Location</h2>

        <p>Choose where backups are stored</p>

    </div>

    <div
        class="settings-card"
        id="backupHistoryCard">

        <div class="settings-icon">🕘</div>

        <h2>Backup History</h2>

        <p>View previously created backups</p>

    </div>

        <div
        class="settings-card"
        id="autoBackupCard">

        <div class="settings-icon">⚙️</div>

        <h2>Automatic Backup</h2>

        <p>
            Daily at
            <strong>${formattedBackupTime}</strong>
        </p>

    </div>

        <div
        class="settings-card"
        id="emailBackupStatusCard">

        <div class="settings-icon">📧</div>

        <h2>Email Backup</h2>

        <p>Manage in System Health &gt; Integrations &gt; Email &amp; Backup</p>

    </div>

</div>

`
    });

    document
        .getElementById("createBackupCard")
        .addEventListener(
            "click",
            async () => {

                const result =
                    await window.electronAPI.createBackup();

                if (result.success) {

                    alert(
                        "Backup created successfully.\n\n" +
                        result.backupFilePath
                    );

                }

                else {

                    alert(
                        "Backup failed.\n\n" +
                        result.message
                    );

                }

            }
        );

        document
    .getElementById("restoreBackupCard")
    .addEventListener(
        "click",
        showRestorePage
    );

        document

        .getElementById("backupLocationCard")
        .addEventListener("click", () => {
            requireAdminAuthorization("BACKUP_LOCATION", async grant => {

            const selectedFolder =
                await window.electronAPI.selectBackupFolder();

            if (!selectedFolder) {

                return;

            }

            const now = new Date();

const lastUpdated =
    `${now.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    })} • ${now.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).toUpperCase()}`;

            const saved =
                await window.electronAPI.saveSettings({
                    backup_location: selectedFolder,
                    last_updated: lastUpdated
                }, grant);

            if (saved) {

                alert(
                    "Backup location updated successfully.\n\n" +
                    selectedFolder +
                    (saved.activityWarning
                        ? `\n\nWarning: ${saved.activityWarning}`
                        : "")
                );

            }

            else {

                alert(
                    "Unable to save backup location."
                );

            }

        });

    });

    document
    .getElementById("backupHistoryCard")
    .addEventListener(
        "click",
        async () => {

            const backups =
                await window.electronAPI.getBackupHistory();

const lines = [];

lines.push("Recent Backups");
//lines.push("");
lines.push("──────────────");
//lines.push("");

backups
    .slice(0, 2)
    .forEach((backup, index) => {

        const date =
            new Date(backup.createdAt);

        const formattedDate =
            date.toLocaleDateString(
                "en-GB",
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }
            );

        const formattedTime =
            date.toLocaleTimeString(
                "en-IN",
                {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true
                }
            );

        const size =
            (backup.size / 1024).toFixed(1);

        lines.push(
            `${String(index + 1).padStart(2, "0")}. Backup created`
        );

        lines.push(
            `    ${formattedDate} • ${formattedTime} • ${size} KB`
        );

        lines.push("");

    });

alert(
    lines.join("\n")
);

        }

        );

    document
.getElementById("autoBackupCard")
.addEventListener("click", () => {

    requireAdminAuthorization("AUTO_BACKUP_SETTINGS", grant => {

        autoBackupAuthorizationGrant = grant;

        showAutomaticBackupPage();

    });

});

async function showAutomaticBackupPage() {

    const settings =
        await window.electronAPI.getSettings();

    const [hour24, minute] =
    (settings.auto_backup_time || "21:30")
        .split(":");

let hour =
    parseInt(hour24);

let meridian =
    "AM";

if (hour >= 12) {

    meridian = "PM";

}

hour =
    hour % 12;

if (hour === 0) {

    hour = 12;

}

hour =
    String(hour)
        .padStart(2, "0");

    renderSettingsPage({

        title: "AUTOMATIC BACKUP",

        icon: "⚙️",

        subtitle: "Configure daily automatic backup.",

        backText: "← Backup",

        backAction: showBackupPage,

        content: `

<div class="settings-form">

    <div class="settings-field">

        <label>

            Backup Time

        </label>

        <div class="backup-time-picker">

    <select
    id="backupHour"
>

        ${Array.from(
            { length: 12 },
            (_, i) => {

                const hour =
                    String(i + 1).padStart(2, "0");

                return `<option value="${hour}">
                            ${hour}
                        </option>`;

            }
        ).join("")}

    </select>

    <select
    id="backupMinute"
>

        ${Array.from(
            { length: 60 },
            (_, i) => {

                const minute =
                    String(i).padStart(2, "0");

                return `<option value="${minute}">
                            ${minute}
                        </option>`;

            }
        ).join("")}

    </select>

    <select
    id="backupMeridian"
>

        <option value="AM">AM</option>

        <option value="PM">PM</option>

    </select>

</div>

    </div>

    <div class="backup-help">

    Database backup will run every day<br>
    at the selected time.

</div>

    <button

        id="saveAutoBackup"

        class="primary-button">

        SAVE SETTINGS

    </button>

</div>

`

    });

    document
    .getElementById("backupHour")
    .value = hour;

document
    .getElementById("backupMinute")
    .value = minute;

document
    .getElementById("backupMeridian")
    .value = meridian;

    document
        .getElementById("saveAutoBackup")
        .addEventListener(
            "click",
            async () => {

                const hour12 =
    parseInt(
        document
            .getElementById("backupHour")
            .value
    );

const minute =
    document
        .getElementById("backupMinute")
        .value;

const meridian =
    document
        .getElementById("backupMeridian")
        .value;

let hour24 =
    hour12;

if (
    meridian === "PM" &&
    hour24 !== 12
) {

    hour24 += 12;

}

if (
    meridian === "AM" &&
    hour24 === 12
) {

    hour24 = 0;

}

settings.auto_backup_time =

    `${String(hour24).padStart(2, "0")}:${minute}`;

                settings.last_updated =

                    new Date().toISOString();

                const saved =

                    await window.electronAPI.saveSettings({
                        auto_backup_time: settings.auto_backup_time,
                        last_updated: settings.last_updated
                    }, autoBackupAuthorizationGrant);

                autoBackupAuthorizationGrant = null;

                if (saved) {

                    alert(

                        "Automatic backup time updated successfully." +
                        (saved.activityWarning
                            ? `\n\nWarning: ${saved.activityWarning}`
                            : "")

                    );

                }

            }

        );
    
    }
}
