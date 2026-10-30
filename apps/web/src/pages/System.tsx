import { useState } from 'react';
import type { BackupRunView, SystemStatus } from '@pos/contracts';
import { api, errorText } from '../api/client.ts';
import { dateTime, Empty, ErrorNote, Icon, PageHeading, Pill, useLoad } from '../components/ui.tsx';
import { useSession } from '../session.tsx';

const KIND: Record<BackupRunView['kind'], string> = { interval: 'ทุก 15 นาที', shift_close: 'หลังปิดกะ', daily: 'รายวัน', manual: 'สั่งเอง' };
const bytes = (n: number | null) => (n === null ? '—' : n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e3).toFixed(0) + ' KB');

function age(iso: string | null | undefined, now: string): string {
  if (!iso) return '';
  const min = Math.round((Date.parse(now) - Date.parse(iso)) / 60_000);
  return min < 1 ? 'เมื่อสักครู่' : min < 120 ? `${min} นาทีที่แล้ว` : `${Math.round(min / 60)} ชั่วโมงที่แล้ว`;
}

/** แสดงเวลาจริงของ snapshot/upload ล่าสุด งานค้าง และ error จริง (R07) */
export function SystemPage() {
  const session = useSession();
  const status = useLoad(() => api.get<SystemStatus>('/system/status'), []);
  const runs = useLoad(() => api.get<BackupRunView[]>('/backups'), []);
  const [busy, setBusy] = useState(false);
  const s = status.data;

  async function backupNow() {
    setBusy(true);
    try {
      const run = await api.post<BackupRunView>('/backups', {});
      session.toast(run.status === 'ok' ? 'สำรองข้อมูลสำเร็จ' : `สำรองข้อมูลไม่สำเร็จ: ${run.error}`, run.status === 'ok' ? 'ok' : 'error');
    } catch (err) {
      session.toast(errorText(err), 'error');
    } finally {
      setBusy(false);
      status.reload();
      runs.reload();
    }
  }

  const snapshotStale = s && (!s.lastSnapshot || Date.parse(s.now) - Date.parse(s.lastSnapshot.startedAt) > 30 * 60_000);
  const lowDisk = s?.disk.freeBytes != null && s.disk.freeBytes < 1e9;

  return (
    <>
      <PageHeading title="ระบบและสำรองข้อมูล" description="สถานะเครื่อง ฐานข้อมูล และจุดกู้คืนล่าสุด"
        actions={<><button className="button" onClick={() => { status.reload(); runs.reload(); }}><Icon name="refresh" />รีเฟรช</button><button className="button primary" disabled={busy} onClick={() => void backupNow()}><Icon name="cloud" />สำรองข้อมูลตอนนี้</button></>} />
      <ErrorNote error={status.error ?? runs.error} />
      {s && (
        <div className="status-grid">
          <div className="status-tile"><Icon name="server" /><h3>ฐานข้อมูลในเครื่อง</h3><strong>schema {s.schemaVersion} · v{s.appVersion}</strong><p className="mono">{s.dbPath}</p></div>
          <div className="status-tile"><Icon name="box" /><h3>พื้นที่ดิสก์</h3><strong className={lowDisk ? 'text-red' : ''}>ว่าง {bytes(s.disk.freeBytes)}</strong><p>จากทั้งหมด {bytes(s.disk.totalBytes)}{lowDisk ? ' · พื้นที่เหลือน้อย' : ''}</p></div>
          <div className="status-tile"><Icon name="history" /><h3>Snapshot ล่าสุด</h3>
            <strong className={snapshotStale ? 'text-red' : ''}>{s.lastSnapshot ? dateTime(s.lastSnapshot.startedAt) : 'ยังไม่มี'}</strong>
            <p>{s.lastSnapshot ? age(s.lastSnapshot.startedAt, s.now) : 'ยังไม่มีจุดกู้คืน'}{s.lastFailedSnapshot && (!s.lastSnapshot || s.lastFailedSnapshot.startedAt > s.lastSnapshot.startedAt) ? ` · ล้มเหลวล่าสุด: ${s.lastFailedSnapshot.error}` : ''}</p></div>
          <div className="status-tile"><Icon name="cloud" /><h3>สำรองนอกเครื่อง</h3>
            <strong className={s.uploadTarget && s.pendingUploads ? 'text-amber' : ''}>{!s.uploadTarget ? 'ยังไม่ได้ตั้งค่า' : s.lastUpload ? dateTime(s.lastUpload.uploadedAt) : 'ยังไม่เคยสำเร็จ'}</strong>
            <p>{s.uploadTarget ? `${s.uploadTarget} · ค้างส่ง ${s.pendingUploads} ไฟล์` : 'ตั้งค่า upload ใน data/config.json หรือ POS_UPLOAD_DIR'}</p></div>
        </div>
      )}
      <section className="panel mt-20">
        <div className="section-heading"><h2>ประวัติการสำรองข้อมูล</h2><span className="muted">snapshot ระยะสั้นเก็บ 48 ชม. · รายวันเก็บ 30 วัน</span></div>
        {runs.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>เริ่ม</th><th>ประเภท</th><th>สถานะ</th><th>ไฟล์</th><th className="right">ขนาด</th><th>ส่งนอกเครื่อง</th></tr></thead>
              <tbody>
                {runs.data.map(r => (
                  <tr key={r.id}>
                    <td className="nowrap">{dateTime(r.startedAt)}</td>
                    <td>{KIND[r.kind]}</td>
                    <td>{r.status === 'ok' ? <Pill>สำเร็จ</Pill> : r.status === 'failed' ? <Pill tone="red">ล้มเหลว</Pill> : <Pill tone="orange">กำลังทำ</Pill>}{r.error && <div className="field-hint">{r.error}</div>}</td>
                    <td className="mono">{r.fileName ?? '—'}</td>
                    <td className="right num">{bytes(r.sizeBytes)}</td>
                    <td>{r.uploadedAt ? dateTime(r.uploadedAt) : r.uploadError ? <span className="text-amber">ลอง {r.uploadAttempts} ครั้ง: {r.uploadError}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !runs.loading && <Empty title="ยังไม่มีการสำรองข้อมูล" icon="cloud" />}
      </section>
    </>
  );
}
