import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../apps/server/src/db/connection.ts';
import { buildApp } from '../../apps/server/src/app.ts';
import { restoreSnapshot } from '../../apps/server/src/modules/backup/restore.ts';
import { DirectoryTarget, type UploadTarget } from '../../apps/server/src/modules/backup/uploader.ts';
import { Client, count, createEnv, createProduct, OWNER, openShift, type TestEnv } from '../helpers.ts';

let env: TestEnv;
const cleanup: string[] = [];
afterEach(async () => {
  await env?.close();
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true });
});

class FlakyTarget implements UploadTarget {
  readonly description = 'ปลายทางจำลอง';
  online = false;
  readonly uploaded: string[] = [];
  private readonly inner: DirectoryTarget;
  constructor(dir: string) { this.inner = new DirectoryTarget(dir); }
  async upload(path: string, sha: string): Promise<void> {
    if (!this.online) throw new Error('getaddrinfo ENOTFOUND backup.example');
    await this.inner.upload(path, sha);
    this.uploaded.push(path.split(/[\\/]/).pop()!);
  }
}

async function sell(e: TestEnv, productId: string, qty = 1) {
  const res = await e.cashier.post('/api/sales', { items: [{ productId, quantity: qty, expectedUnitPrice: 1000 }], tendered: 1000 * qty });
  expect(res.status).toBe(201);
  return res.body;
}

describe('backup and restore', () => {
  it('A12 cloud unavailable for a while → selling continues, pending uploads shown, latest restore point sent first when back online', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'pos-remote-'));
    cleanup.push(remote);
    const target = new FlakyTarget(remote);
    env = await createEnv({ target });
    const p = await createProduct(env.owner, { sku: 'A', price: 1000, openingQuantity: 100 });
    await openShift(env.cashier, 0);

    await env.backup.tick(); // daily
    await sell(env, p.id);
    env.clock.advance(16 * 60_000);
    await env.backup.tick(); // interval
    await sell(env, p.id);
    env.clock.advance(16 * 60_000);
    await env.backup.tick(); // interval

    let status = (await env.owner.get('/api/system/status')).body;
    expect(status.pendingUploads).toBe(3);
    expect(status.lastUpload).toBeNull();
    expect(status.lastSnapshot.status).toBe('ok');
    const runs = (await env.owner.get('/api/backups')).body as { uploadError: string | null; uploadAttempts: number }[];
    expect(runs[0].uploadError).toMatch(/ENOTFOUND/);
    expect(count(env.db, 'sales')).toBe(2);

    target.online = true;
    await env.backup.upload(); // ยังไม่ถึงเวลา backoff
    expect(target.uploaded).toHaveLength(0);
    env.clock.advance(61 * 60_000);
    await env.backup.upload();
    expect(target.uploaded).toHaveLength(3);
    const newest = (await env.owner.get('/api/backups')).body[0].fileName;
    expect(target.uploaded[0]).toBe(newest);
    status = (await env.owner.get('/api/system/status')).body;
    expect(status.pendingUploads).toBe(0);
    expect(status.lastUpload).not.toBeNull();
    expect(readdirSync(remote).filter(f => f.endsWith('.db'))).toHaveLength(3);
  });

  it('A13 restore to a clean location → integrity ok, bills/totals/shifts match the snapshot, sessions cleared, login works', async () => {
    env = await createEnv();
    const p = await createProduct(env.owner, { sku: 'A', price: 1000, openingQuantity: 100 });
    const shift = await openShift(env.cashier, 50000);
    const kept = await sell(env, p.id, 2);
    const voided = await sell(env, p.id, 1);
    await env.owner.post(`/api/sales/${voided.id}/void`, { reason: 'ผิด', cashReturned: true, goodsReturned: true });
    await env.cashier.post(`/api/shifts/${shift.id}/close`, { countedCash: 52000 });
    const snap = (await env.owner.post('/api/backups', {})).body;
    expect(snap.status).toBe('ok');
    await openShift(env.cashier, 0);
    await sell(env, p.id, 5); // หลังจุดสำรอง: ต้องไม่อยู่ในข้อมูลที่กู้

    const clean = mkdtempSync(join(tmpdir(), 'pos-restore-'));
    cleanup.push(clean);
    const dbPath = join(clean, 'pos.db');
    const started = Date.now();
    const result = await restoreSnapshot({ snapshotPath: join(env.config.backupDir, snap.fileName), dbPath });
    expect(Date.now() - started).toBeLessThan(2 * 3_600_000);
    expect(result.integrity).toBe('ok');
    expect(result.previousDbKeptAt).toBeNull();
    expect(result.counts).toMatchObject({ sales: 2, salesTotal: 3000, voids: 1, shifts: 1 });

    const db = openDb(dbPath);
    try {
      expect(count(db, 'sessions')).toBe(0);
      expect(count(db, 'sales')).toBe(2);
      expect(count(db, 'audit_events', "action = 'system.restored'")).toBe(1);
      expect((db.prepare('SELECT on_hand FROM inventory_balances').get() as { on_hand: number }).on_hand).toBe(98);
      const app = await buildApp({ db, config: { ...env.config, dbPath }, clock: env.clock.now });
      const client = new Client(app);
      await client.login(OWNER);
      const bill = (await client.get(`/api/sales/${kept.id}`)).body;
      expect(bill.billNo).toBe(kept.billNo);
      const closed = (await client.get(`/api/reports/shifts/${shift.id}`)).body;
      expect(closed).toMatchObject({ expectedCash: 52000, countedCash: 52000, variance: 0 });
      expect(closed.summary).toMatchObject({ gross: 3000, voids: 1000, net: 2000 });
      await app.close();
    } finally {
      db.close();
    }
  });

  it('A13 restore keeps the previous database and refuses a corrupted snapshot without touching anything', async () => {
    env = await createEnv();
    const snap = (await env.owner.post('/api/backups', {})).body;
    const snapshotPath = join(env.config.backupDir, snap.fileName);
    const clean = mkdtempSync(join(tmpdir(), 'pos-restore-'));
    cleanup.push(clean);
    const dbPath = join(clean, 'pos.db');
    await restoreSnapshot({ snapshotPath, dbPath, now: () => '2026-10-27T00:00:00.000Z' });
    const second = await restoreSnapshot({ snapshotPath, dbPath, now: () => '2026-10-27T01:00:00.000Z' });
    expect(second.previousDbKeptAt && existsSync(join(second.previousDbKeptAt, 'pos.db'))).toBe(true);

    const { appendFileSync } = await import('node:fs');
    appendFileSync(snapshotPath, 'corrupt');
    await expect(restoreSnapshot({ snapshotPath, dbPath })).rejects.toThrow(/checksum/);
    expect(existsSync(dbPath)).toBe(true);
  });
});
