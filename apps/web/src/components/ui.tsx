import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatBaht, parseBaht } from '@pos/domain';

// ไอคอนชุดเดียวกับ mockup
const paths: Record<string, string> = {
  shop: '<path d="M3 10h18l-2-6H5l-2 6Zm1 0v10h16V10M9 20v-6h6v6"/><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',
  bag: '<path d="M5 7h14l1 14H4L5 7Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  receipt: '<path d="M5 3l3 2 4-2 4 2 3-2v18l-3-2-4 2-4-2-3 2V3Z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
  box: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M4 3v17h17M8 15v-4M13 15V7M18 15V4"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  scan: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 8v8M10 8v8M14 8v8M17 8v8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  cash: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M5 9h1M18 15h1"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l4 2"/>',
  printer: '<path d="M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6v-7ZM17 11h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="m12 3 10 18H2L12 3ZM12 9v5M12 17h.01"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 1-10 7 7 0 0 1 13 4 4 4 0 0 1-2 6H7Z"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  logout: '<path d="M9 3H4v18h5M10 12h11m-5-5 5 5-5 5"/>',
  arrowDown: '<path d="M12 3v18m-6-6 6 6 6-6"/>', arrowUp: '<path d="M12 21V3m-6 6 6-6 6 6"/>',
};

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: paths[name] ?? paths.box! }} />
  );
}

export const baht = (satang: number): string => '฿' + formatBaht(satang);
export const num = (n: number): string => n.toLocaleString('th-TH');

export function dateTime(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric', calendar: 'gregory', timeZone: 'Asia/Bangkok',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso));
}
export const timeOnly = (iso: string | null | undefined): string =>
  iso ? new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(new Date(iso)) : '—';

export function Pill({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'orange' | 'red' | 'gray' | 'blue' }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function PageHeading({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="page-heading">
      <div><h1>{title}</h1><p>{description}</p></div>
      <div className="page-actions">{actions}</div>
    </div>
  );
}

export function Empty({ title, subtitle, icon = 'search' }: { title: string; subtitle?: string; icon?: string }) {
  return <div className="empty-state"><Icon name={icon} /><strong>{title}</strong>{subtitle && <p>{subtitle}</p>}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <div className="form-error" role="alert" style={{ display: 'block' }}>{error}</div> : null;
}

/** dialog แบบ modal ของ mockup; ปิดด้วย Esc หรือปุ่มปิด */
export function Dialog({ title, subtitle, children, footer, onClose, wide = false }: {
  title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    // showModal ย้าย focus ไปปุ่มปิด จึงต้องเลือกช่องกรอกแรกเอง
    el?.querySelector<HTMLElement>('[data-autofocus], .dialog-body input:not([type=hidden]):not([type=checkbox]), .dialog-body textarea, .dialog-body select')?.focus();
    return () => { if (el?.open) el.close(); };
  }, []);
  return (
    <dialog ref={ref} className={wide ? 'wide' : ''} aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); onClose(); }}>
      <div className="dialog-head">
        <div><h2 id="dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><Icon name="close" /></button>
      </div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-footer">{footer}</div>}
    </dialog>
  );
}

/** ช่องกรอกเงินบาท แปลงเป็นสตางค์ด้วย parseBaht (ไม่ใช้ float) */
export function MoneyInput({ label, value, onChange, autoFocus, name, full }: {
  label: string; value: string; onChange: (text: string, satang: number | null) => void; autoFocus?: boolean; name?: string; full?: boolean;
}) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      <input name={name} inputMode="decimal" autoComplete="off" value={value} autoFocus={autoFocus} placeholder="0.00"
        onChange={e => onChange(e.target.value, tryParseBaht(e.target.value))} />
    </label>
  );
}

export function tryParseBaht(text: string): number | null {
  try { return parseBaht(text); } catch { return null; }
}

export const satangToInput = (satang: number): string => formatBaht(satang).replace(/,/g, '');

/** โหลดข้อมูลจาก API พร้อมสถานะ */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    load().then(d => { if (alive) { setData(d); setError(null); } }, e => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick(t => t + 1) };
}

/** ตัวอักษรแรกที่ไม่ใช่สระนำ สำหรับรูปแทนสินค้า/ผู้ใช้ */
export const initial = (text: string): string => text.replace(/^[เแโใไ]/, '').slice(0, 1);
