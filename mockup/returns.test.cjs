const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('./store.js');

function memory() {
  const data = new Map();
  return { data, fail: false, getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { if (this.fail) throw new Error('disk full'); data.set(key, value); } };
}
function fixture() {
  const storage = memory();
  const store = createStore({ storage });
  const product = store.saveProduct({name:'Test',sku:'RETURN-TEST',barcode:'999',price:3500,stock:10,category:'ของใช้'},'owner');
  const sale = store.checkout({key:'sale',userId:'owner',items:[{productId:product.id,quantity:2,unitPrice:3500}],tendered:10000}).sale;
  const line = sale.items[0];
  const refund = (key, quantity, restockQuantity, damagedQuantity, extra={}) => store.createReturn({key,userId:'owner',saleId:sale.id,
    lines:[{saleLineId:line.id,quantity,restockQuantity,damagedQuantity}],reason:'ลูกค้าคืนสินค้า',cashPaidConfirmed:true,...extra});
  return {storage,store,product,sale,line,refund};
}
const code = (fn, expected) => assert.throws(fn, e => e.code === expected);
const stock = (store,id) => store.getState().products.find(p=>p.id===id).stock;

test('v1 localStorage migrates sales without losing transactions and rolls back if save fails', () => {
  const storage = memory();
  const old = createStore({storage});
  old.closeShift({key:'v1-close',userId:'owner',counted:0});
  const v1 = old.getState();
  v1.version=1; v1.sales.forEach(s=>s.items.forEach(line=>delete line.id));
  delete v1.shifts[0].summary.refunds; delete v1.shifts[0].summary.returnCount;
  delete v1.returns; delete v1.cashRefunds; delete v1.pendingReturn;
  storage.setItem('old',JSON.stringify(v1));
  storage.fail=true;
  code(()=>createStore({storage,key:'old'}),'STORAGE_FAILED');
  assert.equal(JSON.parse(storage.getItem('old')).version,1);
  storage.fail=false;
  const migrated=createStore({storage,key:'old'}).getState();
  assert.equal(migrated.version,3);
  assert.equal(migrated.sales.length,v1.sales.length);
  assert.equal(migrated.sales[0].id,v1.sales[0].id);
  assert.equal(migrated.shifts[0].summary.expected,v1.shifts[0].summary.expected);
  assert.equal(migrated.shifts[0].summary.refunds,0);
  assert.ok(migrated.sales.every(s=>s.items.every(line=>line.id)));
  assert.deepEqual(migrated.returns,[]);
});

test('partial then full returns use sale price, record one refund per return, and restock only sellable goods', () => {
  const {store,product,sale,refund,line}=fixture();
  store.saveProduct({...product,stock:undefined,price:9900,name:'Renamed'},'owner');
  const first=refund('r1',1,1,0).return;
  assert.equal(first.total,3500);
  assert.equal(first.lines[0].unitPrice,3500);
  assert.equal(first.lines[0].name,'Test');
  assert.equal(store.getReturnable(sale.id).status,'partial');
  assert.equal(store.getReturnable(sale.id).lines[0].remainingQuantity,1);
  assert.equal(stock(store,product.id),9);
  const second=refund('r2',1,0,1).return;
  assert.equal(second.total,3500);
  assert.equal(store.getReturnable(sale.id).status,'full');
  assert.equal(store.getReturnable(sale.id).refunded,7000);
  assert.equal(stock(store,product.id),9);
  const state=store.getState();
  assert.equal(state.sales.find(s=>s.id===sale.id).total,7000);
  assert.equal(state.cashRefunds.length,2);
  assert.equal(state.cashRefunds.reduce((n,r)=>n+r.amount,0),7000);
  assert.equal(state.stockMovements.filter(m=>m.kind==='return_restock'&&m.reference===first.lines[0].id).length,1);
  assert.equal(state.stockMovements.filter(m=>m.kind==='return_restock'&&m.reference===second.lines[0].id).length,0);
  const before=store.getState();
  code(()=>refund('r3',1,1,0),'RETURN_QUANTITY_EXCEEDED');
  assert.deepEqual(store.getState(),before);
  assert.equal(line.id,store.getState().sales.find(s=>s.id===sale.id).items[0].id);
});

test('multi-line return is atomic, including zero-price items and invalid quantities', () => {
  const {store,product}=fixture();
  const free=store.saveProduct({name:'Free',sku:'FREE-RETURN',barcode:'',price:0,stock:5},'owner');
  const sale=store.checkout({key:'mix',userId:'owner',items:[{productId:product.id,quantity:1,unitPrice:3500},{productId:free.id,quantity:2,unitPrice:0}],tendered:3500}).sale;
  const lines=sale.items.map((l,i)=>({saleLineId:l.id,quantity:i?2:1,restockQuantity:i?0:1,damagedQuantity:i?2:0}));
  const before=store.getState();
  code(()=>store.createReturn({key:'bad',userId:'owner',saleId:sale.id,lines:[lines[0],lines[0]],reason:'x',cashPaidConfirmed:true}),'INVALID_RETURN_LINE');
  assert.deepEqual(store.getState(),before);
  const result=store.createReturn({key:'mix-return',userId:'owner',saleId:sale.id,lines,reason:'เปลี่ยนใจ',cashPaidConfirmed:true}).return;
  assert.equal(result.total,3500);
  assert.equal(result.lines.length,2);
  assert.equal(store.getReturnable(sale.id).status,'full');
});

test('return replay survives reload, conflict is rejected and unresolved result recovers once', () => {
  const {store,storage,product,sale,line,refund}=fixture();
  const first=refund('lost',1,1,0,{simulate:'unresolved'});
  assert.equal(first.unresolved,true);
  assert.equal(store.getPendingReturn().key,'lost');
  code(()=>refund('new',1,1,0),'RETURN_UNRESOLVED');
  const reopened=createStore({storage});
  const args={key:'lost',userId:'owner',saleId:sale.id,lines:[{saleLineId:line.id,quantity:1,restockQuantity:1,damagedQuantity:0}],reason:'ลูกค้าคืนสินค้า',cashPaidConfirmed:true};
  assert.equal(reopened.createReturn(args).return.id,first.return.id);
  code(()=>reopened.closeShift({key:'too-soon',userId:'owner',counted:0}),'RETURN_UNRESOLVED');
  code(()=>reopened.setUser('cashier'),'RECOVERY_REQUIRED');
  assert.equal(reopened.recoverReturn().id,first.return.id);
  assert.equal(reopened.getPendingReturn(),null);
  assert.equal(reopened.recoverReturn(),null);
  code(()=>reopened.createReturn({...args,reason:'changed'}),'IDEMPOTENCY_CONFLICT');
  assert.equal(stock(reopened,product.id),9);
  assert.equal(reopened.getState().cashRefunds.length,1);
});

test('void and return exclude each other; role, open shift, reason and cash confirmation are required', () => {
  const {store,sale,line,refund}=fixture();
  const args={key:'return',userId:'owner',saleId:sale.id,lines:[{saleLineId:line.id,quantity:1,restockQuantity:1,damagedQuantity:0}],reason:'x',cashPaidConfirmed:true};
  const before=store.getState();
  code(()=>store.createReturn({...args,userId:'cashier'}),'FORBIDDEN');
  code(()=>store.createReturn({...args,cashPaidConfirmed:false}),'CASH_CONFIRMATION_REQUIRED');
  assert.throws(()=>store.createReturn({...args,reason:' '}));
  assert.deepEqual(store.getState(),before);
  refund('r1',1,1,0);
  code(()=>store.voidSale({key:'void',userId:'owner',saleId:sale.id,reason:'x',cashReturned:true,goodsReturned:true}),'VOID_BLOCKED_BY_RETURN');
  const next=store.checkout({key:'next',userId:'owner',items:[{productId:line.productId,quantity:1,unitPrice:3500}],tendered:3500}).sale;
  store.voidSale({key:'void-next',userId:'owner',saleId:next.id,reason:'x',cashReturned:true,goodsReturned:true});
  code(()=>store.createReturn({...args,key:'void-return',saleId:next.id,lines:[{...args.lines[0],saleLineId:next.items[0].id}]}),'SALE_VOIDED');
  store.closeShift({key:'close',userId:'owner',counted:0});
  code(()=>store.createReturn({...args,key:'closed-return'}),'NO_OPEN_SHIFT');
});

test('refund belongs to current shift and current Bangkok day; old closed snapshot stays fixed', () => {
  const {store,sale,refund}=fixture();
  const old=store.getState().activeShiftId;
  const closed=store.closeShift({key:'close-old',userId:'owner',counted:0});
  const shift=store.openShift({key:'new-shift',userId:'owner',opening:100000});
  const before=store.shiftSummary(old);
  const result=refund('cross-shift',1,0,1).return;
  assert.equal(result.shiftId,shift.id);
  assert.equal(store.shiftSummary(shift.id).refunds,3500);
  assert.equal(store.shiftSummary(shift.id).expected,96500);
  assert.deepEqual(store.shiftSummary(old),before);
  assert.deepEqual(store.shiftSummary(old),closed.summary);
  const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(result.createdAt));
  assert.ok(store.dailySummary(day).refunds>=3500);
  assert.equal(store.getState().cashMovements.filter(m=>m.kind==='out').length,0);
});

test('failed persistence or simulated failure does not commit partial refund', () => {
  const {store,storage,refund}=fixture();
  const before=store.getState();
  code(()=>refund('failed',1,1,0,{simulate:'failure'}),'RETURN_FAILED');
  assert.deepEqual(store.getState(),before);
  storage.fail=true;
  code(()=>refund('disk',1,1,0),'STORAGE_FAILED');
  assert.deepEqual(store.getState(),before);
  storage.fail=false;
  assert.equal(refund('disk',1,1,0).return.total,3500);
});

test('cash reconciliation example is 1515 baht and closed source shift is untouched', () => {
  const {store,sale,line}=fixture();
  const originalShift=store.getState().activeShiftId;
  store.closeShift({key:'close-a',userId:'owner',counted:0});
  store.openShift({key:'open-b',userId:'owner',opening:100000});
  const p500=store.saveProduct({name:'500',sku:'CASH-500',barcode:'',price:50000,stock:2},'owner');
  const p200=store.saveProduct({name:'200',sku:'CASH-200',barcode:'',price:20000,stock:2},'owner');
  store.checkout({key:'sale-500',userId:'owner',items:[{productId:p500.id,quantity:1,unitPrice:50000}],tendered:50000});
  const voided=store.checkout({key:'sale-200',userId:'owner',items:[{productId:p200.id,quantity:1,unitPrice:20000}],tendered:20000}).sale;
  store.voidSale({key:'void-200',userId:'owner',saleId:voided.id,reason:'ยกเลิก',cashReturned:true,goodsReturned:true});
  store.createReturn({key:'refund-35',userId:'owner',saleId:sale.id,lines:[{saleLineId:line.id,quantity:1,restockQuantity:1,damagedQuantity:0}],reason:'คืน',cashPaidConfirmed:true});
  store.addCashMovement({key:'in-100',userId:'owner',kind:'in',amount:10000,reason:'เงินทอน'});
  store.addCashMovement({key:'out-50',userId:'owner',kind:'out',amount:5000,reason:'ค่าใช้จ่าย'});
  const shift=store.getState().activeShiftId;
  const summary=store.shiftSummary(shift);
  assert.deepEqual([summary.gross,summary.voids,summary.refunds,summary.cashIn,summary.cashOut,summary.net,summary.expected],
    [70000,20000,3500,10000,5000,46500,151500]);
  const close=store.closeShift({key:'close-b',userId:'owner',counted:150500});
  assert.equal(close.difference,-1000);
  assert.equal(store.shiftSummary(originalShift).refunds,0);
});
