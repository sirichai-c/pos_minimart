import { fail } from './errors.ts';

const bangkok = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });

/** วันทำการตาม Asia/Bangkok ของเวลา UTC */
export function bangkokDateKey(utcIso: string): string {
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) fail('VALIDATION_FAILED', 'เวลาไม่ถูกต้อง');
  return bangkok.format(date);
}

/** ช่วงเวลา UTC [start, end) ของวันทำการ Asia/Bangkok (UTC+7 ไม่มี DST) */
export function bangkokDayRange(dateKey: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) fail('VALIDATION_FAILED', 'วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD');
  const start = new Date(`${dateKey}T00:00:00+07:00`);
  if (Number.isNaN(start.getTime()) || bangkokDateKey(start.toISOString()) !== dateKey) fail('VALIDATION_FAILED', 'วันที่ไม่ถูกต้อง');
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}
