// จุดล้มเหลวจำลองสำหรับ A02, A03, A15 เปิดได้เฉพาะ NODE_ENV=test
export type FaultPoint = 'before-commit' | 'after-commit-before-response' | 'disk-full' | 'backup-disk-full' | 'upload-fail';

interface Armed { scope: string | null; remaining: number }

const armed = new Map<FaultPoint, Armed>();
const enabled = () => process.env.NODE_ENV === 'test';

/** POS_FAULT=before-commit:sales,disk-full */
function loadFromEnv(): void {
  if (!enabled() || !process.env.POS_FAULT) return;
  for (const part of process.env.POS_FAULT.split(',')) {
    const [point, scope] = part.split(':');
    if (point) armed.set(point as FaultPoint, { scope: scope ?? null, remaining: Infinity });
  }
}
loadFromEnv();

export function armFault(point: FaultPoint, options: { scope?: string; times?: number } = {}): void {
  if (!enabled()) throw new Error('fault injection เปิดได้เฉพาะ NODE_ENV=test');
  armed.set(point, { scope: options.scope ?? null, remaining: options.times ?? 1 });
}

export function clearFaults(): void {
  armed.clear();
}

export class InjectedFault extends Error {
  readonly code: string;
  constructor(point: FaultPoint, code: string) {
    super(`injected fault: ${point}`);
    this.code = code;
  }
}

/** ถ้าจุดนี้ถูกตั้งไว้ จะ throw เพื่อจำลองการล้มเหลว */
export function trip(point: FaultPoint, scope: string): void {
  if (!enabled()) return;
  const fault = armed.get(point);
  if (!fault || (fault.scope && fault.scope !== scope)) return;
  fault.remaining -= 1;
  if (fault.remaining <= 0) armed.delete(point);
  const code = point === 'disk-full' || point === 'backup-disk-full' ? 'SQLITE_FULL' : 'INJECTED_FAULT';
  throw new InjectedFault(point, code);
}
