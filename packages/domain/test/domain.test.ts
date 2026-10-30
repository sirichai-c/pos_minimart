// port จากกรณีเงิน/วันที่/canonical ใน mockup/store.test.cjs
import { describe, expect, it } from 'vitest';
import {
  AppError, bangkokDateKey, bangkokDayRange, billNumber, canonicalJson, cashVariance, changeFor,
  expectedCash, formatBaht, normalizeBarcode, normalizeSku, parseBaht, priceCart, sumSatang,
  type ProductForSale,
} from '../src/index.ts';
import { payloadHash } from '../src/hash.ts';

function codeOf(fn: () => unknown): string | undefined {
  try { fn(); } catch (err) { return err instanceof AppError ? err.code : 'NOT_APP_ERROR'; }
  return undefined;
}

describe('money', () => {
  it('parses baht text into satang without floating point', () => {
    expect(parseBaht('1,234.5')).toBe(123450);
    expect(parseBaht('0.10')).toBe(10);
    expect(parseBaht(' 35 ')).toBe(3500);
    expect(parseBaht('100000')).toBe(10000000);
  });

  it('rejects invalid money text', () => {
    for (const bad of ['', '1.234', '-5', '1,23', 'abc', '1e3', '12,34.00']) {
      expect(codeOf(() => parseBaht(bad)), bad).toBe('VALIDATION_FAILED');
    }
  });

  it('formats satang for display', () => {
    expect(formatBaht(123450)).toBe('1,234.50');
    expect(formatBaht(5)).toBe('0.05');
    expect(formatBaht(-1000)).toBe('-10.00');
  });

  it('guards safe integer bounds when summing', () => {
    expect(sumSatang([7000, 3000])).toBe(10000);
    expect(codeOf(() => sumSatang([Number.MAX_SAFE_INTEGER, 1]))).toBe('AMOUNT_OVERFLOW');
    expect(codeOf(() => sumSatang([1.5]))).toBe('VALIDATION_FAILED');
  });
});

describe('priceCart', () => {
  const coffee: ProductForSale = { id: 'p1', sku: 'COFFEE', name: 'กาแฟ', price: 3500, active: true, onHand: 10 };
  const products = new Map([[coffee.id, coffee]]);

  it('A01 prices 2 × 35 baht = 70 and change from 100 is 30', () => {
    const priced = priceCart([{ productId: 'p1', quantity: 2, expectedUnitPrice: 3500 }], products);
    expect(priced.total).toBe(7000);
    expect(priced.lines[0]).toMatchObject({ sku: 'COFFEE', unitPrice: 3500, lineTotal: 7000 });
    expect(changeFor(priced.total, 10000)).toBe(3000);
  });

  it('A06 reports PRICE_CHANGED with the new price', () => {
    try {
      priceCart([{ productId: 'p1', quantity: 1, expectedUnitPrice: 3000 }], products);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('PRICE_CHANGED');
      expect((err as AppError).details).toEqual({ changes: [{ productId: 'p1', oldPrice: 3000, newPrice: 3500 }] });
    }
  });

  it('checks stock across repeated lines of the same product', () => {
    const lines = [
      { productId: 'p1', quantity: 6, expectedUnitPrice: 3500 },
      { productId: 'p1', quantity: 5, expectedUnitPrice: 3500 },
    ];
    expect(codeOf(() => priceCart(lines, products))).toBe('INSUFFICIENT_STOCK');
  });

  it('rejects inactive, unknown, zero quantity and empty carts', () => {
    const inactive = new Map([[coffee.id, { ...coffee, active: false }]]);
    expect(codeOf(() => priceCart([{ productId: 'p1', quantity: 1, expectedUnitPrice: 3500 }], inactive))).toBe('PRODUCT_INACTIVE');
    expect(codeOf(() => priceCart([{ productId: 'x', quantity: 1, expectedUnitPrice: 3500 }], products))).toBe('NOT_FOUND');
    expect(codeOf(() => priceCart([{ productId: 'p1', quantity: 0, expectedUnitPrice: 3500 }], products))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => priceCart([], products))).toBe('VALIDATION_FAILED');
  });

  it('rejects tender lower than total', () => {
    expect(codeOf(() => changeFor(7000, 6999))).toBe('TENDER_TOO_LOW');
    expect(changeFor(7000, 7000)).toBe(0);
  });
});

describe('shift cash', () => {
  it('A09 expected cash 1,550 and variance −10', () => {
    const expected = expectedCash({ opening: 100000, gross: 70000, voids: 20000, refunds: 0, cashIn: 10000, cashOut: 5000 });
    expect(expected).toBe(155000);
    expect(cashVariance(154000, expected)).toBe(-1000);
  });
});

describe('identity', () => {
  it('canonicalJson sorts keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, 1] } })).toBe('{"a":{"c":[2,1]},"b":1}');
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });

  it('bill numbers come from the sale UUID', () => {
    expect(billNumber('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe('POS1-0F8FAD5BD9CB469FA16570867728950E');
    expect(codeOf(() => billNumber('1'))).toBe('VALIDATION_FAILED');
  });

  it('normalizes SKU and keeps barcode leading zeros', () => {
    expect(normalizeSku('  milk-250 ')).toBe('MILK-250');
    expect(codeOf(() => normalizeSku('   '))).toBe('VALIDATION_FAILED');
    expect(normalizeBarcode(' 0088510 ')).toBe('0088510');
    expect(normalizeBarcode('')).toBeNull();
  });
});

describe('time', () => {
  it('groups by Asia/Bangkok business day', () => {
    expect(bangkokDateKey('2026-10-26T16:50:00.000Z')).toBe('2026-10-26'); // 23:50 ICT
    expect(bangkokDateKey('2026-10-26T17:10:00.000Z')).toBe('2026-10-27'); // 00:10 ICT
    expect(bangkokDayRange('2026-10-27')).toEqual({ start: '2026-10-26T17:00:00.000Z', end: '2026-10-27T17:00:00.000Z' });
    expect(codeOf(() => bangkokDayRange('2026-02-30'))).toBe('VALIDATION_FAILED');
  });
});
