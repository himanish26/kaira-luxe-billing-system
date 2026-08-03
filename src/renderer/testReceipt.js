window.onload = () => {

    const data = window.testReceiptData;

    if (!data) {

        console.error(
            "Test receipt data not found."
        );

        return;

    }

    document.getElementById(
        "printerName"
    ).textContent =
        data.printerName;

    document.getElementById(
        "date"
    ).textContent =
        data.date;

    document.getElementById(
        "time"
    ).textContent =
        data.time;

};