const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, money, parseMoney } = require('./store.js');

function memory() {
  const data = new Map();
  return { fail: false, getItem(k) { return data.get(k) ?? null; },
    setItem(k, v) { if (this.fail) throw new Error('QuotaExceededError'); data.set(k, v); } };
}
function fixture() {
  const storage = memory();
  const store = createStore({ storage });
  const product = store.saveProduct({ name: 'สินค้าทดสอบ', sku: 'TEST', barcode: '001234', price: 3500,
    stock: 10, category: 'ของใช้', image: 'soap', active: true }, 'owner');
  const sale = (key = 'sale-1', extra = {}) => store.checkout({ key, userId: 'owner',
    items: [{ productId: product.id, quantity: 2, unitPrice: 3500 }], tendered: 10000, ...extra });
  return { store, storage, product, sale };
}
function stock(store, id) { return store.getState().products.find(p => p.id === id).stock; }
function rejectsCode(fn, code) { assert.throws(fn, error => error.code === code); }

test('money parses exact satang and rejects fractions, signs, unsafe integers and malformed input', () => {
  assert.equal(parseMoney('1,234.50'), 123450);
  assert.equal(parseMoney('0.01'), 1);
  assert.equal(money(123450), '1,234.50');
  assert.equal(money(Number.MAX_SAFE_INTEGER), '90,071,992,547,409.91');
  for (const input of ['-1', '1.001', '1e3', '', 'NaN', '1,00', '9007199254740992', null]) {
    assert.throws(() => parseMoney(input));
  }
});

test('A01 cash sale commits total, change and traceable stock exactly once', () => {
  const { store, product, sale } = fixture();
  const before = store.getState();
  const result = sale().sale;
  assert.equal(result.total, 7000);
  assert.equal(result.change, 3000);
  assert.equal(stock(store, product.id), 8);
  assert.match(result.receiptNo, /^POS1-[a-f0-9]{32}$/);
  assert.equal(store.getState().sales.length, before.sales.length + 1);
  assert.equal(store.getState().stockMovements.filter(m => m.reference === result.id)[0].quantity, -2);
});

test('checkout replay survives reload and price edits; conflicting payload has no effect', () => {
  const { store, storage, product, sale } = fixture();
  const original = sale().sale;
  store.saveProduct({ ...product, stock: undefined, price: 4000 }, 'owner');
  const reopened = createStore({ storage });
  const request = { key: 'sale-1', userId: 'owner', items: [{ productId: product.id, quantity: 2, unitPrice: 3500 }], tendered: 10000 };
  assert.deepEqual(reopened.checkout(request).sale, original);
  const before = reopened.getState();
  rejectsCode(() => reopened.checkout({ ...request, tendered: 20000 }), 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(reopened.getState(), before);
  assert.equal(stock(reopened, product.id), 8);
});

test('unresolved checkout recovers the committed bill after reload without another stock change', () => {
  const { store, storage, product, sale } = fixture();
  const result = sale('lost-response', { simulate: 'unresolved' });
  assert.equal(result.unresolved, true);
  assert.equal(store.getPendingCheckout().key, 'lost-response');
  rejectsCode(() => sale('new-sale'), 'CHECKOUT_UNRESOLVED');
  const reopened = createStore({ storage });
  assert.deepEqual(reopened.recoverCheckout(), result.sale);
  assert.equal(reopened.getPendingCheckout(), null);
  assert.equal(reopened.recoverCheckout(), null);
  assert.equal(stock(reopened, product.id), 8);
});

test('simulated failure leaves no sale, movement, pending request or audit', () => {
  const { store, sale } = fixture();
  const before = store.getState();
  rejectsCode(() => sale('failure', { simulate: 'failure' }), 'CHECKOUT_FAILED');
  assert.deepEqual(store.getState(), before);
});

test('price changes reject stale carts while historical bill prices remain unchanged', () => {
  const { store, product, sale } = fixture();
  const original = sale().sale;
  store.saveProduct({ ...product, stock: undefined, price: 4000 }, 'owner');
  const before = store.getState();
  rejectsCode(() => sale('new-price'), 'PRICE_CHANGED');
  assert.deepEqual(store.getState(), before);
  assert.equal(original.items[0].unitPrice, 3500);
  assert.equal(store.getState().sales.find(s => s.id === original.id).total, 7000);
});

test('all stock/quantity/payment validation rejects the entire cart', () => {
  const { store, product, sale } = fixture();
  const before = store.getState();
  for (const quantity of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => sale('bad-' + quantity, { items: [{ productId: product.id, quantity, unitPrice: 3500 }] }));
  }
  rejectsCode(() => sale('too-many', { items: [{ productId: product.id, quantity: 11, unitPrice: 3500 }] }), 'INSUFFICIENT_STOCK');
  rejectsCode(() => sale('duplicate-lines', { items: [
    { productId: product.id, quantity: 6, unitPrice: 3500 }, { productId: product.id, quantity: 6, unitPrice: 3500 }
  ], tendered: 50000 }), 'INSUFFICIENT_STOCK');
  rejectsCode(() => sale('too-little', { tendered: 100 }), 'INSUFFICIENT_CASH');
  assert.throws(() => sale('empty', { items: [] }));
  assert.deepEqual(store.getState(), before);
});

test('A08 owner void restores cash and stock once even with a new request key', () => {
  const { store, product, sale } = fixture();
  const bill = sale().sale;
  const args = { key: 'void-1', saleId: bill.id, reason: 'หยิบสินค้าผิด', cashReturned: true, goodsReturned: true, userId: 'owner' };
  store.voidSale(args);
  assert.equal(stock(store, product.id), 10);
  const before = store.getState();
  rejectsCode(() => store.voidSale({ ...args, key: 'void-2' }), 'ALREADY_VOIDED');
  assert.deepEqual(store.getState(), before);
  assert.deepEqual(store.voidSale(args), before.sales.find(s => s.id === bill.id));
  assert.equal(store.getState().sales.find(s => s.id === bill.id).total, 7000);
  assert.equal(store.getState().stockMovements.filter(m => m.reference === bill.id && m.kind === 'void').length, 1);
});

test('void requires owner, reason, both confirmations and original open shift', () => {
  const { store, sale } = fixture();
  const bill = sale().sale;
  const args = { key: 'void', saleId: bill.id, reason: 'ผิดรายการ', cashReturned: true, goodsReturned: true, userId: 'owner' };
  rejectsCode(() => store.voidSale({ ...args, userId: 'cashier' }), 'FORBIDDEN');
  for (const bad of [{ reason: ' ' }, { cashReturned: false }, { goodsReturned: false }]) assert.throws(() => store.voidSale({ ...args, ...bad }));
  store.closeShift({ key: 'close', counted: 100000, userId: 'owner' });
  store.openShift({ key: 'open', opening: 0, userId: 'owner' });
  rejectsCode(() => store.voidSale(args), 'WRONG_SHIFT');
});

test('A09 reconciliation saves expected 1550 and shortage 10 baht as immutable close snapshot', () => {
  const { store, product } = fixture();
  store.closeShift({ key: 'seed-close', counted: 0, userId: 'owner' });
  const shift = store.openShift({ key: 'open', opening: 100000, userId: 'cashier' });
  const a = store.checkout({ key: 'a', userId: 'cashier', items: [{ productId: product.id, quantity: 2, unitPrice: 3500 }], tendered: 10000 }).sale;
  store.saveProduct({ ...product, stock: undefined, price: 10000 }, 'owner');
  const b = store.checkout({ key: 'b', userId: 'cashier', items: [{ productId: product.id, quantity: 2, unitPrice: 10000 }], tendered: 20000 }).sale;
  store.saveProduct({ ...product, stock: undefined, price: 43000 }, 'owner');
  store.checkout({ key: 'c', userId: 'cashier', items: [{ productId: product.id, quantity: 1, unitPrice: 43000 }], tendered: 50000 });
  store.voidSale({ key: 'void', saleId: b.id, reason: 'ยกเลิก', cashReturned: true, goodsReturned: true, userId: 'owner' });
  store.addCashMovement({ key: 'in', kind: 'in', amount: 10000, reason: 'เงินทอน', userId: 'owner' });
  store.addCashMovement({ key: 'out', kind: 'out', amount: 5000, reason: 'ซื้อถุง', userId: 'owner' });
  const summary = store.shiftSummary(shift.id);
  assert.equal(summary.gross, 70000);
  assert.equal(summary.voids, 20000);
  assert.equal(summary.net, 50000);
  assert.equal(summary.expected, 155000);
  assert.equal(summary.saleCount, 3);
  const closed = store.closeShift({ key: 'close', counted: 154000, userId: 'cashier' });
  assert.equal(closed.difference, -1000);
  assert.equal(closed.expected, 155000);
  assert.deepEqual(store.closeShift({ key: 'close', counted: 154000, userId: 'cashier' }), closed);
  store.openShift({ key: 'open2', opening: 0, userId: 'owner' });
  assert.equal(store.shiftSummary(shift.id).difference, -1000);
  assert.equal(store.shiftSummary(shift.id).expected, 155000);
  assert.equal(a.total, 7000);
});

test('closed shift blocks sales and cash movements; only one shift opens', () => {
  const { store, sale } = fixture();
  rejectsCode(() => store.openShift({ key: 'open', opening: 0, userId: 'owner' }), 'SHIFT_OPEN');
  store.closeShift({ key: 'close', counted: 0, userId: 'cashier' });
  rejectsCode(() => sale(), 'NO_OPEN_SHIFT');
  rejectsCode(() => store.addCashMovement({ key: 'out', kind: 'out', amount: 100, reason: 'x', userId: 'owner' }), 'NO_OPEN_SHIFT');
});

test('A16 stock and cash movements replay once and reject payload conflicts', () => {
  const { store, product } = fixture();
  const args = { key: 'receive', productId: product.id, kind: 'receive', quantity: 5, reason: 'ส่งสินค้า', userId: 'owner' };
  const movement = store.adjustStock(args);
  assert.deepEqual(store.adjustStock(args), movement);
  assert.equal(stock(store, product.id), 15);
  rejectsCode(() => store.adjustStock({ ...args, quantity: 6 }), 'IDEMPOTENCY_CONFLICT');
  const cash = { key: 'cash', kind: 'in', amount: 10000, reason: 'เงินทอน', userId: 'owner' };
  const entry = store.addCashMovement(cash);
  assert.deepEqual(store.addCashMovement(cash), entry);
  rejectsCode(() => store.addCashMovement({ ...cash, kind: 'out' }), 'IDEMPOTENCY_CONFLICT');
});

test('owner-only product, stock, cash, user and backup operations enforce roles', () => {
  const { store, product } = fixture();
  const before = store.getState();
  const operations = [
    () => store.saveProduct(product, 'cashier'),
    () => store.adjustStock({ key: 'x', productId: product.id, kind: 'count', quantity: 0, reason: 'นับ', userId: 'cashier' }),
    () => store.addCashMovement({ key: 'x', kind: 'in', amount: 1, reason: 'x', userId: 'cashier' }),
    () => store.saveUser({ name: 'ใหม่', username: 'new', role: 'cashier', active: true }, 'cashier'),
    () => store.recordBackup({ cloud: true }, 'cashier')
  ];
  operations.forEach(operation => rejectsCode(operation, 'FORBIDDEN'));
  assert.deepEqual(store.getState(), before);
});

test('product uniqueness normalizes SKU/barcode and stock edits must use ledger', () => {
  const { store, product } = fixture();
  assert.throws(() => store.saveProduct({ ...product, id: undefined, sku: ' test ', barcode: '' }, 'owner'));
  assert.throws(() => store.saveProduct({ ...product, id: undefined, sku: 'DIFFERENT', barcode: ' 001234 ' }, 'owner'));
  assert.throws(() => store.saveProduct({ ...product, price: -1 }, 'owner'));
  assert.throws(() => store.saveProduct({ ...product, stock: 999 }, 'owner'));
  store.adjustStock({ key: 'count', productId: product.id, kind: 'count', quantity: 0, reason: 'นับจริง', userId: 'owner' });
  assert.equal(stock(store, product.id), 0);
  assert.equal(store.getState().stockMovements.filter(m => m.productId === product.id).reduce((s, m) => s + m.quantity, 0), 0);
});

test('storage failure rolls back sale, void, stock, closing, backup and reset; retry remains possible', () => {
  const { store, storage, product, sale } = fixture();
  const original = sale().sale;
  const before = store.getState();
  storage.fail = true;
  const operations = [
    () => sale('another'),
    () => store.voidSale({ key: 'void', saleId: original.id, reason: 'ผิด', cashReturned: true, goodsReturned: true, userId: 'owner' }),
    () => store.adjustStock({ key: 'stock', productId: product.id, kind: 'receive', quantity: 5, reason: 'รับ', userId: 'owner' }),
    () => store.closeShift({ key: 'close', counted: 0, userId: 'owner' }),
    () => store.recordBackup({ cloud: true }, 'owner'),
    () => store.reset()
  ];
  for (const operation of operations) {
    rejectsCode(operation, 'STORAGE_FAILED');
    assert.deepEqual(store.getState(), before);
  }
  storage.fail = false;
  assert.equal(sale('another').sale.total, 7000);
  assert.equal(stock(store, product.id), 6);
});

test('data copies cannot bypass business rules and every seeded product reconciles to ledger', () => {
  const { store } = fixture();
  const state = store.getState();
  for (const product of state.products) {
    assert.equal(state.stockMovements.filter(m => m.productId === product.id).reduce((s, m) => s + m.quantity, 0), product.stock);
  }
  state.products[0].stock = -100;
  state.users[0].role = 'cashier';
  assert.notEqual(store.getState().products[0].stock, -100);
  assert.equal(store.getState().users.find(u => u.id === 'owner').role, 'owner');
});

test('backup remains a simulated queued snapshot offline and user changes protect last owner', () => {
  const { store } = fixture();
  store.setOnline(false);
  const result = store.recordBackup({ cloud: true }, 'owner');
  assert.ok(result.lastSnapshot);
  assert.equal(result.pending, 1);
  assert.equal(result.lastUpload, null);
  assert.equal(result.history.at(-1).simulated, true);
  assert.equal(result.history.at(-1).action, 'DEMO_BACKUP');
  assert.equal(typeof result.history.at(-1).description, 'string');
  store.setOnline(true);
  assert.equal(store.recordBackup({ cloud: true }, 'owner').pending, 0);
  assert.throws(() => store.saveUser({ id: 'owner', name: 'เจ้าของ', username: 'owner', role: 'cashier', active: true }, 'owner'));
  const user = store.saveUser({ name: 'พนักงานใหม่', username: ' staff ', role: 'cashier', active: true }, 'owner');
  store.setUser(user.id);
  assert.equal(store.getState().currentUserId, user.id);
  store.saveUser({ ...user, active: false }, 'owner');
  rejectsCode(() => store.setUser(user.id), 'INVALID_USER');
});

test('oversized shift totals fail atomically instead of rounding a monetary intermediate', () => {
  const { store, product } = fixture();
  store.closeShift({key:'old-close',counted:0,userId:'owner'});
  store.openShift({key:'big-open',opening:Number.MAX_SAFE_INTEGER,userId:'owner'});
  const before=store.getState();
  rejectsCode(() => store.addCashMovement({key:'overflow',kind:'in',amount:1,reason:'เกินขอบเขต',userId:'owner'}),'AMOUNT_OVERFLOW');
  assert.deepEqual(store.getState(),before);
  rejectsCode(() => store.checkout({key:'overflow-sale',userId:'owner',items:[{productId:product.id,quantity:1,unitPrice:3500}],tendered:3500}),'AMOUNT_OVERFLOW');
  assert.deepEqual(store.getState(),before);
});

test('daily sales follow Bangkok dates and reject impossible calendar dates', () => {
  const {store,sale}=fixture();
  const bill=sale().sale;
  const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(bill.createdAt));
  const before=store.dailySummary(day);
  store.voidSale({key:'void-daily',saleId:bill.id,reason:'คืนครบ',cashReturned:true,goodsReturned:true,userId:'owner'});
  const after=store.dailySummary(day);
  assert.equal(after.gross,before.gross);
  assert.equal(after.voids,before.voids+7000);
  assert.equal(after.net,before.net-7000);
  assert.equal(after.saleCount,before.saleCount);
  rejectsCode(()=>store.dailySummary('2026-02-30'),'INVALID_DATE');
});

test('disabled products and inactive users cannot sell; barcodes remain strings', () => {
  const {store,product,sale}=fixture();
  assert.throws(()=>store.saveProduct({...product,barcode:1234},'owner'));
  store.saveProduct({...product,active:false},'owner');
  rejectsCode(()=>sale(),'PRODUCT_UNAVAILABLE');
  store.saveUser({id:'cashier',name:'พนักงาน',username:'cashier',role:'cashier',active:false},'owner');
  rejectsCode(()=>sale('inactive',{userId:'cashier'}),'INVALID_USER');
});

test('recovery storage failure preserves the committed bill and pending result', () => {
  const {store,storage,product,sale}=fixture();
  const bill=sale('lost',{simulate:'unresolved'}).sale;
  const before=store.getState();
  storage.fail=true;
  rejectsCode(()=>store.recoverCheckout(),'STORAGE_FAILED');
  assert.deepEqual(store.getState(),before);
  storage.fail=false;
  assert.equal(store.recoverCheckout().id,bill.id);
  assert.equal(stock(store,product.id),8);
});

test('storage corruption is surfaced without silently overwriting transaction history', () => {
  const storage=memory();
  storage.setItem('broken','{bad json');
  rejectsCode(()=>createStore({storage,key:'broken'}),'STORAGE_INVALID');
  assert.equal(storage.getItem('broken'),'{bad json');
});
