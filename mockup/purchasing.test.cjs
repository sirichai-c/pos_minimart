const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('./store.js');

function memory() {
  const data = new Map();
  return { fail: false, getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { if (this.fail) throw new Error('disk full'); data.set(key, value); } };
}
function fixture() {
  const storage = memory();
  const store = createStore({ storage });
  const product = store.getState().products.find(p => p.id === 'water');
  const supplier = store.saveSupplier({ code: 'SUP-01', name: 'ร้านส่งน้ำ', contact: '02-123-4567' }, 'owner');
  const draft = store.savePurchaseOrder({ key: 'draft-1', userId: 'owner', supplierId: supplier.id,
    lines: [{ productId: product.id, quantity: 10, agreedUnitCost: 1200 }], note: 'น้ำดื่มรอบเช้า' });
  return { storage, store, product, supplier, draft };
}
function code(fn, expected) { assert.throws(fn, error => error.code === expected); }
function stock(store, productId) { return store.getState().products.find(p => p.id === productId).stock; }

test('v2 demo data migrates to purchasing state without losing sales or returns', () => {
  const storage = memory();
  const original = createStore({ storage, key: 'demo' }).getState();
  const legacy = { ...original, version: 2 };
  delete legacy.suppliers; delete legacy.purchaseOrders; delete legacy.goodsReceipts; delete legacy.pendingGoodsReceipt;
  storage.setItem('demo', JSON.stringify(legacy));
  const upgraded = createStore({ storage, key: 'demo' }).getState();
  assert.equal(upgraded.version, 3);
  assert.equal(upgraded.sales.length, original.sales.length);
  assert.equal(upgraded.stockMovements.length, original.stockMovements.length);
  assert.deepEqual([upgraded.suppliers, upgraded.purchaseOrders, upgraded.goodsReceipts], [[], [], []]);
});

test('supplier codes are unique after normalization and cashier cannot manage suppliers', () => {
  const { store, supplier } = fixture();
  code(() => store.saveSupplier({ code: ' sup-01 ', name: 'ซ้ำ' }, 'owner'), 'DUPLICATE_SUPPLIER_CODE');
  code(() => store.saveSupplier({ code: 'SUP-02', name: 'อื่น' }, 'cashier'), 'FORBIDDEN');
  const inactive = store.saveSupplier({ ...supplier, active: false }, 'owner');
  assert.equal(inactive.active, false);
  assert.equal(store.getState().purchaseOrders[0].supplierId, supplier.id);
});

test('draft can be edited, but issuing snapshots lines without changing stock or cash', () => {
  const { store, product, draft, supplier } = fixture();
  const before = store.getState();
  const edited = store.savePurchaseOrder({ key: 'edit-1', userId: 'owner', id: draft.id, supplierId: supplier.id,
    lines: [{ productId: product.id, quantity: 10, agreedUnitCost: 1200 }], note: 'แก้หมายเหตุ' });
  assert.equal(edited.note, 'แก้หมายเหตุ');
  const issued = store.issuePurchaseOrder({ key: 'issue-1', userId: 'owner', poId: draft.id });
  assert.match(issued.poNo, /^PO1-[a-f0-9]{32}$/);
  assert.equal(issued.status, 'issued');
  assert.equal(issued.lines[0].skuSnapshot, product.sku);
  assert.equal(store.getPurchaseOrder(draft.id).lines[0].outstandingQty, 10);
  assert.equal(stock(store, product.id), product.stock);
  assert.equal(store.getState().cashMovements.length, before.cashMovements.length);
  code(() => store.savePurchaseOrder({ key: 'edit-late', userId: 'owner', id: draft.id, supplierId: supplier.id,
    lines: [{ productId: product.id, quantity: 11, agreedUnitCost: 1200 }] }), 'PO_NOT_DRAFT');
});

test('partial deliveries count only accepted goods, capture actual cost, then complete the PO', () => {
  const { store, product, draft } = fixture();
  store.issuePurchaseOrder({ key: 'issue-1', userId: 'owner', poId: draft.id });
  const lineId = draft.lines[0].id;
  const beforeStock = stock(store, product.id);
  const beforeCash = store.shiftSummary(store.getState().activeShiftId).expected;
  const first = store.receivePurchaseOrder({ key: 'receive-1', userId: 'owner', poId: draft.id, deliveryRef: 'DN-1',
    lines: [{ poLineId: lineId, acceptedQty: 6, rejectedQty: 1, actualUnitCost: 1200 }] }).receipt;
  assert.equal(first.lines[0].acceptedQty, 6);
  assert.equal(first.lines[0].rejectedQty, 1);
  assert.equal(first.acceptedValue, 7200);
  assert.equal(stock(store, product.id), beforeStock + 6);
  assert.equal(store.getPurchaseOrder(draft.id).lines[0].outstandingQty, 4);
  assert.equal(store.getPurchaseOrder(draft.id).status, 'partially_received');
  assert.equal(store.getState().stockMovements.filter(m => m.kind === 'purchase_receipt' && m.reference === first.lines[0].id).length, 1);
  assert.equal(store.shiftSummary(store.getState().activeShiftId).expected, beforeCash);
  const second = store.receivePurchaseOrder({ key: 'receive-2', userId: 'owner', poId: draft.id, deliveryRef: 'DN-2',
    lines: [{ poLineId: lineId, acceptedQty: 4, rejectedQty: 0, actualUnitCost: 1300, varianceReason: 'ต้นทุนปรับใหม่' }] }).receipt;
  assert.equal(second.acceptedValue, 5200);
  assert.equal(store.getPurchaseOrder(draft.id).lines[0].outstandingQty, 0);
  assert.equal(store.getPurchaseOrder(draft.id).status, 'fully_received');
  assert.equal(stock(store, product.id), beforeStock + 10);
  assert.equal(store.getState().products.find(p => p.id === product.id).price, product.price);
});

test('invalid receipt, duplicate delivery reference and price variance all roll back', () => {
  const { store, draft } = fixture();
  store.issuePurchaseOrder({ key: 'issue-1', userId: 'owner', poId: draft.id });
  const line = draft.lines[0];
  const receipt = input => store.receivePurchaseOrder({ key: 'r-' + input.deliveryRef, userId: 'owner', poId: draft.id,
    lines: [{ poLineId: line.id, acceptedQty: 6, rejectedQty: 0, actualUnitCost: 1200 }], ...input });
  const before = store.getState();
  code(() => receipt({ deliveryRef: 'OVER', lines: [{ poLineId: line.id, acceptedQty: 11, rejectedQty: 0, actualUnitCost: 1200 }] }), 'RECEIPT_QUANTITY_EXCEEDED');
  code(() => receipt({ deliveryRef: 'PRICE', lines: [{ poLineId: line.id, acceptedQty: 1, rejectedQty: 0, actualUnitCost: 1300 }] }), 'COST_VARIANCE_REASON_REQUIRED');
  code(() => receipt({ deliveryRef: 'WRONG', lines: [{ poLineId: 'other', acceptedQty: 1, rejectedQty: 0, actualUnitCost: 1200 }] }), 'PRODUCT_NOT_IN_PO');
  code(() => receipt({ deliveryRef: 'CASHIER', userId: 'cashier' }), 'FORBIDDEN');
  assert.deepEqual(store.getState(), before);
  receipt({ deliveryRef: 'DN-1' });
  const after = store.getState();
  code(() => receipt({ key: 'another-request', deliveryRef: 'DN-1' }), 'DUPLICATE_DELIVERY_REF');
  assert.deepEqual(store.getState(), after);
});

test('receipt request replay survives reload and unresolved recovery adds stock once', () => {
  const { storage, store, draft } = fixture();
  store.issuePurchaseOrder({ key: 'issue-1', userId: 'owner', poId: draft.id });
  const args = { key: 'receive-1', userId: 'owner', poId: draft.id, deliveryRef: 'DN-1',
    lines: [{ poLineId: draft.lines[0].id, acceptedQty: 2, rejectedQty: 0, actualUnitCost: 1200 }] };
  const before = stock(store, 'water');
  const result = store.receivePurchaseOrder({ ...args, simulate: 'unresolved' });
  assert.equal(result.unresolved, true);
  const reopened = createStore({ storage });
  assert.deepEqual(reopened.receivePurchaseOrder(args).receipt, result.receipt);
  code(() => reopened.receivePurchaseOrder({ ...args, deliveryRef: 'DN-OTHER' }), 'IDEMPOTENCY_CONFLICT');
  code(() => reopened.receivePurchaseOrder({ ...args, key: 'new', deliveryRef: 'DN-2' }), 'RECEIPT_UNRESOLVED');
  assert.equal(reopened.recoverGoodsReceipt().id, result.receipt.id);
  assert.equal(reopened.getPendingGoodsReceipt(), null);
  assert.equal(stock(reopened, 'water'), before + 2);
});

test('cancel requires no receipts, close-short requires a reason, and neither needs an open shift', () => {
  const { store, draft, supplier, product } = fixture();
  store.closeShift({ key: 'close-shift', userId: 'owner', counted: 0 });
  const cancelled = store.cancelPurchaseOrder({ key: 'cancel-1', userId: 'owner', poId: draft.id, reason: 'สั่งผิด' });
  assert.equal(cancelled.status, 'cancelled');
  const second = store.savePurchaseOrder({ key: 'draft-2', userId: 'owner', supplierId: supplier.id,
    lines: [{ productId: product.id, quantity: 4, agreedUnitCost: 1200 }] });
  store.issuePurchaseOrder({ key: 'issue-2', userId: 'owner', poId: second.id });
  store.receivePurchaseOrder({ key: 'receive-2', userId: 'owner', poId: second.id, deliveryRef: 'DN-2',
    lines: [{ poLineId: second.lines[0].id, acceptedQty: 1, rejectedQty: 0, actualUnitCost: 1200 }] });
  code(() => store.cancelPurchaseOrder({ key: 'cancel-2', userId: 'owner', poId: second.id, reason: 'หยุด' }), 'PO_HAS_RECEIPTS');
  code(() => store.closePurchaseOrder({ key: 'close-1', userId: 'owner', poId: second.id, reason: '' }), 'REQUIRED');
  const closed = store.closePurchaseOrder({ key: 'close-2', userId: 'owner', poId: second.id, reason: 'ไม่ส่งเพิ่ม' });
  assert.equal(closed.status, 'closed_short');
  code(() => store.receivePurchaseOrder({ key: 'receive-3', userId: 'owner', poId: second.id, deliveryRef: 'DN-3',
    lines: [{ poLineId: second.lines[0].id, acceptedQty: 1, rejectedQty: 0, actualUnitCost: 1200 }] }), 'PO_CLOSED');
});

test('storage write failure leaves receipt, movement and balance untouched', () => {
  const { store, storage, draft } = fixture();
  store.issuePurchaseOrder({ key: 'issue-1', userId: 'owner', poId: draft.id });
  const before = store.getState();
  storage.fail = true;
  code(() => store.receivePurchaseOrder({ key: 'failed', userId: 'owner', poId: draft.id, deliveryRef: 'DN-1',
    lines: [{ poLineId: draft.lines[0].id, acceptedQty: 2, rejectedQty: 0, actualUnitCost: 1200 }] }), 'STORAGE_FAILED');
  assert.deepEqual(store.getState(), before);
});

test('rejected-only delivery records evidence but leaves stock and outstanding unchanged', () => {
  const { store, draft, product } = fixture();
  store.issuePurchaseOrder({ key: 'issue-1', userId: 'owner', poId: draft.id });
  const before = store.getState();
  const receipt = store.receivePurchaseOrder({ key: 'reject-only', userId: 'owner', poId: draft.id, deliveryRef: 'DN-REJECT',
    lines: [{ poLineId: draft.lines[0].id, acceptedQty: 0, rejectedQty: 2, actualUnitCost: 1200 }] }).receipt;
  assert.equal(receipt.acceptedValue, 0);
  assert.equal(store.getPurchaseOrder(draft.id).lines[0].outstandingQty, 10);
  assert.equal(store.getPurchaseOrder(draft.id).status, 'issued');
  assert.equal(stock(store, product.id), product.stock);
  assert.equal(store.getState().stockMovements.length, before.stockMovements.length);
  code(() => store.cancelPurchaseOrder({ key: 'cancel', userId: 'owner', poId: draft.id, reason: 'ยกเลิก' }), 'PO_HAS_RECEIPTS');
});
