const { getBusinessReport } = require("./src/database/reportService");
const { exportBusinessReport } = require("./src/database/excelExporter");

async function test() {

    try {

        const data = await getBusinessReport(
            "2026-07-01",
            "2026-07-31"
        );

        const workbook = await exportBusinessReport(data);

        await workbook.xlsx.writeFile("BusinessReport.xlsx");

        console.log("Report created successfully.");

    } catch (err) {

        console.error(err);

    }

}

test();