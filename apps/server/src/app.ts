import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import type { AppConfig } from './config.ts';
import type { Db } from './db/tx.ts';
import { registerErrorHandler } from './http/errors.ts';
import { registerAuthHooks } from './http/auth-hooks.ts';
import type { BackupService } from './modules/backup/scheduler.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { userRoutes } from './modules/users/routes.ts';
import { catalogRoutes } from './modules/catalog/routes.ts';
import { inventoryRoutes } from './modules/inventory/routes.ts';
import { shiftRoutes } from './modules/shifts/routes.ts';
import { salesRoutes } from './modules/sales/routes.ts';
import { reportRoutes } from './modules/reports/routes.ts';
import { auditRoutes } from './modules/audit/routes.ts';
import { backupRoutes } from './modules/backup/routes.ts';
import { systemRoutes } from './modules/system/routes.ts';

export interface AppDeps {
  db: Db;
  config: AppConfig;
  clock: () => string;
  backup: BackupService | null;
}

export async function buildApp(input: Omit<AppDeps, 'clock' | 'backup'> & Partial<Pick<AppDeps, 'clock' | 'backup'>>, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const deps: AppDeps = { clock: () => new Date().toISOString(), backup: null, ...input };
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
    // ไม่แปลงชนิดหรือลบ field เกิน: เงินต้องเป็น integer จริงจาก client (R01)
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false, allErrors: false } },
  });
  await app.register(cookie);
  const hasWeb = existsSync(deps.config.webDist);
  registerErrorHandler(app, { spaFallback: hasWeb });
  registerAuthHooks(app, deps);

  authRoutes(app, deps);
  userRoutes(app, deps);
  catalogRoutes(app, deps);
  inventoryRoutes(app, deps);
  shiftRoutes(app, deps);
  salesRoutes(app, deps);
  reportRoutes(app, deps);
  auditRoutes(app, deps);
  backupRoutes(app, deps);
  systemRoutes(app, deps);

  // production: serve UI build จากเครื่องร้าน ไม่พึ่ง CDN
  if (hasWeb) await app.register(fastifyStatic, { root: deps.config.webDist });
  return app;
}
