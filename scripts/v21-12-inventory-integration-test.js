"use strict";

const assert=require("node:assert/strict");
const sqlite3=require("sqlite3").verbose();
const {migrateStockInwardV14}=require("../src/database/stockInwardMigration");
const {migrateStockInwardArchiveV15}=require("../src/database/stockInwardArchiveMigration");
const {migrateStockOutwardCompletionV16}=require("../src/database/stockOutwardCompletionMigrationV16");
const {createStockInwardService}=require("../src/database/stockInwardService");
const {createStockOutwardService,createStockOutwardDeletionAuthorization}=require("../src/database/stockOutwardService");
const databaseModulePath=require.resolve("../src/database/database");
const previousDatabaseModule=require.cache[databaseModulePath];
require.cache[databaseModulePath]={id:databaseModulePath,filename:databaseModulePath,loaded:true,exports:{}};
const {normalizeActivity}=require("../src/database/activityService");
if(previousDatabaseModule)require.cache[databaseModulePath]=previousDatabaseModule;else delete require.cache[databaseModulePath];

const run=(db,sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(error){error?reject(error):resolve({id:this.lastID,changes:this.changes});}));
const get=(db,sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(error,row)=>error?reject(error):resolve(row||null)));
const all=(db,sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(error,rows)=>error?reject(error):resolve(rows||[])));
const open=()=>new Promise((resolve,reject)=>{const db=new sqlite3.Database(":memory:",error=>error?reject(error):resolve(db));});
async function appendActivity(db,event,instant){
    const row=normalizeActivity(event,instant);
    await run(db,`INSERT INTO activities(activity_date,activity_time,category,action,details,user_name,status,entity_type,reference_no,change_data,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[row.activity_date,row.activity_time,row.category,row.action,row.details,row.user_name,row.status,row.entity_type,row.reference_no,row.change_data,row.created_at]);
}

async function main(){
    const db=await open();
    try{
        await run(db,"PRAGMA foreign_keys=ON");
        await run(db,"CREATE TABLE stores(id INTEGER PRIMARY KEY,store_code TEXT UNIQUE,store_name TEXT,status TEXT,created_at TEXT,updated_at TEXT)");
        await run(db,"INSERT INTO stores VALUES(1,'KL001','Kaira Luxe','ACTIVE','test','test')");
        await run(db,"CREATE TABLE store_context(id INTEGER PRIMARY KEY CHECK(id=1),current_store_id INTEGER NOT NULL)");
        await run(db,"INSERT INTO store_context VALUES(1,1)");
        await run(db,"CREATE TABLE supplier_master(id INTEGER PRIMARY KEY,supplier_code TEXT,name TEXT,status TEXT)");
        await run(db,"INSERT INTO supplier_master VALUES(1,'SUP-1','Test Supplier','ACTIVE')");
        await run(db,"CREATE TABLE supplier_invoices(id INTEGER PRIMARY KEY,invoice_code TEXT,store_id INTEGER,supplier_id INTEGER,supplier_invoice_number TEXT,supplier_invoice_date TEXT,status TEXT)");
        await run(db,`CREATE TABLE products(id INTEGER PRIMARY KEY,barcode TEXT,sku TEXT,product_name TEXT,brand TEXT,colour TEXT,size TEXT,mrp REAL,active INTEGER,variable_value INTEGER DEFAULT 0)`);
        await run(db,"INSERT INTO products VALUES(1,'890000000001','SKU-1','Integration Product','Brand','Black','M',100,1,0),(2,'890000000002','SKU-2','Zero Stock Product','Brand','Blue','S',100,1,0)");
        await run(db,`CREATE TABLE inventory_transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER,barcode TEXT,transaction_type TEXT NOT NULL,quantity INTEGER NOT NULL,reference_type TEXT,reference_id TEXT,supplier_id INTEGER,invoice_no TEXT,remarks TEXT,created_by TEXT DEFAULT 'Administrator',created_at TEXT NOT NULL)`);
        await run(db,"INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,reference_type,reference_id,created_at) VALUES(1,'890000000001','OPENING',3,'OPENING','TEST-OPEN','2026-10-10T00:00:00Z')");
        await run(db,`CREATE TABLE stock_movements(id INTEGER PRIMARY KEY AUTOINCREMENT,movement_no TEXT NOT NULL UNIQUE,direction TEXT NOT NULL CHECK(direction IN ('INWARD','OUTWARD')),status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PARTIALLY_POSTED','PENDING_MASTER','COMPLETE','CANCELLED')),supplier_id INTEGER,supplier_name TEXT,supplier_code_snapshot TEXT,supplier_invoice_id INTEGER,supplier_invoice_code_snapshot TEXT,invoice_no TEXT,invoice_number_snapshot TEXT,reference_text TEXT,invoice_date TEXT,invoice_total_quantity INTEGER,store_id INTEGER,store_code_snapshot TEXT,store_name_snapshot TEXT,business_date TEXT NOT NULL,reason TEXT,remarks TEXT,idempotency_key TEXT NOT NULL UNIQUE,posted_by TEXT,posted_at TEXT,cancelled_by TEXT,cancelled_at TEXT,cancel_reason TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
        await run(db,`CREATE TABLE stock_movement_lines(id INTEGER PRIMARY KEY AUTOINCREMENT,movement_id INTEGER NOT NULL,barcode TEXT NOT NULL,scanned_quantity INTEGER NOT NULL,recognized_quantity INTEGER NOT NULL DEFAULT 0,product_id INTEGER,product_state TEXT NOT NULL DEFAULT 'PENDING_MASTER',posting_state TEXT NOT NULL DEFAULT 'UNPOSTED',posted_quantity INTEGER NOT NULL DEFAULT 0,inventory_transaction_id INTEGER,sku_snapshot TEXT,product_name_snapshot TEXT,colour_snapshot TEXT,size_snapshot TEXT,resolution_note TEXT,discard_reason TEXT,discarded_by TEXT,discarded_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(movement_id,barcode),FOREIGN KEY(movement_id) REFERENCES stock_movements(id),FOREIGN KEY(product_id) REFERENCES products(id),FOREIGN KEY(inventory_transaction_id) REFERENCES inventory_transactions(id))`);
        await run(db,"CREATE TABLE activities(id INTEGER PRIMARY KEY AUTOINCREMENT,activity_date TEXT,activity_time TEXT,category TEXT,action TEXT,details TEXT,user_name TEXT,status TEXT,entity_type TEXT,reference_no TEXT,change_data TEXT,created_at TEXT)");
        await run(db,"CREATE TABLE klbs_schema_metadata(id INTEGER PRIMARY KEY,schema_version INTEGER NOT NULL)");
        await run(db,"INSERT INTO klbs_schema_metadata VALUES(1,13)");
        await migrateStockInwardV14(db);
        await run(db,"UPDATE klbs_schema_metadata SET schema_version=15 WHERE id=1");
        await migrateStockInwardArchiveV15(db);
        await run(db,"UPDATE klbs_schema_metadata SET schema_version=16 WHERE id=1");
        await migrateStockOutwardCompletionV16(db);
        await run(db,"UPDATE stock_movement_sequences SET next_movement_number=1 WHERE id=1");

        const clock=()=>new Date("2026-10-10T06:00:00.000Z");
        const inward=createStockInwardService(db,{allowMultipleDrafts:true,getCurrentStore:async()=>({id:1,storeCode:"KL001",storeName:"Kaira Luxe",status:"ACTIVE"}),getBusinessDate:()=>"2026-10-10",now:clock,authorize:(grant,purpose)=>{if(grant!=="manager-grant"||purpose!=="INVENTORY_INWARD")throw new Error("Manager grant required");},appendActivityInTransaction:appendActivity});
        const outward=createStockOutwardService(db,{getBusinessDate:()=>"2026-10-10",now:clock,appendActivityInTransaction:appendActivity});
        const before=Number((await get(db,"SELECT SUM(quantity) AS q FROM inventory_transactions WHERE product_id=1")).q);
        assert.equal(before,3,"opening stock establishes 3 units");
        const inDoc=await inward.createDraft({},"MANAGER");
        await inward.updateContext({movementId:inDoc.movementId,supplierId:1,invoiceNumber:"INV-INT-1",invoiceDate:"2026-10-10",invoiceTotalQuantity:4,reference:"Integration receipt"});
        const inLine=await inward.scan({movementId:inDoc.movementId,barcode:"890000000001",quantity:4});
        assert.equal(inLine.summary.knownUnits,4);
        await assert.rejects(inward.post({movementId:inDoc.movementId,authorizationGrant:"wrong",actor:"CASHIER"}),/Manager grant required/);
        const inPosted=await inward.post({movementId:inDoc.movementId,authorizationGrant:"manager-grant",actor:"MANAGER"});
        assert.equal(inPosted.posted,true);
        assert.equal(Number((await get(db,"SELECT SUM(quantity) AS q FROM inventory_transactions WHERE product_id=1")).q),7,"inward increases availability by 4");
        const inwardLedger=await get(db,"SELECT quantity,transaction_type,reference_type,reference_id,supplier_id,invoice_no FROM inventory_transactions WHERE id=?",[inPosted.lines[0].inventory_transaction_id]);
        assert.deepEqual(inwardLedger,{quantity:4,transaction_type:"INWARD",reference_type:"STOCK_INWARD",reference_id:inDoc.movementNo,supplier_id:1,invoice_no:"INV-INT-1"});
        const concurrentInwards=await Promise.all([inward.createDraft({reference:"concurrent inward one"},"MANAGER"),inward.createDraft({reference:"concurrent inward two"},"MANAGER")]);
        assert.deepEqual(concurrentInwards.map(row=>row.movementNo),["KLINW000002","KLINW000003"],"concurrent inward allocations are serialized and unique");
        await inward.cancelDraft(concurrentInwards[0].movementId,"MANAGER");
        const afterCancel=await inward.createDraft({reference:"after cancellation"},"MANAGER");
        assert.equal(afterCancel.movementNo,"KLINW000004","cancelled inward document number is never reused");
        assert.equal((await inward.listRecentHistory({page:1,keyword:concurrentInwards[0].movementNo})).rows[0].movement_no,concurrentInwards[0].movementNo,"cancelled inward identity remains historical");

        const outDoc=await outward.createDraft({});
        await outward.updateContext({movementId:outDoc.movementId,businessDate:"2026-10-10",reason:"DAMAGE"});
        const outLine=await outward.scan({movementId:outDoc.movementId,barcode:"890000000001",quantity:5});
        const outPosted=await outward.post({movementId:outDoc.movementId,actor:"MANAGER"});
        assert.equal(outPosted.document.status,"COMPLETE");
        assert.equal(Number((await get(db,"SELECT SUM(quantity) AS q FROM inventory_transactions WHERE product_id=1")).q),2,"outward decreases availability by 5");
        const outwardLedger=await get(db,"SELECT quantity,transaction_type,reference_type,reference_id FROM inventory_transactions WHERE id=?",[outPosted.lines[0].inventory_transaction_id]);
        assert.deepEqual(outwardLedger,{quantity:-5,transaction_type:"DAMAGE",reference_type:"STOCK_OUTWARD",reference_id:outDoc.movementNo});

        const denied=await outward.createDraft({});
        await outward.updateContext({movementId:denied.movementId,businessDate:"2026-10-10",reason:"DAMAGE"});
        await assert.rejects(outward.scan({movementId:denied.movementId,barcode:"890000000002",quantity:1}),error=>error.code==="STOCK_OUTWARD_ZERO_STOCK");
        const overDoc=await outward.createDraft({});
        await outward.updateContext({movementId:overDoc.movementId,businessDate:"2026-10-10",reason:"DAMAGE"});
        const overLine=await outward.scan({movementId:overDoc.movementId,barcode:"890000000001",quantity:1});
        const beforeOver=Number((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions")).n);
        await assert.rejects(outward.editLine({movementId:overDoc.movementId,lineId:overLine.addedLineId,quantity:3}),/Only 2 units available/i);
        assert.equal(Number((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions")).n),beforeOver,"zero-stock scan and over-available edit do not mutate inventory");
        await assert.rejects(outward.post({movementId:outDoc.movementId,actor:"MANAGER"}),/already posted|cannot be posted/i);
        await assert.rejects(outward.deleteDocument({movementId:outDoc.movementId,authorization:createStockOutwardDeletionAuthorization(),actor:"MANAGER"}),error=>error.code==="STOCK_OUTWARD_DELETE_NOT_ALLOWED");

        const byRef=await all(db,"SELECT action,entity_type,reference_no,status FROM activities WHERE reference_no IN (?,?) ORDER BY id",[inDoc.movementNo,outDoc.movementNo]);
        assert.deepEqual(byRef.map(x=>x.reference_no).sort(),[inDoc.movementNo,outDoc.movementNo].sort(),"both completed movements have Activity Log references");
        assert(byRef.every(row=>row.status==="SUCCESS"&&row.entity_type),"Activity Log entries retain success and entity identity");
        const historyIn=await inward.listRecentHistory({page:1,keyword:inDoc.movementNo});
        const historyOut=await outward.listHistory({page:1,keyword:outDoc.movementNo});
        assert.equal(historyIn.rows[0].movement_no,inDoc.movementNo);
        assert.equal(historyOut.rows[0].movement_no,outDoc.movementNo);
        assert.equal((await inward.load(inDoc.movementId)).document.status,"COMPLETE");
        assert.equal((await outward.load(outDoc.movementId)).document.status,"COMPLETE");
        assert.equal(Number((await get(db,"SELECT schema_version FROM klbs_schema_metadata WHERE id=1")).schema_version),16,"fixture remains at V16");
        assert.equal((await get(db,"PRAGMA integrity_check")).integrity_check,"ok");
        assert.equal((await get(db,"SELECT COUNT(*) AS n FROM inventory_transactions WHERE product_id=1 AND (quantity IS NULL OR quantity=0)")).n,0);
        console.log("PASS isolated V16 inventory integration: opening → inward → outward; stock deltas, failed operations, document links, Activity Log, manager grant, history, completed-document protection, and SQLite integrity");
    }finally{await new Promise(resolve=>db.close(()=>resolve()));}
}

main().catch(error=>{console.error(error);process.exitCode=1;});
