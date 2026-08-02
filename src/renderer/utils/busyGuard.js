async function guardBusyOperation() {

    if (!isAppBusy()) {

        return true;

    }

    await window.electronAPI.showMessageBox({

        type: "warning",

        title: "Please Wait",

        message:
`Another operation is currently in progress.

Please wait until it finishes.`

    });

    return false;

}

window.guardBusyOperation = guardBusyOperation;