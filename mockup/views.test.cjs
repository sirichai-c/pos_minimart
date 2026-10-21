const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const POSData = require('./assets/js/store.js');

function loadViews() {
  const context = { window: {}, POSData, Intl, Date, Number, Map, Math };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'assets', 'js', 'views.js'), 'utf8'), context);
  return context.window.POSViews;
}

const sale = {
  id: 'bill-1', receiptNo: '20261019-0001',
  createdAt: '2026-10-19T16:30:00.000Z', // 23:30 Bangkok
  voidedAt: '2026-10-19T17:30:00.000Z', // 00:30 next day Bangkok
  shiftId: 'shift-1', userId: 'owner', total: 4900,
  items: [{ productId: 'milk', name: 'นม', quantity: 2, total: 4900 }]
};

test('daily report events put a cross-midnight void on the void date', () => {
  const V = loadViews();
  const state = { sales: [sale] };
  assert.deepEqual(Array.from(V.reportEvents(state, '2026-10-19', ''), e => [e.kind, e.amount]), [['sale', 4900]]);
  assert.deepEqual(Array.from(V.reportEvents(state, '2026-10-20', ''), e => [e.kind, e.amount]), [['void', -4900]]);
  assert.deepEqual(Array.from(V.reportEvents(state, '2026-10-20', 'shift-1'), e => [e.kind, e.amount]), [['void', -4900], ['sale', 4900]]);
});

test('daily report source shows the void and chart covers late hours', () => {
  const V = loadViews();
  const state = { sales: [sale], shifts: [], users: [{ id: 'owner', name: 'เจ้าของ' }] };
  const store = { dailySummary: () => ({ gross: 4900, voids: 0, net: 4900, saleCount: 1 }) };
  const html = V.pages.reports({ state, store, reportDate: '2026-10-19', reportShift: '' });
  assert.match(html, /ยอดขายก่อนหักยกเลิก/);
  assert.match(html, /22:00/);
  assert.match(html, /POS1-019-0001/);
  const voidHtml = V.pages.reports({ state, store, reportDate: '2026-10-20', reportShift: '' });
  assert.match(voidHtml, /ยกเลิกบิล/);
  assert.match(voidHtml, /-฿49\.00/);
});

test('return event belongs to refund day and its document appears in reports', () => {
  const V=loadViews();
  const record={id:'return-1',returnNo:'RT1-RETURN1',saleId:sale.id,shiftId:'shift-2',createdAt:'2026-10-19T17:30:00.000Z',userId:'owner',total:2500,
    lines:[{id:'line-return-1',saleLineId:'line-1',productId:'milk',name:'นม',quantity:1,restockQuantity:1,damagedQuantity:0,unitPrice:2500,total:2500}],reason:'สินค้าเสีย'};
  const state={sales:[sale],returns:[record],shifts:[],users:[{id:'owner',name:'เจ้าของ'}]};
  assert.deepEqual(Array.from(V.reportEvents(state,'2026-10-19',''),e=>e.kind),['sale']);
  assert.deepEqual(Array.from(V.reportEvents(state,'2026-10-20',''),e=>e.kind),['void','return']);
  assert.deepEqual(Array.from(V.reportEvents(state,'2026-10-19','shift-2'),e=>e.kind),['return']);
  const store={dailySummary:()=>({gross:0,voids:4900,refunds:2500,net:-7400,saleCount:0,returnCount:1})};
  const html=V.pages.reports({state,store,reportDate:'2026-10-20',reportShift:''});
  assert.match(html,/RT1-RETURN1/);
  assert.match(html,/ยอดคืนสินค้า/);
  assert.match(html,/−฿25\.00/);
  assert.match(V.returnDocument(record,state),/สินค้าเสีย/);
});

test('bill history shows partial refund and links the original return document', () => {
  const V=loadViews();
  const storage={getItem:()=>null,setItem:()=>{}};
  const store=POSData.createStore({storage});
  const bill=store.getState().sales[0];
  const line=bill.items[0];
  const record=store.createReturn({key:'history-return',userId:'owner',saleId:bill.id,
    lines:[{saleLineId:line.id,quantity:1,restockQuantity:0,damagedQuantity:1}],reason:'เสียหาย',cashPaidConfirmed:true}).return;
  const state=store.getState();
  const html=V.pages.history({state,store,historyDate:V.dayKey(bill.createdAt),historyQuery:'',historyStatus:'all'});
  assert.match(html,/คืนบางส่วน/);
  assert.match(html,new RegExp(record.returnNo));
  assert.match(V.pages.returns({state,store,returnQuery:''}),/เอกสารคืนสินค้า/);
});
