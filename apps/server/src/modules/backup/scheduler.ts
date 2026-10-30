import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BackupRunView } from '@pos/contracts';
import { bangkokDateKey } from '@pos/domain';
import { writeTx, type Db } from '../../db/tx.ts';
import { createSnapshot, manifestPathFor, type BackupKind } from './snapshot.ts';
import { processUploads, type UploadTarget } from './uploader.ts';

const HOUR = 3_600_000;
export const SHORT_RETENTION_MS = 48 * HOUR;
export const DAILY_RETENTION_MS = 30 * 24 * HOUR;

export interface BackupServiceOptions {
  db: Db;
  backupDir: string;
  intervalMinutes: number;
  target: UploadTarget | null;
  now: () => string;
}

/**
 * snapshot ทุก 15 นาที + หลังปิดกะ + รายวัน; retention 48 ชม./30 วัน (R07)
 * ทำทีละงาน และ error ทุกชนิดถูกบันทึกเป็นสถานะ ไม่ทำให้ server ล้ม
 */
export class BackupService {
  readonly options: BackupServiceOptions;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;

  constructor(options: BackupServiceOptions) {
    this.options = options;
  }

  /** ปิด run ที่ค้าง running จากการปิดโปรแกรมกลางคัน */
  recoverInterrupted(): void {
    const { db, now } = this.options;
    writeTx(db, () => {
      db.prepare("UPDATE backup_runs SET status = 'failed', finished_at = ?, error = 'โปรแกรมหยุดระหว่างสำรองข้อมูล' WHERE status = 'running'").run(now());
    });
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job);
    this.chain = next.catch(() => {});
    return next;
  }

  snapshot(kind: BackupKind): Promise<BackupRunView> {
    return this.enqueue(() => createSnapshot(this.options.db, { backupDir: this.options.backupDir, kind, now: this.options.now }));
  }

  /** เรียกหลังปิดกะ ไม่รอผล */
  requestSnapshot(kind: BackupKind): void {
    void this.snapshot(kind).then(() => this.upload()).catch(() => {});
  }

  upload(): Promise<{ uploaded: number; failed: number }> {
    const { target } = this.options;
    if (!target) return Promise.resolve({ uploaded: 0, failed: 0 });
    return this.enqueue(() => processUploads(this.options.db, { target, backupDir: this.options.backupDir, now: this.options.now }));
  }

  private lastOk(kinds: BackupKind[]): { started_at: string } | undefined {
    return this.options.db.prepare(`SELECT started_at FROM backup_runs WHERE status = 'ok' AND kind IN (${kinds.map(() => '?').join(',')}) ORDER BY started_at DESC LIMIT 1`)
      .get(...kinds) as { started_at: string } | undefined;
  }

  /** ตรวจทุกนาที: ถึงรอบ interval หรือยังไม่มี daily ของวันนี้ */
  async tick(): Promise<void> {
    const now = this.options.now();
    const daily = this.lastOk(['daily']);
    if (!daily || bangkokDateKey(daily.started_at) !== bangkokDateKey(now)) {
      await this.snapshot('daily');
    } else {
      const last = this.lastOk(['interval', 'daily', 'shift_close', 'manual']);
      if (!last || Date.parse(now) - Date.parse(last.started_at) >= this.options.intervalMinutes * 60_000) await this.snapshot('interval');
    }
    await this.prune();
    await this.upload();
  }

  /** ลบไฟล์เกิน retention; daily เก็บ 30 วัน ที่เหลือ 48 ชม. แถวใน backup_runs คงไว้เป็นประวัติ */
  prune(): Promise<number> {
    return this.enqueue(async () => {
      const { db, backupDir } = this.options;
      const now = Date.parse(this.options.now());
      const rows = db.prepare("SELECT id, kind, started_at, file_name FROM backup_runs WHERE status = 'ok' AND pruned_at IS NULL").all() as
        { id: string; kind: BackupKind; started_at: string; file_name: string }[];
      const expired = rows.filter(r => now - Date.parse(r.started_at) > (r.kind === 'daily' ? DAILY_RETENTION_MS : SHORT_RETENTION_MS));
      for (const r of expired) {
        const path = resolve(backupDir, r.file_name);
        await rm(path, { force: true });
        await rm(manifestPathFor(path), { force: true });
        writeTx(db, () => {
          db.prepare('UPDATE backup_runs SET pruned_at = ? WHERE id = ?').run(this.options.now(), r.id);
        });
      }
      return expired.length;
    });
  }

  start(): void {
    this.recoverInterrupted();
    const run = () => { void this.tick().catch(() => {}); };
    run();
    this.timer = setInterval(run, 60_000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.chain.catch(() => {});
  }
}
