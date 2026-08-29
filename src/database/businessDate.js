const BUSINESS_TIME_ZONE = "Asia/Kolkata";

const businessDateFormatter = new Intl.DateTimeFormat(
    "en-CA",
    {
        timeZone: BUSINESS_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }
);

function getBusinessDate(value = new Date()) {
    const date = value instanceof Date
        ? value
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new Error("Invalid date supplied.");
    }

    return businessDateFormatter.format(date);
}

function addBusinessCalendarDays(dateText, days) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
        String(dateText)
    );
    const dayCount = Number(days);

    if (!match || !Number.isInteger(dayCount)) {
        throw new Error("Invalid business date or day count.");
    }

    const date = new Date(Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    ));

    date.setUTCDate(date.getUTCDate() + dayCount);

    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0")
    ].join("-");
}

module.exports = {
    BUSINESS_TIME_ZONE,
    getBusinessDate,
    addBusinessCalendarDays
};
