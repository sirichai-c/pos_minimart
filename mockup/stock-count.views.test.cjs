const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const POSData=require('./store.js');
function fixture(){const data=new Map(),store=POSData.createStore({storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});
 const context={window:{},POSData,Intl,Date,Number,Map,Math};
 for(const file of ['views.js','stock-count-ui.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
 return {store,V:context.window.POSViews,UI:context.window.POSStockCountUI};}
const a=(key,x={})=>({key,userId:'owner',...x});
test('count page renders owner create control, cashier navigation, and distinct zero/uncounted values',()=>{
 const {store,V,UI}=fixture();const c=store.createStockCount(a('new',{name:'รอบเช้า',productIds:['water','milk']}));
 store.recordStockCount(a('line',{countId:c.id,productId:'water',countedQty:0,varianceReason:'หมด'}));
 let state=store.getState(),ctx={store,state,user:state.users[0]};
 const page=UI.page(ctx,c.id,'');assert.match(page,/รอบเช้า/);assert.match(page,/ยังไม่ได้นับ/);assert.match(page,/นับแล้ว 1/);
 assert.match(page,/sc-create/);assert.match(page,/sc-submit/);assert.doesNotMatch(page,/฿/);
 ctx.user=state.users[1];assert.doesNotMatch(UI.page(ctx,c.id,''),/sc-create|sc-approve|sc-cancel/);
 assert.match(V.shell('stock-count',ctx),/href="#stock-count"/);
});
test('stale lines show recount and movement evidence; submitted lines hide edit, approved report is immutable and escaped',()=>{
 const {store,UI}=fixture(),c=store.createStockCount(a('new',{name:'<script>x</script>',productIds:['water']}));
 store.recordStockCount(a('l',{countId:c.id,productId:'water',countedQty:8,varianceReason:'<img src=x>'}));
 store.submitStockCount(a('s',{countId:c.id}));
 const ctx=()=>{const state=store.getState();return {state,store,user:state.users[0]};};
 assert.doesNotMatch(UI.page(ctx(),c.id,''),/data-action="sc-record"/);
 store.adjustStock(a('stock',{productId:'water',kind:'receive',quantity:1,reason:'ส่งน้ำเพิ่ม'}));
 let html=UI.page(ctx(),c.id,'');assert.match(html,/ต้องนับใหม่/);assert.match(html,/sc-reopen/);assert.match(html,/ส่งน้ำเพิ่ม/);assert.doesNotMatch(html,/<script>x/);
 store.reopenStockCountLine(a('reopen',{countId:c.id,productId:'water',reason:'นับอีกครั้ง'}));
 store.recordStockCount(a('l2',{countId:c.id,productId:'water',countedQty:8,varianceReason:'<img src=x>'}));
 store.submitStockCount(a('s2',{countId:c.id}));store.approveStockCount(a('ok',{countId:c.id}));
 html=UI.page(ctx(),c.id,'');assert.doesNotMatch(html,/data-action="sc-record"|data-action="sc-approve"|data-action="sc-cancel"/);
 const report=UI.document(store.getStockCount(c.id),store.getState());
 assert.match(report,/จำนวน SKU 1/);assert.match(report,/SKU มีส่วนต่าง 1/);assert.match(report,/ผลต่างสุทธิ/);
 assert.match(report,/&lt;script&gt;/);assert.match(report,/&lt;img/);assert.match(report,/นับอีกครั้ง/);assert.match(report,/movement/);assert.doesNotMatch(report,/฿/);
});

test('reopening one SKU leaves other submitted SKU editors locked in the UI',()=>{
 const {store,UI}=fixture(),c=store.createStockCount(a('new',{name:'นับสองตัว',productIds:['water','milk']}));
 for(const productId of ['water','milk'])store.recordStockCount(a('line-'+productId,{countId:c.id,productId,countedQty:8,varianceReason:'นับ'}));
 store.submitStockCount(a('send',{countId:c.id}));store.reopenStockCountLine(a('reopen',{countId:c.id,productId:'water',reason:'แก้น้ำ'}));
 const state=store.getState(),html=UI.page({store,state,user:state.users[0]},c.id,'');
 assert.equal((html.match(/data-action="sc-record"/g)||[]).length,1);
 assert.match(html,/data-action="sc-reopen"[^>]*data-product="milk"/);
});
test('barcode search matches snapshot and module scripts are loaded in order',()=>{
 const {store,UI}=fixture(),c=store.createStockCount(a('new',{name:'ทั้งหมด'})),state=store.getState();
 const html=UI.page({store,state,user:state.users[0]},c.id,'8851000000028');
 assert.match(html,/WATER-600/);assert.doesNotMatch(html,/MILK-250/);
 const index=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
 assert.ok(index.indexOf('src="stock-count.js"')<index.indexOf('src="store.js"'));
 assert.ok(index.indexOf('src="stock-count-ui.js"')<index.indexOf('src="app.js"'));
});
