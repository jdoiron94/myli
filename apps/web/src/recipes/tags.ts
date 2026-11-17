import { queryOptions } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import { useRefreshingMutation } from '@/api/refreshing-mutation.ts';
import type { components } from '@/api/schema.ts';

export type CreateTagRequest = components['schemas']['CreateTagRequest'];

/** Every tag, the allergens included, by type, then name. */
export const tagsQuery = queryOptions({
  queryKey: ['tags'],
  queryFn: async () => responseData(await api.GET('/tags')).tags,
});

/**
 * Creates a tag, or gives back the one of that type that already has the name, then refreshes the
 * tags, which include it by the time it's done.
 */
export const useCreateTag = () =>
  useRefreshingMutation(
    tagsQuery.queryKey,
    async (body: CreateTagRequest) => responseData(await api.POST('/tags', { body })).tag,
  );
