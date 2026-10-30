import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection.ts';

export const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

interface Migration { version: number; name: string; sql: string }

export function listMigrations(dir = migrationsDir): Migration[] {
  return readdirSync(dir)
    .filter(f => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map(f => ({ version: Number(f.slice(0, 4)), name: f, sql: readFileSync(resolve(dir, f), 'utf8') }));
}

/** เวอร์ชันล่าสุดที่โปรแกรมรุ่นนี้รู้จัก */
export function latestSchemaVersion(dir = migrationsDir): number {
  return listMigrations(dir).at(-1)?.version ?? 0;
}

export function currentSchemaVersion(db: Db): number {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!exists) return 0;
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

/** รัน migrations ที่ค้างตามเลข แต่ละไฟล์อยู่ใน transaction ของตัวเอง */
export function migrate(db: Db, now = () => new Date().toISOString(), dir = migrationsDir): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const current = currentSchemaVersion(db);
  const migrations = listMigrations(dir);
  const latest = migrations.at(-1)?.version ?? 0;
  if (current > latest) {
    throw new Error(`ฐานข้อมูลเป็น schema ${current} ใหม่กว่าโปรแกรมรุ่นนี้ (${latest}) ห้ามใช้โปรแกรมรุ่นเก่ากับข้อมูลนี้`);
  }
  const applied: number[] = [];
  for (const m of migrations.filter(m => m.version > current)) {
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, now());
    }).immediate();
    applied.push(m.version);
  }
  return applied;
}
