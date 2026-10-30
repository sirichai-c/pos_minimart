import { hash, verify } from '@node-rs/argon2';
import { fail } from '@pos/domain';
import type { UserView } from '@pos/contracts';
import { audit, newId, writeTx, type Db, type Role } from '../../db/tx.ts';
import { hashToken, newSessionToken } from '../../http/auth-hooks.ts';
import type { AppConfig } from '../../config.ts';

// Argon2id อย่างน้อย memory 19 MiB, iterations 2, parallelism 1 (R06)
const ARGON2 = { algorithm: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
let dummyHash: Promise<string> | null = null;

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON2);

export interface UserRow { id: string; username: string; display_name: string; role: Role; password_hash: string; active: number; failed_attempts: number; locked_until: string | null; created_at: string }

export function toUserView(row: UserRow): UserView {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, active: row.active === 1, createdAt: row.created_at };
}

export function needsOwner(db: Db): boolean {
  return !db.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").get();
}

export async function setupOwner(db: Db, input: { username: string; displayName: string; password: string }, now: string): Promise<UserView> {
  if (!needsOwner(db)) fail('SETUP_ALREADY_DONE', 'ร้านนี้มีเจ้าของร้านแล้ว');
  const passwordHash = await hashPassword(input.password);
  return writeTx(db, () => {
    if (!needsOwner(db)) fail('SETUP_ALREADY_DONE', 'ร้านนี้มีเจ้าของร้านแล้ว');
    const id = newId();
    db.prepare('INSERT INTO users (id, username, display_name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.username.trim(), input.displayName.trim(), 'owner', passwordHash, now);
    audit(db, { userId: id, now }, 'setup.owner_created', 'user', id, { username: input.username.trim() });
    return toUserView(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow);
  });
}

export async function login(
  db: Db, config: AppConfig, input: { username: string; password: string }, clock: () => string,
): Promise<{ token: string; user: UserView; expiresAt: string }> {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(input.username.trim()) as UserRow | undefined;
  const now = clock();
  if (row?.locked_until && row.locked_until > now) {
    fail('TOO_MANY_ATTEMPTS', 'ลองเข้าสู่ระบบผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่', { lockedUntil: row.locked_until });
  }
  // ตรวจ hash เสมอแม้ไม่พบบัญชี เพื่อไม่ให้เวลาตอบบอกว่ามีชื่อผู้ใช้นี้หรือไม่
  dummyHash ??= hashPassword('not-a-real-password');
  const ok = await verify(row?.password_hash ?? (await dummyHash), input.password).catch(() => false);
  const at = clock();
  if (!row || !ok || row.active !== 1) {
    if (row) {
      writeTx(db, () => {
        const attempts = row.failed_attempts + 1;
        const lock = attempts >= config.loginMaxAttempts ? new Date(Date.parse(at) + config.loginLockMinutes * 60_000).toISOString() : null;
        db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : attempts, lock, row.id);
        audit(db, null, lock ? 'auth.locked' : 'auth.login_failed', 'user', row.id, { attempts }, at);
      });
    }
    fail('INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  const token = newSessionToken();
  const expiresAt = new Date(Date.parse(at) + config.sessionTtlHours * 3_600_000).toISOString();
  writeTx(db, () => {
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(row.id);
    db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), row.id, at, expiresAt);
    audit(db, { userId: row.id, now: at }, 'auth.login', 'user', row.id);
  });
  return { token, user: toUserView(row), expiresAt };
}

export function logout(db: Db, sessionId: string, userId: string, now: string): void {
  writeTx(db, () => {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL').run(now, sessionId);
    audit(db, { userId, now }, 'auth.logout', 'user', userId);
  });
}
