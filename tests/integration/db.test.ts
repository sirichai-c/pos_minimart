import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../apps/server/src/db/connection.ts';
import { currentSchemaVersion, latestSchemaVersion, migrate } from '../../apps/server/src/db/migrate.ts';
import type { Db } from '../../apps/server/src/db/tx.ts';

let dir: string;
let db: Db;

function setup(): Db {
  dir = mkdtempSync(join(tmpdir(), 'pos-db-'));
  db = openDb(join(dir, 'pos.db'));
  migrate(db);
  const now = '2026-10-26T00:00:00.000Z';
  db.prepare("INSERT INTO users (id, username, display_name, role, password_hash, created_at) VALUES ('u1', 'owner', 'O', 'owner', 'x', ?)").run(now);
  db.prepare("INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES ('p1', 'A', 'A', 100, ?, ?)").run(now, now);
  db.prepare("INSERT INTO inventory_balances (product_id, on_hand) VALUES ('p1', 1)").run();
  return db;
}

afterEach(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('db connection and constraints', () => {
  it('sets PRAGMA on every connection', () => {
    setup();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(2); // FULL
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('records schema version and is re-runnable', () => {
    setup();
    expect(currentSchemaVersion(db)).toBe(latestSchemaVersion());
    expect(migrate(db)).toEqual([]);
  });

  it('prevents negative stock', () => {
    setup();
    expect(() => db.prepare("UPDATE inventory_balances SET on_hand = -1 WHERE product_id = 'p1'").run()).toThrow(/CHECK/);
  });

  it('allows only one open shift', () => {
    setup();
    db.prepare("INSERT INTO shifts (id, opened_by, opened_at, opening_cash) VALUES ('s1', 'u1', 'now', 0)").run();
    expect(() => db.prepare("INSERT INTO shifts (id, opened_by, opened_at, opening_cash) VALUES ('s2', 'u1', 'now', 0)").run()).toThrow(/UNIQUE/);
  });

  it('allows a sale to be voided only once and keeps sales immutable', () => {
    setup();
    db.prepare("INSERT INTO shifts (id, opened_by, opened_at, opening_cash) VALUES ('s1', 'u1', 'now', 0)").run();
    db.prepare("INSERT INTO sales (id, bill_no, shift_id, cashier_id, total, created_at) VALUES ('x1', 'B1', 's1', 'u1', 100, 'now')").run();
    const insertVoid = db.prepare("INSERT INTO sale_voids (id, sale_id, shift_id, amount, reason, approved_by, created_at) VALUES (?, 'x1', 's1', 100, 'r', 'u1', 'now')");
    insertVoid.run('v1');
    expect(() => insertVoid.run('v2')).toThrow(/UNIQUE/);
    expect(() => db.prepare("UPDATE sales SET total = 1 WHERE id = 'x1'").run()).toThrow(/immutable/);
    expect(() => db.prepare("DELETE FROM sales WHERE id = 'x1'").run()).toThrow(/immutable/);
  });

  it('keeps audit append-only and closed shifts immutable', () => {
    setup();
    db.prepare("INSERT INTO audit_events (action, entity_type, entity_id, created_at) VALUES ('a', 'b', 'c', 'now')").run();
    expect(() => db.prepare('UPDATE audit_events SET action = ?').run('z')).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_events').run()).toThrow(/append-only/);
    db.prepare("INSERT INTO shifts (id, opened_by, opened_at, opening_cash, closed_at) VALUES ('s9', 'u1', 'now', 0, 'later')").run();
    expect(() => db.prepare("UPDATE shifts SET counted_cash = 5 WHERE id = 's9'").run()).toThrow(/closed/);
  });

  it('enforces line_total = unit_price × quantity', () => {
    setup();
    db.prepare("INSERT INTO shifts (id, opened_by, opened_at, opening_cash) VALUES ('s1', 'u1', 'now', 0)").run();
    db.prepare("INSERT INTO sales (id, bill_no, shift_id, cashier_id, total, created_at) VALUES ('x1', 'B1', 's1', 'u1', 100, 'now')").run();
    expect(() => db.prepare("INSERT INTO sale_items (id, sale_id, line_no, product_id, sku, name, unit_price, quantity, line_total) VALUES ('i1', 'x1', 1, 'p1', 'A', 'A', 100, 2, 100)").run()).toThrow(/CHECK/);
  });
});
