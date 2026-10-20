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
