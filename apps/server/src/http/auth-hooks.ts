import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { fail } from '@pos/domain';
import type { Db, RequestContext, Role } from '../db/tx.ts';
import type { AppConfig } from '../config.ts';

export const SESSION_COOKIE = 'pos_session';

export interface SessionUser { id: string; username: string; displayName: string; role: Role; sessionId: string }

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser: SessionUser | null;
  }
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const newSessionToken = (): string => randomBytes(32).toString('base64url');

/** origin ของ UI ที่อนุญาต: server เองบน loopback และ origin เพิ่มเติม (เช่น vite dev) */
export function allowedOrigins(config: AppConfig): Set<string> {
  return new Set([`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, ...config.extraOrigins]);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PUBLIC_PATHS = new Set(['/api/setup/status', '/api/setup/owner', '/api/auth/login', '/api/auth/logout', '/api/health']);

export function registerAuthHooks(app: FastifyInstance, deps: { db: Db; config: AppConfig; clock: () => string }): void {
  const origins = allowedOrigins(deps.config);
  const hosts = new Set([...origins].map(o => new URL(o).host));
  app.decorateRequest('sessionUser', null);

  const findSession = deps.db.prepare(`
    SELECT s.id_hash, u.id, u.username, u.display_name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.active = 1`);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    // ป้องกัน DNS rebinding และคำขอข้ามเว็บ: Host ต้องเป็น loopback ของแอป
    if (!hosts.has(req.headers.host ?? '')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'ปฏิเสธคำขอจาก host นี้' } });
    }
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !origins.has(origin)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'คำขอต้องมาจากหน้าจอของแอปเท่านั้น' } });
      }
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const row = findSession.get(hashToken(token), deps.clock()) as
        | { id_hash: string; id: string; username: string; display_name: string; role: Role }
        | undefined;
      if (row) req.sessionUser = { id: row.id, username: row.username, displayName: row.display_name, role: row.role, sessionId: row.id_hash };
    }
    if (!req.sessionUser && !PUBLIC_PATHS.has(req.url.split('?')[0]!)) {
      return reply.status(401).send({ error: { code: 'UNAUTHENTICATED', message: 'กรุณาเข้าสู่ระบบ' } });
    }
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
  });
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.sessionUser) fail('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
  return req.sessionUser;
}

/** ตรวจสิทธิ์ใน API ทุกคำขอ ไม่อาศัยการซ่อนปุ่ม (R06) */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = requireUser(req);
    if (!roles.includes(user.role)) fail('FORBIDDEN', 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');
  };
}

export function contextOf(req: FastifyRequest, clock: () => string): RequestContext {
  const user = requireUser(req);
  return { userId: user.id, role: user.role, sessionId: user.sessionId, now: clock() };
}
