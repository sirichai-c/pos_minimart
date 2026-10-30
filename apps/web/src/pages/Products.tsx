import { useState, type FormEvent } from 'react';
import type { ProductView } from '@pos/contracts';
import { api, errorText } from '../api/client.ts';
import { baht, Dialog, Empty, ErrorNote, Icon, MoneyInput, PageHeading, Pill, satangToInput, tryParseBaht, useLoad } from '../components/ui.tsx';
import { useSession } from '../session.tsx';

export function ProductsPage() {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ProductView | 'new' | null>(null);
  const list = useLoad(() => api.get<ProductView[]>(`/products?limit=1000${q.trim() ? '&q=' + encodeURIComponent(q.trim()) : ''}`), [q]);

  return (
    <>
      <PageHeading title="สินค้า" description="ชื่อ SKU บาร์โค้ด ราคาขาย และสถานะจำหน่าย"
        actions={<button className="button primary" onClick={() => setEditing('new')}><Icon name="plus" />เพิ่มสินค้า</button>} />
      <div className="panel">
        <div className="toolbar"><div className="search-box"><Icon name="search" /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาชื่อ SKU หรือบาร์โค้ด" aria-label="ค้นหาสินค้า" /></div></div>
        <ErrorNote error={list.error} />
        {list.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>สินค้า</th><th>SKU</th><th>บาร์โค้ด</th><th className="right">ราคาขาย</th><th className="right">คงเหลือ</th><th>สถานะ</th><th /></tr></thead>
              <tbody>
                {list.data.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.sku}</td>
                    <td className="num">{p.barcode ?? '—'}</td>
                    <td className="right num">{baht(p.price)}</td>
                    <td className="right num">{p.onHand}</td>
                    <td>{p.active ? <Pill>จำหน่าย</Pill> : <Pill tone="gray">ปิดจำหน่าย</Pill>}</td>
                    <td className="right"><button className="button small" onClick={() => setEditing(p)}><Icon name="edit" />แก้ไข</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !list.loading && <Empty title="ยังไม่มีสินค้า" subtitle="เพิ่มสินค้าพร้อมยอดตั้งต้นเพื่อเริ่มขาย" icon="box" />}
      </div>
      {editing && <ProductDialog product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

function ProductDialog({ product, onClose, onSaved }: { product: ProductView | null; onClose: () => void; onSaved: () => void }) {
  const session = useSession();
  const [form, setForm] = useState({
    name: product?.name ?? '', sku: product?.sku ?? '', barcode: product?.barcode ?? '',
    price: product ? satangToInput(product.price) : '', opening: '0', active: product?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // key ผูกกับฟอร์มที่เปิดอยู่ กดบันทึกซ้ำหลังคำตอบหายจะไม่สร้างสินค้าซ้ำ
  const [key, setKey] = useState(() => crypto.randomUUID());

  async function submit(e: FormEvent) {
    e.preventDefault();
    const price = tryParseBaht(form.price);
    if (price === null) return setError('ราคาขายไม่ถูกต้อง');
    const opening = Number(form.opening || '0');
    if (!Number.isSafeInteger(opening) || opening < 0) return setError('ยอดตั้งต้นต้องเป็นจำนวนเต็มตั้งแต่ 0');
    setBusy(true);
    setError(null);
    try {
      if (product) {
        await api.patch(`/products/${product.id}`, { name: form.name, sku: form.sku, barcode: form.barcode || null, price, active: form.active }, key);
        session.toast(price !== product.price ? 'บันทึกราคาใหม่แล้ว บิลเก่ายังใช้ราคาเดิม' : 'บันทึกสินค้าแล้ว');
      } else {
        await api.post('/products', { name: form.name, sku: form.sku, barcode: form.barcode || null, price, openingQuantity: opening }, key);
        session.toast('เพิ่มสินค้าแล้ว');
      }
      onSaved();
    } catch (err) {
      setError(errorText(err));
      if (!(err as { outcomeUnknown?: boolean }).outcomeUnknown) setKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={product ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'} subtitle={product ? 'การแก้ราคาไม่เปลี่ยนยอดในบิลที่ขายไปแล้ว' : 'สินค้านับเป็นจำนวนเต็มหน่วยชิ้น'} onClose={onClose}
      footer={<><button type="button" className="button" onClick={onClose}>ยกเลิก</button><button type="submit" form="product-form" className="button primary" disabled={busy}>บันทึก</button></>}>
      <ErrorNote error={error} />
      <form id="product-form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field full"><span>ชื่อสินค้า</span><input required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus /></label>
          <label className="field"><span>SKU</span><input required maxLength={40} value={form.sku} placeholder="เช่น DRINK-001" onChange={e => setForm({ ...form, sku: e.target.value })} /></label>
          <label className="field"><span>บาร์โค้ด <small>ไม่บังคับ</small></span><input maxLength={64} inputMode="numeric" value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} /></label>
          <MoneyInput label="ราคาขาย (บาท)" value={form.price} onChange={t => setForm({ ...form, price: t })} />
          {product
            ? <label className="checkbox-field"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /><span>เปิดจำหน่าย</span></label>
            : <label className="field"><span>ยอดตั้งต้น (ชิ้น)</span><input inputMode="numeric" value={form.opening} onChange={e => setForm({ ...form, opening: e.target.value })} /></label>}
        </div>
      </form>
    </Dialog>
  );
}
