import { copyFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeTx, type Db } from '../../db/tx.ts';
import { trip } from '../../testing/faults.ts';
import type { UploadTargetConfig } from '../../config.ts';
import { manifestPathFor, sha256File } from './snapshot.ts';

/** ปลายทางสำรองนอกเครื่อง; credentials อยู่ใน config ไม่อยู่ในฐานข้อมูลจึงไม่ติดไปกับ snapshot */
export interface UploadTarget {
  readonly description: string;
  upload(snapshotPath: string, sha256: string): Promise<void>;
}

/**
 * คัดลอกไปโฟลเดอร์อื่น เช่น USB/ดิสก์ที่สอง (T5.4) หรือโฟลเดอร์ที่ซิงก์ขึ้น cloud
 * อ่านไฟล์ปลายทางกลับมาตรวจ checksum ก่อนถือว่าสำเร็จ
 */
export class DirectoryTarget implements UploadTarget {
  readonly description: string;
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.description = `โฟลเดอร์ ${dir}`;
  }

  async upload(snapshotPath: string, sha256: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const name = snapshotPath.split(/[\\/]/).pop()!;
    const dest = resolve(this.dir, name);
    await copyFile(snapshotPath, dest + '.partial');
    if ((await sha256File(dest + '.partial')) !== sha256) throw new Error('checksum ของสำเนาปลายทางไม่ตรง');
    await copyFile(manifestPathFor(snapshotPath), manifestPathFor(dest));
    await rename(dest + '.partial', dest);
  }
}

export function createTarget(config: UploadTargetConfig | null): UploadTarget | null {
  if (!config) return null;
  if (config.kind === 'directory') return new DirectoryTarget(config.path);
  return null;
}

/** backoff 1, 2, 4 … นาที สูงสุด 60 นาที */
export function backoffMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

/**
 * ส่ง snapshot ที่ค้าง เรียงจากใหม่สุดก่อน เพื่อให้จุดกู้คืนล่าสุดขึ้นก่อนเมื่องานตกค้าง
 * ทำงานนอก transaction การขาย และล้มเหลวได้โดยไม่ขวางการขาย
 */
export async function processUploads(db: Db, args: { target: UploadTarget; backupDir: string; now: () => string; limit?: number }): Promise<{ uploaded: number; failed: number }> {
  const due = db.prepare(`SELECT id, file_name, sha256, upload_attempts FROM backup_runs
                          WHERE status = 'ok' AND uploaded_at IS NULL AND pruned_at IS NULL AND (next_upload_at IS NULL OR next_upload_at <= ?)
                          ORDER BY started_at DESC LIMIT ?`).all(args.now(), args.limit ?? 5) as
    { id: string; file_name: string; sha256: string; upload_attempts: number }[];
  let uploaded = 0;
  let failed = 0;
  for (const run of due) {
    try {
      trip('upload-fail', 'upload');
      await args.target.upload(resolve(args.backupDir, run.file_name), run.sha256);
      writeTx(db, () => {
        db.prepare('UPDATE backup_runs SET uploaded_at = ?, upload_attempts = upload_attempts + 1, upload_error = NULL WHERE id = ?').run(args.now(), run.id);
      });
      uploaded++;
    } catch (err) {
      const attempts = run.upload_attempts + 1;
      const next = new Date(Date.parse(args.now()) + backoffMs(attempts)).toISOString();
      writeTx(db, () => {
        db.prepare('UPDATE backup_runs SET upload_attempts = ?, upload_error = ?, next_upload_at = ? WHERE id = ?')
          .run(attempts, (err instanceof Error ? err.message : String(err)).slice(0, 500), next, run.id);
      });
      failed++;
    }
  }
  return { uploaded, failed };
}
