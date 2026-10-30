import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MeResponse, SetupStatus, ShiftView, UserView } from '@pos/contracts';
import { api, setUnauthenticatedHandler } from './api/client.ts';
import { Icon, initial, timeOnly } from './components/ui.tsx';
import { SessionContext, type Session } from './session.tsx';
import { LoginPage, SetupPage } from './pages/Auth.tsx';
import { SalePage } from './pages/Sale.tsx';
import { BillsPage } from './pages/Bills.tsx';
import { ProductsPage } from './pages/Products.tsx';
import { InventoryPage } from './pages/Inventory.tsx';
import { ShiftPage } from './pages/Shift.tsx';
import { ReportsPage } from './pages/Reports.tsx';
import { UsersPage } from './pages/Users.tsx';
import { AuditPage } from './pages/Audit.tsx';
import { SystemPage } from './pages/System.tsx';

interface NavItem { id: string; label: string; icon: string; owner?: boolean; group: 'front' | 'manage' }
const NAV: NavItem[] = [
  { id: 'sale', label: 'ขายสินค้า', icon: 'bag', group: 'front' },
  { id: 'bills', label: 'ประวัติการขาย', icon: 'receipt', group: 'front' },
  { id: 'products', label: 'สินค้า', icon: 'box', owner: true, group: 'front' },
  { id: 'inventory', label: 'สต๊อก', icon: 'history', owner: true, group: 'front' },
  { id: 'shift', label: 'กะและเงินสด', icon: 'clock', group: 'manage' },
  { id: 'reports', label: 'รายงานการขาย', icon: 'chart', owner: true, group: 'manage' },
  { id: 'users', label: 'ผู้ใช้งาน', icon: 'users', owner: true, group: 'manage' },
  { id: 'audit', label: 'ประวัติการทำรายการ', icon: 'shield', owner: true, group: 'manage' },
  { id: 'system', label: 'ระบบและสำรองข้อมูล', icon: 'server', owner: true, group: 'manage' },
];

const PAGES: Record<string, () => React.JSX.Element> = {
  sale: SalePage, bills: BillsPage, products: ProductsPage, inventory: InventoryPage, shift: ShiftPage,
  reports: ReportsPage, users: UsersPage, audit: AuditPage, system: SystemPage,
};

const pageFromHash = () => window.location.hash.replace(/^#/, '').split('/')[0] || 'sale';

type Boot = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'setup' } | { kind: 'login' } | { kind: 'ready'; user: UserView };

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [page, setPage] = useState(pageFromHash);
  const [shift, setShift] = useState<ShiftView | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const start = useCallback(async () => {
    try {
      const setup = await api.get<SetupStatus>('/setup/status');
      if (setup.needsOwner) return setBoot({ kind: 'setup' });
      try {
        const me = await api.get<MeResponse>('/auth/me');
        setBoot({ kind: 'ready', user: me.user });
      } catch {
        setBoot({ kind: 'login' });
      }
    } catch (err) {
      setBoot({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => { void start(); }, [start]);
  useEffect(() => { setUnauthenticatedHandler(() => setBoot({ kind: 'login' })); }, []);
  useEffect(() => {
    const onHash = () => { setPage(pageFromHash()); setMenuOpen(false); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const refreshShift = useCallback(async () => {
    const res = await api.get<{ shift: ShiftView | null }>('/shifts/current');
    setShift(res.shift);
  }, []);

  useEffect(() => { if (boot.kind === 'ready') void refreshShift().catch(() => {}); }, [boot, refreshShift]);

  const session = useMemo<Session | null>(() => boot.kind !== 'ready' ? null : {
    user: boot.user,
    shift,
    refreshShift,
    logout: async () => { await api.postPlain('/auth/logout').catch(() => {}); setBoot({ kind: 'login' }); },
    toast: (text, tone = 'ok') => { setToastMsg({ text, tone }); window.setTimeout(() => setToastMsg(t => (t?.text === text ? null : t)), 3500); },
    navigate: p => { window.location.hash = p; },
  }, [boot, shift, refreshShift]);

  if (boot.kind === 'loading') return <div className="startup"><div className="loading-spinner" /><p>กำลังเปิดบ้านดี POS…</p></div>;
  if (boot.kind === 'error') {
    return <div className="startup"><h1>เชื่อมต่อระบบในเครื่องไม่ได้</h1><p>ตรวจว่า service บ้านดี POS ทำงานอยู่ แล้วลองใหม่</p><small>{boot.message}</small><button className="button primary" onClick={() => void start()}>ลองใหม่</button></div>;
  }
  if (boot.kind === 'setup') return <SetupPage onDone={() => setBoot({ kind: 'login' })} />;
  if (boot.kind === 'login' || !session) return <LoginPage onLogin={user => { setBoot({ kind: 'ready', user }); }} />;

  const owner = session.user.role === 'owner';
  const allowed = NAV.filter(n => !n.owner || owner);
  const current = allowed.some(n => n.id === page) ? page : 'sale';
  const Page = PAGES[current]!;
  const navGroup = (group: NavItem['group']) => allowed.filter(n => n.group === group).map(n => (
    <a key={n.id} className={`nav-item ${current === n.id ? 'active' : ''}`} href={`#${n.id}`} aria-current={current === n.id ? 'page' : undefined}>
      <Icon name={n.icon} /><span>{n.label}</span>
    </a>
  ));

  return (
    <SessionContext.Provider value={session}>
      <div className={`app-shell ${menuOpen ? 'menu-open' : ''}`}>
        <aside className="sidebar" aria-label="เมนูหลัก">
          <a className="brand" href="#sale" aria-label="บ้านดี POS หน้าขาย">
            <span className="brand-mark"><Icon name="shop" /></span>
            <div><div className="brand-name">บ้านดี<span>POS</span></div><div className="brand-caption">เพื่อนคู่ร้าน ในทุกวัน</div></div>
          </a>
          <div className="nav-label">หน้าร้าน</div>
          <nav className="nav-group">{navGroup('front')}</nav>
          <div className="nav-label">จัดการร้าน</div>
          <nav className="nav-group">{navGroup('manage')}</nav>
          <div className="sidebar-bottom">
            <div className="local-status"><span className="status-dot" /><div><strong>ข้อมูลอยู่ในเครื่องร้าน</strong>ขายเงินสดได้แม้ไม่มีอินเทอร์เน็ต</div></div>
            <div className="sidebar-footer">บ้านดี POS <span>v0.1</span></div>
          </div>
        </aside>
        <div className="mobile-overlay" onClick={() => setMenuOpen(false)} />
        <main className="main-shell">
          <header className="topbar">
            <div className="topbar-store">
              <button className="mobile-menu" onClick={() => setMenuOpen(o => !o)} aria-label="เปิดเมนู"><Icon name="menu" /></button>
              <span className="store-icon"><Icon name="shop" /></span>
              <div>บ้านดี มินิมาร์ท<small>เครื่องขาย 01 · {shift ? `กะเปิด ${timeOnly(shift.openedAt)} น.` : 'ยังไม่เปิดกะ'}</small></div>
            </div>
            <div className="topbar-right">
              <div className="topbar-divider" />
              <div className="profile-button" aria-label="ผู้ใช้งาน">
                <span className="avatar">{initial(session.user.displayName)}</span>
                <span className="profile-copy"><strong>{session.user.displayName}</strong><small>{owner ? 'เจ้าของร้าน' : 'พนักงานขาย'}</small></span>
              </div>
              <button className="button small ghost" onClick={() => void session.logout()}><Icon name="logout" />ออกจากระบบ</button>
            </div>
          </header>
          <div id="page-content" className="workspace"><Page /></div>
        </main>
      </div>
      <div id="toast-region" aria-live="polite" aria-atomic="true">
        {toastMsg && <div className={`toast ${toastMsg.tone === 'error' ? 'error' : ''}`}><Icon name={toastMsg.tone === 'error' ? 'alert' : 'check'} />{toastMsg.text}</div>}
      </div>
    </SessionContext.Provider>
  );
}
