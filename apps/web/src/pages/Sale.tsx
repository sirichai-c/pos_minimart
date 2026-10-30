import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { CartLineInput } from '@pos/domain';
import type { ProductView, SaleResponse } from '@pos/contracts';
import { api, ApiError, errorText, newKey } from '../api/client.ts';
import {
  acceptNewPrices, abandonPending, initialState, recoverCheckout, submitCheckout, type CheckoutDeps, type CheckoutState,
} from '../state/checkout.ts';
import { baht, Dialog, ErrorNote, Icon, initial, MoneyInput, PageHeading, satangToInput, timeOnly, tryParseBaht } from '../components/ui.tsx';
import { PrintableReceipt, printNow, Receipt } from '../components/Receipt.tsx';
import { useSession } from '../session.tsx';
import { OpenShiftDialog } from './Shift.tsx';

const deps: CheckoutDeps = {
  post: (key, payload) => api.post<SaleResponse>('/sales', payload, key),
  lookup: async key => {
    try {
      const res = await api.get<{ result: SaleResponse; scope: string }>(`/requests/${key}`);
      return res.result;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
  storage: window.localStorage,
  newKey,
};

interface CartRow extends CartLineInput { name: string; sku: string; onHand: number }

export function SalePage() {
  const session = useSession();
  const [products, setProducts] = useState<ProductView[]>([]);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartRow[]>([]);
  const [state, setState] = useState<CheckoutState>(() => initialState(window.localStorage));
  const [paying, setPaying] = useState(false);
  const [openShift, setOpenShift] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [printSale, setPrintSale] = useState<SaleResponse | null>(null);

  const loadProducts = (q = query) =>
    api.get<ProductView[]>(`/products?active=true&limit=60${q.trim() ? '&q=' + encodeURIComponent(q.trim()) : ''}`).then(setProducts, e => setError(errorText(e)));

  useEffect(() => { const t = window.setTimeout(() => void loadProducts(query), 150); return () => window.clearTimeout(t); }, [query]);

  // เปิดหน้าขายแล้วพบคำขอค้าง: ตรวจผลด้วย key เดิมก่อน
  useEffect(() => {
    if (state.kind === 'unresolved') void recoverCheckout(deps, state).then(setState);
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const locked = state.kind === 'unresolved' || state.kind === 'submitting';
  const total = cart.reduce((sum, l) => sum + l.expectedUnitPrice * l.quantity, 0);
  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  function add(p: ProductView) {
    if (locked) return;
    setError(null);
    setCart(rows => {
      const existing = rows.find(r => r.productId === p.id);
      if (existing) return rows.map(r => (r.productId === p.id ? { ...r, quantity: r.quantity + 1 } : r));
      return [...rows, { productId: p.id, quantity: 1, expectedUnitPrice: p.price, name: p.name, sku: p.sku, onHand: p.onHand }];
    });
  }

  function setQty(productId: string, quantity: number) {
    setCart(rows => (quantity <= 0 ? rows.filter(r => r.productId !== productId) : rows.map(r => (r.productId === productId ? { ...r, quantity } : r))));
  }

  // เครื่องสแกนแบบคีย์บอร์ดพิมพ์รหัสแล้วกด Enter
  async function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !query.trim()) return;
    e.preventDefault();
    const code = query.trim();
    try {
      const exact = await api.get<ProductView[]>(`/products?active=true&barcode=${encodeURIComponent(code)}`);
      const match = exact[0] ?? (products.length === 1 ? products[0] : undefined);
      if (match) { add(match); setQuery(''); } else setError(`ไม่พบสินค้ารหัส ${code}`);
    } catch (err) { setError(errorText(err)); }
  }

  async function pay(tendered: number) {
    const payload = { items: cart.map(({ productId, quantity, expectedUnitPrice }) => ({ productId, quantity, expectedUnitPrice })), tendered };
    const key = newKey();
    setState({ kind: 'submitting', key, payload });
    try {
      const next = await submitCheckout(deps, payload, key);
      setState(next);
      if (next.kind === 'confirmed') { setCart([]); setPaying(false); void loadProducts(); }
      if (next.kind === 'unresolved' || next.kind === 'price_changed') setPaying(false);
    } catch (err) {
      setState({ kind: 'draft', cart: payload.items });
      setPaying(false);
      setError(errorText(err));
      if (err instanceof ApiError && err.code === 'NO_OPEN_SHIFT') void session.refreshShift();
      void loadProducts();
    }
  }

  async function resend() {
    if (state.kind !== 'unresolved') return;
    setState({ kind: 'submitting', key: state.key, payload: state.payload });
    try {
      setState(await submitCheckout(deps, state.payload, state.key));
    } catch (err) {
      setState({ kind: 'draft', cart: [] });
      setError(errorText(err));
    }
  }

  function acceptPrices() {
    if (state.kind !== 'price_changed') return;
    const updated = acceptNewPrices(state);
    setCart(rows => rows.map(r => ({ ...r, expectedUnitPrice: updated.find(u => u.productId === r.productId)?.expectedUnitPrice ?? r.expectedUnitPrice })));
    setState({ kind: 'draft', cart: updated });
  }

  const confirmed = state.kind === 'confirmed' ? state.sale : null;

  return (
    <>
      <PageHeading title="ขายสินค้า" description="สแกนหรือค้นหาสินค้า แล้วรับเงินสด"
        actions={session.shift
          ? <span className="shift-pill"><Icon name="clock" />เปิดกะแล้ว {timeOnly(session.shift.openedAt)} น.</span>
          : <button className="shift-pill closed" onClick={() => setOpenShift(true)}><Icon name="clock" />เปิดกะก่อนเริ่มขาย</button>} />

      {(state.kind === 'unresolved' || (state.kind === 'submitting' && !paying)) && (
        <div className="unresolved-box" role="alert">
          <strong>บิลก่อนหน้ายังไม่ทราบผล — ยังห้ามเริ่มบิลใหม่</strong>
          <span>{state.kind === 'unresolved' ? state.lastError : 'กำลังตรวจสอบ…'}</span>
          <span>ยอด {baht(state.payload.items.reduce((s, i) => s + i.expectedUnitPrice * i.quantity, 0))} · รับเงิน {baht(state.payload.tendered)}</span>
          {state.kind === 'unresolved' && (
            <div className="actions">
              <button className="button small" onClick={() => void recoverCheckout(deps, state).then(setState)}><Icon name="refresh" />ตรวจผลอีกครั้ง</button>
              <button className="button small primary" onClick={() => void resend()}>ส่งรายการเดิมอีกครั้ง</button>
              <button className="button small danger" onClick={() => {
                if (window.confirm('ยืนยันว่าตรวจแล้วบิลนี้ไม่ได้บันทึก และจะไม่ส่งซ้ำ? หากยังไม่แน่ใจให้กด "ตรวจผลอีกครั้ง"')) {
                  abandonPending(window.localStorage); setState({ kind: 'draft', cart: [] });
                }
              }}>ทิ้งรายการนี้</button>
            </div>
          )}
        </div>
      )}

      <ErrorNote error={error} />

      <div className="pos-layout">
        <section className="catalog" aria-label="สินค้า">
          <div className="search-box">
            <Icon name="search" />
            <input ref={searchRef} type="search" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => void onSearchKey(e)}
              placeholder="ค้นหาชื่อสินค้า, SKU หรือสแกนบาร์โค้ด" aria-label="ค้นหาสินค้าหรือสแกนบาร์โค้ด" autoComplete="off" autoFocus />
            <kbd>F2</kbd>
          </div>
          <div className="catalog-grid">
            {products.map(p => {
              const inCart = cart.find(r => r.productId === p.id)?.quantity ?? 0;
              return (
                <button key={p.id} className="product-card" onClick={() => add(p)} disabled={p.onHand === 0 || locked} aria-label={`เพิ่ม ${p.name} ${baht(p.price)}`}>
                  <span className="product-image">
                    {p.onHand === 0 ? <span className="stock-badge empty">สินค้าหมด</span> : p.onHand <= 5 ? <span className="stock-badge">เหลือน้อย</span> : null}
                    {inCart > 0 && <span className="in-cart-badge">{inCart}</span>}
                    <span className="product-letter">{initial(p.name)}</span>
                  </span>
                  <span className="product-info">
                    <span className="product-title">{p.name}</span>
                    <span className="product-unit">{p.sku} · คงเหลือ {p.onHand}</span>
                    <span className="product-bottom"><span className="product-price num">{baht(p.price)}</span><span className="add-mark"><Icon name="plus" /></span></span>
                  </span>
                </button>
              );
            })}
          </div>
          {!products.length && <div className="cart-empty"><Icon name="box" /><strong>ไม่พบสินค้า</strong><p>{query ? 'ลองค้นด้วยคำอื่น' : 'เจ้าของร้านเพิ่มสินค้าได้ที่เมนูสินค้า'}</p></div>}
        </section>

        <aside className="cart-panel" aria-label="ตะกร้า">
          <div className="cart-heading"><h2>ตะกร้า</h2>{cart.length > 0 && !locked && <button className="plain-button" onClick={() => setCart([])}>ล้างตะกร้า</button>}</div>
          <div className="cart-items">
            {cart.length ? cart.map(row => (
              <div className="cart-item" key={row.productId}>
                <div className="cart-image"><span className="product-letter">{initial(row.name)}</span></div>
                <div>
                  <div className="cart-item-title">{row.name}</div>
                  <div className="cart-item-price num">{baht(row.expectedUnitPrice)} / ชิ้น</div>
                  <div className="quantity-control">
                    <button onClick={() => setQty(row.productId, row.quantity - 1)} disabled={locked} aria-label={`ลดจำนวน ${row.name}`}><Icon name="minus" /></button>
                    <input type="number" min={1} value={row.quantity} disabled={locked} aria-label={`จำนวน ${row.name}`}
                      onChange={e => { const n = Number(e.target.value); if (Number.isSafeInteger(n) && n >= 0) setQty(row.productId, n); }} />
                    <button onClick={() => setQty(row.productId, row.quantity + 1)} disabled={locked} aria-label={`เพิ่มจำนวน ${row.name}`}><Icon name="plus" /></button>
                  </div>
                </div>
                <div className="cart-item-side">
                  <strong className="cart-item-total num">{baht(row.expectedUnitPrice * row.quantity)}</strong>
                  <button className="cart-remove" onClick={() => setQty(row.productId, 0)} disabled={locked} aria-label={`ลบ ${row.name}`}><Icon name="trash" /></button>
                </div>
              </div>
            )) : <div className="cart-empty"><Icon name="bag" /><strong>ตะกร้าพร้อมรับสินค้า</strong><p>เลือกสินค้าทางซ้าย<br />หรือสแกนบาร์โค้ดเพื่อเริ่มขาย</p></div>}
          </div>
          <div className="cart-summary">
            <div className="summary-row"><span>จำนวนสินค้า</span><strong className="num">{itemCount} ชิ้น ({cart.length} รายการ)</strong></div>
            <div className="cart-total"><span>ยอดชำระทั้งหมด</span><strong className="num">{baht(total)}</strong></div>
            <button className="checkout-button" disabled={!cart.length || !session.shift || locked} onClick={() => { setError(null); setPaying(true); }}>
              <Icon name="cash" />{session.shift ? 'รับเงินสด' : 'เปิดกะก่อนรับเงิน'}
            </button>
          </div>
        </aside>
      </div>

      {paying && <PayDialog total={total} busy={state.kind === 'submitting'} onPay={tendered => void pay(tendered)} onClose={() => state.kind !== 'submitting' && setPaying(false)} />}

      {state.kind === 'price_changed' && (
        <Dialog title="ราคาสินค้าเปลี่ยน" subtitle="ยังไม่ได้ขาย กรุณาตรวจราคาใหม่กับลูกค้า" onClose={() => setState({ kind: 'draft', cart: state.cart })}
          footer={<><button className="button" onClick={() => setState({ kind: 'draft', cart: state.cart })}>กลับไปแก้ตะกร้า</button><button className="button primary" onClick={acceptPrices}>ใช้ราคาใหม่</button></>}>
          <table className="data-table"><thead><tr><th>สินค้า</th><th className="right">ราคาในตะกร้า</th><th className="right">ราคาปัจจุบัน</th></tr></thead>
            <tbody>{state.changes.map(c => <tr key={c.productId}><td>{cart.find(r => r.productId === c.productId)?.name ?? c.productId}</td><td className="right num">{baht(c.oldPrice)}</td><td className="right num"><strong>{baht(c.newPrice)}</strong></td></tr>)}</tbody>
          </table>
        </Dialog>
      )}

      {confirmed && (
        <Dialog title="เรียบร้อย พร้อมบิลต่อไป" subtitle="บันทึกยอดขายและตัดสต๊อกแล้ว" onClose={() => setState({ kind: 'draft', cart: [] })}
          footer={<>
            <button className="button" onClick={() => { setPrintSale(confirmed); printNow(); }}><Icon name="printer" />พิมพ์ใบเสร็จ</button>
            <button className="button primary" data-autofocus onClick={() => { setState({ kind: 'draft', cart: [] }); searchRef.current?.focus(); }}>ขายบิลถัดไป</button>
          </>}>
          <div className="receipt-success"><span className="success-mark"><Icon name="check" /></span><h3>ขายสำเร็จแล้ว</h3><p>รับเงิน {baht(confirmed.tendered)} · ทอน {baht(confirmed.change)}</p></div>
          <Receipt sale={confirmed} />
        </Dialog>
      )}

      {openShift && <OpenShiftDialog onClose={() => setOpenShift(false)} />}
      <PrintableReceipt sale={printSale} />
    </>
  );
}

function PayDialog({ total, busy, onPay, onClose }: { total: number; busy: boolean; onPay: (tendered: number) => void; onClose: () => void }) {
  const [text, setText] = useState(satangToInput(total));
  const tendered = tryParseBaht(text);
  const presets = useMemo(() => [...new Set([total, ...[2000, 5000, 10000, 50000, 100000].filter(v => v > total)])].slice(0, 5), [total]);
  const valid = tendered !== null && tendered >= total;
  function submit(e: FormEvent) { e.preventDefault(); if (valid && !busy) onPay(tendered); }
  return (
    <Dialog title="รับเงินสด" subtitle="ตรวจยอดกับลูกค้าก่อนยืนยัน" onClose={onClose}
      footer={<><button type="button" className="button" onClick={onClose} disabled={busy}>กลับ</button>
        <button type="submit" form="pay-form" className="button primary" disabled={!valid || busy}>{busy ? 'กำลังบันทึก…' : 'ยืนยันการขาย'}</button></>}>
      <form id="pay-form" onSubmit={submit} className="stack">
        <div className="payment-total"><span>ยอดชำระ</span><strong className="num">{baht(total)}</strong></div>
        <MoneyInput label="รับเงินมา (บาท)" value={text} onChange={t => setText(t)} autoFocus />
        <div className="cash-presets">{presets.map(v => <button type="button" key={v} className="button small" onClick={() => setText(satangToInput(v))}>{baht(v)}</button>)}</div>
        <div className="change-preview"><span>เงินทอน</span><strong className="num">{valid ? baht(tendered - total) : tendered === null ? 'จำนวนเงินไม่ถูกต้อง' : 'เงินไม่พอ'}</strong></div>
      </form>
    </Dialog>
  );
}
