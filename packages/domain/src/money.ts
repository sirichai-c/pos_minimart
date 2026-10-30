import { fail } from './errors.ts';

/** จำนวนเต็มสตางค์ */
export type Satang = number;

export function assertSatang(value: number, label: string): Satang {
  if (typeof value !== 'number' || Number.isNaN(value)) fail('VALIDATION_FAILED', `${label}ต้องเป็นตัวเลข`);
  if (Number.isFinite(value) && !Number.isInteger(value)) fail('VALIDATION_FAILED', `${label}ต้องเป็นจำนวนเต็มสตางค์`);
  if (!Number.isSafeInteger(value)) fail('AMOUNT_OVERFLOW', `${label}เกินขอบเขตที่บันทึกได้`);
  return value;
}

/** แปลงข้อความบาท เช่น "1,234.5" เป็นสตางค์ */
export function parseBaht(input: string): Satang {
  if (typeof input !== 'string') fail('VALIDATION_FAILED', 'กรุณาระบุจำนวนเงิน');
  const s = input.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s)) {
    fail('VALIDATION_FAILED', 'จำนวนเงินต้องเป็นตัวเลขและมีทศนิยมไม่เกินสองตำแหน่ง');
  }
  const [whole = '0', fraction = ''] = s.replace(/,/g, '').split('.');
  return assertSatang(Number(whole) * 100 + Number(fraction.padEnd(2, '0')), 'จำนวนเงิน');
}

/** 123450 → "1,234.50" */
export function formatBaht(value: Satang): string {
  assertSatang(value, 'จำนวนเงิน');
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / 100).toLocaleString('en-US');
  return (value < 0 ? '-' : '') + whole + '.' + String(absolute % 100).padStart(2, '0');
}

export function addSatang(a: Satang, b: Satang): Satang {
  const result = a + b;
  if (!Number.isSafeInteger(result)) fail('AMOUNT_OVERFLOW', 'ยอดเงินเกินขอบเขตที่บันทึกได้');
  return result;
}

export function multiplySatang(value: Satang, quantity: number): Satang {
  const result = value * quantity;
  if (!Number.isSafeInteger(result)) fail('AMOUNT_OVERFLOW', 'ยอดเงินเกินขอบเขตที่บันทึกได้');
  return result;
}

export function sumSatang(values: readonly Satang[]): Satang {
  return values.reduce<Satang>((sum, value) => addSatang(sum, assertSatang(value, 'จำนวนเงิน')), 0);
}
