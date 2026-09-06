const {

    createBackup

} = require("./backupService");

const {

    getSettings

} = require("../database/settingsService");
const technicalLogger = require("./technicalLogger");
const { isRestoreInProgress } = require("./restoreState");

let lastBackupDate = "";
let schedulerCheckInFlight = false;
let schedulerTimer = null;

function startBackupScheduler() {

    if (schedulerTimer) return;

    console.log("✓ Backup Scheduler Started");

    schedulerTimer = setInterval(

        async () => {

            if (schedulerCheckInFlight) return;
            if (isRestoreInProgress()) return;
            schedulerCheckInFlight = true;

            try {

                const settings =
                    await getSettings();

                const backupTime =
                    settings.auto_backup_time || "21:30";

                const now =
                    new Date();

                const currentTime =
                    now
                        .toTimeString()
                        .substring(0, 5);

                const today =
                    now
                        .toISOString()
                        .substring(0, 10);

                if (

                    currentTime === backupTime &&
                    lastBackupDate !== today

                ) {

                    await createBackup();

                    lastBackupDate =
                        today;

                    console.log(

                        "Automatic Backup Completed."

                    );
                    technicalLogger.info("BACKUP_SCHEDULER", "Scheduled backup completed");

                }

            }

            catch (error) {

                technicalLogger.error(
                    "BACKUP_SCHEDULER",
                    "Scheduled backup attempt failed",
                    error
                );

                console.error(

                    "Backup Scheduler Error:",

                    error

                );

            }
            finally {
                schedulerCheckInFlight = false;
            }

        },

        60000

    );

}

function stopBackupScheduler() {
    if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
    }
}

module.exports = {

    startBackupScheduler,
    stopBackupScheduler

};
