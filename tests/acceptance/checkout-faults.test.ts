import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { armFault } from '../../apps/server/src/testing/faults.ts';
import { count, createEnv, createProduct, onHand, openShift, type TestEnv } from '../helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createEnv(); });
afterEach(async () => { await env.close(); });

async function setup() {
  const p = await createProduct(env.owner, { sku: 'A', price: 3500, openingQuantity: 10 });
  await openShift(env.cashier);
  return { p, body: { items: [{ productId: p.id, quantity: 2, expectedUnitPrice: 3500 }], tendered: 10000 } };
}

describe('checkout faults', () => {
  it('A02 process dies before commit → no partial writes; after restart the key is unknown and retrying it succeeds', async () => {
    const { p, body } = await setup();
    const key = randomUUID();
    const auditsBefore = count(env.db, 'audit_events');
    armFault('before-commit', { scope: 'sales.checkout' });
    const crashed = await env.cashier.post('/api/sales', body, { key });
    expect(crashed.status).toBe(500);
    await env.restart();
    for (const table of ['sales', 'sale_items', 'payments', 'idempotency_requests WHERE scope = \'sales.checkout\'']) {
      const [name, where] = table.split(' WHERE ');
      expect(count(env.db, name!, where ?? '1 = 1'), table).toBe(0);
    }
    expect(count(env.db, 'stock_movements', "kind = 'sale'")).toBe(0);
    expect(count(env.db, 'audit_events')).toBe(auditsBefore + 2); // login ใหม่หลัง restart เท่านั้น
    expect(onHand(env.db, p.id)).toBe(10);
    expect((await env.cashier.get(`/api/requests/${key}`)).status).toBe(404);
    const retry = await env.cashier.post('/api/sales', body, { key });
    expect(retry.status).toBe(201);
    expect(onHand(env.db, p.id)).toBe(8);
  });

  it('A03 committed but response lost → reload finds the bill by key; resend returns the same bill with no extra payment/movement', async () => {
    const { p, body } = await setup();
    const key = randomUUID();
    armFault('after-commit-before-response', { scope: 'sales.checkout' });
    const lost = await env.cashier.post('/api/sales', body, { key });
    expect(lost.status).toBe(500);
    await env.restart();
    const recovered = await env.cashier.get(`/api/requests/${key}`);
    expect(recovered.status).toBe(200);
    expect(recovered.body.result).toMatchObject({ total: 7000, change: 3000 });
    // ราคาเปลี่ยนหลัง commit: การส่งซ้ำต้องคืนผลเดิม ไม่ตรวจราคา/สต๊อกใหม่ (R03)
    await env.owner.patch(`/api/products/${p.id}`, { price: 9900 });
    const resend = await env.cashier.post('/api/sales', body, { key });
    expect(resend.status).toBe(200);
    expect(resend.headers['idempotent-replayed']).toBe('true');
    expect(resend.body.id).toBe(recovered.body.result.id);
    expect(onHand(env.db, p.id)).toBe(8);
    expect(count(env.db, 'sales')).toBe(1);
    expect(count(env.db, 'payments')).toBe(1);
    expect(count(env.db, 'stock_movements', "kind = 'sale'")).toBe(1);
  });

  it('A03 another cashier cannot read someone else\'s request result; owner can', async () => {
    const { body } = await setup();
    const key = randomUUID();
    await env.owner.post('/api/sales', body, { key });
    expect((await env.cashier.get(`/api/requests/${key}`)).status).toBe(404);
    expect((await env.owner.get(`/api/requests/${key}`)).status).toBe(200);
  });

  it('A15 disk full during checkout → 503 STORAGE_FAILURE, nothing committed, same key works afterwards', async () => {
    const { p, body } = await setup();
    const key = randomUUID();
    armFault('disk-full', { scope: 'sales.checkout' });
    const full = await env.cashier.post('/api/sales', body, { key });
    expect(full.status).toBe(503);
    expect(full.body.error.code).toBe('STORAGE_FAILURE');
    expect(count(env.db, 'sales')).toBe(0);
    expect(onHand(env.db, p.id)).toBe(10);
    expect((await env.cashier.post('/api/sales', body, { key })).status).toBe(201);
  });

  it('A15 disk full during backup → run is failed and no new restore point is claimed', async () => {
    await setup();
    armFault('backup-disk-full', { scope: 'manual' });
    const res = await env.owner.post('/api/backups', {});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('failed');
    expect(res.body.error).toMatch(/SQLITE_FULL/);
    const status = (await env.owner.get('/api/system/status')).body;
    expect(status.lastSnapshot).toBeNull();
    expect(status.lastFailedSnapshot.id).toBe(res.body.id);
  });
});
