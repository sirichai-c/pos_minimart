import type { FastifyInstance } from 'fastify';
import { LoginBody, SetupOwnerBody, type LoginRequest, type SetupOwnerRequest } from '@pos/contracts';
import { contextOf, requireUser, SESSION_COOKIE } from '../../http/auth-hooks.ts';
import type { AppDeps } from '../../app.ts';
import { login, logout, needsOwner, setupOwner, toUserView, type UserRow } from './service.ts';

export function authRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config, clock } = deps;

  app.get('/api/setup/status', async () => ({ needsOwner: needsOwner(db) }));

  app.post('/api/setup/owner', { schema: { body: SetupOwnerBody } }, async (req, reply) => {
    const user = await setupOwner(db, req.body as SetupOwnerRequest, clock());
    return reply.status(201).send({ user });
  });

  app.post('/api/auth/login', { schema: { body: LoginBody } }, async (req, reply) => {
    const result = await login(db, config, req.body as LoginRequest, clock);
    reply.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true, sameSite: 'strict', path: '/', expires: new Date(result.expiresAt),
    });
    return { user: result.user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionUser) {
      const ctx = contextOf(req, clock);
      logout(db, ctx.sessionId, ctx.userId, ctx.now);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async req => {
    const user = requireUser(req);
    return { user: toUserView(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow) };
  });
}
