import type { FastifyInstance } from 'fastify';
import { AdjustmentBody, ReceiptBody, type AdjustmentRequest, type InventoryChangeResult, type ReceiptRequest } from '@pos/contracts';
import { fail } from '@pos/domain';
import { audit, idempotent, newId } from '../../db/tx.ts';
import { contextOf, requireRole } from '../../http/auth-hooks.ts';
import { idempotencyKeyOf, sendIdempotent } from '../../http/reply.ts';
import type { AppDeps } from '../../app.ts';
import { applyMovement, getProduct, listMovements } from './service.ts';

export function inventoryRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const owner = { preValidation: requireRole('owner') };

  app.post('/api/inventory/receipts', { ...owner, schema: { body: ReceiptBody } }, async (req, reply) => {
    const ctx = contextOf(req, clock);
    const body = req.body as ReceiptRequest;
    const outcome = idempotent(db, ctx, {
      key: idempotencyKeyOf(req), scope: 'inventory.receipt', payload: body,
      fn: (): InventoryChangeResult => {
        if (!getProduct(db, body.productId)) fail('NOT_FOUND', 'ไม่พบสินค้า');
        const receiptId = newId();
        const movement = applyMovement(db, ctx, {
          productId: body.productId, quantity: body.quantity, kind: 'receipt',
          sourceType: 'inventory_receipt', sourceId: receiptId, reason: body.reason.trim(),
        });
        audit(db, ctx, 'inventory.received', 'product', body.productId, { quantity: body.quantity, balanceAfter: movement.balanceAfter, reason: body.reason.trim() });
        return { movement, product: getProduct(db, body.productId)! };
      },
    });
    return sendIdempotent(reply, outcome);
  });

  // ปรับเป็นยอดนับจริง: ส่วนต่างคำนวณจาก balance ขณะเขียน ไม่ใช้ยอดเก่าจากหน้าจอ (R02)
  app.post('/api/inventory/adjustments', { ...owner, schema: { body: AdjustmentBody } }, async (req, reply) => {
    const ctx = contextOf(req, clock);
    const body = req.body as AdjustmentRequest;
    const outcome = idempotent(db, ctx, {
      key: idempotencyKeyOf(req), scope: 'inventory.adjustment', payload: body,
      fn: (): InventoryChangeResult => {
        const product = getProduct(db, body.productId);
        if (!product) fail('NOT_FOUND', 'ไม่พบสินค้า');
        const diff = body.countedQuantity - product.onHand;
        const adjustmentId = newId();
        const movement = diff === 0 ? null : applyMovement(db, ctx, {
          productId: body.productId, quantity: diff, kind: 'adjustment',
          sourceType: 'inventory_adjustment', sourceId: adjustmentId, reason: body.reason.trim(),
        });
        audit(db, ctx, 'inventory.adjusted', 'product', body.productId, {
          before: product.onHand, counted: body.countedQuantity, difference: diff, reason: body.reason.trim(),
        });
        return { movement, product: getProduct(db, body.productId)! };
      },
    });
    return sendIdempotent(reply, outcome);
  });

  app.get('/api/inventory/:productId/movements', owner, async req => {
    const { productId } = req.params as { productId: string };
    if (!getProduct(db, productId)) fail('NOT_FOUND', 'ไม่พบสินค้า');
    return listMovements(db, productId);
  });
}
