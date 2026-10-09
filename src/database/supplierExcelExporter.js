"use strict";
const ExcelJS = require("exceljs");
const money = value => Number(value || 0) / 100;
function head(sheet,row){sheet.getRow(row).eachCell(cell=>{cell.font={bold:true,color:{argb:"FFFFFFFF"}};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF4F2F24"}};cell.alignment={wrapText:true,vertical:"middle"};});}
async function exportSupplierAccount(data,filePath){
    if(!data?.supplier||!data?.store)throw new Error("Supplier account export data is required.");
    const workbook=new ExcelJS.Workbook();workbook.creator="KLBS";
    const invoices=workbook.addWorksheet("Invoices"),payments=workbook.addWorksheet("Payments"),credits=workbook.addWorksheet("Supplier Credit Notes"),openings=workbook.addWorksheet("Opening Outstanding"),statement=workbook.addWorksheet("Supplier Statement"),summary=workbook.addWorksheet("Supplier Account");
    const metadata=[["Store Code",data.store.storeCode],["Store Name",data.store.storeName],["Supplier Code",data.supplier.supplier_code],["Supplier Name",data.supplier.name],["Supplier Type",data.supplier.supplier_type==="COMPANY"?"COMPANY / DIRECT BRAND":data.supplier.supplier_type],["Status",data.supplier.status],["Generated At",new Date().toISOString()]];
    for(const [i,row]of metadata.entries()){summary.getRow(i+1).values=row;summary.getCell(`A${i+1}`).font={bold:true};}
    summary.getRow(8).values=["Total Purchases","Supplier Credit Notes","Total Payments","Opening Outstanding","Current Outstanding","Overdue","Open Liabilities"];
    summary.getRow(9).values=[money(data.supplier.total_purchases_paise),money(data.supplier.credit_notes_paise),money(data.supplier.total_payments_paise),money(data.supplier.opening_balance_paise),money(data.supplier.outstanding_paise),money(data.supplier.overdue_paise),data.supplier.open_liability_count||0];head(summary,8);
    invoices.addRow(["Invoice ID","Capture Mode","Supplier Invoice Number","Invoice Date","Posting Date","Business Segment","Total Quantity","Due Date","Tax Detail","Taxable Before Discount","Discount","CGST","SGST","IGST","Other Charges","Rounding Adjustment","Invoice Total","Paid","Credit Notes","Outstanding","Status"]);head(invoices,1);
    for(const row of data.invoices){const unknown=row.capture_mode==="SUMMARY"?"NOT CAPTURED":null;invoices.addRow([row.invoice_code,row.capture_mode,row.supplier_invoice_number,row.supplier_invoice_date,row.posting_date,row.business_segment,row.total_quantity??"Not captured",row.due_date,row.capture_mode==="SUMMARY"?"NOT CAPTURED":"DETAILED",unknown??money(row.taxable_paise),unknown??money(row.discount_paise),unknown??money(row.cgst_paise),unknown??money(row.sgst_paise),unknown??money(row.igst_paise),unknown??money(row.other_charges_paise),unknown??money(row.rounding_adjustment_paise),money(row.invoice_total_paise),money(row.paid_paise),money(row.credited_paise),money(row.outstanding_paise),row.overdue?"OVERDUE":row.payment_status]);}
    payments.addRow(["Payment ID","Payment Date","Mode","Reference","Amount"]);head(payments,1);
    for(const row of data.payments)payments.addRow([row.payment_code,row.payment_date,row.payment_mode,row.reference,money(row.amount_paise)]);
    credits.addRow(["Credit Note ID","External Number","Credit Note Date","Posting Date","Reason","Reference Invoice","Reference","Amount","Remarks"]);head(credits,1);
    for(const row of data.creditNotes)credits.addRow([row.credit_note_code,row.external_number,row.credit_note_date,row.posting_date,row.reason,row.reference_invoice_code,row.reference,money(row.amount_paise),row.remarks]);
    openings.addRow(["Opening Balance ID","As On Date","Reference","Due Date","Amount","Remarks"]);head(openings,1);
    for(const row of data.openings)openings.addRow([row.opening_code,row.as_on_date,row.reference,row.due_date||"As On Date",money(row.amount_paise),row.remarks]);
    statement.addRow(["Store Code","Supplier Code","Supplier Name","As Of / Period","Date","Particulars","Reference","Liability Increase","Liability Reduction","Running Balance"]);head(statement,1);
    const asOf=data.statement.at(-1)?.event_date||"No posted activity";
    for(const row of data.statement)statement.addRow([data.store.storeCode,data.supplier.supplier_code,data.supplier.name,asOf,row.event_date,row.event_type,row.reference||row.event_code,money(row.liability_increase_paise),money(row.liability_reduction_paise),money(row.running_balance_paise)]);
    for(const sheet of [invoices,payments,credits,openings,statement,summary]){sheet.views=[{state:"frozen",ySplit:1}];sheet.columns.forEach(column=>{column.width=Math.max(14,Math.min(38,Math.max(...sheet.getColumn(column.number).values.slice(1).map(value=>String(value??"").length),column.header?.length||12)+2));});}
    for(const sheet of [invoices,payments,credits,openings,statement])for(let r=2;r<=sheet.rowCount;r++)for(let c=1;c<=sheet.columnCount;c++)if(["Invoice Total","Paid","Credit Notes","Outstanding","Taxable Before Discount","Discount","CGST","SGST","IGST","Other Charges","Rounding Adjustment","Amount","Liability Increase","Liability Reduction","Running Balance"].includes(sheet.getCell(1,c).value))sheet.getCell(r,c).numFmt='"₹"#,##0.00;[Red]("₹"#,##0.00);-';
    await workbook.xlsx.writeFile(filePath);return {success:true,filePath};
}
module.exports={exportSupplierAccount};
