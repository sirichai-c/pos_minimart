import type { FastifyInstance } from 'fastify';
import {
  CashMovementBody, CloseShiftBody, OpenShiftBody,
  type CashMovementRequest, type CloseShiftRequest, type OpenShiftRequest, type ShiftView,
} from '@pos/contracts';
import { fail } from '@pos/domain';
import { audit, idempotent, newId } from '../../db/tx.ts';
import { contextOf, requireRole, requireUser } from '../../http/auth-hooks.ts';
import { idempotencyKeyOf, sendIdempotent } from '../../http/reply.ts';
import type { AppDeps } from '../../app.ts';
import { closeSnapshot, currentShift, getShift, listShifts, openShiftRow, requireOpenShift } from './service.ts';

export function shiftRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  app.get('/api/shifts/current', async req => {
    requireUser(req);
    return { shift: currentShift(db) };
  });

  app.get('/api/shifts', { preValidation: requireRole('owner') }, async () => listShifts(db));

  app.post('/api/shifts', { schema: { body: OpenShiftBody } }, async (req, reply) => {
    const ctx = contextOf(req, clock);
    const body = req.body as OpenShiftRequest;
    const outcome = idempotent(db, ctx, {
      key: idempotencyKeyOf(req), scope: 'shifts.open', payload: body,
      fn: (): ShiftView => {
        if (openShiftRow(db)) fail('SHIFT_ALREADY_OPEN', 'มีกะที่เปิดอยู่แล้ว');
        const id = newId();
        db.prepare('INSERT INTO shifts (id, opened_by, opened_at, opening_cash) VALUES (?, ?, ?, ?)').run(id, ctx.userId, ctx.now, body.openingCash);
        audit(db, ctx, 'shift.opened', 'shift', id, { openingCash: body.openingCash });
        return getShift(db, id)!;
      },
    });
    return sendIdempotent(reply, outcome);
  });

  app.post('/api/shifts/:id/cash-movements', { preValidation: requireRole('owner'), schema: { body: CashMovementBody } }, async (req, reply) => {
    const ctx = contextOf(req, clock);
    const { id: shiftId } = req.params as { id: string };
    const body = req.body as CashMovementRequest;
    const outcome = idempotent(db, ctx, {
      key: idempotencyKeyOf(req), scope: 'shifts.cash_movement', payload: { shiftId, ...body },
      fn: (): ShiftView => {
        requireOpenShift(db, shiftId);
        const id = newId();
        db.prepare('INSERT INTO cash_movements (id, shift_id, direction, amount, reason, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, shiftId, body.direction, body.amount, body.reason.trim(), ctx.userId, ctx.now);
        audit(db, ctx, body.direction === 'in' ? 'cash.in' : 'cash.out', 'shift', shiftId, { cashMovementId: id, amount: body.amount, reason: body.reason.trim() });
        return getShift(db, shiftId)!;
      },
    });
    return sendIdempotent(reply, outcome);
  });

  app.post('/api/shifts/:id/close', { schema: { body: CloseShiftBody } }, async (req, reply) => {
    const ctx = contextOf(req, clock);
    const { id: shiftId } = req.params as { id: string };
    const body = req.body as CloseShiftRequest;
    const outcome = idempotent(db, ctx, {
      key: idempotencyKeyOf(req), scope: 'shifts.close', payload: { shiftId, ...body }, statusCode: 200,
      fn: (): ShiftView => {
        const existing = getShift(db, shiftId);
        if (!existing) fail('NOT_FOUND', 'ไม่พบกะ');
        if (existing.closedAt) {
          // ปิดซ้ำด้วย key ใหม่: คืน snapshot เดิมถ้ายอดนับตรงกัน
          if (existing.countedCash === body.countedCash) return existing;
          fail('SHIFT_CLOSED', 'กะนี้ปิดแล้ว ยอดที่บันทึกไว้แก้ไขไม่ได้', { countedCash: existing.countedCash });
        }
        const snap = closeSnapshot(db, shiftId, body.countedCash);
        db.prepare('UPDATE shifts SET closed_by = ?, closed_at = ?, expected_cash = ?, counted_cash = ?, variance = ?, close_snapshot = ? WHERE id = ? AND closed_at IS NULL')
          .run(ctx.userId, ctx.now, snap.expected, body.countedCash, snap.variance, JSON.stringify(snap.summary), shiftId);
        audit(db, ctx, 'shift.closed', 'shift', shiftId, { expectedCash: snap.expected, countedCash: body.countedCash, variance: snap.variance, summary: snap.summary });
        return getShift(db, shiftId)!;
      },
    });
    if (!outcome.replayed) deps.backup?.requestSnapshot('shift_close');
    return sendIdempotent(reply, outcome);
  });
}
