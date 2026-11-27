import { isAPIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { user } from '../db/schema.ts';
import { recordAuditEvent, recordAuditEventAfterwards, userAgent } from './audit.ts';

/** Better Auth's error codes for a sign-in it checked and refused, and how the log names them. */
const FAILURE_REASONS = {
  INVALID_EMAIL_OR_PASSWORD: 'invalid-credentials',
  BANNED_USER: 'deactivated',
} as const;

const successBody = z.object({ user: z.object({ id: z.string() }) });
const failureBody = z.object({ code: z.enum(['INVALID_EMAIL_OR_PASSWORD', 'BANNED_USER']) });
const attemptBody = z.object({ email: z.string().trim().toLowerCase().max(254) });

async function json(message: Request | Response): Promise<unknown> {
  return message
    .clone()
    .json()
    .catch(() => undefined);
}

type Outcome =
  | { succeeded: true; userId: string }
  | { succeeded: false; reason: (typeof FAILURE_REASONS)[keyof typeof FAILURE_REASONS] };

/**
 * What Better Auth's answer to a sign-in means, from its HTTP responses, which are the contract
 * its own client relies on. `undefined` when it never checked the credentials: the request was
 * malformed, came from another origin, or was rate limited.
 */
async function outcomeOf(res: Response): Promise<Outcome | undefined> {
  if (res.status === 200) {
    const body = successBody.safeParse(await json(res));
    return body.success ? { succeeded: true, userId: body.data.user.id } : undefined;
  }
  if (res.status !== 401 && res.status !== 403) return undefined;
  const body = failureBody.safeParse(await json(res));
  if (!body.success) return undefined;
  return { succeeded: false, reason: FAILURE_REASONS[body.data.code] };
}

/**
 * Records every email-and-password sign-in Better Auth checked: who signed in, or which email
 * failed and why. Goes in front of Better Auth's handler for `POST /sign-in/email`.
 */
export function auditSignIns(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const attempt = attemptBody.safeParse(await json(c.req.raw));
    await next();
    const outcome = await outcomeOf(c.res);
    if (!outcome) return;

    const origin = { ip: c.var.clientIp, userAgent: userAgent(c) };
    if (outcome.succeeded) {
      recordAuditEventAfterwards(c.var.logger, 'sign_in.succeeded', () => {
        recordAuditEvent(
          db,
          { ...origin, actorId: outcome.userId },
          { action: 'sign_in.succeeded', target: { type: 'user', id: outcome.userId } },
        );
      });
      return;
    }
    const email = attempt.success ? attempt.data.email : null;
    recordAuditEventAfterwards(c.var.logger, 'sign_in.failed', () => {
      const target =
        email === null
          ? undefined
          : db.select({ id: user.id }).from(user).where(eq(user.email, email)).get();
      recordAuditEvent(
        db,
        { ...origin, actorId: null },
        {
          action: 'sign_in.failed',
          ...(target && { target: { type: 'user', id: target.id } }),
          metadata: { email, reason: outcome.reason },
        },
      );
    });
  };
}

/**
 * Records a password change, by the account's user. Goes in front of Better Auth's handler for
 * `POST /change-password`, which answers 200 with the user only once it has changed it.
 */
export function auditPasswordChanges(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    if (c.res.status !== 200) return;
    const body = successBody.safeParse(await json(c.res));
    if (!body.success) return;

    const userId = body.data.user.id;
    recordAuditEventAfterwards(c.var.logger, 'password.changed', () => {
      recordAuditEvent(
        db,
        { actorId: userId, ip: c.var.clientIp, userAgent: userAgent(c) },
        { action: 'password.changed', target: { type: 'user', id: userId } },
      );
    });
  };
}

/**
 * Records a sign-out that ended a session. Goes in front of Better Auth's handler for
 * `POST /sign-out`, which answers 200 whether or not there was a session, so this looks the
 * session up first.
 */
export function auditSignOuts(db: Db, auth: Auth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let userId: string | undefined;
    try {
      // Not the session middleware: it would add a refreshed session cookie back to the response
      // that clears it.
      userId = (await auth.api.getSession({ headers: c.req.raw.headers }))?.user.id;
    } catch (error) {
      // 401: the session ended while being looked up, by a racing sign-out. Nothing to record.
      if (!isAPIError(error) || error.statusCode !== 401) {
        c.var.logger.error(
          { err: error, action: 'sign_out.succeeded' },
          'could not record an audit event',
        );
      }
    }
    await next();
    if (userId === undefined || c.res.status !== 200) return;

    const actorId = userId;
    recordAuditEventAfterwards(c.var.logger, 'sign_out.succeeded', () => {
      recordAuditEvent(
        db,
        { actorId, ip: c.var.clientIp, userAgent: userAgent(c) },
        { action: 'sign_out.succeeded', target: { type: 'user', id: actorId } },
      );
    });
  };
}
