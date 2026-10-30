// fetch wrapper: แปลง error code และใส่ Idempotency-Key ให้คำสั่งเขียน
import type { ApiErrorBody } from '@pos/contracts';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** เครือข่ายขาด/server ล่ม/5xx: ไม่รู้ว่าบันทึกแล้วหรือยัง ต้องกู้ผลด้วย key เดิม */
  get outcomeUnknown(): boolean {
    return this.code === 'NETWORK' || this.status >= 500 || this.status === 0;
  }
}

export const newKey = (): string => crypto.randomUUID();

type Method = 'GET' | 'POST' | 'PATCH';
let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: () => void): void { onUnauthenticated = fn; }

async function request<T>(method: Method, path: string, body?: unknown, key?: string): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  let res: Response;
  try {
    res = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError('NETWORK', 'เชื่อมต่อระบบในเครื่องไม่ได้ ผลรายการยังไม่แน่ชัด', 0);
  }
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401 && onUnauthenticated && !path.startsWith('/auth/login')) onUnauthenticated();
    throw new ApiError(err?.code ?? 'HTTP_' + res.status, err?.message ?? `ระบบตอบกลับผิดปกติ (${res.status})`, res.status, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  /** คำสั่งเขียนที่เปลี่ยนข้อมูลธุรกิจ: ส่ง key เดิมเมื่อลองใหม่ */
  post: <T>(path: string, body: unknown = {}, key: string = newKey()) => request<T>('POST', path, body, key),
  patch: <T>(path: string, body: unknown, key: string = newKey()) => request<T>('PATCH', path, body, key),
  /** setup/login/logout ไม่ใช้ key */
  postPlain: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
};

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
