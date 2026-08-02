const APP_STATES = {

    NORMAL: "NORMAL",

    UPDATING: "UPDATING",

    BACKUP: "BACKUP",

    RESTORE: "RESTORE",

    IMPORT: "IMPORT",

    REPORT: "REPORT"

};

let appState = APP_STATES.NORMAL;

function setAppState(state) {

    appState = state;

}

function getAppState() {

    return appState;

}

function isBusy() {

    return appState !== APP_STATES.NORMAL;

}

/* =====================================
   GLOBAL EXPORTS
===================================== */

window.APP_STATES = APP_STATES;

window.setAppState = setAppState;

window.getAppState = getAppState;

window.isAppBusy = isBusy;