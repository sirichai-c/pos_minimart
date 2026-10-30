import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { count, createEnv, createProduct, onHand, openShift, type TestEnv } from '../helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createEnv(); });
afterEach(async () => { await env.close(); });

describe('checkout', () => {
  it('A01 stock 10, sell 2 × 35 baht, tender 100 → total 70, change 30, stock 8 with bill/payment/movements', async () => {
    const p = await createProduct(env.owner, { sku: 'A01', name: 'กาแฟ', price: 3500, openingQuantity: 10 });
    const shift = await openShift(env.cashier);
    const res = await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 2, expectedUnitPrice: 3500 }], tendered: 10000 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ total: 7000, tendered: 10000, change: 3000, shiftId: shift.id, voided: null });
    expect(res.body.billNo).toBe('POS1-' + res.body.id.replace(/-/g, '').toUpperCase());
    expect(res.body.items).toEqual([{ productId: p.id, sku: 'A01', name: 'กาแฟ', unitPrice: 3500, quantity: 2, lineTotal: 7000 }]);
    expect(onHand(env.db, p.id)).toBe(8);
    expect(count(env.db, 'sales')).toBe(1);
    expect(count(env.db, 'payments', 'sale_id = ? AND tendered = 10000 AND change = 3000 AND amount = 7000', res.body.id)).toBe(1);
    expect(count(env.db, 'stock_movements', "kind = 'sale' AND quantity = -2 AND balance_after = 8 AND source_id = ?", res.body.id)).toBe(1);
    expect(count(env.db, 'audit_events', "action = 'sale.created' AND entity_id = ?", res.body.id)).toBe(1);
  });

  it('A04 same key with quantity changed 2 → 3 gives conflict and no extra business effect', async () => {
    const p = await createProduct(env.owner, { sku: 'A04', price: 3500, openingQuantity: 10 });
    await openShift(env.cashier);
    const key = randomUUID();
    const first = await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 2, expectedUnitPrice: 3500 }], tendered: 10000 }, { key });
    expect(first.status).toBe(201);
    const second = await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 3, expectedUnitPrice: 3500 }], tendered: 10000 }, { key });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(count(env.db, 'sales')).toBe(1);
    expect(count(env.db, 'payments')).toBe(1);
    expect(onHand(env.db, p.id)).toBe(8);
  });

  it('A05 one unit left and two concurrent sales with different keys → one bill, the other INSUFFICIENT_STOCK, stock 0', async () => {
    const p = await createProduct(env.owner, { sku: 'A05', price: 3500, openingQuantity: 1 });
    await openShift(env.cashier);
    const body = { items: [{ productId: p.id, quantity: 1, expectedUnitPrice: 3500 }], tendered: 3500 };
    const [a, b] = await Promise.all([env.cashier.post('/api/sales', body), env.owner.post('/api/sales', body)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const failed = a.status === 409 ? a : b;
    expect(failed.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(failed.body.error.details.shortages[0]).toMatchObject({ productId: p.id, requested: 1, onHand: 0 });
    expect(count(env.db, 'sales')).toBe(1);
    expect(onHand(env.db, p.id)).toBe(0);
  });

  it('A06 price changed 35 → 40 before confirm gives PRICE_CHANGED; old bill keeps 35', async () => {
    const p = await createProduct(env.owner, { sku: 'A06', price: 3500, openingQuantity: 10 });
    await openShift(env.cashier);
    const old = await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 1, expectedUnitPrice: 3500 }], tendered: 3500 });
    expect((await env.owner.patch(`/api/products/${p.id}`, { price: 4000 })).status).toBe(200);
    const res = await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 1, expectedUnitPrice: 3500 }], tendered: 5000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
    expect(res.body.error.details.changes).toEqual([{ productId: p.id, oldPrice: 3500, newPrice: 4000 }]);
    expect(count(env.db, 'sales')).toBe(1);
    expect(onHand(env.db, p.id)).toBe(9);
    const reprint = (await env.cashier.get(`/api/sales/${old.body.id}`)).body;
    expect(reprint.items[0].unitPrice).toBe(3500);
    expect(reprint.total).toBe(3500);
    // ยืนยันราคาใหม่ด้วย key ใหม่จึงขายได้
    const confirmed = await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 1, expectedUnitPrice: 4000 }], tendered: 5000 });
    expect(confirmed.body).toMatchObject({ total: 4000, change: 1000 });
  });

  it('rejects tender lower than total and inactive products without side effects (R01–R02)', async () => {
    const p = await createProduct(env.owner, { sku: 'R01', price: 3500, openingQuantity: 10 });
    await openShift(env.cashier);
    const low = await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 2, expectedUnitPrice: 3500 }], tendered: 6999 });
    expect(low.status).toBe(422);
    expect(low.body.error.code).toBe('TENDER_TOO_LOW');
    await env.owner.patch(`/api/products/${p.id}`, { active: false });
    const inactive = await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 1, expectedUnitPrice: 3500 }], tendered: 3500 });
    expect(inactive.body.error.code).toBe('PRODUCT_INACTIVE');
    const overflow = await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 1, expectedUnitPrice: Number.MAX_SAFE_INTEGER + 1 }], tendered: 1 });
    expect(overflow.status).toBe(400);
    expect(count(env.db, 'sales')).toBe(0);
    expect(onHand(env.db, p.id)).toBe(10);
  });
});
