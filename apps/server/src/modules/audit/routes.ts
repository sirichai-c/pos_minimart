import type { FastifyInstance } from 'fastify';
import type { AuditEventView } from '@pos/contracts';
import { requireRole } from '../../http/auth-hooks.ts';
import { queryString } from '../../http/reply.ts';
import type { AppDeps } from '../../app.ts';

export function auditRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.get('/api/audit-events', { preValidation: requireRole('owner') }, async req => {
    const query = req.query as Record<string, unknown>;
    const where: string[] = [];
    const params: unknown[] = [];
    const entityType = queryString(query.entityType);
    const entityId = queryString(query.entityId);
    const from = queryString(query.from);
    const to = queryString(query.to);
    if (entityType) { where.push('a.entity_type = ?'); params.push(entityType); }
    if (entityId) { where.push('a.entity_id = ?'); params.push(entityId); }
    if (from) { where.push('a.created_at >= ?'); params.push(from); }
    if (to) { where.push('a.created_at < ?'); params.push(to); }
    const limit = Math.min(Math.max(Number(query.limit ?? 300) || 300, 1), 2000);
    const rows = db.prepare(`
      SELECT a.id, a.action, a.entity_type, a.entity_id, a.user_id, u.display_name AS user_name, a.data_json, a.created_at
      FROM audit_events a LEFT JOIN users u ON u.id = a.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.id DESC LIMIT ?`).all(...params, limit) as
      { id: number; action: string; entity_type: string; entity_id: string; user_id: string | null; user_name: string | null; data_json: string | null; created_at: string }[];
    return rows.map((r): AuditEventView => ({
      id: r.id, action: r.action, entityType: r.entity_type, entityId: r.entity_id, userId: r.user_id, userName: r.user_name,
      data: r.data_json ? JSON.parse(r.data_json) : null, createdAt: r.created_at,
    }));
  });
}
