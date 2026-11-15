import { QueryClient } from '@tanstack/vue-query';
import { ApiProblem } from './problem.ts';

/** How many more times a failed query is tried, with TanStack Query's growing delay in between. */
const QUERY_RETRIES = 2;

/**
 * Queries retry network failures and 5xx responses, which may pass on another try, but never a
 * 4xx: the request itself is wrong or not allowed, and would fail the same way again. Mutations
 * keep TanStack Query's default of no retries, since retrying a write could make it happen twice.
 */
export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          failureCount < QUERY_RETRIES && !(error instanceof ApiProblem && error.status < 500),
      },
    },
  });
}
