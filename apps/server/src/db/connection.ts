import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

/** เปิด SQLite พร้อม PRAGMA ตามสเปก ส่วน 4 */
export function openDb(path: string, options: { readonly?: boolean } = {}): Db {
  if (path !== ':memory:' && !options.readonly) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false });
  if (!options.readonly) db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
