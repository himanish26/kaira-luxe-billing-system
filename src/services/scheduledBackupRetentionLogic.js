const { getBusinessDate, addBusinessCalendarDays } = require("../database/businessDate");

function isPositivelyIdentifiedScheduledAutomatic(metadata) {
    return Boolean(metadata && metadata.purpose === "SCHEDULED_AUTOMATIC");
}

function shouldDeleteScheduledAutomaticBackup(metadata, now = new Date()) {
    if (!isPositivelyIdentifiedScheduledAutomatic(metadata)) return false;
    const createdOn = new Date(metadata.createdOn);
    if (Number.isNaN(createdOn.getTime())) return false;
    const cutoffDate = addBusinessCalendarDays(getBusinessDate(now), -6);
    return getBusinessDate(createdOn) < cutoffDate;
}

module.exports = {
    isPositivelyIdentifiedScheduledAutomatic,
    shouldDeleteScheduledAutomaticBackup
};
