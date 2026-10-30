// npm run migrate — สำรองข้อมูลก่อนเสมอ (runbook upgrade)
import { existsSync } from 'node:fs';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/connection.ts';
import { currentSchemaVersion, migrate } from '../db/migrate.ts';
import { runningServerPid } from '../lock.ts';
import { createSnapshot } from '../modules/backup/snapshot.ts';

const config = loadConfig();
const pid = runningServerPid(config.dataDir);
if (pid) {
  console.error(`server ยังทำงานอยู่ (pid ${pid}) กรุณาหยุด service ก่อน migrate`);
  process.exit(1);
}
const existed = existsSync(config.dbPath);
const db = openDb(config.dbPath);
if (existed && currentSchemaVersion(db) > 0) {
  const run = await createSnapshot(db, { backupDir: config.backupDir, kind: 'manual', now: () => new Date().toISOString() });
  if (run.status !== 'ok') {
    console.error('สำรองข้อมูลก่อน migrate ไม่สำเร็จ จึงไม่ migrate:', run.error);
    process.exit(1);
  }
  console.log(`สำรองข้อมูลก่อน migrate: ${run.fileName}`);
}
const applied = migrate(db);
console.log(applied.length ? `ใช้ migrations: ${applied.join(', ')}` : 'schema เป็นรุ่นล่าสุดแล้ว');
console.log(`schema ปัจจุบัน: ${currentSchemaVersion(db)}`);
db.close();
