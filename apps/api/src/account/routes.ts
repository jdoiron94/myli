import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  confirmEmailVerificationRequestSchema,
  emailVerificationStatusSchema,
  emailVerifiedSchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
} from '@myli/shared';
import { auditOrigin } from '../audit/audit.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses, HttpProblem } from '../problems.ts';
import {
  confirmEmailVerification,
  isEmailVerified,
  type RequestVerificationResult,
  requestEmailVerification,
} from './verification.ts';

export interface AccountDeps {
  db: Db;
  /** True when SMTP is configured, which sending a link needs. */
  emailEnabled: boolean;
}

/** One answer for unknown, used, replaced and expired links, so none can be told apart. */
const UNUSABLE =
  'This verification link is invalid, expired or already used. Send a new one from your Account page.';

const REFUSALS: Record<Exclude<RequestVerificationResult, 'queued'>, [409 | 429, string]> = {
  verified: [409, 'Your email address is verified already.'],
  'email-off': [409, "This server doesn't send email, so it can't verify your address."],
  'too-soon': [
    429,
    'A link was sent to you less than five minutes ago. Check your inbox, or try again in a few minutes.',
  ],
};

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

const getVerification = createRoute({
  method: 'get',
  path: '/me/email-verification',
  tags: ['Account'],
  summary: 'Whether your address is verified',
  description:
    "Any signed-in user's own address, whether myli has proven it reaches them, and whether this " +
    'server can send a link to verify it.',
  middleware: [requireSession] as const,
  responses: {
    200: {
      description: 'Your address and whether it is verified.',
      content: { 'application/json': { schema: emailVerificationStatusSchema } },
    },
    ...errorResponses,
  },
});

const postVerification = createRoute({
  method: 'post',
  path: '/me/email-verification',
  tags: ['Account'],
  summary: 'Send a link to verify your address',
  description:
    'Emails a link to your address that verifies it, once, within a day. Only the newest link ' +
    'works, and one is sent at most every five minutes. Send `Content-Type: application/json` ' +
    'even though there is no body.',
  middleware: [requireSession] as const,
  responses: {
    202: { description: 'The email is on its way.' },
    409: problem("Your address is verified already, or this server doesn't send email."),
    429: problem('A link was sent less than five minutes ago.'),
    ...errorResponses,
  },
});

const postConfirm = createRoute({
  method: 'post',
  path: '/email-verification/confirm',
  tags: ['Account'],
  summary: 'Verify an address with its link',
  description:
    'Public: the link proves the address, so it needs no signing in. The token is sent in the ' +
    'body, never the URL, so it stays out of logs.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: confirmEmailVerificationRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'The address is verified.',
      content: { 'application/json': { schema: emailVerifiedSchema } },
    },
    404: problem('The link is invalid, expired, replaced by a newer one, or already used.'),
    ...errorResponses,
  },
});

export function registerAccountRoutes(v1: OpenAPIHono<AppEnv>, deps: AccountDeps) {
  v1.openapi(getVerification, (c) =>
    c.json(
      {
        email: c.var.user.email,
        verified: isEmailVerified(deps.db, c.var.user.id),
        emailEnabled: deps.emailEnabled,
      },
      200,
    ),
  );

  v1.openapi(postVerification, (c) => {
    const userId = c.var.user.id;
    const result = requestEmailVerification(deps.db, {
      userId,
      emailEnabled: deps.emailEnabled,
      at: new Date(),
    });
    if (result !== 'queued') throw new HttpProblem(...REFUSALS[result]);
    c.var.logger.info({ userId }, 'verification email queued');
    return c.body(null, 202);
  });

  v1.openapi(postConfirm, (c) => {
    const verified = confirmEmailVerification(deps.db, {
      token: c.req.valid('json').token,
      origin: auditOrigin(c),
      at: new Date(),
    });
    if (!verified) throw new HttpProblem(404, UNUSABLE);
    c.var.logger.info('email address verified');
    return c.json(verified, 200);
  });
}
