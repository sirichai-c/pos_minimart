import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppError } from '@pos/domain';
import { idempotent, writeTx } from '../../apps/server/src/db/tx.ts';
import { count, createEnv, type TestEnv } from '../helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createEnv(); });
afterEach(async () => { await env.close(); });

describe('idempotent()', () => {
  const ctx = () => {
    const owner = env.db.prepare("SELECT id FROM users WHERE role = 'owner'").get() as { id: string };
    return { userId: owner.id, role: 'owner' as const, sessionId: 's', now: env.clock.now() };
  };

  it('replays the stored result without calling fn again', () => {
    let calls = 0;
    const key = randomUUID();
    const run = () => idempotent(env.db, ctx(), { key, scope: 'test', payload: { a: 1 }, fn: () => ({ n: ++calls }) });
    expect(run()).toEqual({ replayed: false, result: { n: 1 }, statusCode: 201 });
    expect(run()).toEqual({ replayed: true, result: { n: 1 }, statusCode: 200 });
    expect(calls).toBe(1);
  });

  it('rejects the same key with a different payload', () => {
    const key = randomUUID();
    idempotent(env.db, ctx(), { key, scope: 'test', payload: { a: 1 }, fn: () => 1 });
    expect(() => idempotent(env.db, ctx(), { key, scope: 'test', payload: { a: 2 }, fn: () => 2 }))
      .toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });

  it('does not record a key when fn throws, so retry is allowed', () => {
    const key = randomUUID();
    expect(() => idempotent(env.db, ctx(), { key, scope: 'test', payload: {}, fn: () => { throw new AppError('INSUFFICIENT_STOCK', 'x'); } })).toThrow(AppError);
    expect(count(env.db, 'idempotency_requests', 'key = ?', key)).toBe(0);
    expect(idempotent(env.db, ctx(), { key, scope: 'test', payload: {}, fn: () => 'ok' }).result).toBe('ok');
  });

  it('writeTx rolls back every write when fn throws', () => {
    const before = count(env.db, 'audit_events');
    expect(() => writeTx(env.db, () => {
      env.db.prepare("INSERT INTO audit_events (action, entity_type, entity_id, created_at) VALUES ('x', 'y', 'z', 'now')").run();
      throw new Error('boom');
    })).toThrow('boom');
    expect(count(env.db, 'audit_events')).toBe(before);
  });

  it('requires a UUID Idempotency-Key on business POSTs', async () => {
    const missing = await env.owner.post('/api/shifts', { openingCash: 0 }, { key: null });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const bad = await env.owner.post('/api/shifts', { openingCash: 0 }, { key: 'abc' });
    expect(bad.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(count(env.db, 'shifts')).toBe(0);
  });

  it('rejects money sent as text or fractions (no coercion)', async () => {
    const asText = await env.owner.post('/api/shifts', { openingCash: '100' });
    expect(asText.status).toBe(400);
    expect(asText.body.error.code).toBe('VALIDATION_FAILED');
    const fraction = await env.owner.post('/api/shifts', { openingCash: 10.5 });
    expect(fraction.body.error.code).toBe('VALIDATION_FAILED');
    const extra = await env.owner.post('/api/shifts', { openingCash: 1, foo: 1 });
    expect(extra.body.error.code).toBe('VALIDATION_FAILED');
  });
});
