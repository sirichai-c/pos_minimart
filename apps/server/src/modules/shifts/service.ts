import { cashVariance, expectedCash, fail } from '@pos/domain';
import type { CashMovementView, ShiftSummary, ShiftView } from '@pos/contracts';
import type { Db } from '../../db/tx.ts';

interface ShiftRow {
  id: string; opened_by: string; opened_by_name: string; opened_at: string; opening_cash: number;
  closed_by: string | null; closed_at: string | null; expected_cash: number | null; counted_cash: number | null;
  variance: number | null; close_snapshot: string | null;
}

const SHIFT_SELECT = 'SELECT s.*, u.display_name AS opened_by_name FROM shifts s JOIN users u ON u.id = s.opened_by';

export function computeSummary(db: Db, shiftId: string, opening: number): ShiftSummary {
  const sales = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM sales WHERE shift_id = ?').get(shiftId) as { n: number; total: number };
  const voids = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM sale_voids WHERE shift_id = ?').get(shiftId) as { n: number; total: number };
  const cash = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount END), 0) AS cash_in,
                                  COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS cash_out
                           FROM cash_movements WHERE shift_id = ?`).get(shiftId) as { cash_in: number; cash_out: number };
  const totals = { opening, gross: sales.total, voids: voids.total, refunds: 0, cashIn: cash.cash_in, cashOut: cash.cash_out };
  return { ...totals, net: totals.gross - totals.voids - totals.refunds, expectedCash: expectedCash(totals), saleCount: sales.n, voidCount: voids.n };
}

function cashMovements(db: Db, shiftId: string): CashMovementView[] {
  return (db.prepare('SELECT * FROM cash_movements WHERE shift_id = ? ORDER BY created_at, rowid').all(shiftId) as
    { id: string; shift_id: string; direction: 'in' | 'out'; amount: number; reason: string; user_id: string; created_at: string }[])
    .map(r => ({ id: r.id, shiftId: r.shift_id, direction: r.direction, amount: r.amount, reason: r.reason, userId: r.user_id, createdAt: r.created_at }));
}

function toView(db: Db, row: ShiftRow): ShiftView {
  // กะที่ปิดแล้วใช้ snapshot ตอนปิด ตัวเลขจึงไม่เปลี่ยนภายหลัง (R05)
  const summary = row.close_snapshot ? (JSON.parse(row.close_snapshot) as ShiftSummary) : computeSummary(db, row.id, row.opening_cash);
  return {
    id: row.id, openedBy: row.opened_by, openedByName: row.opened_by_name, openedAt: row.opened_at, openingCash: row.opening_cash,
    closedBy: row.closed_by, closedAt: row.closed_at, expectedCash: row.expected_cash, countedCash: row.counted_cash, variance: row.variance,
    summary, cashMovements: cashMovements(db, row.id),
  };
}

export function getShift(db: Db, id: string): ShiftView | null {
  const row = db.prepare(`${SHIFT_SELECT} WHERE s.id = ?`).get(id) as ShiftRow | undefined;
  return row ? toView(db, row) : null;
}

export function openShiftRow(db: Db): { id: string; opening_cash: number } | null {
  return (db.prepare('SELECT id, opening_cash FROM shifts WHERE closed_at IS NULL').get() as { id: string; opening_cash: number } | undefined) ?? null;
}

export function currentShift(db: Db): ShiftView | null {
  const open = openShiftRow(db);
  return open ? getShift(db, open.id) : null;
}

export function listShifts(db: Db, limit = 60): ShiftView[] {
  return (db.prepare(`${SHIFT_SELECT} ORDER BY s.opened_at DESC LIMIT ?`).all(limit) as ShiftRow[]).map(r => toView(db, r));
}

/** ทุก sale, void และเงินนำเข้า/ออกต้องผูกกะที่เปิดอยู่ */
export function requireOpenShift(db: Db, shiftId?: string): { id: string; opening_cash: number } {
  const open = openShiftRow(db);
  if (shiftId) {
    const exists = db.prepare('SELECT closed_at FROM shifts WHERE id = ?').get(shiftId) as { closed_at: string | null } | undefined;
    if (!exists) fail('NOT_FOUND', 'ไม่พบกะ');
    if (exists.closed_at) fail('SHIFT_CLOSED', 'กะนี้ปิดแล้ว');
  }
  if (!open) fail('NO_OPEN_SHIFT', 'ยังไม่ได้เปิดกะ กรุณาเปิดกะก่อน');
  return open;
}

export function closeSnapshot(db: Db, shiftId: string, countedCash: number) {
  const shift = db.prepare('SELECT opening_cash FROM shifts WHERE id = ?').get(shiftId) as { opening_cash: number };
  const summary = computeSummary(db, shiftId, shift.opening_cash);
  return { summary, expected: summary.expectedCash, variance: cashVariance(countedCash, summary.expectedCash) };
}
