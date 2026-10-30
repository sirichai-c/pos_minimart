// ทุก test ใช้ฐานข้อมูลในโฟลเดอร์ชั่วคราว ไม่แตะข้อมูลร้าน
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../apps/server/src/app.ts';
import { openDb } from '../apps/server/src/db/connection.ts';
import { migrate } from '../apps/server/src/db/migrate.ts';
import type { Db } from '../apps/server/src/db/tx.ts';
import { BackupService } from '../apps/server/src/modules/backup/scheduler.ts';
import type { UploadTarget } from '../apps/server/src/modules/backup/uploader.ts';
import { loadConfig, type AppConfig } from '../apps/server/src/config.ts';
import { clearFaults } from '../apps/server/src/testing/faults.ts';

process.env.NODE_ENV = 'test';

export const PORT = 4180;
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const OWNER = { username: 'owner', displayName: 'เจ้าของร้าน', password: 'owner-pass-123' };
export const CASHIER = { username: 'cashier', displayName: 'พนักงานขาย', password: 'cashier-pass-123' };

export interface TestClock { now: () => string; set(iso: string): void; advance(ms: number): void }

export function testClock(start = '2026-10-26T03:00:00.000Z'): TestClock {
  let t = Date.parse(start);
  return {
    now: () => new Date(t).toISOString(),
    set: iso => { t = Date.parse(iso); },
    advance: ms => { t += ms; },
  };
}

export interface Res<T = any> { status: number; body: T; headers: Record<string, unknown> }

export class Client {
  private cookie = '';
  readonly app: FastifyInstance;
  constructor(app: FastifyInstance) { this.app = app; }

  async request<T = any>(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, opts: { key?: string | null; origin?: string | null } = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { host: `127.0.0.1:${PORT}` };
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    if (this.cookie) headers.cookie = this.cookie;
    if (method !== 'GET' && opts.key !== null) headers['idempotency-key'] = opts.key ?? randomUUID();
    const res = await this.app.inject({ method, url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    const setCookie = res.headers['set-cookie'];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (first) this.cookie = first.split(';')[0]!;
    return { status: res.statusCode, body: (res.body ? res.json() : null) as T, headers: res.headers };
  }

  get<T = any>(url: string) { return this.request<T>('GET', url); }
  post<T = any>(url: string, body: unknown = {}, opts: { key?: string | null; origin?: string | null } = {}) { return this.request<T>('POST', url, body, opts); }
  patch<T = any>(url: string, body: unknown, opts: { key?: string | null } = {}) { return this.request<T>('PATCH', url, body, opts); }

  async login(user: { username: string; password: string }): Promise<void> {
    const res = await this.post('/api/auth/login', { username: user.username, password: user.password }, { key: null });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export interface TestEnv {
  dir: string; db: Db; app: FastifyInstance; config: AppConfig; clock: TestClock; backup: BackupService;
  owner: Client; cashier: Client; anon: Client;
  newClient(): Client;
  /** จำลองการปิด process แล้วเปิดใหม่บนไฟล์ฐานข้อมูลเดิม */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export async function createEnv(opts: { target?: UploadTarget | null; seedUsers?: boolean } = {}): Promise<TestEnv> {
  clearFaults();
  const dir = mkdtempSync(join(tmpdir(), 'pos-test-'));
  const clock = testClock();
  const config: AppConfig = { ...loadConfig({ POS_DATA_DIR: dir }), port: PORT, webDist: join(dir, 'no-web') };
  const env = {} as TestEnv;
  async function boot(): Promise<void> {
    env.db = openDb(config.dbPath);
    migrate(env.db, clock.now);
    env.backup = new BackupService({ db: env.db, backupDir: config.backupDir, intervalMinutes: 15, target: opts.target ?? null, now: clock.now });
    env.app = await buildApp({ db: env.db, config, clock: clock.now, backup: env.backup });
    env.owner = new Client(env.app);
    env.cashier = new Client(env.app);
    env.anon = new Client(env.app);
  }
  await boot();
  Object.assign(env, {
    dir, config, clock,
    newClient: () => new Client(env.app),
    restart: async () => {
      await env.app.close();
      await env.backup.stop();
      env.db.close();
      await boot();
      await env.owner.login(OWNER);
      await env.cashier.login(CASHIER).catch(() => {});
    },
    close: async () => {
      clearFaults();
      await env.app.close();
      await env.backup.stop();
      env.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  });
  if (opts.seedUsers !== false) {
    const setup = await env.anon.post('/api/setup/owner', OWNER, { key: null });
    if (setup.status !== 201) throw new Error(JSON.stringify(setup.body));
    await env.owner.login(OWNER);
    const created = await env.owner.post('/api/users', { ...CASHIER, role: 'cashier' });
    if (created.status !== 201) throw new Error(JSON.stringify(created.body));
    await env.cashier.login(CASHIER);
  }
  return env;
}

export async function createProduct(c: Client, input: { sku: string; name?: string; price: number; openingQuantity?: number; barcode?: string }) {
  const res = await c.post('/api/products', { name: input.sku, ...input });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string; price: number; onHand: number };
}

export async function openShift(c: Client, openingCash = 100000) {
  const res = await c.post('/api/shifts', { openingCash });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string };
}

export function count(db: Db, table: string, where = '1 = 1', ...params: unknown[]): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params) as { n: number }).n;
}

export function onHand(db: Db, productId: string): number {
  return (db.prepare('SELECT on_hand FROM inventory_balances WHERE product_id = ?').get(productId) as { on_hand: number }).on_hand;
}
