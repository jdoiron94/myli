import type { QueryClient } from '@tanstack/vue-query';
import type { Router } from 'vue-router';
import { ApiProblem } from '@/api/problem.ts';
import { AuthProblem } from './client.ts';
import { forgetSession, sessionQuery } from './session.ts';
import { goToSignIn } from './sign-in-handoff.ts';

export const SESSION_ENDED_NOTICE = "You've been signed out. Sign in again to continue.";

/**
 * A 401 from the versioned API: it found no session. Better Auth's own 401s, like a wrong password
 * on the sign-in page, are for the page that made the call to explain.
 */
const endsSession = (error: unknown) =>
  error instanceof ApiProblem && !(error instanceof AuthProblem) && error.status === 401;

/**
 * Watches every query and mutation for a sign that the session has ended: it expired, the user was
 * deactivated, or they signed out somewhere else. The app fetches the session once (`sessionQuery`),
 * so the API's 401 is how it finds out. It then forgets the session and what was fetched with it, and
 * goes to the sign-in page, which says why, fills in their email, and comes back here afterwards.
 */
export function watchForSessionEnd(queryClient: QueryClient, router: Router) {
  function onError(error: unknown) {
    if (!endsSession(error)) return;
    const user = queryClient.getQueryData(sessionQuery.queryKey);
    // Already handled, for another request that failed at the same time, or no one was signed in.
    if (!user) return;
    const from = router.currentRoute.value;
    void forgetSession(queryClient, () =>
      goToSignIn(router, { email: user.email, notice: SESSION_ENDED_NOTICE }, from),
    );
  }

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
  });
  queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
  });
}
