import type { FastifyInstance } from 'fastify';
import type { BackupRunView } from '@pos/contracts';
import { BackupBody } from '@pos/contracts';
import { fail } from '@pos/domain';
import { contextOf, requireRole } from '../../http/auth-hooks.ts';
import { idempotencyKeyOf } from '../../http/reply.ts';
import { audit, findRequest, writeTx } from '../../db/tx.ts';
import { payloadHash } from '@pos/domain/hash';
import type { AppDeps } from '../../app.ts';
import { toBackupRunView } from './snapshot.ts';

export function backupRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const owner = { preValidation: requireRole('owner') };

  app.get('/api/backups', owner, async () =>
    (db.prepare('SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 200').all() as Parameters<typeof toBackupRunView>[0][]).map(toBackupRunView));

  // snapshot ทำงานแบบ async นอก transaction จึงบันทึกผลคำขอหลัง snapshot เสร็จ
  app.post('/api/backups', { ...owner, schema: { body: BackupBody } }, async (req, reply) => {
    const ctx = contextOf(req, clock);
    const key = idempotencyKeyOf(req);
    if (!deps.backup) fail('VALIDATION_FAILED', 'ยังไม่ได้ตั้งค่าการสำรองข้อมูล');
    const existing = findRequest(db, key);
    if (existing) {
      if (existing.scope !== 'backups.manual' || existing.userId !== ctx.userId) fail('IDEMPOTENCY_CONFLICT', 'key นี้ใช้กับคำขออื่นแล้ว');
      reply.header('Idempotent-Replayed', 'true');
      return reply.status(200).send(existing.result);
    }
    const run: BackupRunView = await deps.backup.snapshot('manual');
    writeTx(db, () => {
      db.prepare('INSERT OR IGNORE INTO idempotency_requests (key, scope, user_id, payload_hash, status_code, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(key, 'backups.manual', ctx.userId, payloadHash({ scope: 'backups.manual', userId: ctx.userId, payload: {} }), 201, JSON.stringify(run), clock());
      audit(db, { userId: ctx.userId, now: clock() }, run.status === 'ok' ? 'backup.manual' : 'backup.manual_failed', 'backup', run.id, { status: run.status, error: run.error });
    });
    void deps.backup.upload().catch(() => {});
    return reply.status(201).send(run);
  });
}
