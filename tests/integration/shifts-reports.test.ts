import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CASHIER, createEnv, createProduct, OWNER, openShift, type TestEnv } from '../helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createEnv(); });
afterEach(async () => { await env.close(); });

describe('shifts', () => {
  it('opens one shift at a time and exposes the current one', async () => {
    expect((await env.cashier.get('/api/shifts/current')).body.shift).toBeNull();
    const s = await openShift(env.cashier, 50000);
    const again = await env.owner.post('/api/shifts', { openingCash: 0 });
    expect(again.body.error.code).toBe('SHIFT_ALREADY_OPEN');
    expect((await env.cashier.get('/api/shifts/current')).body.shift).toMatchObject({ id: s.id, openingCash: 50000, closedAt: null });
  });

  it('rejects sales without an open shift', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 100, openingQuantity: 1 });
    const res = await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 1, expectedUnitPrice: 100 }], tendered: 100 });
    expect(res.body.error.code).toBe('NO_OPEN_SHIFT');
  });

  it('closed shift numbers do not change and cannot take cash movements', async () => {
    const s = await openShift(env.cashier, 0);
    const closed = await env.cashier.post(`/api/shifts/${s.id}/close`, { countedCash: 0 });
    expect(closed.status).toBe(200);
    const cash = await env.owner.post(`/api/shifts/${s.id}/cash-movements`, { direction: 'in', amount: 100, reason: 'x' });
    expect(cash.body.error.code).toBe('SHIFT_CLOSED');
    const different = await env.cashier.post(`/api/shifts/${s.id}/close`, { countedCash: 5 });
    expect(different.body.error.code).toBe('SHIFT_CLOSED');
  });
});

describe('reports', () => {
  it('daily report groups by Asia/Bangkok and separates a shift that crosses midnight (23:50–00:10)', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 1000, openingQuantity: 10 });
    env.clock.set('2026-10-26T16:40:00.000Z'); // 23:40 ICT
    await env.owner.login(OWNER);
    await env.cashier.login(CASHIER);
    const s = await openShift(env.cashier, 0);
    env.clock.set('2026-10-26T16:50:00.000Z'); // 23:50 ICT วันที่ 26
    await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 1, expectedUnitPrice: 1000 }], tendered: 1000 });
    env.clock.set('2026-10-26T17:10:00.000Z'); // 00:10 ICT วันที่ 27
    await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 2, expectedUnitPrice: 1000 }], tendered: 2000 });
    await env.owner.post(`/api/shifts/${s.id}/cash-movements`, { direction: 'out', amount: 500, reason: 'ซื้อถุง' });

    const d26 = (await env.owner.get('/api/reports/daily?date=2026-10-26')).body;
    const d27 = (await env.owner.get('/api/reports/daily?date=2026-10-27')).body;
    expect(d26).toMatchObject({ saleCount: 1, gross: 1000, net: 1000, cashOut: 0 });
    expect(d27).toMatchObject({ saleCount: 1, gross: 2000, net: 2000, cashOut: 500 });
    expect(d26.shifts).toEqual([expect.objectContaining({ id: s.id, crossesDay: true })]);
    expect(d27.shifts).toHaveLength(1);

    const shift = (await env.cashier.get(`/api/reports/shifts/${s.id}`)).body;
    expect(shift.summary).toMatchObject({ gross: 3000, saleCount: 2, cashOut: 500, expectedCash: 2500 });
  });

  it('cashier can read only own closed shift reports', async () => {
    const s = await openShift(env.owner, 0);
    await env.owner.post(`/api/shifts/${s.id}/close`, { countedCash: 0 });
    expect((await env.cashier.get(`/api/reports/shifts/${s.id}`)).status).toBe(403);
    expect((await env.cashier.get('/api/reports/daily')).status).toBe(403);
  });

  it('lists bills by shift and date', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 1000, openingQuantity: 10 });
    const s = await openShift(env.cashier, 0);
    await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 1, expectedUnitPrice: 1000 }], tendered: 1000 });
    expect((await env.cashier.get(`/api/sales?shiftId=${s.id}`)).body).toHaveLength(1);
    expect((await env.cashier.get('/api/sales?date=2026-10-26')).body).toHaveLength(1);
    expect((await env.cashier.get('/api/sales?date=2026-10-25')).body).toHaveLength(0);
  });
});
