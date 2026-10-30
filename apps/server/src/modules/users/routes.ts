import type { FastifyInstance } from 'fastify';
import { CreateUserBody, UpdateUserBody, type CreateUserRequest, type UpdateUserRequest } from '@pos/contracts';
import { fail } from '@pos/domain';
import { audit, idempotent, newId, writeTx } from '../../db/tx.ts';
import { contextOf, requireRole } from '../../http/auth-hooks.ts';
import { idempotencyKeyOf, sendIdempotent } from '../../http/reply.ts';
import type { AppDeps } from '../../app.ts';
import { hashPassword, toUserView, type UserRow } from '../auth/service.ts';

export function userRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const owner = { preValidation: requireRole('owner') };
  const getUser = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

  app.get('/api/users', owner, async () =>
    (db.prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[]).map(toUserView));

  app.post('/api/users', { ...owner, schema: { body: CreateUserBody } }, async (req, reply) => {
    const ctx = contextOf(req, clock);
    const key = idempotencyKeyOf(req);
    const body = req.body as CreateUserRequest;
    const passwordHash = await hashPassword(body.password);
    // payload สำหรับเทียบ key ไม่รวมรหัสผ่านแบบข้อความ
    const { password: _password, ...payload } = body;
    const outcome = idempotent(db, ctx, {
      key, scope: 'users.create', payload,
      fn: () => {
        if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username.trim())) fail('DUPLICATE_USERNAME', 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
        const id = newId();
        db.prepare('INSERT INTO users (id, username, display_name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, body.username.trim(), body.displayName.trim(), body.role, passwordHash, ctx.now);
        audit(db, ctx, 'user.created', 'user', id, { username: body.username.trim(), role: body.role });
        return toUserView(getUser(id)!);
      },
    });
    return sendIdempotent(reply, outcome);
  });

  app.patch('/api/users/:id', { ...owner, schema: { body: UpdateUserBody } }, async req => {
    const ctx = contextOf(req, clock);
    const { id } = req.params as { id: string };
    const body = req.body as UpdateUserRequest;
    const passwordHash = body.password ? await hashPassword(body.password) : null;
    return writeTx(db, () => {
      const user = getUser(id);
      if (!user) fail('NOT_FOUND', 'ไม่พบผู้ใช้');
      const role = body.role ?? user.role;
      const active = body.active ?? user.active === 1;
      if (user.role === 'owner' && (role !== 'owner' || !active)) {
        const owners = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1").get() as { n: number }).n;
        if (owners <= 1) fail('VALIDATION_FAILED', 'ต้องมีเจ้าของร้านที่ใช้งานได้อย่างน้อยหนึ่งบัญชี');
      }
      db.prepare('UPDATE users SET display_name = ?, role = ?, active = ?, password_hash = COALESCE(?, password_hash), failed_attempts = CASE WHEN ? IS NULL THEN failed_attempts ELSE 0 END, locked_until = CASE WHEN ? IS NULL THEN locked_until ELSE NULL END WHERE id = ?')
        .run(body.displayName?.trim() ?? user.display_name, role, active ? 1 : 0, passwordHash, passwordHash, passwordHash, id);
      // ปิดบัญชี เปลี่ยนสิทธิ์ หรือรีเซ็ตรหัส ให้ session เดิมหมดอายุ
      if (!active || role !== user.role || passwordHash) {
        db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(ctx.now, id);
      }
      const changes: Record<string, unknown> = {};
      if (body.displayName !== undefined && body.displayName.trim() !== user.display_name) changes.displayName = { from: user.display_name, to: body.displayName.trim() };
      if (role !== user.role) changes.role = { from: user.role, to: role };
      if (active !== (user.active === 1)) changes.active = { from: user.active === 1, to: active };
      if (passwordHash) changes.passwordReset = true;
      audit(db, ctx, 'user.updated', 'user', id, changes);
      return toUserView(getUser(id)!);
    });
  });
}
