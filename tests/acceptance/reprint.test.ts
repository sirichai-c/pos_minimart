import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { count, createEnv, createProduct, onHand, openShift, type TestEnv } from '../helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createEnv(); });
afterEach(async () => { await env.close(); });

describe('reprint', () => {
  it('A07 printing failed then reprint → same bill, no new sale or stock change', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 3500, openingQuantity: 10 });
    await openShift(env.cashier);
    const sale = (await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 2, expectedUnitPrice: 3500 }], tendered: 10000 })).body;
    const first = await env.cashier.get(`/api/sales/${sale.id}`);
    const byBillNo = await env.cashier.get(`/api/sales/${sale.billNo}`);
    expect(first.body).toEqual(sale);
    expect(byBillNo.body).toEqual(sale);
    expect(count(env.db, 'sales')).toBe(1);
    expect(count(env.db, 'stock_movements', "kind = 'sale'")).toBe(1);
    expect(onHand(env.db, p.id)).toBe(8);
  });
});
