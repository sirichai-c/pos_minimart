const test = require('node:test');
const assert = require('node:assert/strict');
const {createStore} = require('./store.js');
function fixture(){const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},store=createStore({storage});return {store,storage};}
let n=0; const key=()=>`gp-${++n}`;
const fail=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('FIFO sale captures actual unit costs, preserves unknown opening stock and reports coverage',()=>{
  const {store}=fixture();
  const p=store.saveProduct({name:'ทดสอบต้นทุน',sku:'GP-1',price:4000,stock:0},'owner');
  store.adjustStock({key:key(),userId:'owner',productId:p.id,kind:'receive',quantity:2,unitCost:2000,reason:'รับเข้า'});
  store.adjustStock({key:key(),userId:'owner',productId:p.id,kind:'receive',quantity:3,unitCost:2500,reason:'รับเข้า'});
  const sale=store.checkout({key:key(),userId:'owner',items:[{productId:p.id,quantity:4,unitPrice:4000}],tendered:16000}).sale;
  assert.deepEqual(sale.items[0].costAllocations.map(a=>[a.quantity,a.unitCost]),[[2,2000],[2,2500]]);
  const report=store.grossProfitReport({userId:'owner',groupBy:'product'});
  const row=report.rows.find(r=>r.key===p.id);
  assert.equal(row.revenue,16000);assert.equal(row.cogs,9000);assert.equal(row.profit,7000);
  assert.equal(store.getState().costLayers.filter(l=>l.productId===p.id&&l.remaining>0)[0].remaining,1);
  fail(()=>store.grossProfitReport({userId:'cashier'}),'FORBIDDEN');
});

test('return reverses cost at refund date and damaged units become writeoff',()=>{
  const {store}=fixture();const p=store.saveProduct({name:'ทดสอบคืน',sku:'GP-2',price:4000,stock:0},'owner');
  store.adjustStock({key:key(),userId:'owner',productId:p.id,kind:'receive',quantity:2,unitCost:2000,reason:'รับเข้า'});
  store.adjustStock({key:key(),userId:'owner',productId:p.id,kind:'receive',quantity:3,unitCost:2500,reason:'รับเข้า'});
  const sale=store.checkout({key:key(),userId:'owner',items:[{productId:p.id,quantity:4,unitPrice:4000}],tendered:16000}).sale;
  const ret=store.createReturn({key:key(),userId:'owner',saleId:sale.id,lines:[{saleLineId:sale.items[0].id,quantity:1,restockQuantity:0,damagedQuantity:1}],reason:'เสียหาย',cashPaidConfirmed:true}).return;
  assert.equal(ret.lines[0].costAllocations[0].unitCost,2500);
  const row=store.grossProfitReport({userId:'owner',groupBy:'product'}).rows.find(r=>r.key===p.id);
  assert.equal(row.revenue,12000);assert.equal(row.cogs,6500);assert.equal(row.profit,5500);
  assert.equal(store.getState().costWriteoffs.at(-1).amount,2500);
});

test('legacy stock stays unknown and failed persistence rolls back allocation',()=>{
  const data=new Map(),storage={fail:false,getItem:k=>data.get(k)??null,setItem(k,v){if(this.fail)throw Error('full');data.set(k,v);}};
  const store=createStore({storage});const before=store.getState();
  const sale=store.checkout({key:key(),userId:'owner',items:[{productId:'water',quantity:1,unitPrice:700}],tendered:700}).sale;
  assert.equal(sale.items[0].costAllocations[0].unitCost,null);
  assert.equal(store.grossProfitReport({userId:'owner',groupBy:'product'}).rows.find(r=>r.key==='water').profit,null);
  storage.fail=true;const current=store.getState();
  fail(()=>store.checkout({key:key(),userId:'owner',items:[{productId:'water',quantity:1,unitPrice:700}],tendered:700}),'STORAGE_FAILED');
  assert.deepEqual(store.getState(),current);
  assert.equal(before.version,7);
});

test('void restores original cost layers and cancels revenue and COGS',()=>{
  const {store}=fixture();const p=store.saveProduct({name:'คืนทั้งบิล',sku:'GP-3',price:3000,stock:0},'owner');
  store.adjustStock({key:key(),userId:'owner',productId:p.id,kind:'receive',quantity:2,unitCost:1200,reason:'รับเข้า'});
  const sale=store.checkout({key:key(),userId:'owner',items:[{productId:p.id,quantity:1,unitPrice:3000}],tendered:3000}).sale;
  store.voidSale({key:key(),userId:'owner',saleId:sale.id,reason:'ยกเลิก',cashReturned:true,goodsReturned:true});
  const row=store.grossProfitReport({userId:'owner',groupBy:'product'}).rows.find(r=>r.key===p.id);
  assert.equal(row.revenue,0);assert.equal(row.cogs,0);assert.equal(row.profit,0);
  assert.equal(store.getState().costLayers.filter(l=>l.productId===p.id).reduce((n,l)=>n+l.remaining,0),2);
});

test('version 4 activation is atomic and does not infer costs for old transactions',()=>{
  const {store,storage}=fixture();const legacy=store.getState();legacy.version=4;delete legacy.costLayers;delete legacy.costWriteoffs;delete legacy.costActivatedAt;
  storage.setItem('baan-ran-pos-demo-v1',JSON.stringify(legacy));
  const upgraded=createStore({storage});const after=upgraded.getState();
  assert.equal(after.version,7);assert.equal(after.costLayers.reduce((n,l)=>n+l.remaining,0),after.products.reduce((n,p)=>n+p.stock,0));
  assert.equal(upgraded.grossProfitReport({userId:'owner'}).rows.length,0);
});
