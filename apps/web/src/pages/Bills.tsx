import { useState, type FormEvent } from 'react';
import type { SaleListItem, SaleResponse } from '@pos/contracts';
import { shortBillNumber } from '@pos/domain';
import { api, errorText } from '../api/client.ts';
import { baht, dateTime, Dialog, Empty, ErrorNote, Icon, PageHeading, Pill, useLoad } from '../components/ui.tsx';
import { PrintableReceipt, printNow, Receipt } from '../components/Receipt.tsx';
import { isOwner, useSession } from '../session.tsx';

export function BillsPage() {
  const session = useSession();
  const [date, setDate] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (q.trim()) params.set('q', q.trim());
  const list = useLoad(() => api.get<SaleListItem[]>('/sales?' + params.toString()), [date, q]);

  return (
    <>
      <PageHeading title="ประวัติการขาย" description="ทุกบิลมีที่มา เปิดดูหรือพิมพ์ใบเสร็จซ้ำได้" />
      <div className="panel">
        <div className="toolbar">
          <div className="search-box"><Icon name="search" /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาเลขบิล" aria-label="ค้นหาเลขบิล" /></div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="วันที่ขาย" />
          <button className="button small" onClick={() => setDate('')}>ทุกวัน</button>
        </div>
        <ErrorNote error={list.error} />
        {list.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>เลขบิล</th><th>วันและเวลา</th><th>พนักงาน</th><th className="right">ชิ้น</th><th className="right">ยอดบิล</th><th>สถานะ</th></tr></thead>
              <tbody>
                {list.data.map(s => (
                  <tr key={s.id} className="row-link" onClick={() => setOpenId(s.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setOpenId(s.id)}>
                    <td><strong>{shortBillNumber(s.billNo)}</strong></td>
                    <td>{dateTime(s.createdAt)}</td>
                    <td>{s.cashierName}</td>
                    <td className="right num">{s.itemCount}</td>
                    <td className="right num">{baht(s.total)}</td>
                    <td>{s.voided ? <Pill tone="red">ยกเลิกแล้ว</Pill> : <Pill>สำเร็จ</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !list.loading && <Empty title="ยังไม่มีบิล" subtitle="บิลที่ขายสำเร็จจะแสดงที่นี่" icon="receipt" />}
      </div>
      {openId && <BillDetail id={openId} canVoid={isOwner(session)} onClose={() => setOpenId(null)} onChanged={() => { list.reload(); void session.refreshShift(); }} />}
    </>
  );
}

export function BillDetail({ id, canVoid, onClose, onChanged }: { id: string; canVoid: boolean; onClose: () => void; onChanged: () => void }) {
  const session = useSession();
  const sale = useLoad(() => api.get<SaleResponse>(`/sales/${id}`), [id]);
  const [voiding, setVoiding] = useState(false);
  const [printSale, setPrintSale] = useState<SaleResponse | null>(null);
  const s = sale.data;
  const voidAllowed = canVoid && s && !s.voided && session.shift?.id === s.shiftId;

  if (voiding && s) return <VoidDialog sale={s} onClose={() => setVoiding(false)} onDone={() => { setVoiding(false); sale.reload(); onChanged(); }} />;
  return (
    <Dialog title="รายละเอียดบิล" subtitle={s ? shortBillNumber(s.billNo) : ''} onClose={onClose}
      footer={<>
        {voidAllowed && <button className="button danger" onClick={() => setVoiding(true)}>ยกเลิกบิล</button>}
        {s && <button className="button" onClick={() => { setPrintSale(s); printNow(); }}><Icon name="printer" />พิมพ์ใบเสร็จ</button>}
        <button className="button primary" onClick={onClose}>ปิด</button>
      </>}>
      <ErrorNote error={sale.error} />
      {s && <Receipt sale={s} />}
      {s && canVoid && !s.voided && !voidAllowed && <p className="field-hint">ยกเลิกได้เฉพาะบิลในกะที่ยังเปิดอยู่ บิลนี้อยู่ในกะที่ปิดแล้ว</p>}
      <PrintableReceipt sale={printSale} />
    </Dialog>
  );
}

/** R04: เหตุผล + ยืนยันคืนเงินและสินค้าครบ */
function VoidDialog({ sale, onClose, onDone }: { sale: SaleResponse; onClose: () => void; onDone: () => void }) {
  const session = useSession();
  const [reason, setReason] = useState('');
  const [cash, setCash] = useState(false);
  const [goods, setGoods] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/sales/${sale.id}/void`, { reason: reason.trim(), cashReturned: true, goodsReturned: true }, key);
      session.toast('ยกเลิกบิลแล้ว');
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="ยกเลิกทั้งบิล" subtitle={`${shortBillNumber(sale.billNo)} · ${baht(sale.total)}`} onClose={onClose}
      footer={<><button type="button" className="button" onClick={onClose}>กลับ</button><button type="submit" form="void-form" className="button danger" disabled={busy || !reason.trim() || !cash || !goods}>ยืนยันยกเลิกบิล</button></>}>
      <ErrorNote error={error} />
      <form id="void-form" className="stack" onSubmit={submit}>
        <label className="field"><span>เหตุผล</span><textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <label className="checkbox-field"><input type="checkbox" checked={cash} onChange={e => setCash(e.target.checked)} /><span>คืนเงินสด {baht(sale.total)} ให้ลูกค้าครบแล้ว</span></label>
        <label className="checkbox-field"><input type="checkbox" checked={goods} onChange={e => setGoods(e.target.checked)} /><span>ได้สินค้าคืนครบในสภาพขายได้ หรือยังไม่ได้ส่งมอบ</span></label>
        <p className="field-hint">บิลเดิมยังอยู่ในประวัติ ระบบบันทึกการยกเลิก คืนสต๊อก และหักยอดเงินสดที่คาดหวังของกะนี้</p>
      </form>
    </Dialog>
  );
}
