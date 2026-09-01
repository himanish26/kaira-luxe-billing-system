const {

    createBackup

} = require("./backupService");

const {

    getSettings

} = require("../database/settingsService");
const technicalLogger = require("./technicalLogger");

let lastBackupDate = "";
let schedulerCheckInFlight = false;

function startBackupScheduler() {

    console.log("✓ Backup Scheduler Started");

    setInterval(

        async () => {

            if (schedulerCheckInFlight) return;
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

module.exports = {

    startBackupScheduler

};
