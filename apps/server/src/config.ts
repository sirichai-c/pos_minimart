import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_VERSION = '0.1.0';
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface UploadTargetConfig {
  /** สำเนาไปยังโฟลเดอร์อื่น เช่น USB หรือดิสก์ที่สอง (T5.4) หรือโฟลเดอร์ sync ของ cloud */
  kind: 'directory';
  path: string;
}

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  webDist: string;
  /** Origin ที่อนุญาตให้เรียก API ที่เปลี่ยนข้อมูล นอกจาก origin ของ server เอง */
  extraOrigins: string[];
  sessionTtlHours: number;
  loginMaxAttempts: number;
  loginLockMinutes: number;
  backupIntervalMinutes: number;
  upload: UploadTargetConfig | null;
}

/**
 * อ่านค่าจาก data/config.json (ถ้ามี) แล้วทับด้วย env
 * credentials ของปลายทาง backup อยู่ไฟล์นี้หรือ env เท่านั้น ไม่อยู่ในฐานข้อมูล จึงไม่ติดไปกับ snapshot
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = resolve(env.POS_DATA_DIR ?? resolve(repoRoot, 'data'));
  const file = resolve(dataDir, 'config.json');
  const fromFile = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>) : {};
  const port = Number(env.POS_PORT ?? fromFile.port ?? 4180);
  const uploadDir = env.POS_UPLOAD_DIR;
  return {
    host: '127.0.0.1',
    port,
    dataDir,
    dbPath: resolve(env.POS_DB_PATH ?? fromFile.dbPath ?? resolve(dataDir, 'pos.db')),
    backupDir: resolve(env.POS_BACKUP_DIR ?? fromFile.backupDir ?? resolve(dataDir, 'backups')),
    webDist: resolve(repoRoot, 'apps/web/dist'),
    extraOrigins: (env.POS_EXTRA_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    sessionTtlHours: fromFile.sessionTtlHours ?? 12,
    loginMaxAttempts: fromFile.loginMaxAttempts ?? 5,
    loginLockMinutes: fromFile.loginLockMinutes ?? 15,
    backupIntervalMinutes: fromFile.backupIntervalMinutes ?? 15,
    upload: uploadDir ? { kind: 'directory', path: resolve(uploadDir) } : (fromFile.upload ?? null),
  };
}
