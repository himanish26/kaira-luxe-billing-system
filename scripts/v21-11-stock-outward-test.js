"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const sqlite3 = require("sqlite3").verbose();
const { createStockOutwardService } = require("../src/database/stockOutwardService");
const { createStockOutwardDeletionAuthorization } = require("../src/database/stockOutwardService");
const { migrateStockOutwardCompletionV16 } = require("../src/database/stockOutwardCompletionMigrationV16");
const databaseModulePath=require.resolve("../src/database/database");
const previousDatabaseModule=require.cache[databaseModulePath];
require.cache[databaseModulePath]={id:databaseModulePath,filename:databaseModulePath,loaded:true,exports:{}};
const { normalizeActivity } = require("../src/database/activityService");
if(previousDatabaseModule)require.cache[databaseModulePath]=previousDatabaseModule;else delete require.cache[databaseModulePath];

const run = (db, sql, params=[]) => new Promise((resolve,reject)=>db.run(sql,params,function(error){error?reject(error):resolve({lastID:this.lastID,changes:this.changes});}));
const get = (db, sql, params=[]) => new Promise((resolve,reject)=>db.get(sql,params,(error,row)=>error?reject(error):resolve(row||null)));
const all = (db, sql, params=[]) => new Promise((resolve,reject)=>db.all(sql,params,(error,rows)=>error?reject(error):resolve(rows||[])));
const open = (databasePath=":memory:") => new Promise((resolve,reject)=>{const db=new sqlite3.Database(databasePath,error=>error?reject(error):resolve(db));});
async function appendTestActivity(db,event,instant){
    const normalized=normalizeActivity(event,instant);
    await run(db,`INSERT INTO activities(activity_date,activity_time,category,action,details,user_name,status,entity_type,reference_no,change_data,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[normalized.activity_date,normalized.activity_time,normalized.category,normalized.action,normalized.details,normalized.user_name,normalized.status,normalized.entity_type,normalized.reference_no,normalized.change_data,normalized.created_at]);
}

async function createV15Fixture() {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),"klbs-v21-inv02c-"));
    const databasePath=path.join(directory,"outward-test.db");
    const db=await open(databasePath);
    await run(db,"PRAGMA foreign_keys=ON");
    await run(db,"CREATE TABLE stores(id INTEGER PRIMARY KEY,store_code TEXT UNIQUE,store_name TEXT,status TEXT,created_at TEXT,updated_at TEXT)");
    await run(db,"CREATE TABLE store_context(id INTEGER PRIMARY KEY CHECK(id=1),current_store_id INTEGER NOT NULL REFERENCES stores(id))");
    await run(db,"INSERT INTO stores VALUES(1,'KL001','Kaira Luxe','ACTIVE','t','t')");
    await run(db,"INSERT INTO store_context VALUES(1,1)");
    await run(db,"CREATE TABLE products(id INTEGER PRIMARY KEY,barcode TEXT,sku TEXT,product_name TEXT,brand TEXT,colour TEXT,size TEXT,active INTEGER DEFAULT 1)");
    await run(db,"INSERT INTO products VALUES(1,'00123','SKU-1','Kurti One','Brand','Blue','M',1),(2,'0002','SKU-2','Kurti Two','Brand','Red','L',1),(3,'0003','SKU-3','No Stock','Brand','Black','S',1),(4,'ABC12345','SKU-4','Alpha Barcode','Brand','Green','S',1),(5,'JOCKEY-BLK-L','SKU-5','Mixed Barcode','Brand','Black','L',1),(6,'INACTIVE1','SKU-6','Inactive Product','Brand','Grey','M',0)");
    await run(db,`CREATE TABLE inventory_transactions(
        id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER,barcode TEXT,transaction_type TEXT NOT NULL,
        quantity INTEGER NOT NULL,reference_type TEXT,reference_id TEXT,supplier_id INTEGER,invoice_no TEXT,
        remarks TEXT,created_by TEXT DEFAULT 'Administrator',created_at TEXT NOT NULL,
        CHECK(transaction_type IN ('OPENING','INWARD','SALE','RETURN','DAMAGE','ADJUSTMENT','SUPPLIER_RETURN'))
    )`);
    await run(db,"INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,created_at) VALUES(1,'00123','OPENING',5,'t'),(2,'0002','OPENING',2,'t'),(4,'ABC12345','OPENING',2,'t'),(5,'JOCKEY-BLK-L','OPENING',2,'t')");
    await run(db,`CREATE TABLE stock_movements(
        id INTEGER PRIMARY KEY AUTOINCREMENT,movement_no TEXT NOT NULL UNIQUE,
        direction TEXT NOT NULL CHECK(direction IN ('INWARD','OUTWARD')),
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PARTIALLY_POSTED','PENDING_MASTER','COMPLETE','CANCELLED')),
        supplier_id INTEGER,supplier_name TEXT,supplier_code_snapshot TEXT,supplier_invoice_id INTEGER,
        supplier_invoice_code_snapshot TEXT,invoice_no TEXT,invoice_number_snapshot TEXT,reference_text TEXT,
        invoice_date TEXT,invoice_total_quantity INTEGER,store_id INTEGER REFERENCES stores(id),
        store_code_snapshot TEXT,store_name_snapshot TEXT,business_date TEXT NOT NULL,reason TEXT,remarks TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,posted_by TEXT,posted_at TEXT,cancelled_by TEXT,cancelled_at TEXT,
        cancel_reason TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        archived_at TEXT,archived_by TEXT
    )`);
    await run(db,`CREATE TABLE stock_movement_lines(
        id INTEGER PRIMARY KEY AUTOINCREMENT,movement_id INTEGER NOT NULL,barcode TEXT NOT NULL,
        scanned_quantity INTEGER NOT NULL CHECK(scanned_quantity>0),recognized_quantity INTEGER NOT NULL DEFAULT 0,
        product_id INTEGER,product_state TEXT NOT NULL DEFAULT 'PENDING_MASTER' CHECK(product_state IN ('READY','PENDING_MASTER')),
        posting_state TEXT NOT NULL DEFAULT 'UNPOSTED' CHECK(posting_state IN ('UNPOSTED','POSTED')),
        posted_quantity INTEGER NOT NULL DEFAULT 0,inventory_transaction_id INTEGER,sku_snapshot TEXT,
        product_name_snapshot TEXT,colour_snapshot TEXT,size_snapshot TEXT,resolution_note TEXT,
        discard_reason TEXT,discarded_by TEXT,discarded_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        UNIQUE(movement_id,barcode),
        CHECK((product_state='PENDING_MASTER' AND product_id IS NULL AND recognized_quantity=0) OR (product_state='READY' AND product_id IS NOT NULL AND recognized_quantity>0)),
        CHECK((posting_state='UNPOSTED' AND posted_quantity=0) OR (posting_state='POSTED' AND posted_quantity=recognized_quantity)),
        FOREIGN KEY(movement_id) REFERENCES stock_movements(id),FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(inventory_transaction_id) REFERENCES inventory_transactions(id)
    )`);
    await run(db,`CREATE TRIGGER trg_stock_movement_line_direction_insert BEFORE INSERT ON stock_movement_lines
      FOR EACH ROW WHEN (SELECT direction FROM stock_movements WHERE id=NEW.movement_id)<>'INWARD' AND NEW.product_state='PENDING_MASTER'
      BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MOVEMENT_LINE_DIRECTION_INVALID'); END`);
    await run(db,`CREATE TRIGGER trg_stock_movement_line_posted_immutable BEFORE UPDATE ON stock_movement_lines
      FOR EACH ROW WHEN OLD.posting_state='POSTED' AND (NEW.posting_state<>OLD.posting_state OR NEW.barcode<>OLD.barcode OR NEW.scanned_quantity<>OLD.scanned_quantity OR NEW.recognized_quantity<>OLD.recognized_quantity OR NEW.product_id IS NOT OLD.product_id OR NEW.posted_quantity<>OLD.posted_quantity OR NEW.inventory_transaction_id IS NOT OLD.inventory_transaction_id)
      BEGIN SELECT RAISE(ABORT,'KLBS_POSTED_STOCK_MOVEMENT_LINE_IMMUTABLE'); END`);
    await run(db,`CREATE TRIGGER trg_stock_movement_posted_immutable BEFORE UPDATE ON stock_movements
      FOR EACH ROW WHEN OLD.status IN ('COMPLETE','CANCELLED') AND (NEW.status<>OLD.status OR NEW.movement_no<>OLD.movement_no OR NEW.business_date<>OLD.business_date)
      BEGIN SELECT RAISE(ABORT,'KLBS_POSTED_STOCK_MOVEMENT_IMMUTABLE'); END`);
    await run(db,"CREATE TABLE stock_movement_sequences(id INTEGER PRIMARY KEY CHECK(id=1),next_movement_number INTEGER NOT NULL)");
    await run(db,"INSERT INTO stock_movement_sequences VALUES(1,14)");
    await run(db,`CREATE TABLE activities(id INTEGER PRIMARY KEY AUTOINCREMENT,activity_date TEXT,activity_time TEXT,category TEXT,action TEXT,details TEXT,user_name TEXT,status TEXT,entity_type TEXT,reference_no TEXT,change_data TEXT,created_at TEXT)`);
    await run(db,`CREATE TRIGGER trg_stock_movement_delete_prohibited BEFORE DELETE ON stock_movements
      BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MOVEMENT_DELETE_PROHIBITED'); END`);
    await migrateStockOutwardCompletionV16(db);
    return {db,databasePath,directory};
}

async function verifyLegacyOutwardUnchanged(db){
    const databasePath=require.resolve("../src/database/database");
    const logsPath=require.resolve("../src/database/logService");
    const inventoryPath=require.resolve("../src/database/inventoryTransactionService");
    const previousDatabase=require.cache[databasePath],previousLogs=require.cache[logsPath],previousInventory=require.cache[inventoryPath];
    require.cache[databasePath]={id:databasePath,filename:databasePath,loaded:true,exports:db};
    require.cache[logsPath]={id:logsPath,filename:logsPath,loaded:true,exports:{logStockOutward:async()=>{},logStockInward:async()=>{}}};
    delete require.cache[inventoryPath];
    try{
        const legacy=require("../src/database/inventoryTransactionService");
        const result=await legacy.stockOutward({barcode:"0002",quantity:1,reason:"DAMAGE",remarks:"Legacy path test",createdBy:"TEST"});
        assert.equal(result.success,true);assert.equal(result.currentStock,1,"legacy single-SKU deduction contract remains available");
        await assert.rejects(legacy.stockOutward({barcode:"0002",quantity:2,reason:"DAMAGE"}),/Insufficient stock/i);
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions WHERE reference_type='STOCK_OUTWARD'")).n,1,"legacy insufficient-stock attempt adds no ledger row");
    }finally{
        if(previousDatabase)require.cache[databasePath]=previousDatabase;else delete require.cache[databasePath];
        if(previousLogs)require.cache[logsPath]=previousLogs;else delete require.cache[logsPath];
        if(previousInventory)require.cache[inventoryPath]=previousInventory;else delete require.cache[inventoryPath];
    }
}

async function main(){
    const fixture=await createV15Fixture();
    let db=fixture.db;
    let activityCount=0;
    const service=createStockOutwardService(db,{now:()=>new Date("2026-10-09T06:00:00.000Z"),getBusinessDate:()=>"2026-10-09",appendActivityInTransaction:async(conn,event,instant)=>{if(event.action==="STOCK_OUTWARD_POSTED")activityCount++;return appendTestActivity(conn,event,instant);}});
    try{
        await verifyLegacyOutwardUnchanged(db);
        assert.throws(()=>normalizeActivity({category:"INVENTORY",action:"STOCK_OUTWARD_DOCUMENT_DELETED",details:"test",user_name:"MANAGER",status:"SUCCESS",change_data:{version:1,changes:[{field:"document",label:"Deleted Stock Outward",old:"KLOUT000001",new:"DELETED"},{field:"inventory",label:"Inventory ledger entries",old:"0",new:"0"}]}}),/disallowed field/i,"original deletion payload is rejected by the established Activity Log allowlist");
        const first=await service.createDraft({});
        assert.equal(first.movementNo,"KLOUT000001","first outward number is stable");
        assert.equal((await get(db,"SELECT next_movement_number FROM stock_movement_sequences WHERE id=1")).next_movement_number,14,"KLINW sequence remains untouched");
        await assert.rejects(service.scan({movementId:first.movementId,barcode:"00123"}),/reason/i,"reason is required before scanning");
        await assert.rejects(service.updateContext({movementId:first.movementId,businessDate:"2026-10-09",reason:""}),error=>error.code==="STOCK_OUTWARD_REASON_REQUIRED","direct context update without a reason is rejected by the service boundary");
        await assert.rejects(service.saveDraft({movementId:first.movementId}),error=>error.code==="STOCK_OUTWARD_REASON_REQUIRED","server rejects saving a draft without a valid reason");
        await assert.rejects(service.updateContext({movementId:first.movementId,businessDate:"2026-10-10",reason:"DAMAGE"}),/future/i,"future business dates are rejected");
        await assert.rejects(service.updateContext({movementId:first.movementId,businessDate:"2026-10-08",reason:"DAMAGE"}),error=>error.code==="STOCK_OUTWARD_DATE_BACKDATED","backdated outward business dates are rejected");
        await assert.rejects(service.updateContext({movementId:first.movementId,businessDate:"2026-02-30",reason:"DAMAGE"}),/valid Outward Date/i,"invalid calendar dates are rejected");
        let detail=await service.updateContext({movementId:first.movementId,businessDate:"2026-10-09",reason:"DAMAGE",remarks:"Store equipment maintenance"});
        assert.equal(detail.document.remarks,"Store equipment maintenance","remarks persist on draft");
        const reopenedService=createStockOutwardService(db,{now:()=>new Date("2026-10-09T06:00:00.000Z"),getBusinessDate:()=>"2026-10-09",appendActivityInTransaction:appendTestActivity});
        assert((await reopenedService.listResumable()).some(row=>row.id===first.movementId),"saved outward draft remains resumable through a fresh service instance");
        await assert.rejects(service.scan({movementId:first.movementId,barcode:"unknown"}),/not found/i,"unknown barcode is rejected");
        const beforeRejectedScans=Number((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions")).n);
        await assert.rejects(service.scan({movementId:first.movementId,barcode:"0003"}),error=>error.code==="STOCK_OUTWARD_ZERO_STOCK","zero-stock barcode is rejected with its specific code");
        await assert.rejects(service.scan({movementId:first.movementId,barcode:"00123",quantity:6}),error=>error.code==="STOCK_OUTWARD_INSUFFICIENT_STOCK"&&error.available===5&&error.requested===6,"excess quantity exposes validated available and requested values");
        await assert.rejects(service.scan({movementId:first.movementId,barcode:"INACTIVE1"}),error=>error.code==="STOCK_OUTWARD_PRODUCT_INACTIVE","inactive Product Master record is rejected specifically");
        assert.equal(Number((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions")).n),beforeRejectedScans,"rejected scans never mutate inventory ledger");
        for (const invalidQuantity of [0,-1,1.5,"not-a-number",""]) {
            await assert.rejects(service.scan({movementId:first.movementId,barcode:"00123",quantity:invalidQuantity}),error=>error.code==="STOCK_OUTWARD_QUANTITY_INVALID",`invalid outward quantity ${String(invalidQuantity)} is rejected`);
        }
        const firstLine=await service.scan({movementId:first.movementId,barcode:"00123",quantity:1});
        const savedDraft=await service.saveDraft({movementId:first.movementId});
        assert.equal(savedDraft.success,true,"nonempty valid Stock Outward draft saves without posting");
        assert.equal(savedDraft.document.status,"DRAFT");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions WHERE reference_type='STOCK_OUTWARD' AND reference_id=?",[first.movementNo])).n,0,"Save Draft never posts inventory");
        assert.equal(firstLine.lines[0].barcode,"00123","barcode leading zeroes are preserved");
        const duplicate=await service.scan({movementId:first.movementId,barcode:"00123",quantity:1});
        assert.equal(duplicate.duplicate,true,"duplicate barcode is returned for focus/edit without another line");
        assert.equal(duplicate.lines.length,1);
        await assert.rejects(service.editLine({movementId:first.movementId,lineId:firstLine.addedLineId,quantity:"1.5"}),/whole number/i);
        detail=await service.editLine({movementId:first.movementId,lineId:firstLine.addedLineId,quantity:2});
        assert.equal(detail.summary.totalUnits,2,"editable quantity updates draft totals");
        await assert.rejects(service.editLine({movementId:first.movementId,lineId:firstLine.addedLineId,quantity:6}),/Only 5 units available/i);
        const other=await service.scan({movementId:first.movementId,barcode:"0002",quantity:1});
        assert.equal(other.lines.length,2,"multiple SKUs are supported");
        detail=await service.removeLine({movementId:first.movementId,lineId:other.addedLineId});
        assert.equal(detail.lines.length,1,"removing a row only changes the draft");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions WHERE reference_type='STOCK_OUTWARD'")).n,1,"draft/scan/edit/remove do not add deductions beyond the preserved legacy test record");
        const alphaLine=await service.scan({movementId:first.movementId,barcode:"ABC12345"});
        assert.equal(alphaLine.lines.find(line=>line.product_id===4).barcode,"ABC12345","alphanumeric Product Master barcode resolves exactly in outward draft");
        const mixedLine=await service.scan({movementId:first.movementId,barcode:"JOCKEY-BLK-L"});
        assert.equal(mixedLine.lines.find(line=>line.product_id===5).barcode,"JOCKEY-BLK-L","hyphenated Product Master barcode identity is preserved");
        await service.removeLine({movementId:first.movementId,lineId:alphaLine.addedLineId});
        await service.removeLine({movementId:first.movementId,lineId:mixedLine.addedLineId});
        const deletionAuthorization=createStockOutwardDeletionAuthorization();
        await assert.rejects(service.deleteDocument({movementId:first.movementId}),error=>error.code==="STOCK_OUTWARD_DELETE_UNAUTHORIZED","direct service deletion without the privileged Manager capability is rejected");
        await assert.rejects(service.deleteDocument({movementId:first.movementId,authorization:{purpose:"STOCK_OUTWARD_DELETE"}}),error=>error.code==="STOCK_OUTWARD_DELETE_UNAUTHORIZED","renderer-shaped authorization objects cannot impersonate the Manager capability");
        const ledgerCountBeforeDelete=(await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions")).n;
        const deletedDraft=await service.deleteDocument({movementId:first.movementId,authorization:deletionAuthorization,actor:"MANAGER"});
        assert.equal(deletedDraft.success,true,"authorized draft deletion succeeds");
        assert.equal(await service.load(first.movementId),null,"deleted draft is no longer loadable");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM stock_movement_lines WHERE movement_id=?",[first.movementId])).n,0,"draft lines are permanently removed");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions")).n,ledgerCountBeforeDelete,"document deletion does not change the inventory ledger");
        const deletionAudit=await get(db,"SELECT action,details,reference_no,user_name FROM activities WHERE action='STOCK_OUTWARD_DOCUMENT_DELETED' AND reference_no=?",[first.movementNo]);
        assert(deletionAudit&&deletionAudit.details.includes("previous_status=DRAFT")&&deletionAudit.details.includes("outward_reason=DAMAGE")&&deletionAudit.details.includes("document_id=")&&deletionAudit.details.includes("deletion_timestamp=")&&deletionAudit.details.includes("authorized_manager=MANAGER")&&deletionAudit.details.includes("no_ledger_entries=true")&&deletionAudit.details.includes("action=PERMANENT_DELETE"),"durable deletion audit records document, prior status, reason, timestamp, manager role, ledger absence and action");

        const auditRollback=await service.createDraft({});
        await service.updateContext({movementId:auditRollback.movementId,businessDate:"2026-10-09",reason:"DAMAGE"});
        const failingAuditService=createStockOutwardService(db,{now:()=>new Date("2026-10-09T06:00:00.000Z"),getBusinessDate:()=>"2026-10-09",appendActivityInTransaction:async()=>{throw new Error("forced Activity Log failure");}});
        await assert.rejects(failingAuditService.deleteDocument({movementId:auditRollback.movementId,authorization:deletionAuthorization,actor:"MANAGER"}),/forced Activity Log failure/i,"Activity Log failure rejects deletion");
        assert.equal((await service.load(auditRollback.movementId)).document.status,"DRAFT","Activity Log failure rolls back document deletion");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM activities WHERE reference_no=? AND action='STOCK_OUTWARD_DOCUMENT_DELETED'",[auditRollback.movementNo])).n,0,"failed audit transaction leaves no deletion event");

        const rollbackDoc=await service.createDraft({});
        await service.updateContext({movementId:rollbackDoc.movementId,businessDate:"2026-10-09",reason:"ADJUSTMENT"});
        await service.scan({movementId:rollbackDoc.movementId,barcode:"00123",quantity:2});
        await service.scan({movementId:rollbackDoc.movementId,barcode:"0002",quantity:1});
        await run(db,"CREATE TRIGGER fail_second_line BEFORE INSERT ON inventory_transactions WHEN NEW.reference_type='STOCK_OUTWARD' AND NEW.barcode='0002' BEGIN SELECT RAISE(ABORT,'forced ledger failure'); END");
        await assert.rejects(service.post({movementId:rollbackDoc.movementId,actor:"MANAGER"}),/forced ledger failure/i,"an injected second-line DB failure aborts posting");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions WHERE reference_type='STOCK_OUTWARD'")).n,1,"failed batch leaves no orphan or partial outward-document ledger rows");
        assert.equal((await service.load(rollbackDoc.movementId)).document.status,"DRAFT","failed batch leaves draft resumable");
        await run(db,"DROP TRIGGER fail_second_line");
        await run(db,"INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,created_at) VALUES(1,'00123','SALE',-4,'concurrent')");
        await assert.rejects(service.post({movementId:rollbackDoc.movementId,actor:"MANAGER"}),/Only 1 units available/i,"post rechecks live stock after draft scanning");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions WHERE reference_type='STOCK_OUTWARD'")).n,1,"stale stock rejection makes no outward-document deduction");

        const successDoc=await service.createDraft({});
        assert.equal(successDoc.movementNo,"KLOUT000004","cancelled/failed document numbers are not reused");
        await service.updateContext({movementId:successDoc.movementId,businessDate:"2026-10-09",reason:"SUPPLIER_RETURN",remarks:"Return to supplier"});
        const lineA=await service.scan({movementId:successDoc.movementId,barcode:"00123",quantity:1});
        await service.scan({movementId:successDoc.movementId,barcode:"0002",quantity:1});
        const posted=await service.post({movementId:successDoc.movementId,actor:"MANAGER"});
        assert.equal(posted.document.status,"COMPLETE");assert.equal(posted.summary.totalItems,2);assert.equal(posted.summary.totalUnits,2);
        assert.equal(posted.document.reason,"SUPPLIER_RETURN");
        const linked=await all(db,"SELECT l.barcode,l.posted_quantity,l.inventory_transaction_id,t.quantity,t.transaction_type,t.reference_type,t.reference_id FROM stock_movement_lines l JOIN inventory_transactions t ON t.id=l.inventory_transaction_id WHERE l.movement_id=? ORDER BY l.id",[successDoc.movementId]);
        assert.equal(linked.length,2,"each posted line has exactly one linked ledger transaction");
        assert(linked.every(row=>row.quantity<0&&row.transaction_type==="SUPPLIER_RETURN"&&row.reference_type==="STOCK_OUTWARD"&&row.reference_id===successDoc.movementNo));
        assert.equal((await get(db,"SELECT COALESCE(SUM(quantity),0) AS n FROM inventory_transactions WHERE product_id=1")).n,0,"outward cannot take available stock below zero");
        assert.equal(activityCount,1,"one transactional audit event recorded for the document");
        const attempts=await Promise.allSettled([service.post({movementId:successDoc.movementId,actor:"MANAGER"}),service.post({movementId:successDoc.movementId,actor:"MANAGER"})]);
        assert.equal(attempts.filter(result=>result.status==="fulfilled").length,0,"completed document cannot be posted again");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions WHERE reference_id=?",[successDoc.movementNo])).n,2,"repeated IPC/service requests cannot duplicate line deductions");
        const viewBefore=await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions");
        await service.load(successDoc.movementId);await service.load(successDoc.movementId);
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions")).n,viewBefore.n,"read-only document retrieval does not mutate inventory");
        const history=await service.listHistory({page:1,pageSize:1,keyword:"00123"});
        assert.equal(history.totalCount,1,"history supports barcode search and paging");
        assert.equal(history.rows[0].movement_no,successDoc.movementNo);

        const cancelled=await service.createDraft({});
        await service.updateContext({movementId:cancelled.movementId,businessDate:"2026-10-09",reason:"DAMAGE"});
        await run(db,"INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,created_at) VALUES(2,'0002','OPENING',1,'test-restock')");
        await service.scan({movementId:cancelled.movementId,barcode:"0002",quantity:1});
        await service.cancelDraft(cancelled.movementId,"MANAGER");
        const cancelledDetail=await service.load(cancelled.movementId);
        assert.equal(cancelledDetail.document.status,"CANCELLED");
        assert.equal(cancelledDetail.summary.totalUnits,1,"cancelled document remains viewable with its pre-post requested quantities");
        await assert.rejects(service.post({movementId:cancelled.movementId,actor:"MANAGER"}),error=>error.code==="STOCK_OUTWARD_ALREADY_POSTED","cancelled document cannot be posted");
        const historyPage=await service.listHistory({page:99,pageSize:1});
        assert.equal(historyPage.totalCount,2,"history includes completed and cancelled outward documents");
        assert.equal(historyPage.page,2,"history clamps requested page to valid final page");
        assert.equal(historyPage.rows.length,1);
        const cancelledHistory=await service.listHistory({page:1,pageSize:10,keyword:cancelled.movementNo});
        assert.equal(cancelledHistory.rows[0].item_count,1,"cancelled history retains its draft item count");
        assert.equal(cancelledHistory.rows[0].total_units,1,"cancelled history retains its requested quantity");
        const cancelledDelete=await service.deleteDocument({movementId:cancelled.movementId,authorization:deletionAuthorization,actor:"MANAGER"});
        assert.equal(cancelledDelete.previousStatus,"CANCELLED","manager can delete an unposted cancelled document");
        assert.equal(await service.load(cancelled.movementId),null);
        await assert.rejects(service.deleteDocument({movementId:successDoc.movementId,authorization:deletionAuthorization,actor:"MANAGER"}),error=>error.code==="STOCK_OUTWARD_DELETE_NOT_ALLOWED","completed documents cannot be deleted");
        const linkedDraft=await service.createDraft({});
        await run(db,"INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,reference_type,reference_id,created_at) VALUES(1,'00123','DAMAGE',0,'STOCK_OUTWARD',?,'test')",[linkedDraft.movementNo]);
        await assert.rejects(service.deleteDocument({movementId:linkedDraft.movementId,authorization:deletionAuthorization}),error=>error.code==="STOCK_OUTWARD_DELETE_HAS_LEDGER","ledger-linked documents cannot be deleted even if still marked draft");
        const guardedDraft=await service.createDraft({});
        await assert.rejects(run(db,"DELETE FROM stock_movements WHERE id=?",[guardedDraft.movementId]),/KLBS_STOCK_MOVEMENT_DELETE_PROHIBITED/i,"database trigger blocks deletion without durable audit");
        assert.equal((await service.createDraft({})).movementNo,"KLOUT000008","deleted numbers are never reused after subsequent allocations");
        const concurrentNumbers=await Promise.all([service.createDraft({}),service.createDraft({})]);
        assert.deepEqual(concurrentNumbers.map(row=>row.movementNo),["KLOUT000009","KLOUT000010"],"serialized concurrent creation allocates unique increasing numbers");
        const restartedService=createStockOutwardService(db,{now:()=>new Date("2026-10-09T06:00:00.000Z"),getBusinessDate:()=>"2026-10-09",appendActivityInTransaction:appendTestActivity});
        assert.equal((await restartedService.createDraft({})).movementNo,"KLOUT000011","numbering high-water survives service recreation");
        const lifecycleRace=await service.createDraft({});
        await service.updateContext({movementId:lifecycleRace.movementId,businessDate:"2026-10-09",reason:"DAMAGE"});
        await service.scan({movementId:lifecycleRace.movementId,barcode:"0002",quantity:1});
        const race=await Promise.allSettled([
            service.post({movementId:lifecycleRace.movementId,actor:"MANAGER"}),
            service.deleteDocument({movementId:lifecycleRace.movementId,authorization:deletionAuthorization,actor:"MANAGER"})
        ]);
        assert.equal(race[0].status,"fulfilled","posting wins a serialized concurrent delete/post race when queued first");
        assert.equal(race[1].status,"rejected","deletion rechecks current status after the competing post");
        assert.equal((await service.load(lifecycleRace.movementId)).document.status,"COMPLETE");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions WHERE reference_id=?",[lifecycleRace.movementNo])).n,1,"concurrent deletion cannot remove or duplicate the committed stock movement");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM (SELECT product_id,SUM(quantity) AS available FROM inventory_transactions GROUP BY product_id HAVING available<0)")).n,0,"no product has negative available stock after outward posting");
        await run(db,"INSERT INTO stock_movements(movement_no,direction,status,store_id,business_date,idempotency_key,created_by,created_at,updated_at) VALUES('KLINW000999','INWARD','DRAFT',1,'2026-10-09','TEST_INWARD_GUARD','TEST','t','t')");
        const inwardGuard=await get(db,"SELECT id FROM stock_movements WHERE movement_no='KLINW000999'");
        await assert.rejects(run(db,"DELETE FROM stock_movements WHERE id=?",[inwardGuard.id]),/KLBS_STOCK_MOVEMENT_DELETE_PROHIBITED/i,"V16 leaves Stock Inward document deletion prohibited");
        await new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()));
        db=await open(fixture.databasePath);
        await run(db,"PRAGMA foreign_keys=ON");
        const processRestartService=createStockOutwardService(db,{now:()=>new Date("2026-10-09T06:00:00.000Z"),getBusinessDate:()=>"2026-10-09",appendActivityInTransaction:appendTestActivity});
        assert.equal((await processRestartService.createDraft({})).movementNo,"KLOUT000014","numbering high-water persists across closing and reopening the isolated SQLite database");
        assert.equal((await get(db,"SELECT next_movement_number FROM stock_movement_sequences WHERE id=1")).next_movement_number,14);

        const emptyDraft=await processRestartService.createDraft({});
        assert.equal(emptyDraft.movementNo,"KLOUT000015","empty draft reserves the next monotonic outward number");
        await assert.rejects(processRestartService.saveDraft({movementId:emptyDraft.movementId}),error=>error.code==="STOCK_OUTWARD_REASON_REQUIRED","empty Save Draft cannot bypass mandatory reason validation");
        await processRestartService.updateContext({movementId:emptyDraft.movementId,businessDate:"2026-10-09",reason:"DAMAGE"});
        await assert.rejects(processRestartService.saveDraft({movementId:emptyDraft.movementId}),error=>error.code==="STOCK_OUTWARD_EMPTY_DRAFT","empty Save Draft is rejected at the service boundary");
        const discardEmpty=await processRestartService.deleteDocument({movementId:emptyDraft.movementId,authorization:deletionAuthorization,actor:"MANAGER",emptyOnly:true});
        assert.equal(discardEmpty.success,true,"a confirmed empty draft with context can be discarded without stock changes");
        const untouchedDraft=await processRestartService.createDraft({});
        const ledgerBeforeAbandon=(await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions")).n;
        const abandoned=await processRestartService.deleteDocument({movementId:untouchedDraft.movementId,authorization:deletionAuthorization,actor:"MANAGER",emptyOnly:true});
        assert.equal(abandoned.success,true,"only untouched empty documents may use no-prompt empty cleanup");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions")).n,ledgerBeforeAbandon,"empty-draft cleanup never changes inventory");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM activities WHERE action='STOCK_OUTWARD_DOCUMENT_DELETED' AND reference_no=?",[untouchedDraft.movementNo])).n,1,"empty-draft cleanup retains the durable deletion audit");
        assert.equal((await processRestartService.createDraft({})).movementNo,"KLOUT000017","number allocated to an abandoned empty document is not reused");
        await run(db,"INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,created_at) VALUES(1,'00123','OPENING',2,'test-date-fixture')");
        const oldBusinessDateDraft=await processRestartService.createDraft({});
        await processRestartService.updateContext({movementId:oldBusinessDateDraft.movementId,businessDate:"2026-10-09",reason:"DAMAGE"});
        await processRestartService.scan({movementId:oldBusinessDateDraft.movementId,barcode:"00123",quantity:1});
        await run(db,"UPDATE stock_movements SET business_date='2026-10-08' WHERE id=?",[oldBusinessDateDraft.movementId]);
        const ledgerBeforeBackdatedPost=Number((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions WHERE reference_type='STOCK_OUTWARD'")).n);
        await assert.rejects(processRestartService.post({movementId:oldBusinessDateDraft.movementId,actor:"MANAGER"}),error=>error.code==="STOCK_OUTWARD_DATE_BACKDATED","direct posting of a backdated draft is rejected");
        assert.equal(Number((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions WHERE reference_type='STOCK_OUTWARD'")).n),ledgerBeforeBackdatedPost,"backdated rejection does not create ledger entries");
        await processRestartService.updateContext({movementId:oldBusinessDateDraft.movementId,businessDate:"2026-10-09",reason:"DAMAGE"});
        assert.equal((await processRestartService.post({movementId:oldBusinessDateDraft.movementId,actor:"MANAGER"})).document.status,"COMPLETE","an older draft can be brought forward and posted on the current business date");
        const emptyCancelled=await processRestartService.createDraft({});
        const ledgerBeforeEmptyCancel=Number((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions")).n);
        assert.deepEqual(await processRestartService.cancelDraft(emptyCancelled.movementId,"MANAGER"),{cancelled:true,hadLines:false},"empty draft Cancel follows the existing safe cancellation lifecycle");
        assert.equal((await processRestartService.load(emptyCancelled.movementId)).document.status,"CANCELLED","empty Cancel creates no editable or postable Draft");
        assert.equal(Number((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions")).n),ledgerBeforeEmptyCancel,"empty Cancel does not change inventory");

        const mainSource=fs.readFileSync(path.join(__dirname,"../src/main/main.js"),"utf8");
        const printerSource=fs.readFileSync(path.join(__dirname,"../src/main/printer.js"),"utf8");
        assert.match(mainSource,/stock-outward:enter[\s\S]*?requireSecurityGrant\(grant,\s*"INVENTORY_OUTWARD"\)/,"new workspace consumes the existing server-side Manager grant");
        assert.match(mainSource,/stock-outward:print-receipt[\s\S]*?stockOutwardService\.load[\s\S]*?printStockOutwardReceipt/,"receipt handler loads a posted document and prints it without posting");
        const printHandler=mainSource.slice(mainSource.indexOf('ipcMain.handle("stock-outward:print-receipt"'),mainSource.indexOf('ipcMain.handle("stock-inward:enter"'));
        assert(!printHandler.includes("stockOutwardService.post"),"historical and immediate reprints cannot post inventory");
        assert.match(printerSource,/async function printStockOutwardReceipt[\s\S]*?getSettings\(\)[\s\S]*?default_printer[\s\S]*?webContents\.print/);
        console.log("PASS V21-INV-02D Stock Outward: empty draft save rejection, safe empty cleanup, durable audit, non-reused numbering, deletion guards, atomic post and legacy interface checks");
    }finally{await new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()));fs.rmSync(fixture.directory,{recursive:true,force:true});}
}

main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
