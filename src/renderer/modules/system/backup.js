/* =====================================
   BACKUP
===================================== */

let autoBackupAuthorizationGrant = null;
let autoBackupSaveInProgress = false;

function clearAutomaticBackupAuthorization() {
    autoBackupAuthorizationGrant = null;
}

async function saveAutomaticBackupSettings(settings, dependencies = {}) {
    const requestAuthorization = dependencies.requestAuthorization ||
        (purpose => requestAdminAuthorization(purpose));
    const saveSettings = dependencies.saveSettings ||
        ((data, grant) => window.electronAPI.saveSettings(data, grant));

    clearAutomaticBackupAuthorization();

    try {
        const freshGrant = await requestAuthorization("AUTO_BACKUP_SETTINGS");
        if (!freshGrant) return null;

        autoBackupAuthorizationGrant = freshGrant;
        return await saveSettings(settings, freshGrant);
    }
    finally {
        clearAutomaticBackupAuthorization();
    }
}

function formatAutomaticBackupCard(settings = {}) {
    if (Number(settings.auto_backup_enabled) !== 1) return "Off";

    const frequency = String(settings.auto_backup_frequency || "DAILY");
    const labels = {
        EVERY_6_HOURS: "Every 6 Hours",
        EVERY_3_HOURS: "Every 3 Hours",
        EVERY_1_HOUR: "Every 1 Hour"
    };
    if (labels[frequency]) return labels[frequency];

    const backupTime = String(settings.auto_backup_time || "21:30");
    const match = /^(\d{1,2}):(\d{2})$/.exec(backupTime);
    if (!match) return `Daily at <strong>${backupTime}</strong>`;
    const hour24 = Number(match[1]);
    const hour = String(hour24 % 12 || 12).padStart(2, "0");
    const meridian = hour24 >= 12 ? "PM" : "AM";
    return `Daily at <strong>${hour}:${match[2]} ${meridian}</strong>`;
}

if (typeof module !== "undefined") module.exports = {
    formatAutomaticBackupCard,
    saveAutomaticBackupSettings
};

async function showBackupPage() {

    clearAutomaticBackupAuthorization();

    const settings =
        await window.electronAPI.getSettings();

    const automaticBackupSummary = formatAutomaticBackupCard(settings);

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
            ${automaticBackupSummary}
        </p>

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

    clearAutomaticBackupAuthorization();
    showAutomaticBackupPage();

});

async function showAutomaticBackupPage() {

    clearAutomaticBackupAuthorization();

    const settings =
        await window.electronAPI.getSettings();

    const frequency = ["DAILY", "EVERY_6_HOURS", "EVERY_3_HOURS", "EVERY_1_HOUR"].includes(settings.auto_backup_frequency)
        ? settings.auto_backup_frequency
        : "DAILY";

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

         subtitle: "Configure automatic backup frequency and time.",

        backText: "← Backup",

        backAction: showBackupPage,

        content: `

<div class="settings-form automatic-backup-form">

    <div class="settings-field">
        <label for="autoBackupEnabled">Automatic Backup</label>
        <select id="autoBackupEnabled">
            <option value="1">ON</option>
            <option value="0">OFF</option>
        </select>
    </div>

    <div class="settings-field">
        <label for="autoBackupFrequency">Frequency</label>
        <select id="autoBackupFrequency">
            <option value="DAILY">Daily</option>
            <option value="EVERY_6_HOURS">Every 6 Hours</option>
            <option value="EVERY_3_HOURS">Every 3 Hours</option>
            <option value="EVERY_1_HOUR">Every 1 Hour</option>
        </select>
    </div>

    <div class="settings-field" id="dailyBackupTimeField">

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

    <div class="backup-help" id="autoBackupDescription"></div>

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

    document.getElementById("autoBackupEnabled").value = settings.auto_backup_enabled === 0 ? "0" : "1";
    document.getElementById("autoBackupFrequency").value = frequency;

    const updateDailyTimeVisibility = () => {
        const daily = document.getElementById("autoBackupFrequency").value === "DAILY";
        document.getElementById("dailyBackupTimeField").style.display = daily ? "" : "none";
        const descriptions = {
            DAILY: "Database backup will run every day at the selected time.",
            EVERY_6_HOURS: "Database backup will run every 6 hours while KLBS is running.",
            EVERY_3_HOURS: "Database backup will run every 3 hours while KLBS is running.",
            EVERY_1_HOUR: "Database backup will run every 1 hour while KLBS is running."
        };
        document.getElementById("autoBackupDescription").textContent =
            document.getElementById("autoBackupEnabled").value === "0"
                ? "Automatic database backup is OFF."
                : descriptions[document.getElementById("autoBackupFrequency").value];
    };
    document.getElementById("autoBackupFrequency").addEventListener("change", updateDailyTimeVisibility);
    document.getElementById("autoBackupEnabled").addEventListener("change", updateDailyTimeVisibility);
    updateDailyTimeVisibility();

    document
        .getElementById("saveAutoBackup")
        .addEventListener(
            "click",
            async () => {

                if (autoBackupSaveInProgress) return;
                autoBackupSaveInProgress = true;

                try {
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

                settings.auto_backup_enabled = Number(document.getElementById("autoBackupEnabled").value);
                settings.auto_backup_frequency = document.getElementById("autoBackupFrequency").value;

                settings.last_updated =

                    new Date().toISOString();

                const saved =

                    await saveAutomaticBackupSettings({
                        auto_backup_enabled: settings.auto_backup_enabled,
                        auto_backup_frequency: settings.auto_backup_frequency,
                        auto_backup_time: settings.auto_backup_time,
                        last_updated: settings.last_updated
                    });

                if (saved) {

                    alert(

                        "Automatic backup settings updated successfully." +
                        (saved.activityWarning
                            ? `\n\nWarning: ${saved.activityWarning}`
                            : "")

                    );

                }

                }
                catch (error) {
                    alert(error.message || "Automatic backup settings could not be saved.");
                }
                finally {
                    autoBackupAuthorizationGrant = null;
                    autoBackupSaveInProgress = false;
                }

            }

        );
    
    }
}
