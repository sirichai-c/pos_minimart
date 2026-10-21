const test = require('node:test');
const assert = require('node:assert/strict');
const {createStore} = require('./store.js');
function memory(){ const data=new Map();return {fail:false,getItem:k=>data.get(k)??null,setItem(k,v){if(this.fail)throw Error('disk full');data.set(k,v);}}; }
function fixture(){const storage=memory(),store=createStore({storage,key:'test'});return {store,storage};}
const stock=(s,id='water')=>s.getState().products.find(p=>p.id===id);
const code=(fn,c)=>assert.throws(fn,e=>e.code===c);
let n=0;
const args=(extra={})=>({key:'sc-'+(++n),userId:'owner',...extra});
function start(store,ids=['water']){return store.createStockCount(args({name:'ชั้นเครื่องดื่ม',productIds:ids}));}
function record(store,c,productId,qty,reason='ตรวจนับจริง'){return store.recordStockCount(args({countId:c.id,productId,countedQty:qty,varianceReason:reason}));}
function submit(store,c){return store.submitStockCount(args({countId:c.id}));}
function approve(store,c){return store.approveStockCount(args({countId:c.id}));}

test('count approval changes 10 to 8 exactly once and links immutable movement without changing cash',()=>{
 const {store}=fixture();store.adjustStock(args({productId:'water',kind:'count',quantity:10,reason:'ตั้งต้น'}));
 const before=store.getState(),c=start(store);record(store,c,'water',8);submit(store,c);
 assert.equal(stock(store).stock,10);
 const a=args({countId:c.id}),result=store.approveStockCount(a);
 assert.equal(result.status,'approved');assert.equal(stock(store).stock,8);
 const moves=store.getState().stockMovements.filter(m=>m.kind==='count_adjustment');
 assert.equal(moves.length,1);assert.equal(moves[0].quantity,-2);assert.equal(moves[0].reference,c.lines[0].id);
 assert.equal(moves[0].referenceCountLineId,c.lines[0].id);
 assert.deepEqual(store.approveStockCount(a),result);
 code(()=>approve(store,c),'COUNT_ALREADY_APPROVED');
 code(()=>record(store,c,'water',7),'COUNT_ALREADY_APPROVED');
 code(()=>store.cancelStockCount(args({countId:c.id,reason:'แก้'})),'COUNT_ALREADY_APPROVED');
 assert.deepEqual(store.getState().sales,before.sales);assert.deepEqual(store.getState().cashMovements,before.cashMovements);
 assert.deepEqual(store.getState().shifts,before.shifts);
});
test('uncounted blocks submission, zero counts as entered and equal counts create no movement',()=>{
 const {store}=fixture(),c=start(store,['water','milk']);
 code(()=>submit(store,c),'COUNT_NOT_COMPLETE');
 record(store,c,'water',0);code(()=>submit(store,c),'COUNT_NOT_COMPLETE');
 record(store,c,'milk',stock(store,'milk').stock);submit(store,c);approve(store,c);
 assert.equal(stock(store).stock,0);assert.equal(store.getState().stockMovements.filter(m=>m.kind==='count_adjustment').length,1);
});
test('variance reason and all stock versions are checked before changing any line',()=>{
 const {store}=fixture(),c=start(store,['water','milk']);
 record(store,c,'water',8,'');record(store,c,'milk',6);submit(store,c);
 const before=store.getState();code(()=>approve(store,c),'VARIANCE_REASON_REQUIRED');assert.deepEqual(store.getState(),before);
});
test('movement away and back to same stock is stale; explicit recount keeps history and refreshes snapshot',()=>{
 const {store}=fixture(),c=start(store);record(store,c,'water',8);submit(store,c);
 const initial=stock(store).stock;
 store.adjustStock(args({productId:'water',kind:'receive',quantity:1,reason:'รับ'}));
 store.adjustStock(args({productId:'water',kind:'count',quantity:initial,reason:'คืนยอด'}));
 assert.equal(store.getStockCount(c.id).lines[0].stale,true);
 const before=store.getState();code(()=>approve(store,c),'COUNT_STALE');assert.deepEqual(store.getState(),before);
 store.reopenStockCountLine(args({countId:c.id,productId:'water',reason:'ขายระหว่างนับ'}));
 const reopened=store.getStockCount(c.id);assert.equal(reopened.status,'counting');assert.equal(reopened.lines[0].countedQty,null);
 assert.equal(reopened.lines[0].revisions[0].before.countedQty,8);
 assert.equal(reopened.lines[0].stale,false);record(store,c,'water',initial);submit(store,c);approve(store,c);
});
test('one active count and owner permissions; cashier may record and submit only',()=>{
 const {store}=fixture();code(()=>store.createStockCount(args({userId:'cashier',name:'x'})),'FORBIDDEN');
 const c=start(store);code(()=>start(store),'COUNT_ALREADY_ACTIVE');
 store.recordStockCount(args({userId:'cashier',countId:c.id,productId:'water',countedQty:0,varianceReason:'หมด'}));
 store.submitStockCount(args({userId:'cashier',countId:c.id}));
 code(()=>store.approveStockCount(args({userId:'cashier',countId:c.id})),'FORBIDDEN');
 code(()=>store.cancelStockCount(args({userId:'cashier',countId:c.id,reason:'x'})),'FORBIDDEN');
 code(()=>record(store,c,'water',1),'COUNT_LOCKED');
 store.cancelStockCount(args({countId:c.id,reason:'นับวันถัดไป'}));assert.equal(store.getStockCount(c.id).status,'cancelled');start(store);
});
test('approval storage failure rolls back counts, movements, stock and request key, then retry survives reload',()=>{
 const {store,storage}=fixture(),c=start(store);record(store,c,'water',8);submit(store,c);
 const before=store.getState(),a=args({countId:c.id});storage.fail=true;
 code(()=>store.approveStockCount(a),'STORAGE_FAILED');assert.deepEqual(store.getState(),before);
 storage.fail=false;const result=store.approveStockCount(a);
 assert.deepEqual(createStore({storage,key:'test'}).approveStockCount(a),result);
 assert.equal(store.getState().stockMovements.filter(m=>m.kind==='count_adjustment').length,1);
});
test('request keys replay submit/cancel and conflict with changed payload',()=>{
 const {store}=fixture(),c=start(store);record(store,c,'water',0);
 const a=args({countId:c.id});assert.deepEqual(store.submitStockCount(a),store.submitStockCount(a));
 code(()=>store.submitStockCount({...a,countId:'other'}),'IDEMPOTENCY_CONFLICT');
 const b=args({countId:c.id,reason:'ยกเลิก'});assert.deepEqual(store.cancelStockCount(b),store.cancelStockCount(b));
 code(()=>store.cancelStockCount({...b,reason:'เปลี่ยน'}),'IDEMPOTENCY_CONFLICT');
});
test('invalid quantities, duplicate/empty scope and out-of-scope products are rejected',()=>{
 const {store}=fixture();code(()=>start(store,[]),'EMPTY_COUNT');code(()=>start(store,['water','water']),'DUPLICATE_COUNT_LINE');
 code(()=>start(store,['missing']),'PRODUCT_NOT_FOUND');const c=start(store);
 for(const qty of [-1,1.5,'0',null,Number.MAX_SAFE_INTEGER+1])code(()=>record(store,c,'water',qty),'INVALID_NUMBER');
 code(()=>record(store,c,'milk',0),'PRODUCT_NOT_IN_COUNT');
});
test('all-store scope includes inactive remaining stock; snapshot document is escaped later and preserves names',()=>{
 const {store}=fixture(),p=stock(store);store.saveProduct({...p,active:false},'owner');
 const c=store.createStockCount(args({name:'ทั้งร้าน'}));assert.ok(c.lines.some(l=>l.productId==='water'));
 store.saveProduct({...p,name:'ชื่อใหม่'},'owner');assert.equal(store.getStockCount(c.id).lines.find(l=>l.productId==='water').nameSnapshot,p.name);
});
test('checkout/void, restocked return and purchase receipts advance stock versions',()=>{
 const {store}=fixture(),v=stock(store).stockVersion,p=stock(store);
 const sale=store.checkout(args({items:[{productId:p.id,quantity:1,unitPrice:p.price}],tendered:p.price})).sale;
 assert.equal(stock(store).stockVersion,v+1);
 store.voidSale(args({saleId:sale.id,reason:'ทดสอบ',cashReturned:true,goodsReturned:true}));assert.equal(stock(store).stockVersion,v+2);
 const supplier=store.saveSupplier({code:'s',name:'supplier'},'owner');
 const po=store.savePurchaseOrder(args({supplierId:supplier.id,lines:[{productId:p.id,quantity:1,agreedUnitCost:500}]}));
 store.issuePurchaseOrder(args({poId:po.id}));store.receivePurchaseOrder(args({poId:po.id,deliveryRef:'d',lines:[{poLineId:po.lines[0].id,acceptedQty:1,rejectedQty:0,actualUnitCost:500}]}));
 assert.equal(stock(store).stockVersion,v+3);
 const sale2=store.checkout(args({items:[{productId:p.id,quantity:1,unitPrice:p.price}],tendered:p.price})).sale;
 store.createReturn(args({saleId:sale2.id,reason:'คืน',cashPaidConfirmed:true,lines:[{saleLineId:sale2.items[0].id,quantity:1,restockQuantity:1,damagedQuantity:0}]}));
 assert.equal(stock(store).stockVersion,v+5);
});
test('v3 migration preserves purchasing and legacy docs and initializes versions; failure preserves saved bytes',()=>{
 const {store,storage}=fixture(),legacy=store.getState();legacy.version=3;delete legacy.stockCounts;legacy.products.forEach(p=>delete p.stockVersion);
 storage.setItem('test',JSON.stringify(legacy));storage.fail=true;code(()=>createStore({storage,key:'test'}),'STORAGE_FAILED');
 assert.equal(storage.getItem('test'),JSON.stringify(legacy));storage.fail=false;
 const after=createStore({storage,key:'test'}).getState();assert.equal(after.version,7);assert.deepEqual(after.stockCounts,[]);
 assert.deepEqual(after.sales,legacy.sales);assert.deepEqual(after.purchaseOrders,legacy.purchaseOrders);
 assert.equal(after.products.find(p=>p.id==='water').stockVersion,legacy.stockMovements.filter(m=>m.productId==='water').length);
});
test('future reserved units block count approval atomically',()=>{
 const {store,storage}=fixture();const state=store.getState();state.products.find(p=>p.id==='water').activeReservedQty=5;storage.setItem('test',JSON.stringify(state));
 const s=createStore({storage,key:'test'}),c=start(s);record(s,c,'water',4);submit(s,c);const before=s.getState();
 code(()=>approve(s,c),'RESERVATION_EXCEEDS_STOCK');assert.deepEqual(s.getState(),before);
});

test('reopening one submitted line does not unlock other submitted lines for cashier',()=>{
 const {store}=fixture(),c=start(store,['water','milk']);record(store,c,'water',8);record(store,c,'milk',6);submit(store,c);
 store.reopenStockCountLine(args({countId:c.id,productId:'water',reason:'นับน้ำใหม่'}));
 code(()=>store.recordStockCount(args({userId:'cashier',countId:c.id,productId:'milk',countedQty:0})),'COUNT_LOCKED');
 store.recordStockCount(args({userId:'cashier',countId:c.id,productId:'water',countedQty:8,varianceReason:'ขาด'}));
 submit(store,c);approve(store,c);assert.equal(stock(store,'milk').stock,6);
});
test('recounts preserve intervening movements and closed counts exclude future movements',()=>{
 const {store}=fixture(),c=start(store);record(store,c,'water',8);submit(store,c);
 const move=store.adjustStock(args({productId:'water',kind:'receive',quantity:1,reason:'ของมาระหว่างนับ'}));
 store.reopenStockCountLine(args({countId:c.id,productId:'water',reason:'รับของ'}));
 assert.ok(store.getStockCount(c.id).lines[0].movements.some(m=>m.id===move.id));
 record(store,c,'water',8);submit(store,c);approve(store,c);const closed=store.getStockCount(c.id);
 store.adjustStock(args({productId:'water',kind:'receive',quantity:1,reason:'หลังอนุมัติ'}));
 assert.deepEqual(store.getStockCount(c.id).lines[0].movements,closed.lines[0].movements);
 const c2=start(store);store.cancelStockCount(args({countId:c2.id,reason:'หยุดนับ'}));
 store.adjustStock(args({productId:'water',kind:'receive',quantity:1,reason:'หลังยกเลิก'}));
 assert.deepEqual(store.getStockCount(c2.id).lines[0].movements,[]);
});
