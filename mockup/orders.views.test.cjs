const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const POSData=require('./assets/js/store.js');
function fixture(){const data=new Map(),store=POSData.createStore({storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});
 const context={window:{},document:{addEventListener(){}},POSData,Intl,Date,Number,Map,Math};
 for(const file of ['views.js','orders-ui.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'assets','js',file),'utf8'),context);
 context.window.POSOrdersUI.install({store,render(){},showDialog(){},closeDialog(){},field(){},cancelButton:'',submitButton(){},uuid(){},toast(){},showError(){}});
 return {store,V:context.window.POSViews};}
test('orders page shows reservation before pickup, escapes contact and keeps uncollected value out of sales',()=>{
 const {store,V}=fixture();const o=store.saveOrder({key:'draft-ui',userId:'owner',contactName:'<script>x</script>',contactPhone:'0812345678',channel:'chat',lines:[{productId:'water',quantity:2}]});
 store.confirmOrder({key:'confirm-ui',userId:'owner',orderId:o.id});const state=store.getState();
 const html=V.pages.orders({state,user:state.users[0]});
 assert.match(html,/จองแล้ว/);assert.match(html,/ยังไม่ใช่ยอดขาย/);
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>x/);
 assert.match(V.shell('orders',{state,user:state.users[0],store}),/href="#orders"/);
 const index=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
 assert.ok(index.indexOf('src="assets/js/orders.js"')<index.indexOf('src="assets/js/store.js"'));
 assert.ok(index.indexOf('src="assets/js/orders-ui.js"')<index.indexOf('src="assets/js/app.js"'));
});
