# บ้านดี POS

ระบบขายหน้าร้านสำหรับร้านค้าปลีกแบบ local-first ระบบขาย ฐานข้อมูล และหน้าจออยู่บนเครื่องร้าน ขายเงินสดได้แม้ไม่มีอินเทอร์เน็ต และสำรองข้อมูลออกนอกเครื่องเมื่อพร้อม

โปรเจกต์มีสองส่วน

| ส่วน | สถานะ |
| --- | --- |
| **ระบบจริง (MVP)** ใน `apps/`, `packages/` | M2–M5 ตาม [implementation plan](plan/implementation-plan.md) พัฒนาแล้ว: บัญชี/สิทธิ์, สินค้า, สต๊อก, ขายเงินสดแบบ idempotent, ใบเสร็จ, กะ, ยกเลิกบิล, รายงาน, audit, backup/restore ยังไม่ผ่าน M1 (ยืนยันกับเจ้าของร้าน) และ M6 (pilot บนเครื่องร้าน) |
| **Mockup** ใน `mockup/` | หน้าเว็บตัวอย่าง 13 หน้าสำหรับทดลอง UX รวมโมดูลขยาย 1–6 ข้อมูลอยู่ใน `localStorage` คงไว้เป็นต้นแบบ ระบบจริงไม่อ้างอิงไฟล์ในโฟลเดอร์นี้ |

## เริ่มใช้ระบบจริง

ต้องมี Node.js 24.x จากโฟลเดอร์โปรเจกต์:

```powershell
npm ci
npm run build
npm run start:prod
```

แล้วเปิด [http://127.0.0.1:4180/](http://127.0.0.1:4180/) ครั้งแรกจะให้สร้างบัญชีเจ้าของร้าน (ไม่มีบัญชีเริ่มต้น) ข้อมูลอยู่ที่ `data/pos.db` และ snapshot อยู่ที่ `data/backups/` เปลี่ยนตำแหน่งได้ด้วย `POS_DATA_DIR`

ติดตั้งให้เริ่มเองเมื่อเปิดเครื่อง Windows (PowerShell แบบ administrator):

```powershell
.\scripts\install-service.ps1 -Install
```

ตั้งปลายทางสำเนานอกเครื่อง (เช่น USB หรือโฟลเดอร์ที่ซิงก์ขึ้น cloud) ด้วย `POS_UPLOAD_DIR` หรือไฟล์ `data/config.json`:

```json
{ "upload": { "kind": "directory", "path": "E:\\pos-backup" } }
```

### พัฒนา

```powershell
$env:POS_DATA_DIR = "data-dev"; $env:POS_EXTRA_ORIGINS = "http://127.0.0.1:5173"; npm run dev:server
npm run dev:web
npm run seed:demo -- <owner-username> <password>
```

### คำสั่งดูแลระบบ

| คำสั่ง | หน้าที่ |
| --- | --- |
| `npm run backup:now` | สร้าง snapshot ทันที (ใช้ได้ขณะ server ทำงาน) |
| `npm run migrate` | สำรองแล้วรัน migrations ที่ค้าง (หยุด server ก่อน) |
| `npm run restore -- <ไฟล์ snapshot>` | กู้คืนตาม [runbook](docs/runbooks/restore.md) (หยุด server ก่อน) |

Runbook อื่น: [อัปเกรด/ถอยกลับ](docs/runbooks/upgrade.md), [ขายฉุกเฉิน](docs/runbooks/emergency-sales.md), [ปิดกะ](docs/runbooks/shift-close.md)

## โครงสร้าง

| ตำแหน่ง | เนื้อหา |
| --- | --- |
| `packages/domain` | กติกาที่ไม่ทำ I/O: เงินสตางค์, `priceCart`, เงินทอน, เงินสดคาดหวัง, canonical JSON, เลขบิล, วันตาม Asia/Bangkok |
| `packages/contracts` | TypeBox schema ของ request และ type ของ response ใช้ร่วม server/web |
| `apps/server` | Fastify + better-sqlite3 รันด้วย Node 24 โดยตรง (type stripping ไม่ต้อง compile) |
| `apps/server/migrations` | SQL migrations พร้อม constraint/trigger: สต๊อกห้ามติดลบ, เปิดได้หนึ่งกะ, void ครั้งเดียว, บิล/audit/movement แก้ไม่ได้ |
| `apps/web` | React + Vite ใช้ CSS จาก mockup; state machine ของ checkout อยู่ที่ `src/state/checkout.ts` |
| `tests/integration`, `tests/acceptance` | Vitest กับ SQLite จริงในโฟลเดอร์ชั่วคราว; acceptance แยกตามกรณี A01–A16 |
| `scripts/` | `bench.ts`, `seed-demo.ts`, `install-service.ps1`, ตัวรัน acceptance |
| `docs/runbooks/` | restore, upgrade, ขายฉุกเฉิน, ปิดกะ |
| `plan/` | สเปก MVP, สเปกโมดูลขยาย, production readiness และ implementation plan |
| `mockup/` | หน้าเว็บตัวอย่างและชุดทดสอบของ mockup ([คู่มือ](mockup/README.md)) |

## ตรวจสอบ

```powershell
npm run check                      # typecheck + lint + unit + integration + acceptance
npm run test:acceptance -- A03 A05 # เฉพาะกรณี
npm run bench                      # 10,000 สินค้า / 100,000 บิล ขณะ backup ทำงาน
```

ผลตรวจล่าสุด (30 ต.ค. 2026 บนเครื่อง dev, Windows 11, Node 24.18):

- `npm run check` ผ่าน 80/80 (unit 19, integration 38, acceptance 23) ครอบคลุม A01–A10 และ A12–A16; A11 ต้องตรวจบนเครื่องร้าน
- `npm run bench` ค้นหา p95 5.4 ms, สแกนบาร์โค้ด p95 0.5 ms, checkout p95 10.6 ms (เป้าหมาย < 300 ms / < 1 s) ต้องวัดซ้ำบนเครื่องร้าน
- ทดลองผ่านเบราว์เซอร์บน production build: ตั้งค่าเจ้าของ, ล็อกอิน, เปิดกะ, สแกนบาร์โค้ด, รับเงิน/ทอน, กู้บิลค้างหลัง reload, ยกเลิกบิล, ปิดกะ, หน้ารายงาน/ระบบ

Mockup ยังรันชุดทดสอบเดิมได้ (ผ่าน 85/85):

```powershell
node --test --test-isolation=none mockup/store.test.cjs mockup/returns.test.cjs mockup/views.test.cjs mockup/purchasing.test.cjs mockup/purchasing.views.test.cjs mockup/stock-count.test.cjs mockup/stock-count.views.test.cjs mockup/gross-profit.test.cjs mockup/orders.test.cjs mockup/orders.views.test.cjs mockup/loyalty.test.cjs mockup/loyalty.views.test.cjs
```

เปิด mockup: `py -m http.server 4173 --bind 127.0.0.1 --directory mockup` แล้วไปที่ [http://127.0.0.1:4173/](http://127.0.0.1:4173/)

## สิ่งที่ยังไม่ได้ทำ

- **M1** ยืนยัน D1–D7 กับเจ้าของร้าน และ fixture `shop-examples.json` จากตัวเลขจริง
- **e2e (Playwright)** ยังไม่ได้ตั้งค่า หน้าจอทดสอบด้วยมือบน production build แล้ว
- **ปลายทาง cloud (D5)** มีเฉพาะ adapter แบบโฟลเดอร์ ยังไม่มี S3-compatible adapter
- **T2.8/T3.7/T6.x** ติดตั้ง service, ทดลอง scanner/printer, cold start ตัด WAN (A11), benchmark และซ้อม restore บนเครื่องร้าน, คู่มือผู้ใช้ และ pilot
- **ระยะ 3** โมดูลขยาย 1–6 ยังมีเฉพาะใน mockup
