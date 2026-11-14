import { type Role, roleSchema } from '@myli/shared';
import { isAPIError } from 'better-auth/api';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context.ts';
import { HttpProblem } from '../problems.ts';
import type { Auth } from './auth.ts';

/** The signed-in user, as handlers and the permission policy see them. */
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface CurrentSession {
  id: string;
  expiresAt: Date;
}

/**
 * Looks up the session from the request's cookie and sets `c.var.user` and `c.var.session`, or
 * `null` for both when there is no valid session. Never rejects a request itself: routes that need
 * a user add `requireSession`.
 *
 * Every lookup reads the session table (Better Auth's cookie cache stays off), so a signed-out,
 * expired or revoked session stops working on its very next request. Requests without a session
 * cookie don't touch the database.
 */
export function sessionMiddleware(auth: Auth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let result: Awaited<ReturnType<typeof lookUpSession>>;
    try {
      result = await lookUpSession(auth, c.req.raw.headers);
    } catch (error) {
      // Better Auth answers 401 when a session disappears while it's being refreshed (a sign-out
      // racing this request). That's an anonymous request, not a server error.
      if (isAPIError(error) && error.statusCode === 401) {
        result = { session: null, setCookies: [] };
      } else {
        throw error;
      }
    }

    c.set('user', result.session?.user ?? null);
    c.set('session', result.session?.session ?? null);

    await next();

    // Better Auth extends an active session about once a day, and clears the cookie of an
    // expired one. Either way the browser needs the new cookie, whatever the handler answered.
    for (const cookie of result.setCookies) c.res.headers.append('set-cookie', cookie);
  };
}

async function lookUpSession(auth: Auth, headers: Headers) {
  const { headers: responseHeaders, response } = await auth.api.getSession({
    headers,
    returnHeaders: true,
  });
  const setCookies = responseHeaders.getSetCookie();
  if (!response) return { session: null, setCookies };

  const { user, session } = response;
  return {
    session: {
      // The CHECK constraint guarantees a valid role. If it ever isn't, this throws and the
      // request fails closed with a 500.
      user: { id: user.id, name: user.name, email: user.email, role: roleSchema.parse(user.role) },
      session: { id: session.id, expiresAt: session.expiresAt },
    },
    setCookies,
  };
}

/** The 401 for requests that need a signed-in user. Every guard answers with this one. */
export function signInRequired(): HttpProblem {
  return new HttpProblem(401, 'Sign in to continue.');
}

/**
 * Answers 401 unless the request has a valid session. Handlers after it can rely on `c.var.user`
 * and `c.var.session` being set, and their types say so.
 */
export const requireSession = createMiddleware<{
  Variables: { user: CurrentUser; session: CurrentSession };
}>(async (c, next) => {
  // The variables are typed as always set here; at runtime they're null until signed in.
  const user = c.var.user as CurrentUser | null;
  if (!user) throw signInRequired();
  await next();
});
