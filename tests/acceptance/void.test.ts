import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { count, createEnv, createProduct, onHand, openShift, type TestEnv } from '../helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createEnv(); });
afterEach(async () => { await env.close(); });

const voidBody = { reason: 'ลูกค้าเปลี่ยนใจ', cashReturned: true, goodsReturned: true };

describe('void', () => {
  it('A08 owner voids A01, then resends with a new key → reverses 70 baht and stock to 10 exactly once; bill stays', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 3500, openingQuantity: 10 });
    const shift = await openShift(env.cashier, 0);
    const sale = (await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 2, expectedUnitPrice: 3500 }], tendered: 10000 })).body;
    const first = await env.owner.post(`/api/sales/${sale.id}/void`, voidBody);
    expect(first.status).toBe(200);
    expect(first.body.voided).toMatchObject({ reason: 'ลูกค้าเปลี่ยนใจ', approvedByName: 'เจ้าของร้าน' });
    const again = await env.owner.post(`/api/sales/${sale.id}/void`, voidBody);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_VOIDED');
    expect(onHand(env.db, p.id)).toBe(10);
    expect(count(env.db, 'sale_voids')).toBe(1);
    expect(count(env.db, 'stock_movements', "kind = 'void' AND quantity = 2")).toBe(1);
    expect(count(env.db, 'sales', 'id = ? AND total = 7000', sale.id)).toBe(1);
    const summary = (await env.owner.get(`/api/reports/shifts/${shift.id}`)).body.summary;
    expect(summary).toMatchObject({ gross: 7000, voids: 7000, net: 0, expectedCash: 0 });
  });

  it('R04 cannot void a bill from a closed shift', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 3500, openingQuantity: 10 });
    const shift = await openShift(env.cashier, 0);
    const sale = (await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 1, expectedUnitPrice: 3500 }], tendered: 3500 })).body;
    await env.cashier.post(`/api/shifts/${shift.id}/close`, { countedCash: 3500 });
    await openShift(env.cashier, 0);
    const res = await env.owner.post(`/api/sales/${sale.id}/void`, voidBody);
    expect(res.body.error.code).toBe('VOID_NOT_ALLOWED');
    const unconfirmed = await env.owner.post(`/api/sales/${sale.id}/void`, { ...voidBody, cashReturned: false });
    expect(unconfirmed.status).toBe(400);
    expect(onHand(env.db, p.id)).toBe(9);
  });

  it('A14 cashier calling void/stock APIs directly is refused and nothing changes', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 3500, openingQuantity: 10 });
    const shift = await openShift(env.cashier, 0);
    const sale = (await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 2, expectedUnitPrice: 3500 }], tendered: 7000 })).body;
    const before = { audit: count(env.db, 'audit_events'), movements: count(env.db, 'stock_movements') };
    const calls = [
      await env.cashier.post(`/api/sales/${sale.id}/void`, voidBody),
      await env.cashier.post('/api/inventory/adjustments', { productId: p.id, countedQuantity: 100, reason: 'x' }),
      await env.cashier.post('/api/inventory/receipts', { productId: p.id, quantity: 5, reason: 'x' }),
      await env.cashier.post(`/api/shifts/${shift.id}/cash-movements`, { direction: 'out', amount: 100, reason: 'x' }),
      await env.cashier.patch(`/api/products/${p.id}`, { price: 1 }),
      await env.cashier.post(`/api/sales/${sale.id}/void`, { nonsense: true }),
    ];
    for (const res of calls) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(onHand(env.db, p.id)).toBe(8);
    expect(count(env.db, 'sale_voids')).toBe(0);
    expect(count(env.db, 'cash_movements')).toBe(0);
    expect(count(env.db, 'stock_movements')).toBe(before.movements);
    expect(count(env.db, 'audit_events')).toBe(before.audit);
  });
});
