const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const POSData = require('./store.js');

function loadViews() {
  const context = { window: {}, POSData, Intl, Date, Number, Map, Math };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'views.js'), 'utf8'), context);
  return context.window.POSViews;
}
function fixture() {
  const storage = { data: new Map(), getItem(key) { return this.data.get(key) ?? null; }, setItem(key, value) { this.data.set(key, value); } };
  const store = POSData.createStore({ storage });
  const supplier = store.saveSupplier({ code: 'FRESH', name: 'ส่งของสด', contact: 'โทร 000' }, 'owner');
  const po = store.savePurchaseOrder({ key: 'draft', userId: 'owner', supplierId: supplier.id,
    lines: [{ productId: 'water', quantity: 10, agreedUnitCost: 1200 }] });
  store.issuePurchaseOrder({ key: 'issue', userId: 'owner', poId: po.id });
  const receipt = store.receivePurchaseOrder({ key: 'receipt', userId: 'owner', poId: po.id, deliveryRef: 'DN-A',
    lines: [{ poLineId: po.lines[0].id, acceptedQty: 6, rejectedQty: 1, actualUnitCost: 1200 }] }).receipt;
  return { store, supplier, po, receipt };
}

test('purchasing page exposes supplier, PO, receipt and current outstanding balance', () => {
  const { store, po } = fixture();
  const V = loadViews();
  const state = store.getState();
  const html = V.pages.purchasing({ state, store, user: state.users[0], purchasingQuery: '', purchasingSupplier: '' });
  assert.match(html, /จัดซื้อและรับสินค้า/);
  assert.match(html, /ส่งของสด/);
  assert.match(html, new RegExp(store.getPurchaseOrder(po.id).poNo));
  assert.match(html, /ค้างรับ/);
  assert.match(html, /4 ชิ้น/);
  assert.match(html, /DN-A/);
  assert.match(html, /data-action="purchase-open"/);
});

test('purchase order and goods receipt print views retain their source and actual quantities', () => {
  const { store, po, receipt } = fixture();
  const V = loadViews();
  const state = store.getState();
  const detail = store.getPurchaseOrder(po.id);
  assert.match(V.purchaseOrderDocument(detail, state), /10/);
  const printed = V.goodsReceiptDocument(receipt, detail, state);
  assert.match(printed, /DN-A/);
  assert.match(printed, /ส่งของสด/);
  assert.match(printed, /6/);
  assert.match(printed, /1/);
});

test('purchasing report filters accepted value by Bangkok receipt day and shows current outstanding', () => {
  const { store, supplier, receipt } = fixture();
  const V = loadViews();
  const state = store.getState();
  const today = V.dayKey(receipt.receivedAt);
  const html = V.pages.purchasing({ state, store, user: state.users[0], purchasingQuery: '',
    purchasingSupplier: supplier.id, purchasingProduct: 'water', purchasingDate: today });
  const report = html.split('id="purchase-report"')[1];
  assert.ok(report);
  assert.match(report, /ค้างรับปัจจุบัน/);
  assert.match(report, /4 ชิ้น/);
  assert.match(report, /DN-A/);
  assert.match(report, /฿72\.00/);
  const otherDay = V.pages.purchasing({ state, store, user: state.users[0], purchasingQuery: '',
    purchasingSupplier: supplier.id, purchasingProduct: 'water', purchasingDate: '2000-01-01' }).split('id="purchase-report"')[1];
  assert.doesNotMatch(otherDay, /DN-A/);
});
