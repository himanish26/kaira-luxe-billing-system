const ExcelJS = require("exceljs");
const { dialog } = require("electron");
const db = require("./database");
const path = require("path");

/* ===========================================
   EXPORT ACTIVITY LOG
=========================================== */

async function exportActivityLog() {

    return new Promise(async (resolve, reject) => {

        try {

            const workbook = new ExcelJS.Workbook();

            const sheet =
                workbook.addWorksheet("Activity Log");

            sheet.columns = [

                { header: "Date", key: "activity_date", width: 18 },

                { header: "Time", key: "activity_time", width: 15 },

                { header: "Category", key: "category", width: 18 },

                { header: "Action", key: "action", width: 35 },

                { header: "Details", key: "details", width: 50 },

                { header: "User", key: "user_name", width: 20 },

                { header: "Status", key: "status", width: 15 }

            ];

            db.all(

                `

                SELECT *

                FROM activities

                ORDER BY id DESC

                `,

                [],

                async (error, rows) => {

                    if (error) {

                        return reject(error);

                    }

                    rows.forEach(row => {

                        sheet.addRow(row);

                    });

                    const today = new Date();

                    const dd =
                        String(today.getDate()).padStart(2, "0");

                    const mm =
                        String(today.getMonth() + 1).padStart(2, "0");

                    const yyyy =
                        today.getFullYear();

                    const result =
                        await dialog.showSaveDialog({

                            defaultPath:
                                `KL_Activity_Log_${dd}_${mm}_${yyyy}.xlsx`

                        });

                    if (result.canceled) {

                        return resolve({

                            success: false,

                            cancelled: true

                        });

                    }

                    await workbook.xlsx.writeFile(

                        result.filePath

                    );

                    resolve({

                        success: true,

                        filePath: result.filePath,

                        fileName: path.basename(result.filePath)

                    });

                }

            );

        }

        catch (error) {

            reject(error);

        }

    });

}

module.exports = {

    exportActivityLog

};