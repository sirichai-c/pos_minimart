// npm run bench — 10,000 สินค้า / 100,000 บิล แล้ววัด p95 ค้นหาและ checkout ขณะ backup ทำงาน (T6.2)
// ฐานข้อมูลอยู่ในโฟลเดอร์ชั่วคราว ไม่แตะข้อมูลร้าน
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { billNumber } from '@pos/domain';
import { buildApp } from '../apps/server/src/app.ts';
import { openDb } from '../apps/server/src/db/connection.ts';
import { migrate } from '../apps/server/src/db/migrate.ts';
import { loadConfig } from '../apps/server/src/config.ts';
import { BackupService } from '../apps/server/src/modules/backup/scheduler.ts';

const PRODUCTS = Number(process.env.BENCH_PRODUCTS ?? 10_000);
const SALES = Number(process.env.BENCH_SALES ?? 100_000);
const dir = mkdtempSync(join(tmpdir(), 'pos-bench-'));
const config = { ...loadConfig({ POS_DATA_DIR: dir }), webDist: join(dir, 'none') };
const db = openDb(config.dbPath);
migrate(db);

console.log(`สร้างข้อมูล ${PRODUCTS.toLocaleString()} สินค้า / ${SALES.toLocaleString()} บิล ใน ${dir}`);
const t0 = performance.now();
const now = new Date().toISOString();
const ownerId = randomUUID();
const shiftId = randomUUID();
db.transaction(() => {
  db.prepare("INSERT INTO users (id, username, display_name, role, password_hash, created_at) VALUES (?, 'bench', 'Bench', 'owner', 'x', ?)").run(ownerId, now);
  db.prepare('INSERT INTO shifts (id, opened_by, opened_at, opening_cash) VALUES (?, ?, ?, 0)').run(shiftId, ownerId, now);
  const p = db.prepare('INSERT INTO products (id, sku, barcode, name, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const b = db.prepare('INSERT INTO inventory_balances (product_id, on_hand) VALUES (?, ?)');
  const m = db.prepare("INSERT INTO stock_movements (id, product_id, kind, quantity, balance_after, source_type, source_id, user_id, created_at) VALUES (?, ?, 'opening', ?, ?, 'product', ?, ?, ?)");
  for (let i = 0; i < PRODUCTS; i++) {
    const id = randomUUID();
    p.run(id, `SKU-${String(i).padStart(6, '0')}`, String(8850000000000 + i), `สินค้าทดสอบ ${i} ${['น้ำดื่ม', 'กาแฟ', 'ขนม', 'สบู่', 'ข้าว'][i % 5]}`, 1000 + (i % 50) * 100, now, now);
    b.run(id, 1_000_000);
    m.run(randomUUID(), id, 1_000_000, 1_000_000, id, ownerId, now);
  }
})();
const productIds = (db.prepare('SELECT id, price FROM products').all() as { id: string; price: number }[]);
db.transaction(() => {
  const s = db.prepare('INSERT INTO sales (id, bill_no, shift_id, cashier_id, total, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const i = db.prepare('INSERT INTO sale_items (id, sale_id, line_no, product_id, sku, name, unit_price, quantity, line_total) VALUES (?, ?, 1, ?, ?, ?, ?, 1, ?)');
  const pay = db.prepare("INSERT INTO payments (id, sale_id, method, tendered, change, amount) VALUES (?, ?, 'cash', ?, 0, ?)");
  for (let n = 0; n < SALES; n++) {
    const id = randomUUID();
    const prod = productIds[n % productIds.length]!;
    s.run(id, billNumber(id), shiftId, ownerId, prod.price, now);
    i.run(randomUUID(), id, prod.id, 'SKU', 'bench', prod.price, prod.price);
    pay.run(randomUUID(), id, prod.price, prod.price);
  }
})();
console.log(`สร้างข้อมูลเสร็จใน ${((performance.now() - t0) / 1000).toFixed(1)} วินาที`);

let t = Date.now();
const clock = () => new Date(t++).toISOString();
const backup = new BackupService({ db, backupDir: config.backupDir, intervalMinutes: 15, target: null, now: clock });
const app = await buildApp({ db, config, clock, backup });

// session โดยตรง (ข้ามการ hash รหัสผ่านซึ่งไม่ใช่สิ่งที่วัด)
const { hashToken } = await import('../apps/server/src/http/auth-hooks.ts');
const token = 'bench-token';
db.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, '9999-01-01T00:00:00.000Z')").run(hashToken(token), ownerId, now);
const headers = { host: `127.0.0.1:${config.port}`, origin: `http://127.0.0.1:${config.port}`, cookie: `pos_session=${token}` };

const p95 = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;
async function measure(label: string, n: number, fn: (i: number) => Promise<number>) {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    const status = await fn(i);
    times.push(performance.now() - start);
    if (status >= 400) throw new Error(`${label} ล้มเหลว status ${status}`);
  }
  console.log(`${label.padEnd(28)} p95 ${p95(times).toFixed(1)} ms  (n=${n})`);
  return p95(times);
}

const backupRun = backup.snapshot('manual'); // วัดขณะ backup ทำงาน
const terms = ['กาแฟ', 'SKU-0042', 'ขนม 77', '8850000004321', 'สบู่'];
const search = await measure('ค้นหาสินค้า (q)', 300, async i =>
  (await app.inject({ method: 'GET', url: `/api/products?active=true&limit=60&q=${encodeURIComponent(terms[i % terms.length]!)}`, headers })).statusCode);
const scan = await measure('สแกนบาร์โค้ด (barcode)', 300, async i =>
  (await app.inject({ method: 'GET', url: `/api/products?active=true&barcode=${8850000000000 + (i * 7) % PRODUCTS}`, headers })).statusCode);
const checkout = await measure('checkout 3 รายการ', 300, async i => {
  const items = [0, 1, 2].map(k => { const p = productIds[(i * 3 + k) % productIds.length]!; return { productId: p.id, quantity: 1, expectedUnitPrice: p.price }; });
  const tendered = items.reduce((s, x) => s + x.expectedUnitPrice, 0);
  return (await app.inject({ method: 'POST', url: '/api/sales', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { items, tendered } })).statusCode;
});
const run = await backupRun;
console.log(`backup ระหว่างวัด: ${run.status} ${((run.sizeBytes ?? 0) / 1e6).toFixed(1)} MB`);

await app.close();
await backup.stop();
db.close();
rmSync(dir, { recursive: true, force: true });
const ok = Math.max(search, scan) < 300 && checkout < 1000;
console.log(ok ? 'ผ่านเป้าหมาย: ค้นหา p95 < 300 ms, checkout p95 < 1 s' : 'ไม่ผ่านเป้าหมาย');
process.exit(ok ? 0 : 1);
