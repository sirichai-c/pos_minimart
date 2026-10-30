import { billNumber, changeFor, fail, priceCart, type ProductForSale } from '@pos/domain';
import type { CheckoutRequest, SaleListItem, SaleResponse, VoidRequest } from '@pos/contracts';
import { audit, newId, type Db, type RequestContext } from '../../db/tx.ts';
import { applyMovement } from '../inventory/service.ts';
import { requireOpenShift } from '../shifts/service.ts';

interface SaleRow { id: string; bill_no: string; shift_id: string; cashier_id: string; cashier_name: string; total: number; created_at: string }

export function getSale(db: Db, id: string): SaleResponse | null {
  const sale = db.prepare('SELECT s.*, u.display_name AS cashier_name FROM sales s JOIN users u ON u.id = s.cashier_id WHERE s.id = ? OR s.bill_no = ?')
    .get(id, id.toUpperCase()) as SaleRow | undefined;
  if (!sale) return null;
  const items = db.prepare('SELECT product_id, sku, name, unit_price, quantity, line_total FROM sale_items WHERE sale_id = ? ORDER BY line_no').all(sale.id) as
    { product_id: string; sku: string; name: string; unit_price: number; quantity: number; line_total: number }[];
  const payment = db.prepare('SELECT tendered, change FROM payments WHERE sale_id = ?').get(sale.id) as { tendered: number; change: number };
  const voided = db.prepare('SELECT v.reason, v.approved_by, u.display_name AS approved_by_name, v.created_at FROM sale_voids v JOIN users u ON u.id = v.approved_by WHERE v.sale_id = ?')
    .get(sale.id) as { reason: string; approved_by: string; approved_by_name: string; created_at: string } | undefined;
  return {
    id: sale.id, billNo: sale.bill_no, shiftId: sale.shift_id, cashierId: sale.cashier_id, cashierName: sale.cashier_name, createdAt: sale.created_at,
    items: items.map(i => ({ productId: i.product_id, sku: i.sku, name: i.name, unitPrice: i.unit_price, quantity: i.quantity, lineTotal: i.line_total })),
    total: sale.total, tendered: payment.tendered, change: payment.change,
    voided: voided ? { reason: voided.reason, approvedBy: voided.approved_by, approvedByName: voided.approved_by_name, createdAt: voided.created_at } : null,
  };
}

export function listSales(db: Db, filter: { shiftId?: string; start?: string; end?: string; q?: string; limit?: number }): SaleListItem[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.shiftId) { where.push('s.shift_id = ?'); params.push(filter.shiftId); }
  if (filter.start && filter.end) { where.push('s.created_at >= ? AND s.created_at < ?'); params.push(filter.start, filter.end); }
  if (filter.q) { where.push('s.bill_no LIKE ?'); params.push(`%${filter.q.toUpperCase().replace(/[%_\\]/g, '')}%`); }
  const rows = db.prepare(`
    SELECT s.id, s.bill_no, s.shift_id, u.display_name AS cashier_name, s.created_at, s.total,
           (SELECT COALESCE(SUM(quantity), 0) FROM sale_items i WHERE i.sale_id = s.id) AS item_count,
           EXISTS (SELECT 1 FROM sale_voids v WHERE v.sale_id = s.id) AS voided
    FROM sales s JOIN users u ON u.id = s.cashier_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.created_at DESC LIMIT ?`).all(...params, filter.limit ?? 500) as
    { id: string; bill_no: string; shift_id: string; cashier_name: string; created_at: string; total: number; item_count: number; voided: number }[];
  return rows.map(r => ({ id: r.id, billNo: r.bill_no, shiftId: r.shift_id, cashierName: r.cashier_name, createdAt: r.created_at, total: r.total, itemCount: r.item_count, voided: r.voided === 1 }));
}

/**
 * ลำดับใน transaction: ตรวจกะเปิด → อ่านสินค้า+balance → priceCart() → changeFor()
 * → insert sales, sale_items, payments → update balance + stock_movements → audit
 * (idempotent() ครอบภายนอกและบันทึกผลใน transaction เดียวกัน)
 */
export function checkout(db: Db, ctx: RequestContext, body: CheckoutRequest): SaleResponse {
  const shift = requireOpenShift(db);
  const ids = [...new Set(body.items.map(i => i.productId))];
  const rows = db.prepare(`
    SELECT p.id, p.sku, p.name, p.price, p.active, COALESCE(b.on_hand, 0) AS on_hand
    FROM products p LEFT JOIN inventory_balances b ON b.product_id = p.id
    WHERE p.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: string; sku: string; name: string; price: number; active: number; on_hand: number }[];
  const products = new Map<string, ProductForSale>(rows.map(r => [r.id, { id: r.id, sku: r.sku, name: r.name, price: r.price, active: r.active === 1, onHand: r.on_hand }]));
  const priced = priceCart(body.items, products);
  const change = changeFor(priced.total, body.tendered);

  const saleId = newId();
  const billNo = billNumber(saleId);
  db.prepare('INSERT INTO sales (id, bill_no, shift_id, cashier_id, total, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(saleId, billNo, shift.id, ctx.userId, priced.total, ctx.now);
  const insertItem = db.prepare('INSERT INTO sale_items (id, sale_id, line_no, product_id, sku, name, unit_price, quantity, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  priced.lines.forEach((line, index) => {
    insertItem.run(newId(), saleId, index + 1, line.productId, line.sku, line.name, line.unitPrice, line.quantity, line.lineTotal);
  });
  db.prepare("INSERT INTO payments (id, sale_id, method, tendered, change, amount) VALUES (?, ?, 'cash', ?, ?, ?)").run(newId(), saleId, body.tendered, change, priced.total);
  for (const line of priced.lines) {
    applyMovement(db, ctx, { productId: line.productId, quantity: -line.quantity, kind: 'sale', sourceType: 'sale', sourceId: saleId });
  }
  audit(db, ctx, 'sale.created', 'sale', saleId, { billNo, total: priced.total, tendered: body.tendered, change, lines: priced.lines.length });
  return getSale(db, saleId)!;
}

/** R04: owner ยกเลิกทั้งบิลในกะเดิมที่ยังเปิด ได้ครั้งเดียว */
export function voidSale(db: Db, ctx: RequestContext, saleId: string, body: VoidRequest): SaleResponse {
  const sale = getSale(db, saleId);
  if (!sale) fail('NOT_FOUND', 'ไม่พบบิล');
  if (sale.voided) fail('ALREADY_VOIDED', 'บิลนี้ถูกยกเลิกแล้ว', { voidedAt: sale.voided.createdAt });
  const open = db.prepare('SELECT id FROM shifts WHERE closed_at IS NULL').get() as { id: string } | undefined;
  if (!open || open.id !== sale.shiftId) fail('VOID_NOT_ALLOWED', 'ยกเลิกได้เฉพาะบิลในกะที่ยังเปิดอยู่');
  if (!body.cashReturned || !body.goodsReturned) fail('VOID_NOT_ALLOWED', 'ต้องยืนยันการคืนเงินและสินค้าครบ');
  const voidId = newId();
  db.prepare('INSERT INTO sale_voids (id, sale_id, shift_id, amount, reason, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(voidId, sale.id, sale.shiftId, sale.total, body.reason.trim(), ctx.userId, ctx.now);
  for (const line of sale.items) {
    applyMovement(db, ctx, { productId: line.productId, quantity: line.quantity, kind: 'void', sourceType: 'sale_void', sourceId: voidId, reason: body.reason.trim() });
  }
  audit(db, ctx, 'sale.voided', 'sale', sale.id, { billNo: sale.billNo, amount: sale.total, reason: body.reason.trim(), voidId });
  return getSale(db, sale.id)!;
}
