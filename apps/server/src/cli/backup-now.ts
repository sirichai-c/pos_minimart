// npm run backup:now — snapshot ทันที ใช้ได้ทั้งตอน server ทำงาน (WAL) และหยุดอยู่
import { loadConfig } from '../config.ts';
import { openDb } from '../db/connection.ts';
import { migrate } from '../db/migrate.ts';
import { createSnapshot } from '../modules/backup/snapshot.ts';
import { createTarget, processUploads } from '../modules/backup/uploader.ts';

const config = loadConfig();
const db = openDb(config.dbPath);
migrate(db);
const now = () => new Date().toISOString();
const run = await createSnapshot(db, { backupDir: config.backupDir, kind: 'manual', now });
if (run.status !== 'ok') {
  console.error('สำรองข้อมูลไม่สำเร็จ:', run.error);
  db.close();
  process.exit(1);
}
console.log(`snapshot: ${config.backupDir}\\${run.fileName} (${run.sizeBytes} bytes, sha256 ${run.sha256})`);
const target = createTarget(config.upload);
if (target) {
  const result = await processUploads(db, { target, backupDir: config.backupDir, now, limit: 1 });
  console.log(result.uploaded ? `ส่งไปยัง ${target.description} แล้ว` : `ส่งไปยัง ${target.description} ไม่สำเร็จ จะลองใหม่เมื่อ server ทำงาน`);
}
db.close();
