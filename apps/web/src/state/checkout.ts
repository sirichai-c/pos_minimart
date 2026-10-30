// state machine ของ checkout + เก็บคำขอค้าง (implementation plan ส่วน 5.5, R03)
import type { CartLineInput, PriceChange } from '@pos/domain';
import type { CheckoutRequest, SaleResponse } from '@pos/contracts';
import { ApiError } from '../api/client.ts';

export type CheckoutState =
  | { kind: 'draft'; cart: CartLineInput[] }
  | { kind: 'submitting'; key: string; payload: CheckoutRequest }
  | { kind: 'confirmed'; sale: SaleResponse }
  | { kind: 'unresolved'; key: string; payload: CheckoutRequest; lastError: string }
  | { kind: 'price_changed'; cart: CartLineInput[]; changes: PriceChange[] };

export interface PendingCheckout { key: string; payload: CheckoutRequest; savedAt: string }

export interface CheckoutDeps {
  post(key: string, payload: CheckoutRequest): Promise<SaleResponse>;
  lookup(key: string): Promise<SaleResponse | null>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  newKey(): string;
}

export const PENDING_STORAGE_KEY = 'baandee-pos.pending-checkout';

export function loadPending(storage: CheckoutDeps['storage']): PendingCheckout | null {
  try {
    const raw = storage.getItem(PENDING_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PendingCheckout) : null;
  } catch {
    return null;
  }
}

/** เปิดหน้าขายแล้วพบคำขอค้าง: เริ่มที่ unresolved ห้ามเริ่มบิลใหม่จนกว่าจะรู้ผล */
export function initialState(storage: CheckoutDeps['storage']): CheckoutState {
  const pending = loadPending(storage);
  return pending
    ? { kind: 'unresolved', key: pending.key, payload: pending.payload, lastError: 'มีบิลก่อนหน้าที่ยังไม่ทราบผล กำลังตรวจสอบ' }
    : { kind: 'draft', cart: [] };
}

/**
 * ส่ง checkout: เก็บ { key, payload } ก่อนส่ง และลบเมื่อได้ผลยืนยัน
 * error ทางธุรกิจ (4xx) แปลว่าไม่ได้บันทึก จึงลบคำขอค้าง; ไม่ทราบผล (เครือข่าย/5xx) ให้คงไว้
 */
export async function submitCheckout(deps: CheckoutDeps, payload: CheckoutRequest, key = deps.newKey()): Promise<CheckoutState> {
  deps.storage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ key, payload, savedAt: new Date().toISOString() } satisfies PendingCheckout));
  try {
    const sale = await deps.post(key, payload);
    deps.storage.removeItem(PENDING_STORAGE_KEY);
    return { kind: 'confirmed', sale };
  } catch (err) {
    const cart = payload.items.map(i => ({ ...i }));
    if (err instanceof ApiError && !err.outcomeUnknown && err.code !== 'IDEMPOTENCY_CONFLICT') {
      deps.storage.removeItem(PENDING_STORAGE_KEY);
      if (err.code === 'PRICE_CHANGED') {
        return { kind: 'price_changed', cart, changes: (err.details?.changes as PriceChange[] | undefined) ?? [] };
      }
      throw err;
    }
    return { kind: 'unresolved', key, payload, lastError: err instanceof Error ? err.message : String(err) };
  }
}

/** ตรวจผลด้วย key เดิม: พบ → confirmed; ไม่พบ → ยัง unresolved (ส่งซ้ำด้วย key เดิมได้) */
export async function recoverCheckout(deps: CheckoutDeps, state: Extract<CheckoutState, { kind: 'unresolved' }>): Promise<CheckoutState> {
  try {
    const sale = await deps.lookup(state.key);
    if (sale) {
      deps.storage.removeItem(PENDING_STORAGE_KEY);
      return { kind: 'confirmed', sale };
    }
    return { ...state, lastError: 'ระบบยังไม่ได้บันทึกบิลนี้ กดส่งอีกครั้งด้วยรายการเดิมได้อย่างปลอดภัย' };
  } catch (err) {
    return { ...state, lastError: err instanceof Error ? err.message : String(err) };
  }
}

/** ยอมรับราคาใหม่: payload เปลี่ยนจึงต้องใช้ key ใหม่ */
export function acceptNewPrices(state: Extract<CheckoutState, { kind: 'price_changed' }>): CartLineInput[] {
  const price = new Map(state.changes.map(c => [c.productId, c.newPrice]));
  return state.cart.map(line => ({ ...line, expectedUnitPrice: price.get(line.productId) ?? line.expectedUnitPrice }));
}

/** ยกเลิกคำขอค้างได้เฉพาะเมื่อตรวจแล้วว่าไม่ได้บันทึก และผู้ขายยืนยันไม่ส่งซ้ำ */
export function abandonPending(storage: CheckoutDeps['storage']): void {
  storage.removeItem(PENDING_STORAGE_KEY);
}
