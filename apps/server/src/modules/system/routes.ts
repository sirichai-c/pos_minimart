import type { FastifyInstance } from 'fastify';
import { statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SystemStatus } from '@pos/contracts';
import { requireRole } from '../../http/auth-hooks.ts';
import { currentSchemaVersion } from '../../db/migrate.ts';
import { APP_VERSION } from '../../config.ts';
import type { AppDeps } from '../../app.ts';
import { toBackupRunView } from '../backup/snapshot.ts';
import { openShiftRow } from '../shifts/service.ts';

type RunRow = Parameters<typeof toBackupRunView>[0];

export function systemRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config, clock } = deps;

  // แสดงสถานะจริงจาก backup_runs ไม่ถือว่าตั้งเวลาแล้วเท่ากับสำรองสำเร็จ (R07)
  app.get('/api/system/status', { preValidation: requireRole('owner') }, async (): Promise<SystemStatus> => {
    let disk: SystemStatus['disk'] = { freeBytes: null, totalBytes: null };
    try {
      const s = statfsSync(dirname(config.dbPath));
      disk = { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
    } catch { /* บางระบบไฟล์ไม่รองรับ */ }
    const one = (sql: string) => { const row = db.prepare(sql).get() as RunRow | undefined; return row ? toBackupRunView(row) : null; };
    const target = deps.backup?.options.target ?? null;
    const pending = target
      ? (db.prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE status = 'ok' AND uploaded_at IS NULL AND pruned_at IS NULL").get() as { n: number }).n
      : 0;
    return {
      appVersion: APP_VERSION,
      schemaVersion: currentSchemaVersion(db),
      dbPath: config.dbPath,
      now: clock(),
      disk,
      lastSnapshot: one("SELECT * FROM backup_runs WHERE status = 'ok' ORDER BY started_at DESC LIMIT 1"),
      lastFailedSnapshot: one("SELECT * FROM backup_runs WHERE status = 'failed' ORDER BY started_at DESC LIMIT 1"),
      lastUpload: one('SELECT * FROM backup_runs WHERE uploaded_at IS NOT NULL ORDER BY uploaded_at DESC LIMIT 1'),
      pendingUploads: pending,
      uploadTarget: target?.description ?? null,
      openShiftId: openShiftRow(db)?.id ?? null,
    };
  });

  app.get('/api/health', async () => ({ ok: true }));
}
