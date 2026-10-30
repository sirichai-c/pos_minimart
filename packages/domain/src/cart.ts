import { fail } from './errors.ts';
import { addSatang, assertSatang, multiplySatang, type Satang } from './money.ts';

export interface CartLineInput { productId: string; quantity: number; expectedUnitPrice: Satang }
export interface ProductForSale { id: string; sku: string; name: string; price: Satang; active: boolean; onHand: number }
export interface PricedLine { productId: string; sku: string; name: string; unitPrice: Satang; quantity: number; lineTotal: Satang }
export interface PriceChange { productId: string; oldPrice: Satang; newPrice: Satang }
export interface StockShortage { productId: string; requested: number; onHand: number }

export const MAX_CART_LINES = 200;

/**
 * คำนวณบิลจากราคาปัจจุบันบน server (R01–R02)
 * สินค้าเดียวกันหลายบรรทัดรวมจำนวนเพื่อตรวจสต๊อกทั้งบิล
 */
export function priceCart(
  lines: readonly CartLineInput[],
  products: ReadonlyMap<string, ProductForSale>,
): { lines: PricedLine[]; total: Satang } {
  if (lines.length < 1 || lines.length > MAX_CART_LINES) {
    fail('VALIDATION_FAILED', `บิลต้องมี 1–${MAX_CART_LINES} รายการ`);
  }
  const changes: PriceChange[] = [];
  const requested = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) fail('VALIDATION_FAILED', 'จำนวนสินค้าต้องเป็นจำนวนเต็มตั้งแต่ 1');
    assertSatang(line.expectedUnitPrice, 'ราคาที่แสดง');
    const product = products.get(line.productId);
    if (!product) fail('NOT_FOUND', 'ไม่พบสินค้าในบิล', { productId: line.productId });
    if (!product.active) fail('PRODUCT_INACTIVE', `${product.name} ปิดจำหน่ายแล้ว`, { productId: product.id });
    if (product.price !== line.expectedUnitPrice && !changes.some(c => c.productId === product.id)) {
      changes.push({ productId: product.id, oldPrice: line.expectedUnitPrice, newPrice: product.price });
    }
    const total = (requested.get(product.id) ?? 0) + line.quantity;
    if (!Number.isSafeInteger(total)) fail('AMOUNT_OVERFLOW', 'จำนวนสินค้าเกินขอบเขต');
    requested.set(product.id, total);
  }
  if (changes.length) fail('PRICE_CHANGED', 'ราคาสินค้าเปลี่ยน กรุณาตรวจและยืนยันราคาใหม่', { changes });

  const shortages: StockShortage[] = [...requested]
    .map(([productId, quantity]) => ({ productId, requested: quantity, onHand: products.get(productId)!.onHand }))
    .filter(s => s.requested > s.onHand);
  if (shortages.length) fail('INSUFFICIENT_STOCK', 'สินค้าคงเหลือไม่พอ', { shortages });

  let total: Satang = 0;
  const priced = lines.map(line => {
    const product = products.get(line.productId)!;
    const lineTotal = multiplySatang(product.price, line.quantity);
    total = addSatang(total, lineTotal);
    return { productId: product.id, sku: product.sku, name: product.name, unitPrice: product.price, quantity: line.quantity, lineTotal };
  });
  return { lines: priced, total };
}

export function changeFor(total: Satang, tendered: Satang): Satang {
  assertSatang(total, 'ยอดบิล');
  assertSatang(tendered, 'เงินรับ');
  if (tendered < total) fail('TENDER_TOO_LOW', 'เงินรับน้อยกว่ายอดบิล', { total, tendered });
  return tendered - total;
}
