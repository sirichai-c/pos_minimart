import { useState, type FormEvent } from 'react';
import type { RoleName, UserView } from '@pos/contracts';
import { api, errorText } from '../api/client.ts';
import { dateTime, Dialog, ErrorNote, Icon, PageHeading, Pill, useLoad } from '../components/ui.tsx';
import { useSession } from '../session.tsx';

export function UsersPage() {
  const session = useSession();
  const list = useLoad(() => api.get<UserView[]>('/users'), []);
  const [editing, setEditing] = useState<UserView | 'new' | null>(null);

  async function toggle(u: UserView) {
    try {
      await api.patch(`/users/${u.id}`, { active: !u.active });
      session.toast(u.active ? `ปิดบัญชี ${u.displayName} แล้ว` : `เปิดบัญชี ${u.displayName} แล้ว`);
      list.reload();
    } catch (err) {
      session.toast(errorText(err), 'error');
    }
  }

  return (
    <>
      <PageHeading title="ผู้ใช้งาน" description="บัญชีเจ้าของร้านและพนักงานขาย ปิดบัญชีแทนการลบเพื่อเก็บผู้ทำรายการเดิม"
        actions={<button className="button primary" onClick={() => setEditing('new')}><Icon name="plus" />เพิ่มผู้ใช้</button>} />
      <div className="panel">
        <ErrorNote error={list.error} />
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>ชื่อ</th><th>ชื่อผู้ใช้</th><th>สิทธิ์</th><th>สถานะ</th><th>สร้างเมื่อ</th><th /></tr></thead>
            <tbody>
              {list.data?.map(u => (
                <tr key={u.id}>
                  <td><strong>{u.displayName}</strong></td>
                  <td>{u.username}</td>
                  <td>{u.role === 'owner' ? 'เจ้าของร้าน' : 'พนักงานขาย'}</td>
                  <td>{u.active ? <Pill>ใช้งาน</Pill> : <Pill tone="gray">ปิดบัญชี</Pill>}</td>
                  <td>{dateTime(u.createdAt, false)}</td>
                  <td className="right table-actions">
                    <button className="button small" onClick={() => setEditing(u)}><Icon name="edit" />แก้ไข/รีเซ็ตรหัส</button>
                    {u.id !== session.user.id && <button className="button small ghost" onClick={() => void toggle(u)}>{u.active ? 'ปิดบัญชี' : 'เปิดบัญชี'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <UserDialog user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

function UserDialog({ user, onClose, onSaved }: { user: UserView | null; onClose: () => void; onSaved: () => void }) {
  const session = useSession();
  const [form, setForm] = useState({ displayName: user?.displayName ?? '', username: user?.username ?? '', role: (user?.role ?? 'cashier') as RoleName, password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (user) {
        await api.patch(`/users/${user.id}`, { displayName: form.displayName.trim(), role: form.role, ...(form.password ? { password: form.password } : {}) });
      } else {
        await api.post('/users', { displayName: form.displayName.trim(), username: form.username.trim(), role: form.role, password: form.password }, key);
      }
      session.toast('บันทึกผู้ใช้แล้ว');
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={user ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'} subtitle={user ? 'เปลี่ยนสิทธิ์หรือรีเซ็ตรหัส จะบังคับให้ผู้ใช้นี้ล็อกอินใหม่' : 'รหัสผ่านอย่างน้อย 8 ตัวอักษร'} onClose={onClose}
      footer={<><button type="button" className="button" onClick={onClose}>ยกเลิก</button><button type="submit" form="user-form" className="button primary" disabled={busy}>บันทึก</button></>}>
      <ErrorNote error={error} />
      <form id="user-form" className="form-grid" onSubmit={submit}>
        <label className="field"><span>ชื่อที่แสดง</span><input required maxLength={80} value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} autoFocus /></label>
        <label className="field"><span>ชื่อผู้ใช้</span><input required minLength={3} maxLength={40} pattern="[A-Za-z0-9._\-]+" disabled={!!user} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
        <label className="field"><span>สิทธิ์</span><select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as RoleName })}><option value="cashier">พนักงานขาย</option><option value="owner">เจ้าของร้าน</option></select></label>
        <label className="field"><span>{user ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน'}</span><input type="password" required={!user} minLength={8} autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
      </form>
    </Dialog>
  );
}
