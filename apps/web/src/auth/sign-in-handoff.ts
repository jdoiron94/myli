import type { Router } from 'vue-router';
import { z } from 'zod';
import { comeBackTo } from './redirect.ts';

const handoffSchema = z.object({ email: z.string(), notice: z.string() });

/** What a page tells the sign-in page it sends someone to: the email to fill in, and a note. */
export type SignInHandoff = z.infer<typeof handoffSchema>;

/**
 * Goes to the sign-in page with `handoff`, in the navigation's history state rather than the address,
 * so the email stays out of the URL, and out of server logs if the page is reloaded. Replaces the
 * current page in the history, so Back doesn't return to a form that's done. Signing in goes back to
 * `returnTo`, if given, and home otherwise.
 */
export function goToSignIn(
  router: Router,
  handoff: SignInHandoff,
  returnTo?: { fullPath: string },
) {
  return router.replace({
    name: 'login',
    query: returnTo ? comeBackTo(returnTo) : {},
    state: { signIn: { ...handoff } },
  });
}

/** The handoff the current page was opened with, if any. */
export function signInHandoff(router: Router): SignInHandoff | undefined {
  const result = z.object({ signIn: handoffSchema }).safeParse(router.options.history.state);
  return result.success ? result.data.signIn : undefined;
}
