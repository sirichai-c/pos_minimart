import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireIdempotencyKey, type IdempotentResult } from '../db/tx.ts';

export function idempotencyKeyOf(req: FastifyRequest): string {
  const header = req.headers['idempotency-key'];
  return requireIdempotencyKey(Array.isArray(header) ? header[0] : header);
}

/** 201 สร้างใหม่ · 200 คืนผลเดิมจาก key เดิม (header Idempotent-Replayed: true) */
export function sendIdempotent<T>(reply: FastifyReply, outcome: IdempotentResult<T>): FastifyReply {
  if (outcome.replayed) reply.header('Idempotent-Replayed', 'true');
  return reply.status(outcome.replayed ? 200 : outcome.statusCode).send(outcome.result);
}

export function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
