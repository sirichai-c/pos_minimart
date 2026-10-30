import { fail } from './errors.ts';

/** JSON ที่ key เรียงลำดับและตัดค่า undefined เพื่อเทียบ payload */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(v => (v === undefined ? 'null' : canonicalJson(v))).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort()
      .filter(k => record[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + canonicalJson(record[k]))
      .join(',') + '}';
  }
  if (typeof value === 'number' && !Number.isFinite(value)) fail('VALIDATION_FAILED', 'ตัวเลขไม่ถูกต้อง');
  return JSON.stringify(value) ?? 'null';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** "POS1-" + UUID ตัดขีด ไม่พึ่งลำดับแถว จึงไม่ซ้ำหลัง restore */
export function billNumber(saleId: string): string {
  if (!isUuid(saleId)) fail('VALIDATION_FAILED', 'รหัสบิลไม่ถูกต้อง');
  return 'POS1-' + saleId.replace(/-/g, '').toUpperCase();
}

/** เลขบิลแบบสั้นสำหรับแสดงในตาราง (ใบเสร็จแสดงเลขเต็ม) */
export function shortBillNumber(billNo: string): string {
  return billNo.length > 13 ? billNo.slice(0, 5) + billNo.slice(-8) : billNo;
}

export function normalizeSku(input: string): string {
  const sku = typeof input === 'string' ? input.trim().toUpperCase() : '';
  if (!sku) fail('VALIDATION_FAILED', 'กรุณาระบุ SKU');
  return sku;
}

/** บาร์โค้ดเก็บเป็นข้อความเพื่อรักษาศูนย์นำหน้า; ค่าว่างคือไม่มีบาร์โค้ด */
export function normalizeBarcode(input: string | null | undefined): string | null {
  if (input == null) return null;
  const barcode = String(input).trim();
  return barcode === '' ? null : barcode;
}
