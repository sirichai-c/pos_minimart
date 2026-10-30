import { describe, expect, it } from 'vitest';
import type { CheckoutRequest, SaleResponse } from '@pos/contracts';
import { ApiError } from '../src/api/client.ts';
import {
  acceptNewPrices, initialState, PENDING_STORAGE_KEY, recoverCheckout, submitCheckout, type CheckoutDeps,
} from '../src/state/checkout.ts';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

const payload: CheckoutRequest = { items: [{ productId: 'p1', quantity: 2, expectedUnitPrice: 3500 }], tendered: 10000 };
const sale = { id: 's1', billNo: 'POS1-X', total: 7000, change: 3000 } as SaleResponse;

function deps(post: CheckoutDeps['post'], lookup: CheckoutDeps['lookup'] = async () => null) {
  const storage = memoryStorage();
  let n = 0;
  return { storage, post, lookup, newKey: () => `key-${++n}` } satisfies CheckoutDeps;
}

describe('checkout state machine', () => {
  it('stores the pending request before sending and clears it after confirmation', async () => {
    let seen: string | null = null;
    const d = deps(async () => { seen = d.storage.getItem(PENDING_STORAGE_KEY); return sale; });
    const state = await submitCheckout(d, payload);
    expect(JSON.parse(seen!)).toMatchObject({ key: 'key-1', payload });
    expect(state).toEqual({ kind: 'confirmed', sale });
    expect(d.storage.getItem(PENDING_STORAGE_KEY)).toBeNull();
  });

  it('keeps the request when the outcome is unknown and resumes as unresolved after reload', async () => {
    const d = deps(async () => { throw new ApiError('NETWORK', 'offline', 0); });
    const state = await submitCheckout(d, payload);
    expect(state).toMatchObject({ kind: 'unresolved', key: 'key-1' });
    expect(initialState(d.storage)).toMatchObject({ kind: 'unresolved', key: 'key-1', payload });
  });

  it('recovers a committed sale by key, or stays unresolved for a safe resend with the same key', async () => {
    const found = deps(async () => sale, async key => (key === 'key-1' ? sale : null));
    const unresolved = { kind: 'unresolved' as const, key: 'key-1', payload, lastError: '' };
    expect(await recoverCheckout(found, unresolved)).toEqual({ kind: 'confirmed', sale });

    const keys: string[] = [];
    const missing = deps(async key => { keys.push(key); return sale; }, async () => null);
    const still = await recoverCheckout(missing, unresolved);
    expect(still.kind).toBe('unresolved');
    await submitCheckout(missing, payload, 'key-1');
    expect(keys).toEqual(['key-1']);
  });

  it('PRICE_CHANGED clears the pending request and new prices need a new key', async () => {
    const d = deps(async () => { throw new ApiError('PRICE_CHANGED', 'changed', 409, { changes: [{ productId: 'p1', oldPrice: 3500, newPrice: 4000 }] }); });
    const state = await submitCheckout(d, payload);
    expect(state.kind).toBe('price_changed');
    expect(d.storage.getItem(PENDING_STORAGE_KEY)).toBeNull();
    if (state.kind === 'price_changed') expect(acceptNewPrices(state)[0]!.expectedUnitPrice).toBe(4000);
  });

  it('definite business errors are thrown and not kept as pending', async () => {
    const d = deps(async () => { throw new ApiError('INSUFFICIENT_STOCK', 'no stock', 409); });
    await expect(submitCheckout(d, payload)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(d.storage.getItem(PENDING_STORAGE_KEY)).toBeNull();
  });
});
