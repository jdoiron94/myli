import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  avatarSchema,
  confirmEmailVerificationRequestSchema,
  confirmPasswordResetRequestSchema,
  emailVerificationStatusSchema,
  emailVerifiedSchema,
  PROBLEM_CONTENT_TYPE,
  passwordResetAvailabilitySchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  problemDetailsSchema,
  setAvatarRequestSchema,
} from '@myli/shared';
import { auditOrigin } from '../audit/audit.ts';
import type { Auth } from '../auth/auth.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses, HttpProblem, InvalidFields } from '../problems.ts';
import { avatarOf, removeAvatar, setAvatar } from './avatar.ts';
import { requestPasswordReset, resetPassword } from './password-reset.ts';
import {
  confirmEmailVerification,
  isEmailVerified,
  type RequestVerificationResult,
  requestEmailVerification,
} from './verification.ts';

export interface AccountDeps {
  db: Db;
  /** Better Auth, whose hasher a reset's new password goes through. */
  auth: Auth;
  /** True when SMTP is configured, which sending a link needs. */
  emailEnabled: boolean;
}

/** One answer for unknown, used, replaced and expired links, so none can be told apart. */
const UNUSABLE =
  'This verification link is invalid, expired or already used. Send a new one from your Account page.';
/** The same, for a reset link, and for one whose account was deactivated since. */
const UNUSABLE_RESET =
  'This reset link is invalid, expired or already used. Ask for a new one from the sign-in page.';
const NO_RESET_EMAIL =
  "This server doesn't send email. Ask whoever runs it to make you a reset link.";

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

const getResetAvailability = createRoute({
  method: 'get',
  path: '/password-reset',
  tags: ['Account'],
  summary: 'How to reset a forgotten password',
  description:
    'Public: whether this server emails reset links. Without email, whoever runs it makes one ' +
    'from the command line.',
  responses: {
    200: {
      description: 'What someone who forgot their password can do.',
      content: { 'application/json': { schema: passwordResetAvailabilitySchema } },
    },
    ...errorResponses,
  },
});

const postReset = createRoute({
  method: 'post',
  path: '/password-reset',
  tags: ['Account'],
  summary: 'Ask for a reset link',
  description:
    'Public. Emails a link that sets a new password, once, within an hour, if the address is the ' +
    'verified address of an active account and none was sent to it in the last five minutes. ' +
    'The answer is the same either way, so it tells no one whether an account exists.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: passwordResetRequestSchema } },
    },
  },
  responses: {
    202: { description: 'Asked for. An email goes out only as described above.' },
    409: problem("This server doesn't send email."),
    ...errorResponses,
  },
});

const postResetConfirm = createRoute({
  method: 'post',
  path: '/password-reset/confirm',
  tags: ['Account'],
  summary: 'Set a new password with a reset link',
  description:
    "Public: the link stands in for the current password. Sets the account's new password and " +
    'signs it out everywhere. The token is sent in the body, never the URL, so it stays out of logs.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: confirmPasswordResetRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'The password is reset, and every session of the account has ended.',
      content: { 'application/json': { schema: passwordResetSchema } },
    },
    404: problem(
      'The link is invalid, expired, replaced by a newer one or already used, or its account ' +
        'was deactivated.',
    ),
    ...errorResponses,
  },
});

const UNUSABLE_AVATAR = 'Choose a photo you uploaded that isn’t in a recipe.';

const getAvatar = createRoute({
  method: 'get',
  path: '/me/avatar',
  tags: ['Account'],
  summary: 'Your profile photo',
  description: 'Any signed-in user’s own. Without one, people see their initials.',
  middleware: [requireSession] as const,
  responses: {
    200: {
      description: 'Your profile photo, or `null`.',
      content: { 'application/json': { schema: avatarSchema } },
    },
    ...errorResponses,
  },
});

const putAvatar = createRoute({
  method: 'put',
  path: '/me/avatar',
  tags: ['Account'],
  summary: 'Set your profile photo',
  description:
    'Any signed-in user, viewers included, for themselves only. Upload the photo with ' +
    '`POST /images` first. Every signed-in user can then see it, beside your name; public links ' +
    'never show it. The photo before is deleted.',
  middleware: [requireSession] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: setAvatarRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Your new profile photo.',
      content: { 'application/json': { schema: avatarSchema } },
    },
    ...errorResponses,
  },
});

const deleteAvatar = createRoute({
  method: 'delete',
  path: '/me/avatar',
  tags: ['Account'],
  summary: 'Remove your profile photo',
  description:
    'Deletes it, so people see your initials. Nothing to do when there is none. Send ' +
    '`Content-Type: application/json` even though there is no body.',
  middleware: [requireSession] as const,
  responses: {
    204: { description: 'You have no profile photo now.' },
    ...errorResponses,
  },
});

export function registerAccountRoutes(v1: OpenAPIHono<AppEnv>, deps: AccountDeps) {
  v1.openapi(getAvatar, (c) => c.json({ imageId: avatarOf(deps.db, c.var.user.id) }, 200));

  v1.openapi(putAvatar, (c) => {
    const { imageId } = c.req.valid('json');
    if (!setAvatar(deps.db, { userId: c.var.user.id, imageId })) {
      throw new InvalidFields([{ path: ['imageId'], detail: UNUSABLE_AVATAR }]);
    }
    c.var.logger.info({ imageId }, 'profile photo set');
    return c.json({ imageId }, 200);
  });

  v1.openapi(deleteAvatar, (c) => {
    removeAvatar(deps.db, c.var.user.id);
    c.var.logger.info('profile photo removed');
    return c.body(null, 204);
  });

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

  v1.openapi(getResetAvailability, (c) => c.json({ emailEnabled: deps.emailEnabled }, 200));

  v1.openapi(postReset, (c) => {
    if (!deps.emailEnabled) throw new HttpProblem(409, NO_RESET_EMAIL);
    const outcome = requestPasswordReset(deps.db, {
      email: c.req.valid('json').email,
      at: new Date(),
    });
    // For whoever runs the server, when an email doesn't arrive. Never the address.
    c.var.logger.info({ outcome }, 'password reset asked for');
    return c.body(null, 202);
  });

  v1.openapi(postResetConfirm, async (c) => {
    const { token, newPassword } = c.req.valid('json');
    const reset = await resetPassword(deps.db, deps.auth, {
      token,
      newPassword,
      origin: auditOrigin(c),
      at: new Date(),
    });
    if (!reset) throw new HttpProblem(404, UNUSABLE_RESET);
    c.var.logger.info('password reset with a link');
    return c.json(reset, 200);
  });
}
