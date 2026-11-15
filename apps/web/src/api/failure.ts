import { AuthProblem } from '@/auth/client.ts';
import { ApiProblem } from './problem.ts';

/**
 * What to tell someone when a request failed, for the failures a page doesn't explain itself. The
 * API writes a problem's `detail` for the person using the app (CLAUDE.md, Types and contracts), so a
 * 4xx shows it. Better Auth's messages aren't written for them, and a 5xx's detail says nothing useful.
 */
export function failureMessage(error: unknown): string {
  if (!(error instanceof ApiProblem)) {
    return "Couldn't reach myli. Check your connection, then try again.";
  }
  if (error.status < 500 && !(error instanceof AuthProblem) && error.problem.detail) {
    return error.problem.detail;
  }
  return "Something went wrong on myli's server. Try again in a moment.";
}
