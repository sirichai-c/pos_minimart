const test=require('node:test'),assert=require('node:assert/strict');
const {createStore}=require('./store.js');
function fixture(){const data=new Map(),storage={fail:false,getItem:k=>data.get(k)??null,setItem(k,v){if(this.fail)throw Error('full');data.set(k,v);}},store=createStore({storage});return {store,storage};}
let n=0;const a=(x={})=>({key:`ord-${++n}`,userId:'owner',...x});
const fail=(fn,c)=>assert.throws(fn,e=>e.code===c);
function draft(store,quantity=4){return store.saveOrder(a({contactName:'ลูกค้าทดสอบ',contactPhone:'0812345678',channel:'phone',lines:[{productId:'water',quantity}]}));}

test('reserve uses available stock, keeps cash and on-hand unchanged, then one pickup sale at snapshotted price',()=>{
 const {store}=fixture();const start=store.getState(),before=start.products.find(p=>p.id==='water').stock;
 const order=draft(store);assert.equal(store.availableToSell('water'),before);
 const confirmed=store.confirmOrder(a({orderId:order.id}));assert.equal(confirmed.status,'reserved');
 assert.equal(store.availableToSell('water'),before-4);
 assert.equal(store.getState().products.find(p=>p.id==='water').stock,before);
 assert.equal(store.getState().sales.length,start.sales.length);
 store.saveProduct({...store.getState().products.find(p=>p.id==='water'),price:900},'owner');
 const req=a({orderId:order.id,tendered:2800});const sale=store.checkoutOrder(req).sale;
 assert.equal(sale.total,2800);assert.equal(sale.items[0].unitPrice,700);assert.equal(sale.orderId,order.id);
 assert.equal(store.getOrder(order.id).status,'completed');assert.equal(store.availableToSell('water'),before-4);
 assert.equal(store.checkoutOrder(req).sale.id,sale.id);
 fail(()=>store.checkoutOrder(a({orderId:order.id,tendered:2800})),'ORDER_ALREADY_COMPLETED');
});

test('normal checkout and count adjustment cannot consume active reservations; cancellation releases without movement',()=>{
 const {store}=fixture(),before=store.getState().products.find(p=>p.id==='water').stock;
 const order=draft(store,before);store.confirmOrder(a({orderId:order.id}));
 fail(()=>store.checkout({key:'normal-'+n,userId:'owner',items:[{productId:'water',quantity:1,unitPrice:700}],tendered:700}),'INSUFFICIENT_AVAILABLE_STOCK');
 fail(()=>store.adjustStock(a({productId:'water',kind:'count',quantity:before-1,reason:'นับ'})),'RESERVED_STOCK_CONFLICT');
 const movements=store.getState().stockMovements.length;
 store.cancelOrder(a({orderId:order.id,reason:'ลูกค้ายกเลิก'}));
 assert.equal(store.availableToSell('water'),before);assert.equal(store.getState().stockMovements.length,movements);
});

test('expiry is excluded from available without timer and inactive products block pickup',()=>{
 const {store,storage}=fixture(),order=draft(store);
 const confirmed=store.confirmOrder(a({orderId:order.id}));
 const data=store.getState(),record=data.orders.find(o=>o.id===order.id);record.expiresAt='2020-01-01T00:00:00.000Z';
 storage.setItem('baan-ran-pos-demo-v1',JSON.stringify(data));const reopened=createStore({storage});
 assert.equal(reopened.availableToSell('water'),data.products.find(p=>p.id==='water').stock);
 fail(()=>reopened.checkoutOrder(a({orderId:order.id,tendered:2800})),'ORDER_EXPIRED');
 const expired=reopened.expireOrder(a({orderId:order.id}));assert.equal(expired.status,'expired');
 const second=draft(reopened);reopened.confirmOrder(a({orderId:second.id}));
 reopened.saveProduct({...reopened.getState().products.find(p=>p.id==='water'),active:false},'owner');
 fail(()=>reopened.checkoutOrder(a({orderId:second.id,tendered:2800})),'PRODUCT_INACTIVE');
 assert.equal(confirmed.expiresAt>confirmed.confirmedAt,true);
});

test('failed order pickup rolls back sale, cost, reservation and request',()=>{
 const {store,storage}=fixture(),order=draft(store);store.confirmOrder(a({orderId:order.id}));const before=store.getState();
 storage.fail=true;fail(()=>store.checkoutOrder(a({orderId:order.id,tendered:2800})),'STORAGE_FAILED');
 assert.deepEqual(store.getState(),before);
});

test('stock count approval below reserved quantity is rejected atomically; void does not restore a reservation',()=>{
 const {store}=fixture(),before=store.getState().products.find(p=>p.id==='water').stock;
 const o=draft(store,before);store.confirmOrder(a({orderId:o.id}));
 const c=store.createStockCount(a({name:'นับน้ำ',productIds:['water']}));
 store.recordStockCount(a({countId:c.id,productId:'water',countedQty:before-1,varianceReason:'นับจริง'}));
 store.submitStockCount(a({countId:c.id}));const previous=store.getState();
 fail(()=>store.approveStockCount(a({countId:c.id})),'RESERVED_STOCK_CONFLICT');assert.deepEqual(store.getState(),previous);
 const sale=store.checkoutOrder(a({orderId:o.id,tendered:before*700})).sale;
 store.voidSale(a({saleId:sale.id,reason:'ยกเลิก',cashReturned:true,goodsReturned:true}));
 assert.equal(store.getOrder(o.id).status,'completed');assert.equal(store.availableToSell('water'),before);
 assert.equal(store.getState().reservations.filter(r=>r.orderId===o.id&&!r.releasedAt).length,0);
});

test('version 5 data upgrades orders without changing historical sales or cost layers',()=>{
 const {store,storage}=fixture(),old=store.getState();old.version=5;delete old.orders;delete old.reservations;
 storage.setItem('baan-ran-pos-demo-v1',JSON.stringify(old));const next=createStore({storage}).getState();
 assert.equal(next.version,7);assert.deepEqual(next.orders,[]);assert.deepEqual(next.reservations,[]);
 assert.deepEqual(next.sales,old.sales);assert.deepEqual(next.costLayers,old.costLayers);
});
