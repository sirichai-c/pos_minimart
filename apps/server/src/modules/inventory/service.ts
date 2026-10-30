import { fail } from '@pos/domain';
import type { ProductView, StockMovementView } from '@pos/contracts';
import { newId, type Db, type RequestContext } from '../../db/tx.ts';

export type MovementKind = StockMovementView['kind'];

interface ProductRow { id: string; sku: string; barcode: string | null; name: string; price: number; active: number; on_hand: number; created_at: string; updated_at: string }

export const PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.barcode, p.name, p.price, p.active, p.created_at, p.updated_at, COALESCE(b.on_hand, 0) AS on_hand
  FROM products p LEFT JOIN inventory_balances b ON b.product_id = p.id`;

export function toProductView(row: ProductRow): ProductView {
  return {
    id: row.id, sku: row.sku, barcode: row.barcode, name: row.name, price: row.price,
    active: row.active === 1, onHand: row.on_hand, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function getProduct(db: Db, id: string): ProductView | null {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id) as ProductRow | undefined;
  return row ? toProductView(row) : null;
}

interface MovementRow { id: string; product_id: string; kind: MovementKind; quantity: number; balance_after: number; source_type: string; source_id: string; reason: string | null; user_id: string; user_name: string; created_at: string }

const MOVEMENT_SELECT = `
  SELECT m.*, u.display_name AS user_name FROM stock_movements m JOIN users u ON u.id = m.user_id`;

function toMovementView(row: MovementRow): StockMovementView {
  return {
    id: row.id, productId: row.product_id, kind: row.kind, quantity: row.quantity, balanceAfter: row.balance_after,
    sourceType: row.source_type, sourceId: row.source_id, reason: row.reason, userId: row.user_id, userName: row.user_name, createdAt: row.created_at,
  };
}

export function listMovements(db: Db, productId: string, limit = 500): StockMovementView[] {
  return (db.prepare(`${MOVEMENT_SELECT} WHERE m.product_id = ? ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`).all(productId, limit) as MovementRow[]).map(toMovementView);
}

/**
 * เปลี่ยนยอดคงเหลือพร้อม movement ใน transaction ที่เรียกอยู่ (R02)
 * ต้องเรียกภายใน writeTx/idempotent เท่านั้น
 */
export function applyMovement(db: Db, ctx: RequestContext, args: {
  productId: string; quantity: number; kind: MovementKind; sourceType: string; sourceId: string; reason?: string | null;
}): StockMovementView {
  if (!Number.isSafeInteger(args.quantity) || args.quantity === 0) fail('VALIDATION_FAILED', 'จำนวนที่เปลี่ยนต้องเป็นจำนวนเต็มที่ไม่ใช่ศูนย์');
  const balance = db.prepare('SELECT on_hand FROM inventory_balances WHERE product_id = ?').get(args.productId) as { on_hand: number } | undefined;
  if (!balance) fail('NOT_FOUND', 'ไม่พบสินค้า');
  const after = balance.on_hand + args.quantity;
  if (!Number.isSafeInteger(after)) fail('AMOUNT_OVERFLOW', 'จำนวนสินค้าเกินขอบเขต');
  if (after < 0) fail('INSUFFICIENT_STOCK', 'สินค้าคงเหลือไม่พอ', { shortages: [{ productId: args.productId, requested: -args.quantity, onHand: balance.on_hand }] });
  db.prepare('UPDATE inventory_balances SET on_hand = ?, version = version + 1 WHERE product_id = ?').run(after, args.productId);
  const id = newId();
  db.prepare(`INSERT INTO stock_movements (id, product_id, kind, quantity, balance_after, source_type, source_id, reason, user_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, args.productId, args.kind, args.quantity, after, args.sourceType, args.sourceId, args.reason ?? null, ctx.userId, ctx.now);
  return toMovementView(db.prepare(`${MOVEMENT_SELECT} WHERE m.id = ?`).get(id) as MovementRow);
}

/** ตรวจว่าคงเหลือทุกสินค้าเท่ากับผลรวม movement (ใช้ใน test และหน้าระบบ) */
export function findBalanceMismatches(db: Db): { productId: string; onHand: number; movementSum: number }[] {
  return db.prepare(`
    SELECT b.product_id AS productId, b.on_hand AS onHand, COALESCE(SUM(m.quantity), 0) AS movementSum
    FROM inventory_balances b LEFT JOIN stock_movements m ON m.product_id = b.product_id
    GROUP BY b.product_id HAVING onHand <> movementSum`).all() as { productId: string; onHand: number; movementSum: number }[];
}
