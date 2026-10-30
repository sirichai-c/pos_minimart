import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import type { BackupRunView } from '@pos/contracts';
import { newId, writeTx, type Db } from '../../db/tx.ts';
import { currentSchemaVersion } from '../../db/migrate.ts';
import { trip } from '../../testing/faults.ts';
import { APP_VERSION } from '../../config.ts';

export type BackupKind = BackupRunView['kind'];

/** ข้อมูลกำกับ snapshot ใช้ตรวจตอน restore (R07–R08) */
export interface SnapshotManifest {
  format: 'baandee-pos-snapshot/1';
  appVersion: string;
  schemaVersion: number;
  kind: BackupKind;
  createdAt: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  counts: { sales: number; salesTotal: number; voids: number; shifts: number; products: number; lastSaleAt: string | null };
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export function dataCounts(db: Db): SnapshotManifest['counts'] {
  const sales = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total, MAX(created_at) AS last FROM sales').get() as { n: number; total: number; last: string | null };
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { sales: sales.n, salesTotal: sales.total, voids: count('sale_voids'), shifts: count('shifts'), products: count('products'), lastSaleAt: sales.last };
}

export const manifestPathFor = (snapshotPath: string): string => snapshotPath.replace(/\.db$/, '.json');

interface BackupRunRow {
  id: string; kind: BackupKind; started_at: string; finished_at: string | null; file_name: string | null; size_bytes: number | null;
  sha256: string | null; schema_version: number; status: 'running' | 'ok' | 'failed'; error: string | null;
  uploaded_at: string | null; upload_attempts: number; upload_error: string | null;
}

export function toBackupRunView(row: BackupRunRow): BackupRunView {
  return {
    id: row.id, kind: row.kind, startedAt: row.started_at, finishedAt: row.finished_at, fileName: row.file_name, sizeBytes: row.size_bytes,
    sha256: row.sha256, schemaVersion: row.schema_version, status: row.status, error: row.error,
    uploadedAt: row.uploaded_at, uploadAttempts: row.upload_attempts, uploadError: row.upload_error,
  };
}

export function getBackupRun(db: Db, id: string): BackupRunView {
  return toBackupRunView(db.prepare('SELECT * FROM backup_runs WHERE id = ?').get(id) as BackupRunRow);
}

/**
 * snapshot ที่สอดคล้องกันผ่าน SQLite online backup API (ไม่ copy ไฟล์ .db ตรง ๆ)
 * เขียนไฟล์ชั่วคราวก่อน แล้วจึงเปลี่ยนชื่อเมื่อ checksum และ manifest พร้อม
 * ถ้าล้มเหลว run เป็น failed และไม่อ้างว่ามีจุดกู้คืนใหม่ (A15)
 */
export async function createSnapshot(db: Db, args: { backupDir: string; kind: BackupKind; now: () => string }): Promise<BackupRunView> {
  const id = newId();
  const startedAt = args.now();
  const schemaVersion = currentSchemaVersion(db);
  writeTx(db, () => {
    db.prepare("INSERT INTO backup_runs (id, kind, started_at, schema_version, status) VALUES (?, ?, ?, ?, 'running')").run(id, args.kind, startedAt, schemaVersion);
  });
  const stamp = startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const fileName = `pos-${stamp}-${args.kind}-${id.slice(0, 8)}.db`;
  const finalPath = resolve(args.backupDir, fileName);
  const tmpPath = finalPath + '.partial';
  try {
    await mkdir(args.backupDir, { recursive: true });
    trip('backup-disk-full', args.kind);
    await db.backup(tmpPath);
    const counts = dataCounts(db);
    const { size } = await stat(tmpPath);
    const sha256 = await sha256File(tmpPath);
    const manifest: SnapshotManifest = {
      format: 'baandee-pos-snapshot/1', appVersion: APP_VERSION, schemaVersion, kind: args.kind,
      createdAt: startedAt, fileName, sizeBytes: size, sha256, counts,
    };
    await writeFile(manifestPathFor(finalPath), JSON.stringify(manifest, null, 2));
    await rename(tmpPath, finalPath);
    writeTx(db, () => {
      db.prepare("UPDATE backup_runs SET status = 'ok', finished_at = ?, file_name = ?, size_bytes = ?, sha256 = ?, next_upload_at = ? WHERE id = ?")
        .run(args.now(), fileName, size, sha256, args.now(), id);
    });
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    await rm(manifestPathFor(finalPath), { force: true }).catch(() => {});
    const message = err instanceof Error ? `${(err as { code?: string }).code ?? ''} ${err.message}`.trim() : String(err);
    try {
      writeTx(db, () => {
        db.prepare("UPDATE backup_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(args.now(), message.slice(0, 500), id);
      });
    } catch {
      // ดิสก์อาจเต็มจนบันทึกสถานะไม่ได้; run ค้าง running จะถูกปิดเป็น failed ตอนเริ่ม server
    }
  }
  return getBackupRun(db, id);
}

export async function readManifest(snapshotPath: string): Promise<SnapshotManifest> {
  const manifest = JSON.parse(await readFile(manifestPathFor(snapshotPath), 'utf8')) as SnapshotManifest;
  if (manifest.format !== 'baandee-pos-snapshot/1') throw new Error('manifest ไม่ใช่รูปแบบของบ้านดี POS');
  if (manifest.fileName !== basename(snapshotPath)) throw new Error('manifest ไม่ตรงกับไฟล์ snapshot');
  return manifest;
}
