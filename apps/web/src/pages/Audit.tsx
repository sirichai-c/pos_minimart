import { useState } from 'react';
import type { AuditEventView } from '@pos/contracts';
import { api } from '../api/client.ts';
import { dateTime, Empty, ErrorNote, PageHeading, useLoad } from '../components/ui.tsx';

const ACTIONS: Record<string, string> = {
  'setup.owner_created': 'สร้างเจ้าของร้าน', 'auth.login': 'เข้าสู่ระบบ', 'auth.logout': 'ออกจากระบบ', 'auth.login_failed': 'ล็อกอินผิด', 'auth.locked': 'ล็อกบัญชีชั่วคราว',
  'user.created': 'เพิ่มผู้ใช้', 'user.updated': 'แก้ไขผู้ใช้', 'product.created': 'เพิ่มสินค้า', 'product.updated': 'แก้ไขสินค้า', 'product.price_changed': 'แก้ราคา',
  'inventory.received': 'รับสินค้าเข้า', 'inventory.adjusted': 'ปรับยอดสต๊อก', 'shift.opened': 'เปิดกะ', 'shift.closed': 'ปิดกะ', 'cash.in': 'นำเงินเข้า', 'cash.out': 'นำเงินออก',
  'sale.created': 'ขาย', 'sale.voided': 'ยกเลิกบิล', 'backup.manual': 'สำรองข้อมูล', 'backup.manual_failed': 'สำรองข้อมูลไม่สำเร็จ', 'system.restored': 'กู้คืนข้อมูล',
};
const TYPES = [['', 'ทุกประเภท'], ['sale', 'การขาย'], ['product', 'สินค้า/สต๊อก'], ['shift', 'กะและเงินสด'], ['user', 'ผู้ใช้'], ['backup', 'สำรอง/กู้คืน']] as const;

export function AuditPage() {
  const [type, setType] = useState('');
  const list = useLoad(() => api.get<AuditEventView[]>(`/audit-events${type ? '?entityType=' + type : ''}`), [type]);
  return (
    <>
      <PageHeading title="ประวัติการทำรายการ" description="บันทึกต่อท้ายเท่านั้น แก้หรือลบไม่ได้ ไม่มีรหัสผ่านหรือ token ในบันทึก"
        actions={<select value={type} onChange={e => setType(e.target.value)} aria-label="ประเภท">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>} />
      <div className="panel">
        <ErrorNote error={list.error} />
        {list.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>เวลา</th><th>รายการ</th><th>ผู้ทำ</th><th>รายละเอียด</th></tr></thead>
              <tbody>
                {list.data.map(a => (
                  <tr key={a.id}>
                    <td className="nowrap">{dateTime(a.createdAt)}</td>
                    <td>{ACTIONS[a.action] ?? a.action}</td>
                    <td>{a.userName ?? 'ระบบ'}</td>
                    <td><div className="audit-data">{a.data ? JSON.stringify(a.data, null, 1) : '—'}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !list.loading && <Empty title="ยังไม่มีรายการ" icon="shield" />}
      </div>
    </>
  );
}
