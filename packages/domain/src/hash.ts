// แยกจาก index เพราะใช้ node:crypto (ฝั่ง server เท่านั้น)
import { createHash } from 'node:crypto';
import { canonicalJson } from './identity.ts';

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function payloadHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
