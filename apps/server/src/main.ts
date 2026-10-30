// เริ่ม Fastify, เปิด DB, รัน migrations, serve web build
import { loadConfig } from './config.ts';
import { openDb } from './db/connection.ts';
import { migrate } from './db/migrate.ts';
import { buildApp } from './app.ts';
import { BackupService } from './modules/backup/scheduler.ts';
import { createTarget } from './modules/backup/uploader.ts';
import { acquireServerLock, releaseServerLock } from './lock.ts';

const config = loadConfig();
acquireServerLock(config.dataDir);
const db = openDb(config.dbPath);
const applied = migrate(db);
const backup = new BackupService({
  db, backupDir: config.backupDir, intervalMinutes: config.backupIntervalMinutes,
  target: createTarget(config.upload), now: () => new Date().toISOString(),
});
const app = await buildApp({ db, config, backup }, { logger: true });

if (applied.length) app.log.info({ applied }, 'applied migrations');
backup.start();
await app.listen({ host: config.host, port: config.port });
app.log.info(`บ้านดี POS พร้อมใช้งานที่ http://${config.host}:${config.port}/`);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await backup.stop();
  db.close();
  releaseServerLock(config.dataDir);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
