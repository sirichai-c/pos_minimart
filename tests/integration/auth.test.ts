import { afterEach, describe, expect, it } from 'vitest';
import { CASHIER, count, createEnv, OWNER, type TestEnv } from '../helpers.ts';

let env: TestEnv;
afterEach(async () => { await env?.close(); });

describe('setup and login', () => {
  it('creates the first owner only once, without default accounts', async () => {
    env = await createEnv({ seedUsers: false });
    expect((await env.anon.get('/api/setup/status')).body).toEqual({ needsOwner: true });
    expect(count(env.db, 'users')).toBe(0);
    expect((await env.anon.post('/api/setup/owner', OWNER, { key: null })).status).toBe(201);
    expect((await env.anon.get('/api/setup/status')).body).toEqual({ needsOwner: false });
    const again = await env.anon.post('/api/setup/owner', { ...OWNER, username: 'other' }, { key: null });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SETUP_ALREADY_DONE');
  });

  it('stores Argon2id hashes and hashed session tokens only', async () => {
    env = await createEnv();
    const user = env.db.prepare("SELECT password_hash FROM users WHERE username = 'owner'").get() as { password_hash: string };
    expect(user.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    const res = await env.newClient().post('/api/auth/login', { username: OWNER.username, password: OWNER.password }, { key: null });
    const cookie = String((res.headers['set-cookie'] as string[] | string)).split(';')[0]!.split('=')[1]!;
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/);
    expect(String(res.headers['set-cookie'])).toMatch(/SameSite=Strict/);
    expect(count(env.db, 'sessions', 'id_hash = ?', cookie)).toBe(0);
    const audits = env.db.prepare('SELECT data_json FROM audit_events').all() as { data_json: string | null }[];
    expect(JSON.stringify(audits)).not.toContain(OWNER.password);
  });

  it('requires a session and logs out', async () => {
    env = await createEnv();
    expect((await env.anon.get('/api/products')).status).toBe(401);
    expect((await env.owner.get('/api/auth/me')).body.user.role).toBe('owner');
    await env.owner.post('/api/auth/logout', {}, { key: null });
    expect((await env.owner.get('/api/auth/me')).status).toBe(401);
  });

  it('locks login after repeated failures', async () => {
    env = await createEnv();
    const c = env.newClient();
    for (let i = 0; i < 5; i++) {
      const res = await c.post('/api/auth/login', { username: CASHIER.username, password: 'wrong-password' }, { key: null });
      expect(res.status).toBe(401);
    }
    const locked = await c.post('/api/auth/login', { username: CASHIER.username, password: CASHIER.password }, { key: null });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    env.clock.advance(16 * 60_000);
    expect((await c.post('/api/auth/login', { username: CASHIER.username, password: CASHIER.password }, { key: null })).status).toBe(200);
  });

  it('expires sessions', async () => {
    env = await createEnv();
    env.clock.advance(13 * 3_600_000);
    expect((await env.owner.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects writes without the app Origin or with a foreign Host', async () => {
    env = await createEnv();
    const noOrigin = await env.owner.post('/api/shifts', { openingCash: 0 }, { origin: null });
    expect(noOrigin.status).toBe(403);
    const evil = await env.owner.post('/api/shifts', { openingCash: 0 }, { origin: 'http://evil.example' });
    expect(evil.status).toBe(403);
    const foreignHost = await env.app.inject({ method: 'GET', url: '/api/setup/status', headers: { host: 'evil.example:4180' } });
    expect(foreignHost.statusCode).toBe(403);
    expect(count(env.db, 'shifts')).toBe(0);
  });

  it('cashier gets 403 on owner APIs', async () => {
    env = await createEnv();
    expect((await env.cashier.get('/api/users')).status).toBe(403);
    expect((await env.cashier.post('/api/users', { ...CASHIER, username: 'x2', role: 'owner' })).status).toBe(403);
    expect((await env.cashier.post('/api/products', { sku: 'A', name: 'A', price: 1 })).status).toBe(403);
    expect((await env.cashier.get('/api/audit-events')).status).toBe(403);
    expect((await env.cashier.get('/api/system/status')).status).toBe(403);
    expect((await env.cashier.post('/api/backups', {})).status).toBe(403);
  });

  it('deactivating a user revokes their sessions; last owner is protected', async () => {
    env = await createEnv();
    const users = (await env.owner.get('/api/users')).body as { id: string; username: string }[];
    const cashier = users.find(u => u.username === CASHIER.username)!;
    const owner = users.find(u => u.username === OWNER.username)!;
    expect((await env.owner.patch(`/api/users/${cashier.id}`, { active: false })).status).toBe(200);
    expect((await env.cashier.get('/api/auth/me')).status).toBe(401);
    expect((await env.newClient().post('/api/auth/login', { username: CASHIER.username, password: CASHIER.password }, { key: null })).status).toBe(401);
    const demote = await env.owner.patch(`/api/users/${owner.id}`, { role: 'cashier' });
    expect(demote.status).toBe(400);
  });
});
