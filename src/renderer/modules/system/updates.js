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
            Administrator PIN Required
        </p>

    </div>

</div>

`

    });

    document

    .getElementById("checkUpdatesCard")

    .addEventListener(

        "click",

        async () => {

            const result =
                await window.electronAPI.checkForUpdates();

            if (!result.success) {

                await window.electronAPI.showMessageBox({

                    type: "error",

                    title: "Update Check Failed",

                    message: result.message

                });

                return;

            }

            if (!result.updateAvailable) {

                await window.electronAPI.showMessageBox({

                    type: "info",

                    title: "You're Up To Date",

                    message:

`Current Version : ${result.currentVersion}

You are already using the latest version.`

                });

                return;

            }

            const info =
    result.updateInfo;

const releaseNotes =
    info.notes
        .map(note => `• ${note}`)
        .join("\n");

const response =
    await window.electronAPI.showMessageBox({

        type: "info",

        title: "New Version Available",

        buttons: [

            "Later",

            "Download"

        ],

        defaultId: 1,

        cancelId: 0,

        message:

`Current Version

${result.currentVersion}

Latest Version

${result.latestVersion}

Release Date

${info.releaseDate}

What's New

${releaseNotes}`

    });

if (response.response !== 1) {

    return;

}

setAppState(APP_STATES.UPDATING);

lockApplication(

    "⬆️ Updating Kaira Luxe",

    "Downloading latest version..."

);

setLockProgress(0);

setLockMessage("Connecting...");

window.electronAPI.onDownloadProgress(

    progress => {

        updateProgress(

            progress,

            "Downloading update..."

        );

    }

);

const downloadResult =

    await window.electronAPI.downloadUpdate(

        info.downloadUrl,

        "KAIRA_LUXE_BILLING_SYSTEM_Setup.exe",

        info.version

    );

unlockApplication();

if (!downloadResult.success) {

    setAppState(APP_STATES.NORMAL);

    await window.electronAPI.showMessageBox({

        type: "error",

        title: "Download Failed",

        message: downloadResult.message

    });

    return;

}



const installResponse =

    await window.electronAPI.showMessageBox({

        type: "question",

        title: "Download Complete",

        buttons: [

            "Later",

            "Install Now"

        ],

        defaultId: 1,

        cancelId: 0,

        message:

`Installer downloaded successfully.

Would you like to install the update now?`

    });

if (

    installResponse.response !== 1

) {

    setAppState(APP_STATES.NORMAL);

    return;

}

lockApplication(

    "⬆️ Updating Kaira Luxe",

    "Installing update..."

);

setLockProgress(25);

setLockMessage("Downloading latest version...");

const installGrant =
    await requestAdminAuthorization("INSTALL_UPDATE");

if (!installGrant) {
    setAppState(APP_STATES.NORMAL);
    unlockApplication();
    return;
}

const installResult =
    await window.electronAPI.launchInstaller(
        downloadResult.filePath,
        info.sha256,
        installGrant
    );

if (!installResult.success) {

    setAppState(APP_STATES.NORMAL);

    unlockApplication();

    await window.electronAPI.showMessageBox({
        type: "error",
        title: "Installation Failed",
        message: installResult.message
    });

    return;
}

setLockProgress(60);

setLockMessage("Downloading latest version...");

setTimeout(() => {

    setLockProgress(100);

setLockMessage("Preparing installer...");

}, 1000);
    
}

);

}
