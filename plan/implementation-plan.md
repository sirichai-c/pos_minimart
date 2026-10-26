# Implementation plan: POS จาก mockup สู่ระบบขายจริง

วันที่: 26 ต.ค. 2026 · ฉบับ 0.1 · สถานะ: ฉบับเสนอสำหรับทบทวนก่อนเริ่มสร้างระบบ

เอกสารนี้คือ implementation plan ตามที่ [สเปก MVP ส่วน 10](pos-mvp-spec.md) กำหนดไว้เป็นขั้นถัดไป ระบุโครงไฟล์ interfaces งานย่อย และคำสั่งตรวจรับของ milestone M1–M6 ส่วนเกณฑ์ "ผ่านเมื่อ" และประตูตัดสินใจก่อนใช้ขายจริงยังอยู่ที่ [production-readiness.md](production-readiness.md) เอกสารนี้ไม่ได้แทนที่

## 1. หลักการ

1. **ทำ MVP ขายเงินสดให้ใช้จริงได้ก่อน** (M1–M6) แล้วจึงย้ายโมดูลขยาย 1–6 ทีละโมดูลหลังเปิดใช้งาน
2. **พิสูจน์ transaction core ก่อน UI** checkout แบบ idempotent ต้องผ่าน A01–A07 ด้วย API/SQLite จริงก่อนเริ่มทำหน้ากะ รายงาน หรือหน้าจัดการอื่น
3. **ระบบจริงเขียนใหม่ ไม่ต่อยอด mockup โดยตรง** mockup เก็บ state ทั้งก้อนใน `localStorage` จึงย้ายมาใช้ไม่ได้ แต่ใช้ส่วนเหล่านี้ต่อได้:
   - กติกาใน `mockup/assets/js/store.js` (`parseMoney`, `money`, `canonical`, `dateKey`, การตรวจ safe integer และรหัส error) ย้ายไป `packages/domain` เป็น TypeScript
   - กรณีทดสอบใน `mockup/*.test.cjs` ใช้เป็นต้นแบบ unit/integration tests
   - CSS และเลย์เอาต์ภาษาไทยใน `mockup/assets/css/` ใช้เป็นฐานของ React components
   - เก็บ `mockup/` ไว้เป็นต้นแบบ UX ไม่ลบ และไม่ให้ระบบจริงอ้างอิงไฟล์ในโฟลเดอร์นี้
4. **API เป็นผู้เขียนฐานข้อมูลเพียงตัวเดียว** ทุกคำสั่งเขียนผ่าน `db.transaction(...).immediate()` ของ better-sqlite3 ซึ่งทำงานแบบ synchronous ใน process เดียว จึงเรียงคำขอที่ชนกันได้โดยไม่ต้องมี lock เพิ่ม

## 2. สิ่งที่ต้องตัดสินใจใน M1 ก่อนงานที่ขึ้นกับข้อนั้น

| ID | คำถาม | กระทบงาน | ค่าที่ใช้วางแผนไปก่อน |
| --- | --- | --- | --- |
| D1 | OS และรุ่นเครื่องร้าน | T2.8 service, T6.x ติดตั้ง | Windows 11, Node 24.x |
| D2 | scanner, printer, ลิ้นชักเงิน | T3.7 ใบเสร็จ, T6.3 | scanner แบบคีย์บอร์ด, browser print กระดาษ 80 มม. |
| D3 | จำนวนเครื่องขาย | สถาปัตยกรรมทั้งหมด | 1 เครื่อง bind เฉพาะ loopback |
| D4 | ต้องรับ QR/พร้อมเพย์ตั้งแต่วันแรกไหม | T3.x payments | เงินสดอย่างเดียว |
| D5 | ปลายทาง cloud backup | T5.3 | object storage แบบ S3-compatible |
| D6 | วิธีขายฉุกเฉินเมื่อเครื่องหลักเสีย | runbook M5 | จดมือแล้วบันทึกย้อนหลังหลัง restore |
| D7 | ต้องใช้คืนสินค้าบางรายการ/ข้ามกะตั้งแต่ pilot ไหม | ลำดับระยะ 3 | ไม่จำเป็น ใช้ void ทั้งบิล |

งาน M2 ข้อ T2.1–T2.7 เริ่มได้ก่อนได้คำตอบ เพราะสเปกยืนยันชุดเทคโนโลยีไว้แล้ว

## 3. โครงโปรเจกต์

ใช้ npm workspaces ในโฟลเดอร์ราก

```text
package.json                 workspaces + สคริปต์รวม (ส่วน 8)
tsconfig.base.json
.nvmrc                       24.x
apps/
  server/
    src/
      main.ts                เริ่ม Fastify, เปิด DB, รัน migrations, serve web build
      config.ts              path ฐานข้อมูล, port, โฟลเดอร์ backup (อ่านจาก env/ไฟล์ config)
      db/
        connection.ts        เปิด SQLite + PRAGMA
        migrate.ts           รัน migrations/*.sql ตามเลข บันทึกใน schema_migrations
        tx.ts                writeTx(), idempotent() helper
      http/
        errors.ts            AppError + error handler → { error: { code, message } }
        auth-hooks.ts        โหลด session, requireRole(), ตรวจ Origin/Host
      modules/
        auth/     routes.ts service.ts repo.ts
        users/    routes.ts service.ts repo.ts
        catalog/  routes.ts service.ts repo.ts
        inventory/routes.ts service.ts repo.ts
        shifts/   routes.ts service.ts repo.ts
        sales/    routes.ts service.ts repo.ts
        reports/  routes.ts service.ts
        audit/    routes.ts repo.ts
        backup/   routes.ts scheduler.ts snapshot.ts uploader.ts
        system/   routes.ts
      testing/
        faults.ts            fault injection เปิดได้เฉพาะ NODE_ENV=test
    migrations/
      0001_core.sql
      0002_...sql
  web/
    index.html
    src/
      main.tsx
      api/client.ts          fetch wrapper, แปลง error code, ใส่ Idempotency-Key
      state/checkout.ts      state machine ของ checkout + เก็บคำขอค้าง
      pages/                 Setup, Login, Sale, Bills, BillDetail, Products,
                             Inventory, Shift, Reports, Users, Audit, System
      components/            Receipt, MoneyInput, ProductSearch, ConfirmDialog
      styles/                ย้ายจาก mockup/assets/css
packages/
  domain/src/                กติกาที่ไม่ทำ I/O (ส่วน 5.1)
  contracts/src/             TypeBox schemas ของ request/response ใช้ร่วม server/web
tests/
  integration/               Vitest + SQLite จริงในโฟลเดอร์ชั่วคราว
  acceptance/                A01–A16 แยกไฟล์ละกรณี
  e2e/                       Playwright บน production build
  bench/                     สร้างข้อมูล 10,000 สินค้า/100,000 บิล แล้ววัด p95
scripts/
  install-service.ps1        ติดตั้ง/ถอน service (ขึ้นกับ D1)
  seed-demo.ts               ข้อมูลตัวอย่างสำหรับ dev เท่านั้น
docs/runbooks/               restore, upgrade, ขายฉุกเฉิน, ปิดกะ
mockup/                      คงเดิม
```

**Dependencies ที่เสนอ:** `fastify`, `@fastify/static`, `@fastify/cookie`, `@sinclair/typebox`, `better-sqlite3`, `@node-rs/argon2` (มี prebuilt binary ไม่ต้อง compile บน Windows), `react`, `react-dom`, `vite`, `vitest`, `@playwright/test`, `typescript`, `tsx` ตรึงเวอร์ชันด้วย `package-lock.json` และทดสอบติดตั้งบนเครื่องเป้าหมายใน T2.1

## 4. ข้อตกลงร่วม

| เรื่อง | ข้อตกลง |
| --- | --- |
| เงิน | `Satang` = จำนวนเต็มสตางค์ (`number` ที่ผ่าน `Number.isSafeInteger`); เก็บใน SQLite เป็น `INTEGER`; แปลงเป็นบาทเฉพาะตอนแสดงผล |
| จำนวนสินค้า | จำนวนเต็ม; ขายต้อง ≥ 1 |
| ID | UUID v4 เป็น `TEXT`; เลขบิล `POS1-` + UUID ตัดขีด |
| เวลา | เก็บ ISO 8601 UTC (`2026-10-26T07:15:00.000Z`); จัดกลุ่มวันตาม `Asia/Bangkok` ด้วย `bangkokDateKey()` |
| request key | header `Idempotency-Key: <uuid>` บังคับกับทุก `POST` ที่เปลี่ยนข้อมูลธุรกิจ |
| error | HTTP status + `{ "error": { "code": "PRICE_CHANGED", "message": "...", "details": {...} } }`; ข้อความภาษาไทยสำหรับผู้ใช้ |
| audit | ทุกคำสั่งเขียนสร้าง `audit_events` ใน transaction เดียวกัน; ห้ามมีรหัสผ่าน token หรือ secret ใน payload |

**รหัส error ชุดแรก**

| HTTP | code | เมื่อ |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | body/query ไม่ตรง schema |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | ไม่มี header หรือไม่ใช่ UUID |
| 401 | `UNAUTHENTICATED` | ไม่มี session หรือหมดอายุ |
| 403 | `FORBIDDEN` | บทบาทไม่พอ หรือ Origin ไม่ใช่ UI ของแอป |
| 404 | `NOT_FOUND` | ไม่พบทรัพยากร |
| 409 | `IDEMPOTENCY_CONFLICT` | key เดิมแต่ payload hash ต่าง |
| 409 | `PRICE_CHANGED` | `expectedUnitPrice` ไม่ตรงราคาปัจจุบัน (`details` มีราคาใหม่) |
| 409 | `INSUFFICIENT_STOCK` | คงเหลือไม่พอ (`details` มีคงเหลือปัจจุบัน) |
| 409 | `NO_OPEN_SHIFT` / `SHIFT_ALREADY_OPEN` / `SHIFT_CLOSED` | สถานะกะไม่ตรง |
| 409 | `ALREADY_VOIDED` / `VOID_NOT_ALLOWED` | void ซ้ำหรือผิดเงื่อนไข R04 |
| 409 | `DUPLICATE_SKU` / `DUPLICATE_BARCODE` | ข้อมูลสินค้าซ้ำ |
| 422 | `TENDER_TOO_LOW` / `AMOUNT_OVERFLOW` / `PRODUCT_INACTIVE` | ผิดกติกา R01–R02 |
| 429 | `TOO_MANY_ATTEMPTS` | ล็อกอินผิดเกินกำหนด |
| 503 | `DB_BUSY` / `STORAGE_FAILURE` | SQLite busy หรือเขียนดิสก์ไม่ได้; ไม่ commit และลองด้วย key เดิมได้ |

## 5. Interfaces

### 5.1 `packages/domain`

```ts
// money.ts
export type Satang = number;
export function assertSatang(value: number, label: string): Satang;      // AMOUNT_OVERFLOW / VALIDATION_FAILED
export function parseBaht(input: string): Satang;                        // "1,234.5" → 123450
export function formatBaht(value: Satang): string;                       // 123450 → "1,234.50"
export function sumSatang(values: readonly Satang[]): Satang;            // ตรวจ safe integer ทุกขั้น

// cart.ts
export interface CartLineInput { productId: string; quantity: number; expectedUnitPrice: Satang }
export interface ProductForSale { id: string; sku: string; name: string; price: Satang; active: boolean; onHand: number }
export interface PricedLine { productId: string; sku: string; name: string; unitPrice: Satang; quantity: number; lineTotal: Satang }
export function priceCart(lines: readonly CartLineInput[], products: ReadonlyMap<string, ProductForSale>):
  { lines: PricedLine[]; total: Satang };                                // PRICE_CHANGED, INSUFFICIENT_STOCK, PRODUCT_INACTIVE
export function changeFor(total: Satang, tendered: Satang): Satang;      // TENDER_TOO_LOW

// shift.ts
export interface ShiftTotals { opening: Satang; gross: Satang; voids: Satang; refunds: Satang; cashIn: Satang; cashOut: Satang }
export function expectedCash(t: ShiftTotals): Satang;                    // opening + gross − voids − refunds + cashIn − cashOut
export function cashVariance(counted: Satang, expected: Satang): Satang;

// identity.ts
export function canonicalJson(value: unknown): string;                  // key เรียงลำดับ ตัด undefined
export function payloadHash(value: unknown): string;                     // sha256 hex ของ canonicalJson
export function billNumber(saleId: string): string;                      // "POS1-" + uuid ไม่มีขีด
export function normalizeSku(input: string): string;                     // trim + uppercase

// time.ts
export function bangkokDateKey(utcIso: string): string;                  // "2026-10-26"
```

`refunds` ใน `ShiftTotals` เป็น 0 จนกว่าจะทำโมดูลคืนสินค้า เพื่อไม่ต้องเปลี่ยน signature ทีหลัง

### 5.2 Transaction และ idempotency (`apps/server/src/db/tx.ts`)

```ts
export type Db = import('better-sqlite3').Database;
export interface RequestContext { userId: string; role: 'owner' | 'cashier'; sessionId: string; now: string }

// เปิด BEGIN IMMEDIATE; ถ้า throw จะ rollback ทั้งหมด
export function writeTx<T>(db: Db, fn: (db: Db) => T): T;

// ขั้นตอน: หา key → มีและ hash ตรง: คืน response เดิม (ไม่ตรวจราคา/สต๊อกใหม่ตาม R03)
//          → มีแต่ hash ต่าง: IDEMPOTENCY_CONFLICT
//          → ไม่มี: เรียก fn แล้ว insert idempotency_requests พร้อม response ใน transaction เดียวกัน
export function idempotent<T>(db: Db, ctx: RequestContext, args: {
  key: string; scope: string; payload: unknown; fn: (db: Db) => T;
}): { replayed: boolean; result: T };
```

`faults.ts` เปิดจุดล้มเหลว `before-commit`, `after-commit-before-response`, `disk-full` ผ่าน env `POS_FAULT` เฉพาะตอน `NODE_ENV=test` ใช้ใน A02, A03, A15

### 5.3 Schema หลัก (`migrations/0001_core.sql`)

ตัวอย่างโครงตารางและ constraint หลัก รายละเอียดคอลัมน์ปรับได้ระหว่าง T2.3 แต่ข้อผูกพันในคอมเมนต์ต้องคงไว้

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner','cashier')),
  password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,                       -- เก็บ hash ของ token ไม่เก็บ token
  user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE products (
  id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, barcode TEXT UNIQUE,
  name TEXT NOT NULL, price INTEGER NOT NULL CHECK (price >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE inventory_balances (
  product_id TEXT PRIMARY KEY REFERENCES products(id),
  on_hand INTEGER NOT NULL CHECK (on_hand >= 0),  -- ห้ามติดลบ (R02)
  version INTEGER NOT NULL DEFAULT 0              -- ใช้ต่อใน M4S ตรวจนับ
);
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL CHECK (kind IN ('opening','receipt','adjustment','sale','void')),
  quantity INTEGER NOT NULL CHECK (quantity <> 0),            -- บวกเข้า ลบออก
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  source_type TEXT NOT NULL, source_id TEXT NOT NULL, reason TEXT,
  user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE shifts (
  id TEXT PRIMARY KEY, opened_by TEXT NOT NULL REFERENCES users(id), opened_at TEXT NOT NULL,
  opening_cash INTEGER NOT NULL CHECK (opening_cash >= 0),
  closed_by TEXT REFERENCES users(id), closed_at TEXT,
  expected_cash INTEGER, counted_cash INTEGER, variance INTEGER, close_snapshot TEXT
);
CREATE UNIQUE INDEX one_open_shift ON shifts((1)) WHERE closed_at IS NULL;  -- เปิดได้หนึ่งกะ
CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shifts(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount INTEGER NOT NULL CHECK (amount > 0), reason TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE sales (
  id TEXT PRIMARY KEY, bill_no TEXT NOT NULL UNIQUE, shift_id TEXT NOT NULL REFERENCES shifts(id),
  cashier_id TEXT NOT NULL REFERENCES users(id),
  total INTEGER NOT NULL CHECK (total >= 0), created_at TEXT NOT NULL
);
CREATE TABLE sale_items (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), line_no INTEGER NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL, name TEXT NOT NULL,                          -- snapshot ขณะขาย
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0), quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total INTEGER NOT NULL CHECK (line_total = unit_price * quantity),
  UNIQUE (sale_id, line_no)
);
CREATE TABLE payments (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id),
  method TEXT NOT NULL CHECK (method = 'cash'),
  tendered INTEGER NOT NULL, change INTEGER NOT NULL CHECK (change >= 0), amount INTEGER NOT NULL
);
CREATE TABLE sale_voids (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id),   -- void ได้ครั้งเดียว
  shift_id TEXT NOT NULL REFERENCES shifts(id), amount INTEGER NOT NULL,
  reason TEXT NOT NULL, approved_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE idempotency_requests (
  key TEXT PRIMARY KEY, scope TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  payload_hash TEXT NOT NULL, status_code INTEGER NOT NULL, response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL, user_id TEXT REFERENCES users(id), data_json TEXT, created_at TEXT NOT NULL
);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('interval','shift_close','daily','manual')),
  started_at TEXT NOT NULL, finished_at TEXT, file_name TEXT, size_bytes INTEGER, sha256 TEXT,
  schema_version INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('running','ok','failed')),
  error TEXT, uploaded_at TEXT, upload_attempts INTEGER NOT NULL DEFAULT 0, upload_error TEXT
);
```

PRAGMA ทุก connection: `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`

### 5.4 HTTP API

ทุก path ขึ้นต้น `/api` ทุก request ต้องมี session ยกเว้นที่ระบุ ทุก `POST`/`PATCH` ที่มี ✓ ในคอลัมน์ key ต้องส่ง `Idempotency-Key`

| Method & path | สิทธิ์ | key | หน้าที่ |
| --- | --- | :---: | --- |
| `GET /setup/status` | ไม่ต้องล็อกอิน | | `{ needsOwner: boolean }` |
| `POST /setup/owner` | ไม่ต้องล็อกอิน, ใช้ได้เฉพาะยังไม่มี owner | | สร้าง owner คนแรก |
| `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` | — | | session cookie `HttpOnly; SameSite=Strict` |
| `GET /users` · `POST /users` · `PATCH /users/:id` | owner | ✓ (POST) | จัดการ cashier, ปิดบัญชี, รีเซ็ตรหัส |
| `GET /products?q=&barcode=&active=` | ทุกคน | | ค้นด้วยชื่อ/SKU/บาร์โค้ด พร้อมคงเหลือ |
| `POST /products` · `PATCH /products/:id` | owner | ✓ | เพิ่ม/แก้ราคา/ปิดจำหน่าย; audit การแก้ราคา |
| `POST /inventory/receipts` | owner | ✓ | `{ productId, quantity, reason }` |
| `POST /inventory/adjustments` | owner | ✓ | `{ productId, countedQuantity, reason }` คำนวณส่วนต่างจาก balance ตอนเขียน |
| `GET /inventory/:productId/movements` | owner | | ประวัติ movement |
| `GET /shifts/current` | ทุกคน | | กะที่เปิดอยู่หรือ `null` |
| `POST /shifts` | ทุกคน | ✓ | `{ openingCash }` |
| `POST /shifts/:id/cash-movements` | owner | ✓ | `{ direction, amount, reason }` |
| `POST /shifts/:id/close` | ทุกคน | ✓ | `{ countedCash }` → snapshot; ปิดซ้ำคืนผลเดิม |
| `POST /sales` | ทุกคน | ✓ | checkout (ด้านล่าง) |
| `GET /sales?shiftId=&date=` · `GET /sales/:id` | ทุกคน | | รายการบิล/ใบเสร็จสำหรับพิมพ์ซ้ำ |
| `POST /sales/:id/void` | owner | ✓ | `{ reason, cashReturned: true, goodsReturned: true }` |
| `GET /requests/:key` | เจ้าของคำขอหรือ owner | | กู้ผลคำขอ: 200 + ผลเดิม หรือ 404 (ยังไม่ commit ส่งซ้ำด้วย key เดิมได้) |
| `GET /reports/shifts/:id` · `GET /reports/daily?date=` | owner (cashier ดูกะตัวเองได้) | | ยอดขาย ยกเลิก สุทธิ เงินสด |
| `GET /audit-events?entityType=&from=&to=` | owner | | audit |
| `GET /system/status` | owner | | เวอร์ชัน schema, ดิสก์ว่าง, backup ล่าสุด, งาน upload ค้าง |
| `GET /backups` · `POST /backups` | owner | ✓ (POST) | ดูประวัติ / สั่ง snapshot ทันที |

**Checkout**

```ts
// POST /api/sales   Idempotency-Key: <uuid>
interface CheckoutRequest {
  items: { productId: string; quantity: number; expectedUnitPrice: Satang }[];  // 1–200 รายการ
  tendered: Satang;
}
interface SaleResponse {
  id: string; billNo: string; shiftId: string; cashierId: string; createdAt: string;
  items: PricedLine[]; total: Satang; tendered: Satang; change: Satang;
  voided: null | { reason: string; approvedBy: string; createdAt: string };
}
// 201 สร้างใหม่ · 200 คืนผลเดิมจาก key เดิม (header Idempotent-Replayed: true)
```

ลำดับใน transaction: `idempotent()` → ตรวจกะเปิด → อ่านสินค้า+balance → `priceCart()` → `changeFor()` → insert `sales`, `sale_items`, `payments` → update balance + insert `stock_movements` → `audit_events` → บันทึกผล idempotency

### 5.5 Web checkout state

```ts
type CheckoutState =
  | { kind: 'draft'; cart: CartLineInput[] }
  | { kind: 'submitting'; key: string; payload: CheckoutRequest }
  | { kind: 'confirmed'; sale: SaleResponse }
  | { kind: 'unresolved'; key: string; payload: CheckoutRequest; lastError: string }
  | { kind: 'price_changed'; cart: CartLineInput[]; changes: { productId: string; oldPrice: Satang; newPrice: Satang }[] };
```

- เก็บ `{ key, payload }` ลง `localStorage` **ก่อน** ส่งคำขอ และลบหลังได้ผลยืนยัน
- เมื่อเปิดหน้าขายแล้วพบคำขอค้าง ให้เข้า `unresolved` เรียก `GET /requests/:key` ก่อน ห้ามเริ่มบิลใหม่จนกว่าจะรู้ผลหรือผู้ขายส่งซ้ำด้วย key เดิม
- `PRICE_CHANGED` ให้ผู้ขายกดยืนยันราคาใหม่ แล้วสร้าง key ใหม่ เพราะ payload เปลี่ยน

## 6. งานย่อย

แต่ละงานถือว่าเสร็จเมื่อโค้ด test และคำสั่งตรวจในคอลัมน์สุดท้ายผ่าน งานในแต่ละ milestone เรียงตามลำดับที่ควรทำ

### M1 — ยืนยันกติกาและเครื่องเป้าหมาย (1–2 วัน)

| ID | งาน | ส่งมอบ / ตรวจ |
| --- | --- | --- |
| T1.1 | สัมภาษณ์เจ้าของร้านตาม D1–D7 และงาน M1 ใน production-readiness | ตารางส่วน 2 มีคำตอบครบ |
| T1.2 | ทำตัวอย่างบิล เงินกะ และสต๊อกด้วยตัวเลขจริงของร้าน | ไฟล์ `tests/acceptance/fixtures/shop-examples.json` ที่เจ้าของรับรอง |
| T1.3 | ปรับสเปกและประมาณการตามคำตอบ | อัปเดต `pos-mvp-spec.md` และส่วน 2 ของเอกสารนี้ |

### M2 — ฐานระบบ local บัญชี สินค้า และสต๊อก (3–5 วัน)

| ID | งาน | ส่งมอบ / ตรวจ |
| --- | --- | --- |
| T2.1 | สร้าง workspaces, tsconfig, ESLint, Vitest, Playwright, สคริปต์ส่วน 8; ทดลอง `npm ci` บนเครื่องเป้าหมาย (better-sqlite3, argon2) | `npm ci && npm run typecheck && npm run lint` ผ่านบนเครื่อง dev และเครื่องร้าน |
| T2.2 | `packages/domain` ตามส่วน 5.1 พร้อม port test จาก `mockup/store.test.cjs` ที่เกี่ยวกับเงิน/วันที่/canonical | `npm run test:unit` |
| T2.3 | `connection.ts`, `migrate.ts`, `0001_core.sql`; test ว่า PRAGMA ถูกต้องและ constraint ป้องกัน stock ติดลบ/เปิดสองกะ/void ซ้ำ | `npm run test:integration -- db` |
| T2.4 | `tx.ts` (`writeTx`, `idempotent`), `errors.ts`, `faults.ts` | `npm run test:integration -- idempotency` |
| T2.5 | setup owner, login/logout, session, จำกัดการลองล็อกอิน, `requireRole`, ตรวจ Origin | `npm run test:integration -- auth`; cashier เรียก owner API แล้วได้ 403 |
| T2.6 | catalog + inventory API (receipts, adjustments, movements) พร้อม audit | `npm run test:integration -- catalog inventory`; ผลรวม movement = balance ทุกสินค้า |
| T2.7 | web: Setup, Login, Products, Inventory เชื่อม API จริง; ย้าย CSS จาก mockup | `npm run test:e2e -- setup products` |
| T2.8 | production build + service เริ่มเองหลังเปิดเครื่อง (ตาม D1) | restart เครื่องโดยตัด WAN แล้วเปิด `http://127.0.0.1:<port>/` ล็อกอินได้ |

### M3 — การขายเงินสดที่บันทึกได้ครั้งเดียว (4–7 วัน)

| ID | งาน | ส่งมอบ / ตรวจ |
| --- | --- | --- |
| T3.1 | เปิดกะขั้นต่ำ (`POST /shifts`, `GET /shifts/current`) เพื่อให้ checkout ผูกกะได้ | `npm run test:integration -- shifts` |
| T3.2 | `POST /sales` ตามส่วน 5.4 | `npm run test:acceptance -- A01 A04 A05 A06` |
| T3.3 | `GET /requests/:key` และการคืนผลเดิมโดยไม่ตรวจราคา/สต๊อกใหม่ | `npm run test:acceptance -- A03` |
| T3.4 | fault tests: kill process ก่อน commit, หลัง commit, ดิสก์เต็ม | `npm run test:acceptance -- A02 A15` |
| T3.5 | web Sale page: ค้นหา/สแกน, ตะกร้า, รับเงิน, state machine ส่วน 5.5 | `npm run test:e2e -- checkout` รวมกรณี reload ระหว่าง submitting |
| T3.6 | Bills / BillDetail และใบเสร็จพิมพ์ซ้ำ | `npm run test:acceptance -- A07`; `npm run test:e2e -- reprint` |
| T3.7 | ทดลอง scanner และ printer จริง (ตาม D2) | บันทึกผลใน `docs/device-tests.md` |

### M4 — กะ ยกเลิกบิล รายงาน และ audit (3–5 วัน)

| ID | งาน | ส่งมอบ / ตรวจ |
| --- | --- | --- |
| T4.1 | เงินนำเข้า/ออก | `npm run test:acceptance -- A16` |
| T4.2 | ปิดกะพร้อม snapshot, ปิดซ้ำคืนผลเดิม, ขายชนปิดกะ | `npm run test:acceptance -- A09 A10` |
| T4.3 | void ตาม R04 | `npm run test:acceptance -- A08 A14` |
| T4.4 | รายงานกะและรายวัน (Asia/Bangkok, กะคร่อมเที่ยงคืน) | `npm run test:integration -- reports` รวมกรณี 23:50–00:10 |
| T4.5 | หน้า Shift, Reports, Users, Audit | `npm run test:e2e -- shift-close void reports` |

### M5 — Backup, restore และการรับมือเหตุขัดข้อง (3–5 วัน)

| ID | งาน | ส่งมอบ / ตรวจ |
| --- | --- | --- |
| T5.1 | `snapshot.ts` ผ่าน `db.backup()` + manifest (app/schema version, เวลา, sha256) | `npm run test:integration -- backup` เปิดไฟล์ snapshot แล้ว `PRAGMA integrity_check` = ok |
| T5.2 | `scheduler.ts` ทุก 15 นาที + หลังปิดกะ + retention 48 ชม./30 วัน | test ด้วยนาฬิกาจำลอง |
| T5.3 | `uploader.ts` (ตาม D5) คิว + retry แบบ backoff ไม่ขวางการขาย; credentials ไม่อยู่ใน snapshot | `npm run test:acceptance -- A12` ด้วย endpoint จำลองที่ล้ม |
| T5.4 | สำเนาลงสื่อที่สอง (ถ้า D6 ต้องการ) | ทดสอบอ่านสำเนากลับได้ |
| T5.5 | `npm run restore -- <snapshot>`: maintenance mode, เก็บ DB เดิม, ตรวจ checksum/schema, กู้ลงตำแหน่งใหม่, ล้าง sessions | `npm run test:acceptance -- A13` |
| T5.6 | หน้า System แสดงเวลา snapshot/upload ล่าสุด งานค้าง และ error จริง | `npm run test:e2e -- system-status` |
| T5.7 | runbook restore, upgrade/rollback, ขายฉุกเฉินใน `docs/runbooks/` | ซ้อม restore บนเครื่องสะอาดและจับเวลา (เป้าหมาย RTO ≤ 2 ชม.) |

### M6 — ตรวจรับบนเครื่องร้านและเปิด pilot (4–7 วัน)

| ID | งาน | ส่งมอบ / ตรวจ |
| --- | --- | --- |
| T6.1 | รัน acceptance ครบ A01–A16 บน production build | `npm run test:acceptance` เก็บรายงานใน `docs/test-reports/` |
| T6.2 | benchmark 10,000 สินค้า/100,000 บิล ขณะ backup ทำงาน | `npm run bench`: p95 ค้นหา < 300 ms, checkout < 1 s |
| T6.3 | cold start ตัด WAN บนเครื่องร้าน (A11) | checklist ลงชื่อผู้ทดสอบ |
| T6.4 | คู่มือผู้ขาย/เจ้าของร้าน | `docs/manual-th.md` |
| T6.5 | pilot อย่างน้อย 1 วันทำการ แล้วกระทบยอดเงิน บิล สต๊อก | รายงาน pilot + ลงชื่อเจ้าของตามประตูตัดสินใจใน production-readiness |

## 7. ระยะ 3: โมดูลขยายหลังเปิดใช้ MVP

ทำทีละโมดูลตามลำดับที่ต้องพึ่งกัน แต่ละโมดูลใช้แบบเดียวกัน: migration ใหม่ → service + API ผ่าน `idempotent()` → test ตามกรณีตรวจรับในสเปกโมดูล → หน้าจอ → ทดลองกับข้อมูลจริง

| ลำดับ | โมดูล | milestone | ขึ้นกับ | กรณีตรวจรับ |
| --- | --- | --- | --- | --- |
| 1 | คืนสินค้าและคืนเงินสด | M4R | MVP; ใช้ `refunds` ใน `expectedCash()` | RT01–RT10 ใน [สเปกคืนสินค้า](pos-returns-refunds-spec.md) |
| 2 | จัดซื้อและรับสินค้า | M4P | MVP; แทน `POST /inventory/receipts` แบบไม่มี PO | [สเปกจัดซื้อ](pos-purchasing-receiving-spec.md) |
| 3 | ตรวจนับสต๊อก | M4S | `inventory_balances.version` | SC01–SC09 ใน [สเปกตรวจนับ](pos-stock-count-spec.md) |
| 4 | กำไรขั้นต้น FIFO | M4G (ต้องเพิ่ม) | ราคาทุนจากใบรับใน M4P | [สเปกกำไรขั้นต้น](pos-gross-profit-spec.md) |
| 5 | ออเดอร์และจองสินค้า | M4O (ต้องเพิ่ม) | ยอดขายได้ = คงเหลือ − ยอดจอง; ต้องแก้ `priceCart()` | [สเปกออเดอร์](pos-orders-reservations-spec.md) |
| 6 | สมาชิกและแต้ม | M4L (ต้องเพิ่ม) | checkout รับ `memberId`/`redeemPoints`; ต้องทบทวน PDPA เรื่องเบอร์โทร | [สเปกสมาชิก](pos-membership-points-spec.md) |

M4G, M4O และ M4L ยังไม่มีใน production-readiness ต้องเพิ่มรายการงานและเกณฑ์ "ผ่านเมื่อ" ในรูปแบบเดียวกับ M4R ก่อนเริ่มโมดูลนั้น ประมาณการ 18–31 วันในสเปกไม่รวมระยะนี้

## 8. คำสั่งตรวจรับ

สคริปต์ทั้งหมดสร้างใน T2.1 และรันจากโฟลเดอร์ราก ทุก test ใช้ฐานข้อมูลในโฟลเดอร์ชั่วคราว ไม่แตะข้อมูลร้าน

```powershell
npm ci                                   # ติดตั้งตาม lockfile
npm run typecheck                        # tsc --build ทุก workspace
npm run lint
npm run test:unit                        # packages/domain
npm run test:integration                 # API + SQLite จริง
npm run test:acceptance                  # A01–A16 (ระบุ ID ได้ เช่น -- A03 A05)
npm run build                            # web build + server bundle
npm run test:e2e                         # Playwright บน production build
npm run bench                            # 10,000 สินค้า / 100,000 บิล
npm run check                            # typecheck + lint + unit + integration + acceptance
```

คำสั่งดูแลระบบ (ใช้ใน runbook)

```powershell
npm run start:prod                       # เปิด server แบบ production ที่ 127.0.0.1
npm run migrate                          # รัน migrations ที่ค้าง (สำรองข้อมูลก่อนเสมอ)
npm run backup:now                       # สร้าง snapshot ทันที
npm run restore -- <snapshot-file>       # กู้คืนตาม runbook
```

**แผนผังกรณีตรวจรับกับไฟล์ test**

| กรณี | ไฟล์ | milestone |
| --- | --- | --- |
| A01, A04, A05, A06 | `tests/acceptance/checkout.test.ts` | M3 |
| A02, A03, A15 | `tests/acceptance/checkout-faults.test.ts` | M3 |
| A07 | `tests/acceptance/reprint.test.ts` | M3 |
| A08, A14 | `tests/acceptance/void.test.ts` | M4 |
| A09, A10 | `tests/acceptance/shift-close.test.ts` | M4 |
| A16 | `tests/acceptance/idempotent-writes.test.ts` | M4 |
| A12, A13 | `tests/acceptance/backup-restore.test.ts` | M5 |
| A11 | checklist บนเครื่องร้าน (ทำอัตโนมัติไม่ได้) | M6 |

## 9. ความเสี่ยงที่ต้องจัดการเร็ว

| ความเสี่ยง | จัดการใน |
| --- | --- |
| better-sqlite3 และ argon2 เป็น native module อาจติดตั้งไม่ได้บนเครื่องร้าน | T2.1 ทดสอบบนเครื่องจริงตั้งแต่วันแรก |
| browser print เลือกเครื่องพิมพ์อัตโนมัติไม่ได้ | T3.7; ถ้าร้านต้องการพิมพ์ทันทีต้องเพิ่ม scope |
| ร้านต้องใช้หลายเครื่องหรือ QR ตั้งแต่วันแรก | T1.1; ถ้าใช่ต้องปรับสถาปัตยกรรมก่อน M2 |
| ประมาณการรวมเฉพาะ MVP | ประเมินระยะ 3 ใหม่หลังจบ M6 |
