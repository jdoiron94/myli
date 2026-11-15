import { AUTH_BASE_PATH } from '@myli/shared';
import { createAuthClient } from 'better-auth/client';
import { ApiProblem } from '@/api/problem.ts';

/**
 * Better Auth's client, for its own routes under `/api/auth` (signing in and out, the session),
 * which aren't in the OpenAPI document. Requests are same-origin, so the session cookie goes along.
 * The framework-agnostic client is enough: the session is kept in TanStack Query (session.ts), not
 * in Better Auth's reactive store.
 */
export const authClient = createAuthClient({
  baseURL: new URL(AUTH_BASE_PATH, location.origin).href,
  fetchOptions: {
    // Looked up on each call, as in api/client.ts: tests replace `fetch` (MSW) after this loads.
    customFetchImpl: (input, init) => globalThis.fetch(input, init),
  },
});

/**
 * A Better Auth route that answered with an error. `code` is Better Auth's own, such as
 * `INVALID_EMAIL_OR_PASSWORD`. Being an `ApiProblem`, it follows the same retry rules (query.ts).
 */
export class AuthProblem extends ApiProblem {
  readonly code: string | undefined;

  constructor(status: number, code?: string, message?: string) {
    super({
      type: 'about:blank',
      title: 'Request failed',
      status,
      detail: message ?? `The request failed with HTTP status ${String(status)}.`,
    });
    this.name = 'AuthProblem';
    this.code = code;
  }
}

/** What Better Auth's client resolves to: the data, or the error the route answered with. */
type AuthResult<T> =
  | { data: T; error: null }
  | {
      data: null;
      error: { status: number; code?: string | undefined; message?: string | undefined };
    };

/**
 * The data of a Better Auth call, which answers `{ data, error }` instead of throwing. Throws an
 * `AuthProblem` for an error answer, so a call that returns has succeeded, as with `api`.
 */
export async function unwrap<T>(call: Promise<AuthResult<T>>): Promise<T> {
  const { data, error } = await call;
  if (error) throw new AuthProblem(error.status, error.code, error.message);
  return data;
}
