import { useState, type FormEvent } from 'react';
import type { ShiftSummary, ShiftView } from '@pos/contracts';
import { api, errorText } from '../api/client.ts';
import { baht, dateTime, Dialog, Empty, ErrorNote, Icon, MoneyInput, PageHeading, Pill, tryParseBaht } from '../components/ui.tsx';
import { isOwner, useSession } from '../session.tsx';

/** key คงที่ต่อการเปิด dialog: ส่งซ้ำหลังคำตอบหายจะได้ผลเดิม; error ทางธุรกิจได้ key ใหม่ */
function useWriteKey(): [string, (err: unknown) => void] {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return [key, err => { if (!(err as { outcomeUnknown?: boolean }).outcomeUnknown) setKey(crypto.randomUUID()); }];
}

export function OpenShiftDialog({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, onError] = useWriteKey();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const openingCash = tryParseBaht(text);
    if (openingCash === null) return setError('จำนวนเงินไม่ถูกต้อง');
    setBusy(true);
    try {
      await api.post('/shifts', { openingCash }, key);
      await session.refreshShift();
      session.toast('เปิดกะแล้ว');
      onClose();
    } catch (err) {
      setError(errorText(err));
      onError(err);
      void session.refreshShift();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="เปิดกะ" subtitle="นับเงินในลิ้นชักก่อนเริ่มขาย" onClose={onClose}
      footer={<><button type="button" className="button" onClick={onClose}>ยกเลิก</button><button type="submit" form="open-shift" className="button primary" disabled={busy}>เปิดกะ</button></>}>
      <ErrorNote error={error} />
      <form id="open-shift" onSubmit={submit}><MoneyInput label="เงินตั้งต้นในลิ้นชัก (บาท)" value={text} onChange={t => setText(t)} autoFocus /></form>
    </Dialog>
  );
}

export function SummaryLines({ s }: { s: ShiftSummary }) {
  return (
    <div className="stat-list">
      <div className="stat-line"><span>เงินตั้งต้น</span><strong className="num">{baht(s.opening)}</strong></div>
      <div className="stat-line"><span>ยอดขายก่อนหักยกเลิก ({s.saleCount} บิล)</span><strong className="num">{baht(s.gross)}</strong></div>
      <div className="stat-line"><span>ยอดยกเลิก ({s.voidCount} บิล)</span><strong className="num text-amber">−{baht(s.voids)}</strong></div>
      <div className="stat-line"><span>เงินนำเข้า</span><strong className="num">{baht(s.cashIn)}</strong></div>
      <div className="stat-line"><span>เงินนำออก</span><strong className="num">−{baht(s.cashOut)}</strong></div>
      <div className="stat-line total"><span>เงินสดที่ควรมี</span><strong className="num">{baht(s.expectedCash)}</strong></div>
    </div>
  );
}

export function ShiftPage() {
  const session = useSession();
  const shift = session.shift;
  const [dialog, setDialog] = useState<'open' | 'in' | 'out' | null>(null);
  // เก็บกะที่กำลังปิดไว้ เพราะหลังปิด shift ปัจจุบันจะเป็น null แต่ยังต้องแสดงผลสรุป
  const [closing, setClosing] = useState<ShiftView | null>(null);

  return (
    <>
      <PageHeading title="กะและเงินสด" description="เปิดกะ บันทึกเงินนำเข้า/ออก และปิดกะด้วยยอดนับจริง"
        actions={shift
          ? <><Pill>กะเปิดตั้งแต่ {dateTime(shift.openedAt)}</Pill><button className="button primary" onClick={() => setClosing(shift)}>ปิดกะ</button></>
          : <button className="button primary" onClick={() => setDialog('open')}><Icon name="clock" />เปิดกะ</button>} />
      {shift ? (
        <div className="content-grid">
          <section className="panel">
            <div className="section-heading"><h2>สรุปกะปัจจุบัน</h2><span className="muted">เปิดโดย {shift.openedByName}</span></div>
            <SummaryLines s={shift.summary} />
          </section>
          <section className="panel">
            <div className="section-heading"><h2>เงินนำเข้า/ออก</h2>
              {isOwner(session) && <div className="table-actions"><button className="button small" onClick={() => setDialog('in')}><Icon name="arrowDown" />นำเงินเข้า</button><button className="button small" onClick={() => setDialog('out')}><Icon name="arrowUp" />นำเงินออก</button></div>}
            </div>
            {shift.cashMovements.length ? (
              <div className="table-wrap"><table className="data-table"><thead><tr><th>เวลา</th><th>รายการ</th><th>เหตุผล</th><th className="right">จำนวน</th></tr></thead>
                <tbody>{shift.cashMovements.map(m => <tr key={m.id}><td>{dateTime(m.createdAt)}</td><td>{m.direction === 'in' ? 'นำเข้า' : 'นำออก'}</td><td>{m.reason}</td><td className="right num">{m.direction === 'in' ? '' : '−'}{baht(m.amount)}</td></tr>)}</tbody>
              </table></div>
            ) : <Empty title="ยังไม่มีเงินนำเข้า/ออก" subtitle="เงินนำเข้า/ออกไม่ใช่ยอดขาย" icon="cash" />}
          </section>
        </div>
      ) : <div className="panel"><Empty title="ยังไม่ได้เปิดกะ" subtitle="เปิดกะพร้อมเงินตั้งต้นก่อนเริ่มขาย" icon="clock" /></div>}

      {dialog === 'open' && <OpenShiftDialog onClose={() => setDialog(null)} />}
      {shift && (dialog === 'in' || dialog === 'out') && <CashDialog shift={shift} direction={dialog} onClose={() => setDialog(null)} />}
      {closing && <CloseShiftDialog shift={closing} onClose={() => setClosing(null)} />}
    </>
  );
}

function CashDialog({ shift, direction, onClose }: { shift: ShiftView; direction: 'in' | 'out'; onClose: () => void }) {
  const session = useSession();
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, onError] = useWriteKey();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amount = tryParseBaht(text);
    if (!amount) return setError('จำนวนเงินต้องมากกว่า 0');
    setBusy(true);
    try {
      await api.post(`/shifts/${shift.id}/cash-movements`, { direction, amount, reason: reason.trim() }, key);
      await session.refreshShift();
      session.toast(direction === 'in' ? 'บันทึกเงินนำเข้าแล้ว' : 'บันทึกเงินนำออกแล้ว');
      onClose();
    } catch (err) {
      setError(errorText(err));
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={direction === 'in' ? 'นำเงินเข้าลิ้นชัก' : 'นำเงินออกจากลิ้นชัก'} subtitle="ไม่นับเป็นยอดขาย" onClose={onClose}
      footer={<><button type="button" className="button" onClick={onClose}>ยกเลิก</button><button type="submit" form="cash-form" className="button primary" disabled={busy}>บันทึก</button></>}>
      <ErrorNote error={error} />
      <form id="cash-form" className="stack" onSubmit={submit}>
        <MoneyInput label="จำนวนเงิน (บาท)" value={text} onChange={t => setText(t)} autoFocus />
        <label className="field"><span>เหตุผล</span><input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder={direction === 'in' ? 'เช่น เติมเงินทอน' : 'เช่น จ่ายค่าน้ำแข็ง'} /></label>
      </form>
    </Dialog>
  );
}

function CloseShiftDialog({ shift, onClose }: { shift: ShiftView; onClose: () => void }) {
  const session = useSession();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<ShiftView | null>(null);
  const [key, onError] = useWriteKey();
  const counted = tryParseBaht(text);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (counted === null) return setError('จำนวนเงินไม่ถูกต้อง');
    setBusy(true);
    try {
      setClosed(await api.post<ShiftView>(`/shifts/${shift.id}/close`, { countedCash: counted }, key));
      await session.refreshShift();
    } catch (err) {
      setError(errorText(err));
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  if (closed) {
    return (
      <Dialog title="ปิดกะแล้ว" subtitle={dateTime(closed.closedAt)} onClose={onClose} footer={<><button className="button" onClick={() => window.print()}><Icon name="printer" />พิมพ์</button><button className="button primary" onClick={onClose}>เสร็จสิ้น</button></>}>
        <SummaryLines s={closed.summary} />
        <div className="stat-list mt-20">
          <div className="stat-line"><span>นับได้จริง</span><strong className="num">{baht(closed.countedCash ?? 0)}</strong></div>
          <div className="stat-line total"><span>เงินขาด/เกิน</span><strong className={`num ${closed.variance ? 'text-red' : 'text-green'}`}>{baht(closed.variance ?? 0)}</strong></div>
        </div>
        <p className="field-hint">ระบบสำรองข้อมูลหลังปิดกะโดยอัตโนมัติ ตรวจสถานะได้ที่หน้าระบบ</p>
      </Dialog>
    );
  }
  return (
    <Dialog title="ปิดกะ" subtitle="นับเงินจริงในลิ้นชัก ตัวเลขจะถูกบันทึกและแก้ไม่ได้" onClose={onClose}
      footer={<><button type="button" className="button" onClick={onClose}>ยกเลิก</button><button type="submit" form="close-form" className="button primary" disabled={busy}>ยืนยันปิดกะ</button></>}>
      <ErrorNote error={error} />
      <SummaryLines s={shift.summary} />
      <form id="close-form" className="stack mt-20" onSubmit={submit}>
        <MoneyInput label="เงินที่นับได้จริง (บาท)" value={text} onChange={t => setText(t)} autoFocus />
        {counted !== null && <div className="change-preview"><span>ส่วนต่างโดยประมาณ</span><strong className="num">{baht(counted - shift.summary.expectedCash)}</strong></div>}
        <p className="field-hint">ยอดคาดหวังสุดท้ายคำนวณบน server ตอนปิด รวมบิลที่ขายระหว่างนี้</p>
      </form>
    </Dialog>
  );
}
