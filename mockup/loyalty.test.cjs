const test=require('node:test'),assert=require('node:assert/strict'),{createStore}=require('./store.js');
function fixture(){const data=new Map(),storage={fail:false,getItem:k=>data.get(k)??null,setItem(k,v){if(this.fail)throw Error('full');data.set(k,v);}},store=createStore({storage});return {store,storage};}
let n=0;const a=(x={})=>({key:`lo-${++n}`,userId:'owner',...x});const fail=(fn,c)=>assert.throws(fn,e=>e.code===c);
function member(store,phone='0812345678'){return store.saveMember(a({name:'สมาชิกทดสอบ',phone,consent:true}));}
function earn(store,memberId){return store.checkout(a({items:[{productId:'water',quantity:15,unitPrice:700}],tendered:10500,memberId})).sale;}

test('normalized phone is unique, cashier lookup is minimal and consent is required',()=>{
 const {store}=fixture();fail(()=>store.saveMember(a({name:'ไม่ยินยอม',phone:'0812345678',consent:false})),'CONSENT_REQUIRED');
 const m=member(store);fail(()=>store.saveMember(a({name:'ซ้ำ',phone:'081-234-5678',consent:true})),'DUPLICATE_MEMBER_PHONE');
 const result=store.lookupMember({phone:'081-234-5678',userId:'cashier'});
 assert.equal(result.id,m.id);assert.equal(result.balance,0);assert.equal(result.phone,undefined);
 fail(()=>store.saveMember({...a({name:'ผิดสิทธิ์',phone:'0899999999',consent:true}),userId:'cashier'}),'FORBIDDEN');
});

test('redeem is allocated per unit; partial refunds restore points and reverse earned points cumulatively',()=>{
 const {store}=fixture(),m=member(store);earn(store,m.id);
 const p=store.saveProduct({name:'สองชิ้น',sku:'LO-1',price:3500,stock:2},'owner');
 const sale=store.checkout(a({items:[{productId:p.id,quantity:2,unitPrice:3500}],tendered:6900,memberId:m.id,redeemPoints:100})).sale;
 assert.equal(sale.gross,7000);assert.equal(sale.discount,100);assert.equal(sale.total,6900);assert.equal(sale.pointsEarned,69);
 assert.deepEqual(sale.items[0].unitDiscounts.map(u=>u.discount),[50,50]);
 const r1=store.createReturn(a({saleId:sale.id,lines:[{saleLineId:sale.items[0].id,quantity:1,restockQuantity:1,damagedQuantity:0}],reason:'คืน',cashPaidConfirmed:true})).return;
 assert.equal(r1.total,3450);assert.equal(r1.lines[0].discount,50);assert.equal(r1.pointsRestored,50);assert.equal(r1.pointsReversed,35);
 const r2=store.createReturn(a({saleId:sale.id,lines:[{saleLineId:sale.items[0].id,quantity:1,restockQuantity:1,damagedQuantity:0}],reason:'คืนอีก',cashPaidConfirmed:true})).return;
 assert.equal(r2.total,3450);assert.equal(r2.pointsRestored,50);assert.equal(r2.pointsReversed,34);
 assert.deepEqual(store.getState().sales.find(s=>s.id===sale.id).items[0].unitDiscounts.map(u=>u.returnedBy!==null),[true,true]);
 assert.equal(store.pointsBalance(m.id),105);
});

test('void restores redeemed points and removes earned points; cash and profit use net revenue',()=>{
 const {store}=fixture(),m=member(store);earn(store,m.id);
 const p=store.saveProduct({name:'กำไร',sku:'LO-2',price:3500,stock:0},'owner');
 store.adjustStock(a({productId:p.id,kind:'receive',quantity:2,unitCost:1500,reason:'รับเข้า'}));
 const sale=store.checkout(a({items:[{productId:p.id,quantity:2,unitPrice:3500}],tendered:6900,memberId:m.id,redeemPoints:100})).sale;
 let row=store.grossProfitReport({userId:'owner',groupBy:'product'}).rows.find(r=>r.key===p.id);
 assert.equal(row.revenue,6900);assert.equal(row.cogs,3000);assert.equal(row.profit,3900);
 assert.equal(store.shiftSummary(sale.shiftId).gross>=6900,true);
 store.voidSale(a({saleId:sale.id,reason:'ผิด',cashReturned:true,goodsReturned:true}));
 row=store.grossProfitReport({userId:'owner',groupBy:'product'}).rows.find(r=>r.key===p.id);
 assert.equal(row.revenue,0);assert.equal(store.pointsBalance(m.id),105);
});

test('order earns points only at pickup and failed payment rolls back loyalty ledger',()=>{
 const {store,storage}=fixture(),m=member(store),order=store.saveOrder(a({contactName:'ลูกค้า',contactPhone:'0811111111',channel:'phone',lines:[{productId:'water',quantity:2}]}));
 store.confirmOrder(a({orderId:order.id}));assert.equal(store.pointsBalance(m.id),0);
 const before=store.getState();storage.fail=true;
 fail(()=>store.checkoutOrder(a({orderId:order.id,tendered:1400,memberId:m.id})),'STORAGE_FAILED');assert.deepEqual(store.getState(),before);
 storage.fail=false;const sale=store.checkoutOrder(a({orderId:order.id,tendered:1400,memberId:m.id})).sale;
 assert.equal(sale.pointsEarned,14);assert.equal(store.pointsBalance(m.id),14);
});

test('refund can make point balance negative after earlier earnings were redeemed elsewhere',()=>{
 const {store}=fixture(),m=member(store),first=earn(store,m.id);
 const second=store.checkout(a({items:[{productId:'milk',quantity:1,unitPrice:1500}],tendered:1400,memberId:m.id,redeemPoints:100})).sale;
 assert.equal(second.pointsEarned,14);assert.equal(store.pointsBalance(m.id),19);
 const returned=store.createReturn(a({saleId:first.id,lines:[{saleLineId:first.items[0].id,quantity:15,restockQuantity:15,damagedQuantity:0}],reason:'คืน',cashPaidConfirmed:true})).return;
 assert.equal(returned.total,10500);assert.equal(store.pointsBalance(m.id),-86);
 fail(()=>store.checkout(a({items:[{productId:'milk',quantity:1,unitPrice:1500}],tendered:1499,memberId:m.id,redeemPoints:1})),'INSUFFICIENT_POINTS');
});

test('line discounts use deterministic integer largest remainder and returns choose lowest unit ordinals',()=>{
 const {store}=fixture(),m=member(store);earn(store,m.id);
 const p=store.saveProduct({name:'เล็ก',sku:'LO-3',price:101,stock:3},'owner');
 const sale=store.checkout(a({items:[{productId:p.id,quantity:3,unitPrice:101}],tendered:301,memberId:m.id,redeemPoints:2})).sale;
 assert.deepEqual(sale.items[0].unitDiscounts.map(u=>u.discount),[1,1,0]);
 const r=store.createReturn(a({saleId:sale.id,lines:[{saleLineId:sale.items[0].id,quantity:1,restockQuantity:1,damagedQuantity:0}],reason:'คืน',cashPaidConfirmed:true})).return;
 assert.deepEqual(r.lines[0].unitOrdinals,[1]);assert.equal(r.total,100);assert.equal(r.pointsRestored,1);
});

test('version 6 migration adds zero discounts without awarding old sales retroactively',()=>{
 const {store,storage}=fixture(),old=store.getState();old.version=6;delete old.members;delete old.loyaltyEntries;
 old.sales.forEach(s=>{delete s.gross;delete s.discount;delete s.cashDue;delete s.memberId;delete s.redeemPoints;delete s.pointsEarned;s.items.forEach(l=>{delete l.discount;delete l.netTotal;delete l.unitDiscounts;});});
 storage.setItem('baan-ran-pos-demo-v1',JSON.stringify(old));const after=createStore({storage}).getState();
 assert.equal(after.version,7);assert.deepEqual(after.loyaltyEntries,[]);
 assert.equal(after.sales[0].gross,after.sales[0].total);assert.equal(after.sales[0].items[0].netTotal,after.sales[0].items[0].total);
});

test('member checkout and refund replay never post points twice',()=>{
 const {store,storage}=fixture(),m=member(store),saleArgs=a({items:[{productId:'water',quantity:2,unitPrice:700}],tendered:1400,memberId:m.id});
 const sale=store.checkout(saleArgs).sale,afterSale=store.getState().loyaltyEntries.length;
 assert.equal(createStore({storage}).checkout(saleArgs).sale.id,sale.id);
 assert.equal(store.getState().loyaltyEntries.length,afterSale);
 const returnArgs=a({saleId:sale.id,lines:[{saleLineId:sale.items[0].id,quantity:1,restockQuantity:1,damagedQuantity:0}],reason:'คืน',cashPaidConfirmed:true});
 const first=store.createReturn(returnArgs).return,afterReturn=store.getState().loyaltyEntries.length;
 assert.equal(createStore({storage}).createReturn(returnArgs).return.id,first.id);
 assert.equal(store.getState().loyaltyEntries.length,afterReturn);
});
