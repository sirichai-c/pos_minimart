import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { armFault } from '../../apps/server/src/testing/faults.ts';
import { count, createEnv, createProduct, openShift, type TestEnv } from '../helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createEnv(); });
afterEach(async () => { await env.close(); });

describe('shift close', () => {
  it('A09 open 1,000, sell 700, void 200, cash in 100, out 50, counted 1,540 → expected 1,550, variance −10', async () => {
    const big = await createProduct(env.owner, { sku: 'BIG', price: 50000, openingQuantity: 5 });
    const small = await createProduct(env.owner, { sku: 'SMALL', price: 20000, openingQuantity: 5 });
    const shift = await openShift(env.cashier, 100000);
    await env.cashier.post('/api/sales', { items: [{ productId: big.id, quantity: 1, expectedUnitPrice: 50000 }], tendered: 50000 });
    const toVoid = (await env.cashier.post('/api/sales', { items: [{ productId: small.id, quantity: 1, expectedUnitPrice: 20000 }], tendered: 20000 })).body;
    await env.owner.post(`/api/sales/${toVoid.id}/void`, { reason: 'ขายผิด', cashReturned: true, goodsReturned: true });
    await env.owner.post(`/api/shifts/${shift.id}/cash-movements`, { direction: 'in', amount: 10000, reason: 'แลกเหรียญ' });
    await env.owner.post(`/api/shifts/${shift.id}/cash-movements`, { direction: 'out', amount: 5000, reason: 'ค่าน้ำแข็ง' });
    const closed = await env.cashier.post(`/api/shifts/${shift.id}/close`, { countedCash: 154000 });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ expectedCash: 155000, countedCash: 154000, variance: -1000 });
    expect(closed.body.summary).toMatchObject({ opening: 100000, gross: 70000, voids: 20000, net: 50000, cashIn: 10000, cashOut: 5000, expectedCash: 155000 });
  });

  it('A10 concurrent sale and close are serialized; lost close response resent with the same key returns the same snapshot', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 1000, openingQuantity: 10 });
    const shift = await openShift(env.cashier, 0);
    const closeKey = randomUUID();
    const [sale, close] = await Promise.all([
      env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 1, expectedUnitPrice: 1000 }], tendered: 1000 }),
      env.owner.post(`/api/shifts/${shift.id}/close`, { countedCash: 1000 }, { key: closeKey }),
    ]);
    expect(close.status).toBe(200);
    if (sale.status === 201) {
      // ขายก่อนปิด: อยู่ใน snapshot ของกะ
      expect(sale.body.shiftId).toBe(shift.id);
      expect(close.body.summary.saleCount).toBe(1);
    } else {
      // ขายหลังปิด: ถูกปฏิเสธครบชุด
      expect(sale.body.error.code).toBe('NO_OPEN_SHIFT');
      expect(count(env.db, 'sales')).toBe(0);
      expect(close.body.summary.saleCount).toBe(0);
    }
    const resend = await env.owner.post(`/api/shifts/${shift.id}/close`, { countedCash: 1000 }, { key: closeKey });
    expect(resend.status).toBe(200);
    expect(resend.headers['idempotent-replayed']).toBe('true');
    expect(resend.body).toEqual(close.body);
  });

  it('A10 close response lost after commit → resend returns the original snapshot', async () => {
    const shift = await openShift(env.cashier, 5000);
    const key = randomUUID();
    armFault('after-commit-before-response', { scope: 'shifts.close' });
    expect((await env.cashier.post(`/api/shifts/${shift.id}/close`, { countedCash: 5000 }, { key })).status).toBe(500);
    const resend = await env.cashier.post(`/api/shifts/${shift.id}/close`, { countedCash: 5000 }, { key });
    expect(resend.status).toBe(200);
    expect(resend.body).toMatchObject({ id: shift.id, expectedCash: 5000, variance: 0 });
    // คีย์ใหม่แต่ยอดเดิมก็ได้ผลเดิม
    const newKey = await env.cashier.post(`/api/shifts/${shift.id}/close`, { countedCash: 5000 });
    expect(newKey.body.closedAt).toBe(resend.body.closedAt);
    expect(count(env.db, 'audit_events', "action = 'shift.closed'")).toBe(1);
  });
});
