import { AuthProblem } from '@/auth/client.ts';
import { ApiProblem } from './problem.ts';

/**
 * What to tell someone when a request failed, for the failures a page doesn't explain itself. The
 * API writes a problem's `detail` for the person using the app (CLAUDE.md, Types and contracts), so a
 * 4xx shows it, and so does a 503, which says what's unavailable (search, say). Better Auth's
 * messages aren't written for them, and any other 5xx's detail says nothing useful.
 */
export function failureMessage(error: unknown): string {
  if (!(error instanceof ApiProblem)) {
    return "Couldn't reach myli. Check your connection, then try again.";
  }
  const explained = error.status < 500 || error.status === 503;
  if (explained && !(error instanceof AuthProblem) && error.problem.detail) {
    return error.problem.detail;
  }
  return "Something went wrong on myli's server. Try again in a moment.";
}
