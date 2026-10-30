import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findBalanceMismatches } from '../../apps/server/src/modules/inventory/service.ts';
import { count, createEnv, createProduct, openShift, type TestEnv } from '../helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createEnv(); });
afterEach(async () => { await env.close(); });

describe('catalog', () => {
  it('normalizes SKU, keeps barcode text and rejects duplicates', async () => {
    const p = await createProduct(env.owner, { sku: '  milk-250 ', name: 'นม', price: 1500, barcode: '0088510' });
    const got = (await env.owner.get(`/api/products/${p.id}`)).body;
    expect(got).toMatchObject({ sku: 'MILK-250', barcode: '0088510', price: 1500, onHand: 0, active: true });
    const dupSku = await env.owner.post('/api/products', { sku: 'MILK-250', name: 'x', price: 1 });
    expect(dupSku.body.error.code).toBe('DUPLICATE_SKU');
    const dupBarcode = await env.owner.post('/api/products', { sku: 'OTHER', name: 'x', price: 1, barcode: '0088510' });
    expect(dupBarcode.body.error.code).toBe('DUPLICATE_BARCODE');
  });

  it('searches by name, SKU and exact barcode', async () => {
    await createProduct(env.owner, { sku: 'COFFEE', name: 'กาแฟกระป๋อง', price: 1700, barcode: '885001' });
    await createProduct(env.owner, { sku: 'TEA', name: 'ชาเขียว', price: 2000, barcode: '885002' });
    expect((await env.cashier.get('/api/products?q=' + encodeURIComponent('กาแฟ'))).body).toHaveLength(1);
    expect((await env.cashier.get('/api/products?q=tea')).body[0].sku).toBe('TEA');
    expect((await env.cashier.get('/api/products?barcode=885002')).body[0].sku).toBe('TEA');
    expect((await env.cashier.get('/api/products?q=%25')).body).toHaveLength(0);
  });

  it('audits price changes and deactivates instead of delete', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 3500 });
    expect((await env.owner.patch(`/api/products/${p.id}`, { price: 4000 })).body.price).toBe(4000);
    expect((await env.owner.patch(`/api/products/${p.id}`, { active: false })).body.active).toBe(false);
    const audit = (await env.owner.get('/api/audit-events?entityType=product')).body as { action: string; data: any }[];
    expect(audit.find(a => a.action === 'product.price_changed')?.data).toEqual({ price: { from: 3500, to: 4000 } });
    expect((await env.cashier.get('/api/products?active=true')).body).toHaveLength(0);
  });
});

describe('inventory', () => {
  it('records receipts and adjustments as movements; balance equals movement sum', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 100, openingQuantity: 10 });
    const r = await env.owner.post('/api/inventory/receipts', { productId: p.id, quantity: 5, reason: 'รับจากร้านส่ง' });
    expect(r.status).toBe(201);
    expect(r.body.product.onHand).toBe(15);
    const a = await env.owner.post('/api/inventory/adjustments', { productId: p.id, countedQuantity: 12, reason: 'นับจริง' });
    expect(a.body.movement).toMatchObject({ kind: 'adjustment', quantity: -3, balanceAfter: 12 });
    const same = await env.owner.post('/api/inventory/adjustments', { productId: p.id, countedQuantity: 12, reason: 'นับซ้ำ' });
    expect(same.body.movement).toBeNull();
    const movements = (await env.owner.get(`/api/inventory/${p.id}/movements`)).body as { kind: string; quantity: number; userName: string }[];
    expect(movements.map(m => [m.kind, m.quantity])).toEqual([['adjustment', -3], ['receipt', 5], ['opening', 10]]);
    expect(movements[0].userName).toBe('เจ้าของร้าน');
    expect(findBalanceMismatches(env.db)).toEqual([]);
    expect(count(env.db, 'audit_events', "action LIKE 'inventory.%'")).toBe(3);
  });

  it('adjustment computes difference from the balance at write time', async () => {
    const p = await createProduct(env.owner, { sku: 'A', price: 100, openingQuantity: 10 });
    await openShift(env.cashier);
    await env.cashier.post('/api/sales', { items: [{ productId: p.id, quantity: 4, expectedUnitPrice: 100 }], tendered: 400 });
    // หน้าจอยังเห็น 10 แต่ขายไปแล้ว 4: นับจริงได้ 5 ต้องเป็นส่วนต่าง −1 จากยอด 6
    const a = await env.owner.post('/api/inventory/adjustments', { productId: p.id, countedQuantity: 5, reason: 'นับจริง' });
    expect(a.body.movement.quantity).toBe(-1);
    expect(findBalanceMismatches(env.db)).toEqual([]);
  });
});
