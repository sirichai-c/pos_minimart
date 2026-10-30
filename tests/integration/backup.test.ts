import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../../apps/server/src/db/connection.ts';
import { sha256File, type SnapshotManifest } from '../../apps/server/src/modules/backup/snapshot.ts';
import { backoffMs } from '../../apps/server/src/modules/backup/uploader.ts';
import { count, createEnv, createProduct, openShift, type TestEnv } from '../helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createEnv(); });
afterEach(async () => { await env.close(); });

describe('snapshot', () => {
  it('creates a consistent snapshot with manifest; integrity_check = ok', async () => {
    await createProduct(env.owner, { sku: 'A', price: 1000, openingQuantity: 3 });
    const run = await env.backup.snapshot('manual');
    expect(run).toMatchObject({ status: 'ok', kind: 'manual', schemaVersion: 1 });
    const path = join(env.config.backupDir, run.fileName!);
    expect(await sha256File(path)).toBe(run.sha256);
    const manifest = JSON.parse(readFileSync(path.replace(/\.db$/, '.json'), 'utf8')) as SnapshotManifest;
    expect(manifest).toMatchObject({ appVersion: '0.1.0', schemaVersion: 1, sha256: run.sha256, counts: { products: 1 } });
    expect(readFileSync(path.replace(/\.db$/, '.json'), 'utf8')).not.toMatch(/password|secret/i);
    const copy = openDb(path, { readonly: true });
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(count(copy, 'products')).toBe(1);
    copy.close();
  });

  it('a shift close triggers a snapshot', async () => {
    const s = await openShift(env.cashier, 0);
    await env.cashier.post(`/api/shifts/${s.id}/close`, { countedCash: 0 });
    await env.backup.stop(); // รองานในคิว
    expect(count(env.db, 'backup_runs', "kind = 'shift_close' AND status = 'ok'")).toBe(1);
  });
});

describe('scheduler with a simulated clock', () => {
  it('takes a daily snapshot, then every 15 minutes, and a new daily on the next Bangkok day', async () => {
    await env.backup.tick();
    expect(count(env.db, 'backup_runs', "kind = 'daily'")).toBe(1);
    env.clock.advance(5 * 60_000);
    await env.backup.tick();
    expect(count(env.db, 'backup_runs')).toBe(1);
    env.clock.advance(10 * 60_000);
    await env.backup.tick();
    expect(count(env.db, 'backup_runs', "kind = 'interval'")).toBe(1);
    env.clock.set('2026-10-26T17:01:00.000Z'); // 00:01 ICT วันถัดไป
    await env.backup.tick();
    expect(count(env.db, 'backup_runs', "kind = 'daily'")).toBe(2);
  });

  it('prunes short snapshots after 48 h and daily after 30 days', async () => {
    await env.backup.tick(); // daily day 0
    env.clock.advance(15 * 60_000);
    await env.backup.tick(); // interval
    const files = () => (env.db.prepare("SELECT file_name FROM backup_runs WHERE pruned_at IS NULL AND status = 'ok' ORDER BY started_at").all() as { file_name: string }[]).map(r => r.file_name);
    const [daily0, interval0] = files();
    env.clock.advance(49 * 3_600_000);
    await env.backup.tick();
    expect(files()).toContain(daily0);
    expect(files()).not.toContain(interval0);
    expect(existsSync(join(env.config.backupDir, interval0!))).toBe(false);
    env.clock.advance(30 * 24 * 3_600_000);
    await env.backup.tick();
    expect(files()).not.toContain(daily0);
    expect(count(env.db, 'backup_runs', 'pruned_at IS NOT NULL')).toBeGreaterThanOrEqual(2);
  });

  it('marks runs interrupted by a crash as failed', async () => {
    env.db.prepare("INSERT INTO backup_runs (id, kind, started_at, schema_version, status) VALUES ('r1', 'interval', 'x', 1, 'running')").run();
    env.backup.recoverInterrupted();
    expect(count(env.db, 'backup_runs', "id = 'r1' AND status = 'failed'")).toBe(1);
  });

  it('backs off uploads exponentially up to an hour', () => {
    expect([1, 2, 3, 7, 20].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 3_600_000, 3_600_000]);
  });
});
