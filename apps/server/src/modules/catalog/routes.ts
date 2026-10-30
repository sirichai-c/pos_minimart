import type { FastifyInstance } from 'fastify';
import { CreateProductBody, UpdateProductBody, type CreateProductRequest, type ProductView, type UpdateProductRequest } from '@pos/contracts';
import { fail, normalizeBarcode, normalizeSku } from '@pos/domain';
import { audit, idempotent, newId, type Db } from '../../db/tx.ts';
import { contextOf, requireRole, requireUser } from '../../http/auth-hooks.ts';
import { idempotencyKeyOf, queryString, sendIdempotent } from '../../http/reply.ts';
import type { AppDeps } from '../../app.ts';
import { applyMovement, getProduct, PRODUCT_SELECT, toProductView } from '../inventory/service.ts';

function assertUnique(db: Db, sku: string, barcode: string | null, exceptId: string | null): void {
  if (db.prepare('SELECT 1 FROM products WHERE sku = ? AND id IS NOT ?').get(sku, exceptId)) fail('DUPLICATE_SKU', `SKU ${sku} มีอยู่แล้ว`);
  if (barcode && db.prepare('SELECT 1 FROM products WHERE barcode = ? AND id IS NOT ?').get(barcode, exceptId)) fail('DUPLICATE_BARCODE', `บาร์โค้ด ${barcode} มีอยู่แล้ว`);
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, c => '\\' + c);

export function catalogRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const owner = { preValidation: requireRole('owner') };

  // ค้นด้วยชื่อ/SKU/บาร์โค้ด; ใส่ barcode= เพื่อหาตรงตัวจากเครื่องสแกน
  app.get('/api/products', async req => {
    requireUser(req);
    const query = req.query as Record<string, unknown>;
    const q = queryString(query.q);
    const barcode = queryString(query.barcode);
    const active = queryString(query.active);
    const limit = Math.min(Math.max(Number(query.limit ?? 200) || 200, 1), 1000);
    const where: string[] = [];
    const params: unknown[] = [];
    if (barcode) { where.push('(p.barcode = ? OR p.sku = ?)'); params.push(barcode, barcode.toUpperCase()); }
    if (q) {
      const like = `%${escapeLike(q)}%`;
      where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
    }
    if (active === 'true' || active === 'false') { where.push('p.active = ?'); params.push(active === 'true' ? 1 : 0); }
    const sql = `${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.active DESC, p.name LIMIT ?`;
    return (db.prepare(sql).all(...params, limit) as Parameters<typeof toProductView>[0][]).map(toProductView);
  });

  app.get('/api/products/:id', async req => {
    requireUser(req);
    const product = getProduct(db, (req.params as { id: string }).id);
    if (!product) fail('NOT_FOUND', 'ไม่พบสินค้า');
    return product;
  });

  app.post('/api/products', { ...owner, schema: { body: CreateProductBody } }, async (req, reply) => {
    const ctx = contextOf(req, clock);
    const body = req.body as CreateProductRequest;
    const outcome = idempotent(db, ctx, {
      key: idempotencyKeyOf(req), scope: 'products.create', payload: body,
      fn: (): ProductView => {
        const sku = normalizeSku(body.sku);
        const barcode = normalizeBarcode(body.barcode);
        const name = body.name.trim();
        if (!name) fail('VALIDATION_FAILED', 'กรุณาระบุชื่อสินค้า');
        assertUnique(db, sku, barcode, null);
        const id = newId();
        db.prepare('INSERT INTO products (id, sku, barcode, name, price, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
          .run(id, sku, barcode, name, body.price, ctx.now, ctx.now);
        db.prepare('INSERT INTO inventory_balances (product_id, on_hand) VALUES (?, 0)').run(id);
        if (body.openingQuantity) {
          applyMovement(db, ctx, { productId: id, quantity: body.openingQuantity, kind: 'opening', sourceType: 'product', sourceId: id, reason: 'ยอดตั้งต้น' });
        }
        audit(db, ctx, 'product.created', 'product', id, { sku, barcode, name, price: body.price, openingQuantity: body.openingQuantity ?? 0 });
        return getProduct(db, id)!;
      },
    });
    return sendIdempotent(reply, outcome);
  });

  app.patch('/api/products/:id', { ...owner, schema: { body: UpdateProductBody } }, async (req, reply) => {
    const ctx = contextOf(req, clock);
    const { id } = req.params as { id: string };
    const body = req.body as UpdateProductRequest;
    const outcome = idempotent(db, ctx, {
      key: idempotencyKeyOf(req), scope: 'products.update', payload: { id, ...body }, statusCode: 200,
      fn: (): ProductView => {
        const before = getProduct(db, id);
        if (!before) fail('NOT_FOUND', 'ไม่พบสินค้า');
        const sku = body.sku !== undefined ? normalizeSku(body.sku) : before.sku;
        const barcode = body.barcode !== undefined ? normalizeBarcode(body.barcode) : before.barcode;
        const name = body.name !== undefined ? body.name.trim() : before.name;
        if (!name) fail('VALIDATION_FAILED', 'กรุณาระบุชื่อสินค้า');
        const price = body.price ?? before.price;
        const active = body.active ?? before.active;
        assertUnique(db, sku, barcode, id);
        db.prepare('UPDATE products SET sku = ?, barcode = ?, name = ?, price = ?, active = ?, updated_at = ? WHERE id = ?')
          .run(sku, barcode, name, price, active ? 1 : 0, ctx.now, id);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (sku !== before.sku) changes.sku = { from: before.sku, to: sku };
        if (barcode !== before.barcode) changes.barcode = { from: before.barcode, to: barcode };
        if (name !== before.name) changes.name = { from: before.name, to: name };
        if (price !== before.price) changes.price = { from: before.price, to: price };
        if (active !== before.active) changes.active = { from: before.active, to: active };
        audit(db, ctx, changes.price ? 'product.price_changed' : 'product.updated', 'product', id, changes);
        return getProduct(db, id)!;
      },
    });
    return sendIdempotent(reply, outcome);
  });
}
