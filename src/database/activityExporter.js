const ExcelJS = require("exceljs");
const { dialog } = require("electron");
const db = require("./database");
const path = require("path");
const { getActivityTimestamp } = require("./activityService");

const safeExcelValue = value => {
    const text = value === null || value === undefined ? "" : String(value);
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
};

function getActivityRows() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM activities ORDER BY id DESC", [],
            (error, rows) => error ? reject(error) : resolve(rows));
    });
}

async function exportActivityLog() {
    const rows = await getActivityRows();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Activity Log");
    sheet.columns = [
        { header: "Date", key: "activity_date", width: 18 },
        { header: "Time", key: "activity_time", width: 15 },
        { header: "Category", key: "category", width: 18 },
        { header: "Action", key: "action", width: 35 },
        { header: "Details", key: "details", width: 50 },
        { header: "User", key: "user_name", width: 20 },
        { header: "Status", key: "status", width: 15 },
        { header: "Entity Type", key: "entity_type", width: 20 },
        { header: "Reference No", key: "reference_no", width: 24 },
        { header: "Created At", key: "created_at", width: 30 },
        { header: "Change Data", key: "change_data", width: 60 }
    ];
    rows.forEach(row => {
        sheet.addRow(Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, safeExcelValue(value)])
        ));
    });

    const timestamp = getActivityTimestamp();
    const [dd, month, yyyy] = timestamp.activity_date.split(" ");
    const result = await dialog.showSaveDialog({
        defaultPath: `KL_Activity_Log_${dd}_${month}_${yyyy}.xlsx`
    });
    if (result.canceled) return { success: false, cancelled: true };

    await workbook.xlsx.writeFile(result.filePath);
    return {
        success: true,
        filePath: result.filePath,
        fileName: path.basename(result.filePath),
        rowCount: rows.length
    };
}

module.exports = { exportActivityLog, safeExcelValue };
