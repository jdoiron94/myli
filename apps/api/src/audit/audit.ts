import type { HttpBindings } from '@hono/node-server';
import type { AuditAction, AuditTargetType } from '@myli/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db, Tx } from '../db/database.ts';
import { auditEvent, user } from '../db/schema.ts';
import type { Logger } from '../logger.ts';

export const USER_AGENT_MAX_LENGTH = 512;

/** Who did it, and from where. */
export interface AuditOrigin {
  actorId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditEventInput {
  action: AuditAction;
  target?: { type: AuditTargetType; id: string };
  /** Details for admins. Never a secret: no tokens, hashes or passwords. */
  metadata?: Record<string, unknown>;
}

/**
 * The parts of a request's context the audit log reads. Structural, so a context whose type a
 * guard has narrowed fits too.
 */
export interface AuditRequest {
  env: unknown;
  req: { header(name: string): string | undefined };
  var: { user: { id: string } | null };
}

/**
 * The client's address: the TCP peer, for now. Behind Caddy that's Caddy itself, until increment
 * 18 makes this trust `X-Forwarded-For` from it (and configures Better Auth the same way).
 */
export function clientIp(c: Pick<AuditRequest, 'env'>): string | null {
  // Set by @hono/node-server. Requests made with `app.request()` in tests have no socket, unless
  // the test passes one.
  const bindings = c.env as Partial<HttpBindings> | undefined;
  const address = bindings?.incoming?.socket.remoteAddress;
  if (address === undefined) return null;
  // A dual-stack socket reports IPv4 clients as IPv4-mapped IPv6 addresses.
  return address.startsWith('::ffff:') && address.includes('.') ? address.slice(7) : address;
}

export function userAgent(c: Pick<AuditRequest, 'req'>): string | null {
  return c.req.header('user-agent')?.slice(0, USER_AGENT_MAX_LENGTH) ?? null;
}

/** The signed-in user (on `/api/v1` routes), the client's address and its user agent. */
export function auditOrigin(c: AuditRequest): AuditOrigin {
  return { actorId: c.var.user?.id ?? null, ip: clientIp(c), userAgent: userAgent(c) };
}

/**
 * Records an audit event. Pass the transaction of the change it records, so both commit or roll
 * back together.
 */
export function recordAuditEvent(db: Db | Tx, origin: AuditOrigin, event: AuditEventInput): void {
  db.insert(auditEvent)
    .values({
      actorId: origin.actorId,
      action: event.action,
      targetType: event.target?.type ?? null,
      targetId: event.target?.id ?? null,
      metadata: event.metadata ?? {},
      ip: origin.ip,
      userAgent: origin.userAgent,
    })
    .run();
}

/**
 * For an event about a change that already happened outside our transaction, like a sign-in
 * Better Auth handled. Failing the request then would only hide that the change happened, so a
 * failure is logged instead. `record` does any lookups the event needs, and the write.
 */
export function recordAuditEventAfterwards(
  logger: Logger,
  action: AuditAction,
  record: () => void,
): void {
  try {
    record();
  } catch (error) {
    logger.error({ err: error, action }, 'could not record an audit event');
  }
}

export type AuditEventRow = typeof auditEvent.$inferSelect & { actorName: string | null };

/** A page of events, newest first, and the `before` value for the next page. */
export function listAuditEvents(
  db: Db,
  query: { before?: number | undefined; limit: number; action?: AuditAction | undefined },
): { events: AuditEventRow[]; nextBefore: number | null } {
  const rows = db
    .select({ event: auditEvent, actorName: user.name })
    .from(auditEvent)
    .leftJoin(user, eq(user.id, auditEvent.actorId))
    .where(
      and(
        query.before === undefined ? undefined : lt(auditEvent.id, query.before),
        query.action === undefined ? undefined : eq(auditEvent.action, query.action),
      ),
    )
    .orderBy(desc(auditEvent.id))
    // One more than asked for tells whether there's another page.
    .limit(query.limit + 1)
    .all();
  const events = rows
    .slice(0, query.limit)
    .map(({ event, actorName }) => ({ ...event, actorName }));
  const last = events.at(-1);
  return { events, nextBefore: rows.length > query.limit && last ? last.id : null };
}
