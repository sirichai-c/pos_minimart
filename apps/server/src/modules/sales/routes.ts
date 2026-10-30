import type { FastifyInstance } from 'fastify';
import { CheckoutBody, VoidBody, type CheckoutRequest, type VoidRequest } from '@pos/contracts';
import { bangkokDayRange, fail, isUuid } from '@pos/domain';
import { findRequest, idempotent } from '../../db/tx.ts';
import { contextOf, requireRole, requireUser } from '../../http/auth-hooks.ts';
import { idempotencyKeyOf, queryString, sendIdempotent } from '../../http/reply.ts';
import type { AppDeps } from '../../app.ts';
import { checkout, getSale, listSales, voidSale } from './service.ts';

export function salesRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  app.post('/api/sales', { schema: { body: CheckoutBody } }, async (req, reply) => {
    const ctx = contextOf(req, clock);
    const body = req.body as CheckoutRequest;
    const outcome = idempotent(db, ctx, { key: idempotencyKeyOf(req), scope: 'sales.checkout', payload: body, fn: () => checkout(db, ctx, body) });
    return sendIdempotent(reply, outcome);
  });

  app.get('/api/sales', async req => {
    requireUser(req);
    const query = req.query as Record<string, unknown>;
    const date = queryString(query.date);
    const range = date ? bangkokDayRange(date) : undefined;
    return listSales(db, { shiftId: queryString(query.shiftId), q: queryString(query.q), ...(range ?? {}) });
  });

  app.get('/api/sales/:id', async req => {
    requireUser(req);
    const sale = getSale(db, (req.params as { id: string }).id);
    if (!sale) fail('NOT_FOUND', 'ไม่พบบิล');
    return sale;
  });

  app.post('/api/sales/:id/void', { preValidation: requireRole('owner'), schema: { body: VoidBody } }, async (req, reply) => {
    const ctx = contextOf(req, clock);
    const { id } = req.params as { id: string };
    const body = req.body as VoidRequest;
    const outcome = idempotent(db, ctx, {
      key: idempotencyKeyOf(req), scope: 'sales.void', payload: { saleId: id, ...body }, statusCode: 200,
      fn: () => voidSale(db, ctx, id, body),
    });
    return sendIdempotent(reply, outcome);
  });

  // กู้ผลคำขอ: 200 + ผลเดิม หรือ 404 (ยังไม่ commit ส่งซ้ำด้วย key เดิมได้)
  app.get('/api/requests/:key', async (req, reply) => {
    const user = requireUser(req);
    const { key } = req.params as { key: string };
    if (!isUuid(key)) fail('VALIDATION_FAILED', 'key ไม่ถูกต้อง');
    const found = findRequest(db, key.toLowerCase());
    if (!found || (found.userId !== user.id && user.role !== 'owner')) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'ยังไม่พบผลของคำขอนี้ ส่งซ้ำด้วย key เดิมได้อย่างปลอดภัย' } });
    }
    return { key, scope: found.scope, statusCode: found.statusCode, createdAt: found.createdAt, result: found.result };
  });
}
