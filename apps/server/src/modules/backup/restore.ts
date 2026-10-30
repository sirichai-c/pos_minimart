import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { openDb } from '../../db/connection.ts';
import { latestSchemaVersion, migrate } from '../../db/migrate.ts';
import { audit, writeTx } from '../../db/tx.ts';
import { dataCounts, readManifest, sha256File, type SnapshotManifest } from './snapshot.ts';

export interface RestoreResult {
  manifest: SnapshotManifest;
  restoredTo: string;
  previousDbKeptAt: string | null;
  integrity: string;
  counts: SnapshotManifest['counts'];
  migrationsApplied: number[];
}

const sidecars = (dbPath: string) => [dbPath, dbPath + '-wal', dbPath + '-shm'];

/**
 * กู้คืน snapshot (R08): ต้องหยุด server ก่อน (maintenance mode)
 * ตรวจ checksum/schema/integrity และจำนวนข้อมูลเทียบ manifest บนสำเนาในตำแหน่งสะอาดก่อนสลับใช้งาน
 * เก็บฐานข้อมูลเดิมไว้ ล้าง sessions เพื่อบังคับล็อกอินใหม่ และคง UUID/เลขบิลเดิมทั้งหมด
 */
export async function restoreSnapshot(args: { snapshotPath: string; dbPath: string; now?: () => string }): Promise<RestoreResult> {
  const now = args.now ?? (() => new Date().toISOString());
  const snapshotPath = resolve(args.snapshotPath);
  if (!existsSync(snapshotPath)) throw new Error(`ไม่พบไฟล์ snapshot: ${snapshotPath}`);
  const manifest = await readManifest(snapshotPath);
  const actualSha = await sha256File(snapshotPath);
  if (actualSha !== manifest.sha256) throw new Error('checksum ของ snapshot ไม่ตรงกับ manifest ไฟล์อาจเสียหาย');
  const latest = latestSchemaVersion();
  if (manifest.schemaVersion > latest) throw new Error(`snapshot เป็น schema ${manifest.schemaVersion} ใหม่กว่าโปรแกรมนี้ (${latest}) กรุณาใช้โปรแกรมรุ่นที่สร้าง snapshot`);

  const stamp = now().replace(/[-:.]/g, '');
  const dataDir = dirname(args.dbPath);
  mkdirSync(dataDir, { recursive: true });
  const staging = resolve(dataDir, `restore-${stamp}.db`);
  copyFileSync(snapshotPath, staging);

  let integrity: string;
  let counts: SnapshotManifest['counts'];
  let migrationsApplied: number[];
  const check = openDb(staging);
  try {
    integrity = String(check.pragma('integrity_check', { simple: true }));
    if (integrity !== 'ok') throw new Error(`integrity_check ไม่ผ่าน: ${integrity}`);
    counts = dataCounts(check);
    const expected = manifest.counts;
    if (counts.sales !== expected.sales || counts.salesTotal !== expected.salesTotal || counts.shifts !== expected.shifts || counts.voids !== expected.voids) {
      throw new Error('จำนวนบิล/ยอดขาย/กะใน snapshot ไม่ตรงกับ manifest');
    }
    migrationsApplied = migrate(check, now);
    writeTx(check, () => {
      check.prepare('DELETE FROM sessions').run();
      check.prepare("UPDATE backup_runs SET status = 'failed', finished_at = ?, error = 'ถูกตัดตอนจาก restore' WHERE status = 'running'").run(now());
      audit(check, null, 'system.restored', 'backup', manifest.fileName, {
        snapshot: basename(snapshotPath), snapshotCreatedAt: manifest.createdAt, schemaVersion: manifest.schemaVersion, counts,
      }, now());
    });
    check.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    check.close();
    for (const p of sidecars(staging)) rmSync(p, { force: true });
    throw err;
  }
  check.close();

  let previousDbKeptAt: string | null = null;
  if (existsSync(args.dbPath)) {
    const keepDir = resolve(dataDir, `pre-restore-${stamp}`);
    mkdirSync(keepDir, { recursive: true });
    for (const p of sidecars(args.dbPath)) if (existsSync(p)) renameSync(p, resolve(keepDir, basename(p)));
    previousDbKeptAt = keepDir;
  }
  for (const p of sidecars(staging).slice(1)) rmSync(p, { force: true });
  renameSync(staging, args.dbPath);
  return { manifest, restoredTo: args.dbPath, previousDbKeptAt, integrity, counts, migrationsApplied };
}
