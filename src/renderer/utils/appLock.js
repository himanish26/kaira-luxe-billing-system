function lockApplication(

    title = "Please Wait",

    message = "Processing..."

) {

    const overlay = document.getElementById(

        "appLockOverlay"

    );

    overlay.style.display = "flex";

    document.getElementById(

        "lockTitle"

    ).innerText = title;

    document.getElementById(

        "lockMessage"

    ).innerText = message;

    setLockProgress(0);

}

function unlockApplication() {

    document.getElementById(

        "appLockOverlay"

    ).style.display = "none";

}

function setLockProgress(progress) {

    document.getElementById(

        "lockProgressBar"

    ).style.width = `${progress}%`;

    document.getElementById(

        "lockPercentage"

    ).innerText = `${progress}%`;

}

function setLockMessage(message) {

    document.getElementById(

        "lockMessage"

    ).innerText = message;

}

window.lockApplication = lockApplication;

window.unlockApplication = unlockApplication;

window.setLockProgress = setLockProgress;

window.setLockMessage = setLockMessage;