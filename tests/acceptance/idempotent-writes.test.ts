import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { armFault } from '../../apps/server/src/testing/faults.ts';
import { count, createEnv, createProduct, onHand, openShift, type TestEnv } from '../helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createEnv(); });
afterEach(async () => { await env.close(); });

describe('idempotent writes', () => {
  it('A16 receive 5 units, response lost, resend same key → original result, stock +5 once', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 100, openingQuantity: 10 });
    const key = randomUUID();
    const body = { productId: p.id, quantity: 5, reason: 'รับของ' };
    armFault('after-commit-before-response', { scope: 'inventory.receipt' });
    expect((await env.owner.post('/api/inventory/receipts', body, { key })).status).toBe(500);
    const resend = await env.owner.post('/api/inventory/receipts', body, { key });
    expect(resend.status).toBe(200);
    expect(resend.headers['idempotent-replayed']).toBe('true');
    expect(resend.body.movement).toMatchObject({ quantity: 5, balanceAfter: 15 });
    expect(onHand(env.db, p.id)).toBe(15);
    expect(count(env.db, 'stock_movements', "kind = 'receipt'")).toBe(1);
  });

  it('A16 cash in 100 baht, response lost, resend same key → +100 once', async () => {
    const shift = await openShift(env.cashier, 0);
    const key = randomUUID();
    const body = { direction: 'in', amount: 10000, reason: 'เติมเงินทอน' };
    armFault('after-commit-before-response', { scope: 'shifts.cash_movement' });
    expect((await env.owner.post(`/api/shifts/${shift.id}/cash-movements`, body, { key })).status).toBe(500);
    const resend = await env.owner.post(`/api/shifts/${shift.id}/cash-movements`, body, { key });
    expect(resend.status).toBe(200);
    expect(resend.body.summary.cashIn).toBe(10000);
    expect(count(env.db, 'cash_movements')).toBe(1);
  });

  it('opening a shift and creating a product are also idempotent', async () => {
    const key = randomUUID();
    const a = await env.cashier.post('/api/shifts', { openingCash: 100 }, { key });
    const b = await env.cashier.post('/api/shifts', { openingCash: 100 }, { key });
    expect(b.body.id).toBe(a.body.id);
    const pk = randomUUID();
    const p1 = await env.owner.post('/api/products', { sku: 'X', name: 'X', price: 1, openingQuantity: 3 }, { key: pk });
    const p2 = await env.owner.post('/api/products', { sku: 'X', name: 'X', price: 1, openingQuantity: 3 }, { key: pk });
    expect(p2.body.id).toBe(p1.body.id);
    expect(count(env.db, 'products')).toBe(1);
    expect(count(env.db, 'stock_movements', "kind = 'opening'")).toBe(1);
  });
});
