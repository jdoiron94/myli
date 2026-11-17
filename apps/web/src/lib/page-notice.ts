import type { RouteLocationRaw, Router } from 'vue-router';
import { z } from 'zod';

/**
 * Goes to `to` with a notice for the page there to show, like "Deleted “Weeknight Bread”.", for when
 * what happened took away the page it happened on. It travels in the navigation's history state, not
 * the address. Replaces the current page in the history, so Back doesn't return to what's gone.
 */
export function goWithNotice(router: Router, to: RouteLocationRaw & object, notice: string) {
  return router.replace({ ...to, state: { notice } });
}

/** The notice the current page was opened with, if any. */
export function pageNotice(router: Router): string | undefined {
  const result = z.object({ notice: z.string() }).safeParse(router.options.history.state);
  return result.success ? result.data.notice : undefined;
}
