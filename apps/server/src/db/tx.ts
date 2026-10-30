import { randomUUID } from 'node:crypto';
import { AppError, fail, isUuid } from '@pos/domain';
import { payloadHash } from '@pos/domain/hash';
import type { Db } from './connection.ts';
import { trip } from '../testing/faults.ts';

export type { Db };
export type Role = 'owner' | 'cashier';
export interface RequestContext { userId: string; role: Role; sessionId: string; now: string }

/** แปลง error ของ SQLite เป็นรหัสที่ client ลองใหม่ด้วย key เดิมได้ */
export function mapDbError(err: unknown): unknown {
  if (err instanceof AppError) return err;
  const code = (err as { code?: unknown })?.code;
  if (typeof code !== 'string') return err;
  if (code === 'SQLITE_BUSY' || code.startsWith('SQLITE_BUSY_') || code === 'SQLITE_LOCKED') {
    return new AppError('DB_BUSY', 'ฐานข้อมูลกำลังทำงานอื่น ยังไม่ได้บันทึก กรุณาลองใหม่ด้วยคำขอเดิม');
  }
  if (code === 'SQLITE_FULL' || code.startsWith('SQLITE_IOERR') || code === 'SQLITE_READONLY' || code === 'SQLITE_CANTOPEN') {
    return new AppError('STORAGE_FAILURE', 'บันทึกลงดิสก์ไม่ได้ รายการนี้ยังไม่ถูกบันทึก');
  }
  return err;
}

/** เปิด BEGIN IMMEDIATE; ถ้า throw จะ rollback ทั้งหมด */
export function writeTx<T>(db: Db, fn: (db: Db) => T): T {
  try {
    return db.transaction(() => fn(db)).immediate();
  } catch (err) {
    throw mapDbError(err);
  }
}

export function requireIdempotencyKey(value: unknown): string {
  if (!isUuid(value)) fail('IDEMPOTENCY_KEY_REQUIRED', 'ต้องส่ง Idempotency-Key แบบ UUID');
  return value.toLowerCase();
}

export interface IdempotentResult<T> { replayed: boolean; result: T; statusCode: number }

interface StoredRequest { scope: string; user_id: string; payload_hash: string; status_code: number; response_json: string }

/**
 * หา key → มีและ hash ตรง: คืน response เดิม (ไม่ตรวจราคา/สต๊อกใหม่ตาม R03)
 *        → มีแต่ hash ต่าง: IDEMPOTENCY_CONFLICT
 *        → ไม่มี: เรียก fn แล้ว insert idempotency_requests พร้อม response ใน transaction เดียวกัน
 * error ทางธุรกิจไม่ถูกบันทึก จึงส่งซ้ำด้วย key เดิมหลังแก้สาเหตุได้
 */
export function idempotent<T>(db: Db, ctx: RequestContext, args: {
  key: string; scope: string; payload: unknown; fn: (db: Db) => T; statusCode?: number;
}): IdempotentResult<T> {
  const hash = payloadHash({ scope: args.scope, userId: ctx.userId, payload: args.payload });
  const outcome = writeTx(db, () => {
    const existing = db.prepare('SELECT scope, user_id, payload_hash, status_code, response_json FROM idempotency_requests WHERE key = ?')
      .get(args.key) as StoredRequest | undefined;
    if (existing) {
      if (existing.payload_hash !== hash) {
        fail('IDEMPOTENCY_CONFLICT', 'คำขอนี้ใช้ key เดิมแต่ข้อมูลต่างจากเดิม จึงไม่ได้บันทึกเพิ่ม');
      }
      return { replayed: true, result: JSON.parse(existing.response_json) as T, statusCode: 200 };
    }
    const result = args.fn(db);
    const statusCode = args.statusCode ?? 201;
    db.prepare(`INSERT INTO idempotency_requests (key, scope, user_id, payload_hash, status_code, response_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(args.key, args.scope, ctx.userId, hash, statusCode, JSON.stringify(result), ctx.now);
    trip('disk-full', args.scope);
    trip('before-commit', args.scope);
    return { replayed: false, result, statusCode };
  });
  if (!outcome.replayed) trip('after-commit-before-response', args.scope);
  return outcome;
}

export function findRequest(db: Db, key: string): { scope: string; userId: string; statusCode: number; result: unknown; createdAt: string } | null {
  const row = db.prepare('SELECT scope, user_id, status_code, response_json, created_at FROM idempotency_requests WHERE key = ?').get(key) as
    | { scope: string; user_id: string; status_code: number; response_json: string; created_at: string }
    | undefined;
  if (!row) return null;
  return { scope: row.scope, userId: row.user_id, statusCode: row.status_code, result: JSON.parse(row.response_json), createdAt: row.created_at };
}

export function audit(db: Db, ctx: Pick<RequestContext, 'userId' | 'now'> | null, action: string, entityType: string, entityId: string, data?: unknown, now?: string): void {
  db.prepare('INSERT INTO audit_events (action, entity_type, entity_id, user_id, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(action, entityType, entityId, ctx?.userId ?? null, data === undefined ? null : JSON.stringify(data), ctx?.now ?? now ?? new Date().toISOString());
}

export const newId = (): string => randomUUID();
