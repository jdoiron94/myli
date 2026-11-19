import { queryOptions } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import { useRefreshingMutation } from '@/api/refreshing-mutation.ts';
import type { Tag } from '@/recipes/recipe.ts';
import { tagsQuery } from '@/recipes/tags.ts';

/** A tag as the Tags page lists it: with how many recipes the admin may see have it. */
export type ManagedTag = Tag & { recipes: number };

/**
 * Every tag, by type and then name, with its count. Under the tags' own key, so refreshing the tags,
 * as every change to one does, refreshes this too.
 */
export const managedTagsQuery = queryOptions({
  queryKey: [...tagsQuery.queryKey, 'managed'],
  queryFn: async (): Promise<ManagedTag[]> => {
    const [tags, usage] = await Promise.all([api.GET('/tags'), api.GET('/tags/usage')]);
    const counts = new Map(responseData(usage).usage.map(({ tagId, recipes }) => [tagId, recipes]));
    return responseData(tags).tags.map((tag) => ({ ...tag, recipes: counts.get(tag.id) ?? 0 }));
  },
});

/** Renames a tag, refusing a name another tag of its type has. */
export const useRenameTag = () =>
  useRefreshingMutation(tagsQuery.queryKey, async ({ id, name }: { id: number; name: string }) => {
    const result = await api.PUT('/tags/{id}', { params: { path: { id } }, body: { name } });
    return responseData(result).tag;
  });

/** Merges a tag into another of its type, which takes its place on every recipe. */
export const useMergeTag = () =>
  useRefreshingMutation(
    tagsQuery.queryKey,
    async ({ id, intoId }: { id: number; intoId: number }) => {
      const result = await api.POST('/tags/{id}/merge', {
        params: { path: { id } },
        body: { intoId },
      });
      return responseData(result).tag;
    },
  );

/** Deletes a tag, taking it off every recipe. */
export const useDeleteTag = () =>
  useRefreshingMutation(tagsQuery.queryKey, async (id: number) => {
    await api.DELETE('/tags/{id}', { params: { path: { id } } });
  });
