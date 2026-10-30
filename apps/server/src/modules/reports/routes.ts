import type { FastifyInstance } from 'fastify';
import type { DailyReport } from '@pos/contracts';
import { bangkokDateKey, bangkokDayRange, fail } from '@pos/domain';
import { requireRole, requireUser } from '../../http/auth-hooks.ts';
import { queryString } from '../../http/reply.ts';
import type { AppDeps } from '../../app.ts';
import type { Db } from '../../db/tx.ts';
import { getShift, listShifts } from '../shifts/service.ts';

/** รายวันจัดกลุ่มตามเวลา Asia/Bangkok ของแต่ละรายการ จึงแยกกะที่คร่อมเที่ยงคืนออกตามวันได้ (R05) */
export function dailyReport(db: Db, date: string, now: string): DailyReport {
  const { start, end } = bangkokDayRange(date);
  const sales = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM sales WHERE created_at >= ? AND created_at < ?').get(start, end) as { n: number; total: number };
  const voids = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM sale_voids WHERE created_at >= ? AND created_at < ?').get(start, end) as { n: number; total: number };
  const cash = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount END), 0) AS cash_in,
                                  COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS cash_out
                           FROM cash_movements WHERE created_at >= ? AND created_at < ?`).get(start, end) as { cash_in: number; cash_out: number };
  const shifts = db.prepare(`SELECT id, opened_at, closed_at FROM shifts
                             WHERE opened_at < ? AND (closed_at IS NULL OR closed_at >= ?) ORDER BY opened_at`).all(end, start) as
    { id: string; opened_at: string; closed_at: string | null }[];
  return {
    date, saleCount: sales.n, voidCount: voids.n, gross: sales.total, voids: voids.total, net: sales.total - voids.total,
    cashIn: cash.cash_in, cashOut: cash.cash_out,
    shifts: shifts.map(s => ({
      id: s.id, openedAt: s.opened_at, closedAt: s.closed_at,
      crossesDay: bangkokDateKey(s.opened_at) !== bangkokDateKey(s.closed_at ?? now),
    })),
  };
}

export function reportRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  // owner ดูได้ทุกกะ; cashier ดูกะที่ตนเปิดหรือกะที่เปิดอยู่
  app.get('/api/reports/shifts/:id', async req => {
    const user = requireUser(req);
    const shift = getShift(db, (req.params as { id: string }).id);
    if (!shift) fail('NOT_FOUND', 'ไม่พบกะ');
    if (user.role !== 'owner' && shift.openedBy !== user.id && shift.closedAt !== null) fail('FORBIDDEN', 'ดูรายงานได้เฉพาะกะของตนเอง');
    return shift;
  });

  app.get('/api/reports/shifts', { preValidation: requireRole('owner') }, async () => listShifts(db));

  app.get('/api/reports/daily', { preValidation: requireRole('owner') }, async req => {
    const now = clock();
    const date = queryString((req.query as Record<string, unknown>).date) ?? bangkokDateKey(now);
    return dailyReport(db, date, now);
  });
}
