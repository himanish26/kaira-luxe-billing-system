const { getBusinessDate, BUSINESS_TIME_ZONE } = require("../database/businessDate");

const AUTO_BACKUP_FREQUENCIES = Object.freeze({
    DAILY: null,
    EVERY_6_HOURS: 6 * 60 * 60 * 1000,
    EVERY_3_HOURS: 3 * 60 * 60 * 1000,
    EVERY_1_HOUR: 60 * 60 * 1000
});

function normalizeFrequency(value) {
    return Object.prototype.hasOwnProperty.call(AUTO_BACKUP_FREQUENCIES, value)
        ? value
        : "DAILY";
}

function getIntervalMilliseconds(frequency) {
    return AUTO_BACKUP_FREQUENCIES[normalizeFrequency(frequency)];
}

function getPersistedLastSuccess(settings) {
    const timestamp = settings && settings.auto_backup_last_success_at;
    if (!timestamp) return null;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isDailyDue(settings, now, inMemoryLastBackupDate = "") {
    const backupTime = settings.auto_backup_time || "21:30";
    const currentTime = new Intl.DateTimeFormat("en-GB", {
        timeZone: BUSINESS_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(now);
    const today = getBusinessDate(now);
    const persistedLastSuccess = getPersistedLastSuccess(settings);
    const lastDate = persistedLastSuccess
        ? getBusinessDate(persistedLastSuccess)
        : inMemoryLastBackupDate;
    return currentTime === backupTime && lastDate !== today;
}

function isScheduledBackupDue(settings, now = new Date(), inMemoryLastBackupDate = "") {
    if (!settings || settings.auto_backup_enabled === 0) return false;
    const frequency = normalizeFrequency(settings.auto_backup_frequency);
    if (frequency === "DAILY") return isDailyDue(settings, now, inMemoryLastBackupDate);

    const interval = getIntervalMilliseconds(frequency);
    const lastSuccess = getPersistedLastSuccess(settings);
    return !lastSuccess || now.getTime() - lastSuccess.getTime() >= interval;
}

module.exports = {
    AUTO_BACKUP_FREQUENCIES,
    normalizeFrequency,
    getIntervalMilliseconds,
    getPersistedLastSuccess,
    isScheduledBackupDue
};
