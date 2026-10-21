const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const POSData=require('./assets/js/store.js');
function fixture(){const data=new Map(),store=POSData.createStore({storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});
 const context={window:{},document:{addEventListener(){}},POSData,Intl,Date,Number,Map,Math};
 for(const file of ['views.js','loyalty-ui.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'assets','js',file),'utf8'),context);
 context.window.POSLoyaltyUI.install({store,render(){},showDialog(){},closeDialog(){},field(){},cancelButton:'',submitButton(){},uuid(){},toast(){},showError(){}});
 return {store,V:context.window.POSViews};}
test('member page escapes names, owner sees history, cashier navigation omits it and receipt hides phone',()=>{
 const {store,V}=fixture(),m=store.saveMember({key:'member-ui',userId:'owner',name:'<script>x</script>',phone:'0812345678',consent:true});
 const sale=store.checkout({key:'sale-ui',userId:'owner',items:[{productId:'water',quantity:1,unitPrice:700}],tendered:700,memberId:m.id}).sale;
 const state=store.getState(),owner={state,store,user:state.users[0]},cashier={state,store,user:state.users[1]};
 const html=V.pages.members(owner);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>x/);
 assert.match(html,/ประวัติแต้ม/);assert.match(V.shell('members',owner),/href="#members"/);
 assert.doesNotMatch(V.shell('members',cashier),/href="#members"/);
 const receipt=V.receipt(sale,state);assert.match(receipt,/แต้มที่ได้/);assert.doesNotMatch(receipt,/0812345678/);
 const index=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
 assert.ok(index.indexOf('src="assets/js/loyalty.js"')<index.indexOf('src="assets/js/store.js"'));
 assert.ok(index.indexOf('src="assets/js/loyalty-ui.js')<index.indexOf('src="assets/js/app.js"'));
});
