// ข้อมูลตัวอย่างสำหรับ dev เท่านั้น: ส่งผ่าน API ของ server ที่กำลังทำงาน (API เป็นผู้เขียนฐานข้อมูลตัวเดียว)
// ใช้: npm run seed:demo -- <username> <password> [http://127.0.0.1:4180]
import { randomUUID } from 'node:crypto';

const [username, password, base = 'http://127.0.0.1:4180'] = process.argv.slice(2);
if (!username || !password) {
  console.error('วิธีใช้: npm run seed:demo -- <ชื่อผู้ใช้ owner> <รหัสผ่าน> [URL]');
  process.exit(2);
}

const origin = new URL(base).origin;
let cookie = '';
async function call(method: string, path: string, body?: unknown, key = true): Promise<{ status: number; data: { error?: { code?: string; message?: string } } }> {
  const res = await fetch(base + '/api' + path, {
    method,
    headers: { 'content-type': 'application/json', origin, cookie, ...(key ? { 'idempotency-key': randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  return { status: res.status, data: (await res.json()) as { error?: { code?: string; message?: string } } };
}

// ชุดสินค้าเดียวกับ mockup
const catalog: [string, string, string, number, number][] = [
  ['นมสดรสจืด 250 มล.', 'MILK-250', '8851000000011', 1500, 36],
  ['น้ำดื่ม 600 มล.', 'WATER-600', '8851000000028', 700, 72],
  ['กาแฟกระป๋อง 180 มล.', 'COFFEE-180', '8851000000035', 1700, 24],
  ['ชาเขียว 500 มล.', 'TEA-500', '8851000000042', 2000, 30],
  ['น้ำอัดลม 325 มล.', 'SODA-325', '8851000000059', 1500, 40],
  ['บะหมี่กึ่งสำเร็จรูป รสต้มยำ', 'NOODLE-TOM', '8851000000066', 700, 80],
  ['ข้าวหอมมะลิ 1 กก.', 'RICE-1KG', '8851000000073', 4500, 18],
  ['น้ำมันถั่วเหลือง 1 ลิตร', 'OIL-1L', '8851000000080', 5800, 12],
  ['น้ำตาลทราย 1 กก.', 'SUGAR-1KG', '8851000000097', 2800, 20],
  ['ไข่ไก่ เบอร์ 2 แพ็ก 10', 'EGG-10', '8851000000103', 4900, 15],
  ['ขนมปังแผ่น', 'BREAD', '8851000000110', 3200, 10],
  ['ขนมขบเคี้ยว รสดั้งเดิม', 'SNACK-ORI', '8851000000127', 2000, 45],
  ['สบู่ก้อน', 'SOAP', '8851000000134', 2500, 4],
  ['แชมพู 170 มล.', 'SHAMPOO', '8851000000141', 6900, 9],
  ['กระดาษทิชชู แพ็ก 6', 'TISSUE-6', '8851000000158', 8900, 0],
];

const login = await call('POST', '/auth/login', { username, password }, false);
if (login.status !== 200) {
  console.error('ล็อกอินไม่สำเร็จ:', login.data.error?.message);
  process.exit(1);
}
let created = 0;
for (const [name, sku, barcode, price, openingQuantity] of catalog) {
  const res = await call('POST', '/products', { name, sku, barcode, price, openingQuantity });
  if (res.status === 201) created++;
  else if (res.data.error?.code !== 'DUPLICATE_SKU') console.error(sku, res.data.error?.message);
}
const cashier = await call('POST', '/users', { username: 'cashier', displayName: 'พนักงานขาย', password: 'cashier-pass-123', role: 'cashier' });
console.log(`เพิ่มสินค้า ${created} รายการ${cashier.status === 201 ? ' และบัญชี cashier (รหัส cashier-pass-123)' : ''}`);
