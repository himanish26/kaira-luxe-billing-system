const { createScheduledAutomaticBackup } = require("./backupService");
const { getSettings } = require("../database/settingsService");
const { getBusinessDate } = require("../database/businessDate");
const {
    AUTO_BACKUP_FREQUENCIES,
    normalizeFrequency,
    getIntervalMilliseconds,
    isScheduledBackupDue: isScheduleDue
} = require("./backupScheduleLogic");
const technicalLogger = require("./technicalLogger");
const { isRestoreInProgress } = require("./restoreState");

let lastBackupDate = "";
let schedulerCheckInFlight = false;
let schedulerTimer = null;

function isScheduledBackupDue(settings, now = new Date()) {
    return isScheduleDue(settings, now, lastBackupDate);
}

async function checkBackupSchedule() {
    if (schedulerCheckInFlight || isRestoreInProgress()) return;
    schedulerCheckInFlight = true;
    try {
        const settings = await getSettings();
        const now = new Date();
        if (!isScheduledBackupDue(settings, now)) return;
        await createScheduledAutomaticBackup(normalizeFrequency(settings.auto_backup_frequency));
        lastBackupDate = getBusinessDate(now);
        console.log("Automatic Backup Completed.");
        technicalLogger.info("BACKUP_SCHEDULER", "Scheduled backup completed");
    }
    catch (error) {
        technicalLogger.error("BACKUP_SCHEDULER", "Scheduled backup attempt failed", error);
        console.error("Backup Scheduler Error:", error);
    }
    finally {
        schedulerCheckInFlight = false;
    }
}

function startBackupScheduler() {
    if (schedulerTimer) return;
    console.log("✓ Backup Scheduler Started");
    schedulerTimer = setInterval(checkBackupSchedule, 60000);
}

function stopBackupScheduler() {
    if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
    }
}

module.exports = {
    AUTO_BACKUP_FREQUENCIES,
    normalizeFrequency,
    getIntervalMilliseconds,
    isScheduledBackupDue,
    checkBackupSchedule,
    startBackupScheduler,
    stopBackupScheduler
};
