import { queryOptions } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import { useRefreshingMutation } from '@/api/refreshing-mutation.ts';
import type { components } from '@/api/schema.ts';

export type SearchIndexStatus = components['schemas']['SearchIndexStatus'];
export type RebuildState = NonNullable<SearchIndexStatus['rebuild']>['state'];

/** How often the page checks again while a rebuild is under way, or search is unavailable. */
export const STATUS_POLL_MS = 1500;

/** Whether the status will change by itself: a rebuild still to finish, or search to come back. */
export function settling(status: SearchIndexStatus | undefined) {
  if (!status) return false;
  const state = status.rebuild?.state;
  return !status.available || state === 'queued' || state === 'running' || state === 'retrying';
}

/** Whether search works, and how the latest rebuild of its index stands. Admins only. */
export const searchIndexQuery = queryOptions({
  queryKey: ['search-index'],
  queryFn: async () => responseData(await api.GET('/search/index')),
  refetchInterval: (query) => (settling(query.state.data) ? STATUS_POLL_MS : false),
});

/** Rebuilds the index in the background. A rebuild already waiting or under way stands. */
export const useRebuildSearchIndex = () =>
  useRefreshingMutation(searchIndexQuery.queryKey, async () =>
    responseData(await api.POST('/search/index/rebuild')),
  );
