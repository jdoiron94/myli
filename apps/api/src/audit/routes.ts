import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { auditEventListQuerySchema, auditEventListSchema } from '@myli/shared';
import { requirePermission } from '../auth/authorize.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses } from '../problems.ts';
import { type AuditEventRow, listAuditEvents } from './audit.ts';

const getAuditEvents = createRoute({
  method: 'get',
  path: '/audit-events',
  tags: ['Audit log'],
  summary: 'List audit events',
  description: 'Admins only. Newest first, a page at a time.',
  middleware: [requirePermission('auditLog.read')] as const,
  request: { query: auditEventListQuerySchema },
  responses: {
    200: {
      description: 'A page of audit events.',
      content: { 'application/json': { schema: auditEventListSchema } },
    },
    ...errorResponses,
  },
});

function toAuditEvent(row: AuditEventRow) {
  return {
    id: row.id,
    action: row.action,
    actor:
      row.actorId !== null && row.actorName !== null
        ? { id: row.actorId, name: row.actorName, avatar: row.actorAvatar }
        : null,
    target:
      row.targetType !== null && row.targetId !== null
        ? { type: row.targetType, id: row.targetId }
        : null,
    metadata: row.metadata,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

export function registerAuditRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  v1.openapi(getAuditEvents, (c) => {
    const { events, nextBefore } = listAuditEvents(deps.db, c.req.valid('query'));
    return c.json({ events: events.map(toAuditEvent), nextBefore }, 200);
  });
}
