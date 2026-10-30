import { useState } from 'react';
import type { DailyReport, ShiftView } from '@pos/contracts';
import { bangkokDateKey } from '@pos/domain';
import { api } from '../api/client.ts';
import { baht, dateTime, Dialog, Empty, ErrorNote, Icon, PageHeading, Pill, useLoad } from '../components/ui.tsx';
import { SummaryLines } from './Shift.tsx';

export function ReportsPage() {
  const [date, setDate] = useState(() => bangkokDateKey(new Date().toISOString()));
  const [openShift, setOpenShift] = useState<ShiftView | null>(null);
  const daily = useLoad(() => api.get<DailyReport>(`/reports/daily?date=${date}`), [date]);
  const shifts = useLoad(() => api.get<ShiftView[]>('/reports/shifts'), []);
  const d = daily.data;

  return (
    <>
      <PageHeading title="รายงานการขาย" description="ยอดขาย ยกเลิก สุทธิ และเงินสด ตามวัน (เวลาไทย) และตามกะ"
        actions={<input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} aria-label="วันที่รายงาน" />} />
      <ErrorNote error={daily.error ?? shifts.error} />
      {d && (
        <div className="metric-grid four">
          <div className="metric-card"><div className="metric-label"><Icon name="receipt" />ยอดขายก่อนหักยกเลิก</div><div className="metric-value num">{baht(d.gross)}</div><div className="metric-foot">{d.saleCount} บิล</div></div>
          <div className="metric-card"><div className="metric-label"><Icon name="history" />ยอดยกเลิก</div><div className="metric-value num text-amber">{baht(d.voids)}</div><div className="metric-foot">{d.voidCount} บิล</div></div>
          <div className="metric-card"><div className="metric-label"><Icon name="chart" />ยอดสุทธิ</div><div className="metric-value num">{baht(d.net)}</div><div className="metric-foot">ขาย − ยกเลิก</div></div>
          <div className="metric-card"><div className="metric-label"><Icon name="cash" />เงินนำเข้า/ออก</div><div className="metric-value num">{baht(d.cashIn - d.cashOut)}</div><div className="metric-foot">เข้า {baht(d.cashIn)} · ออก {baht(d.cashOut)}</div></div>
        </div>
      )}
      {d?.shifts.some(s => s.crossesDay) && <p className="field-hint">มีกะที่คร่อมเที่ยงคืนในวันนี้ ยอดรายวันนับเฉพาะรายการที่เกิดในวันที่เลือก ดูยอดทั้งกะได้จากตารางด้านล่าง</p>}
      <section className="panel mt-20">
        <div className="section-heading"><h2>รายงานตามกะ</h2></div>
        {shifts.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>เปิดกะ</th><th>ปิดกะ</th><th>ผู้เปิด</th><th className="right">สุทธิ</th><th className="right">คาดหวัง</th><th className="right">นับจริง</th><th className="right">ขาด/เกิน</th></tr></thead>
              <tbody>
                {shifts.data.map(s => (
                  <tr key={s.id} className="row-link" onClick={() => setOpenShift(s)}>
                    <td>{dateTime(s.openedAt)}</td>
                    <td>{s.closedAt ? dateTime(s.closedAt) : <Pill>เปิดอยู่</Pill>}</td>
                    <td>{s.openedByName}</td>
                    <td className="right num">{baht(s.summary.net)}</td>
                    <td className="right num">{baht(s.expectedCash ?? s.summary.expectedCash)}</td>
                    <td className="right num">{s.countedCash === null ? '—' : baht(s.countedCash)}</td>
                    <td className={`right num ${s.variance ? 'text-red' : ''}`}>{s.variance === null ? '—' : baht(s.variance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !shifts.loading && <Empty title="ยังไม่มีกะ" icon="clock" />}
      </section>
      {openShift && (
        <Dialog title="รายงานกะ" subtitle={`${dateTime(openShift.openedAt)} – ${openShift.closedAt ? dateTime(openShift.closedAt) : 'ยังเปิดอยู่'}`} onClose={() => setOpenShift(null)}
          footer={<><a className="button" href={`#bills`}>ดูบิล</a><button className="button primary" onClick={() => setOpenShift(null)}>ปิด</button></>}>
          <SummaryLines s={openShift.summary} />
          {openShift.closedAt && (
            <div className="stat-list mt-20">
              <div className="stat-line"><span>นับได้จริง</span><strong className="num">{baht(openShift.countedCash ?? 0)}</strong></div>
              <div className="stat-line total"><span>เงินขาด/เกิน</span><strong className="num">{baht(openShift.variance ?? 0)}</strong></div>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
