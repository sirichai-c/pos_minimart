// npm run restore -- <snapshot-file>
import { loadConfig } from '../config.ts';
import { runningServerPid } from '../lock.ts';
import { restoreSnapshot } from '../modules/backup/restore.ts';

const file = process.argv[2];
if (!file) {
  console.error('วิธีใช้: npm run restore -- <ไฟล์ snapshot .db>');
  process.exit(2);
}
const config = loadConfig();
const pid = runningServerPid(config.dataDir);
if (pid) {
  console.error(`server ยังทำงานอยู่ (pid ${pid}) กรุณาหยุด service ก่อน restore`);
  process.exit(1);
}
try {
  const result = await restoreSnapshot({ snapshotPath: file, dbPath: config.dbPath });
  console.log('กู้คืนสำเร็จ');
  console.log(`  snapshot เวลา       ${result.manifest.createdAt}`);
  console.log(`  integrity_check     ${result.integrity}`);
  console.log(`  บิล / ยอดขาย(สตางค์) ${result.counts.sales} / ${result.counts.salesTotal}`);
  console.log(`  กะ / ยกเลิก         ${result.counts.shifts} / ${result.counts.voids}`);
  console.log(`  บิลล่าสุด           ${result.counts.lastSaleAt ?? '-'}`);
  console.log(`  ฐานข้อมูลเดิมเก็บที่  ${result.previousDbKeptAt ?? '(ไม่มีฐานข้อมูลเดิม)'}`);
  console.log('ขั้นต่อไป: เปิด service ล็อกอินใหม่ และกระทบยอดบิล/เงินสดที่เกิดหลังเวลา snapshot ตาม runbook');
} catch (err) {
  console.error('กู้คืนไม่สำเร็จ ฐานข้อมูลเดิมไม่ถูกแตะ:', err instanceof Error ? err.message : err);
  process.exit(1);
}
