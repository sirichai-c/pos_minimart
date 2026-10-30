import { useState, type FormEvent } from 'react';
import type { ProductView, StockMovementView } from '@pos/contracts';
import { api, errorText } from '../api/client.ts';
import { dateTime, Dialog, Empty, ErrorNote, Icon, PageHeading, Pill, useLoad } from '../components/ui.tsx';
import { useSession } from '../session.tsx';

const KIND: Record<StockMovementView['kind'], string> = { opening: 'ยอดตั้งต้น', receipt: 'รับเข้า', adjustment: 'ปรับยอด', sale: 'ขาย', void: 'ยกเลิกบิล' };

export function InventoryPage() {
  const [q, setQ] = useState('');
  const [action, setAction] = useState<{ kind: 'receipt' | 'adjustment' | 'history'; product: ProductView } | null>(null);
  const list = useLoad(() => api.get<ProductView[]>(`/products?limit=1000${q.trim() ? '&q=' + encodeURIComponent(q.trim()) : ''}`), [q]);

  return (
    <>
      <PageHeading title="สต๊อก" description="รับสินค้าเข้า ปรับเป็นยอดนับจริง และดูประวัติทุกการเปลี่ยนแปลง" />
      <div className="panel">
        <div className="toolbar"><div className="search-box"><Icon name="search" /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาสินค้า" aria-label="ค้นหาสินค้า" /></div></div>
        <ErrorNote error={list.error} />
        {list.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>สินค้า</th><th>SKU</th><th className="right">คงเหลือ</th><th /></tr></thead>
              <tbody>
                {list.data.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong> {!p.active && <Pill tone="gray">ปิดจำหน่าย</Pill>}</td>
                    <td>{p.sku}</td>
                    <td className="right num"><strong>{p.onHand}</strong></td>
                    <td className="right table-actions">
                      <button className="button small" onClick={() => setAction({ kind: 'receipt', product: p })}><Icon name="arrowDown" />รับเข้า</button>
                      <button className="button small" onClick={() => setAction({ kind: 'adjustment', product: p })}><Icon name="edit" />ปรับยอดนับจริง</button>
                      <button className="button small ghost" onClick={() => setAction({ kind: 'history', product: p })}><Icon name="history" />ประวัติ</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !list.loading && <Empty title="ยังไม่มีสินค้า" icon="box" />}
      </div>
      {action?.kind === 'history' && <MovementsDialog product={action.product} onClose={() => setAction(null)} />}
      {action && action.kind !== 'history' && <StockDialog kind={action.kind} product={action.product} onClose={() => setAction(null)} onDone={() => { setAction(null); list.reload(); }} />}
    </>
  );
}

function StockDialog({ kind, product, onClose, onDone }: { kind: 'receipt' | 'adjustment'; product: ProductView; onClose: () => void; onDone: () => void }) {
  const session = useSession();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(qty);
    if (!Number.isSafeInteger(n) || n < (kind === 'receipt' ? 1 : 0)) return setError(kind === 'receipt' ? 'จำนวนรับเข้าต้องเป็นจำนวนเต็มตั้งแต่ 1' : 'ยอดนับต้องเป็นจำนวนเต็มตั้งแต่ 0');
    setBusy(true);
    try {
      const body = kind === 'receipt' ? { productId: product.id, quantity: n, reason: reason.trim() } : { productId: product.id, countedQuantity: n, reason: reason.trim() };
      await api.post(kind === 'receipt' ? '/inventory/receipts' : '/inventory/adjustments', body, key);
      session.toast(kind === 'receipt' ? `รับ ${product.name} เข้า ${n} ชิ้นแล้ว` : `ปรับ ${product.name} เป็น ${n} ชิ้นแล้ว`);
      onDone();
    } catch (err) {
      setError(errorText(err));
      // error ทางธุรกิจไม่ถูกบันทึก แก้แล้วส่งใหม่ด้วย key ใหม่; ถ้าไม่ทราบผลให้คง key เดิมเพื่อส่งซ้ำได้ปลอดภัย
      if (!(err as { outcomeUnknown?: boolean }).outcomeUnknown) setKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={kind === 'receipt' ? 'รับสินค้าเข้า' : 'ปรับเป็นยอดนับจริง'} subtitle={`${product.name} · คงเหลือในระบบ ${product.onHand} ชิ้น`} onClose={onClose}
      footer={<><button type="button" className="button" onClick={onClose}>ยกเลิก</button><button type="submit" form="stock-form" className="button primary" disabled={busy}>บันทึก</button></>}>
      <ErrorNote error={error} />
      <form id="stock-form" className="stack" onSubmit={submit}>
        <label className="field"><span>{kind === 'receipt' ? 'จำนวนที่รับเข้า (ชิ้น)' : 'จำนวนที่นับได้จริง (ชิ้น)'}</span><input required inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} autoFocus /></label>
        <label className="field"><span>เหตุผล</span><input required maxLength={500} value={reason} placeholder={kind === 'receipt' ? 'เช่น รับจากร้านส่ง' : 'เช่น นับสต๊อกสิ้นเดือน'} onChange={e => setReason(e.target.value)} /></label>
        {kind === 'adjustment' && <p className="field-hint">ระบบคำนวณส่วนต่างจากยอดคงเหลือ ณ เวลาบันทึก หากมีการขายระหว่างนับ ส่วนต่างจะคิดจากยอดล่าสุด</p>}
      </form>
    </Dialog>
  );
}

function MovementsDialog({ product, onClose }: { product: ProductView; onClose: () => void }) {
  const list = useLoad(() => api.get<StockMovementView[]>(`/inventory/${product.id}/movements`), [product.id]);
  return (
    <Dialog wide title="ประวัติสต๊อก" subtitle={`${product.name} · ${product.sku}`} onClose={onClose} footer={<button className="button primary" onClick={onClose}>ปิด</button>}>
      <ErrorNote error={list.error} />
      {list.data?.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>เวลา</th><th>ประเภท</th><th className="right">เปลี่ยน</th><th className="right">คงเหลือ</th><th>ผู้ทำ</th><th>เหตุผล</th></tr></thead>
            <tbody>
              {list.data.map(m => (
                <tr key={m.id}>
                  <td>{dateTime(m.createdAt)}</td>
                  <td>{KIND[m.kind]}</td>
                  <td className={`right num ${m.quantity > 0 ? 'text-green' : 'text-red'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td>
                  <td className="right num">{m.balanceAfter}</td>
                  <td>{m.userName}</td>
                  <td>{m.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !list.loading && <Empty title="ยังไม่มีการเคลื่อนไหว" icon="history" />}
    </Dialog>
  );
}
