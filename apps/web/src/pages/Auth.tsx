import { useState, type FormEvent } from 'react';
import type { MeResponse, UserView } from '@pos/contracts';
import { api, errorText } from '../api/client.ts';
import { ErrorNote, Icon } from '../components/ui.tsx';

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><Icon name="shop" /></span>
      <div><div className="brand-name">บ้านดี<span>POS</span></div><div className="brand-caption">เพื่อนคู่ร้าน ในทุกวัน</div></div>
    </div>
  );
}

/** สร้าง owner คนแรกบนเครื่อง ไม่มีบัญชีเริ่มต้นที่ใช้ร่วมกัน (R06) */
export function SetupPage({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ displayName: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) return setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    if (form.password.length < 8) return setError('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
    setBusy(true);
    try {
      await api.postPlain('/setup/owner', { displayName: form.displayName.trim(), username: form.username.trim(), password: form.password });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-card">
        <Brand />
        <h1>ตั้งค่าเจ้าของร้าน</h1>
        <p className="lead">สร้างบัญชีเจ้าของร้านบัญชีแรกบนเครื่องนี้ บัญชีนี้ใช้จัดการสินค้า ผู้ใช้ สต๊อก และการสำรองข้อมูล</p>
        <ErrorNote error={error} />
        <form onSubmit={submit}>
          <label className="field"><span>ชื่อที่แสดง</span><input required maxLength={80} value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} autoFocus /></label>
          <label className="field"><span>ชื่อผู้ใช้ (อังกฤษ/ตัวเลข)</span><input required minLength={3} maxLength={40} pattern="[A-Za-z0-9._\-]+" autoComplete="username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
          <label className="field"><span>รหัสผ่าน</span><input required type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
          <label className="field"><span>ยืนยันรหัสผ่าน</span><input required type="password" minLength={8} autoComplete="new-password" value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} /></label>
          <button className="button primary" disabled={busy}>สร้างบัญชีเจ้าของร้าน</button>
        </form>
      </section>
    </div>
  );
}

export function LoginPage({ onLogin }: { onLogin: (user: UserView) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.postPlain<MeResponse>('/auth/login', { username: username.trim(), password });
      onLogin(res.user);
    } catch (err) {
      setError(errorText(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-card">
        <Brand />
        <h1>เข้าสู่ระบบ</h1>
        <p className="lead">ใช้บัญชีของร้านบนเครื่องนี้ ไม่ต้องเชื่อมต่ออินเทอร์เน็ต</p>
        <ErrorNote error={error} />
        <form onSubmit={submit}>
          <label className="field"><span>ชื่อผู้ใช้</span><input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} autoFocus /></label>
          <label className="field"><span>รหัสผ่าน</span><input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
          <button className="button primary" disabled={busy}><Icon name="lock" />เข้าสู่ระบบ</button>
        </form>
      </section>
    </div>
  );
}
