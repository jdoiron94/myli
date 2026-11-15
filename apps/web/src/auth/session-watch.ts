import type { User } from '@myli/shared';
import type { QueryClient } from '@tanstack/vue-query';
import type { Router } from 'vue-router';
import { ApiProblem } from '@/api/problem.ts';
import { AuthProblem } from './client.ts';
import { forgetSession, sessionQuery } from './session.ts';
import { goToSignIn } from './sign-in-handoff.ts';

export const SESSION_ENDED_NOTICE = "You've been signed out. Sign in again to continue.";

/**
 * Watches every query and mutation for the versioned API saying the session the app knows about
 * (`sessionQuery`, fetched once) is out of date:
 * - A 401 means it has ended: it expired, the user was deactivated, or they signed out somewhere
 *   else. The app forgets the session and what was fetched with it, and goes to the sign-in page,
 *   which says why, fills in their email, and comes back here afterwards.
 * - A 403 may mean their role changed, which doesn't end the session. The app fetches it again,
 *   and if the role changed, checks the current page again, which takes away what the role no
 *   longer allows. The refusal itself is for the page to explain.
 *
 * Better Auth's own errors, like a wrong password's 401, are for the page that made the call.
 */
export function watchSession(queryClient: QueryClient, router: Router) {
  function endSession(user: User) {
    const from = router.currentRoute.value;
    void forgetSession(queryClient, () =>
      goToSignIn(router, { email: user.email, notice: SESSION_ENDED_NOTICE }, from),
    );
  }

  function onSessionEnded() {
    const user = queryClient.getQueryData(sessionQuery.queryKey);
    // Already handled, for another request that failed at the same time, or no one was signed in.
    if (user) endSession(user);
  }

  async function onRefused() {
    const before = queryClient.getQueryData(sessionQuery.queryKey);
    if (!before) return;
    let now: User | null;
    try {
      // Several refusals at once share one request: TanStack Query doesn't start a second.
      now = await queryClient.query({ ...sessionQuery, staleTime: 0 });
    } catch {
      return; // Couldn't find out. The page has already explained the refusal.
    }
    if (!now) {
      endSession(before);
    } else if (now.role !== before.role) {
      const { path, query, hash } = router.currentRoute.value;
      await router.replace({ path, query, hash, force: true });
    }
  }

  function onError(error: unknown) {
    if (!(error instanceof ApiProblem) || error instanceof AuthProblem) return;
    if (error.status === 401) onSessionEnded();
    else if (error.status === 403) void onRefused();
  }

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
  });
  queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
  });
}
