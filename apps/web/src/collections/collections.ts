import type { MOVE_DIRECTIONS } from '@myli/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import { useRefreshingMutation } from '@/api/refreshing-mutation.ts';
import type { components } from '@/api/schema.ts';

export type CollectionSummary = components['schemas']['CollectionSummary'];
export type Collection = components['schemas']['Collection'];

/** Every query here starts with it, so a change to any collection refreshes what's shown of them. */
const COLLECTIONS = ['collections'];

/** The signed-in user's collections, by name. Only they ever see them. */
export const collectionsQuery = queryOptions({
  queryKey: [...COLLECTIONS, 'list'],
  queryFn: async () => responseData(await api.GET('/collections')).collections,
});

/** Every page of one of the signed-in user's collections. */
export const collectionKey = (id: string) => [...COLLECTIONS, 'one', id];

/**
 * One of the signed-in user's collections, with a page of the recipes in it they may see, in its
 * order. While another page of it loads, the last one stays, so the page doesn't jump back to its
 * loading state; another collection's never does.
 */
export const collectionQuery = (id: string, page: number) =>
  queryOptions({
    queryKey: [...collectionKey(id), page],
    queryFn: async () =>
      responseData(
        await api.GET('/collections/{id}', { params: { path: { id }, query: { page } } }),
      ),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === id ? previous : undefined,
  });

/** The IDs of the signed-in user's collections that hold a recipe. */
export const recipeCollectionsQuery = (recipeId: string) =>
  queryOptions({
    queryKey: [...COLLECTIONS, 'holding', recipeId],
    queryFn: async () =>
      responseData(
        await api.GET('/recipes/{id}/collections', { params: { path: { id: recipeId } } }),
      ).collectionIds,
  });

export const useCreateCollection = () =>
  useRefreshingMutation(COLLECTIONS, async (name: string) =>
    responseData(await api.POST('/collections', { body: { name } })),
  );

export const useRenameCollection = () =>
  useRefreshingMutation(COLLECTIONS, async ({ id, name }: { id: string; name: string }) => {
    await api.PUT('/collections/{id}', { params: { path: { id } }, body: { name } });
  });

/**
 * Deletes a collection, and forgets the lists that showed it, so none shows it while it's fetched
 * again. Its own page forgets it once it has gone on to another, which it couldn't show otherwise.
 */
export function useDeleteCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.DELETE('/collections/{id}', { params: { path: { id } } });
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: [...COLLECTIONS, 'list'] });
      queryClient.removeQueries({ queryKey: [...COLLECTIONS, 'holding'] });
    },
  });
}

/** Puts a recipe in a collection, at its end, or takes it out. */
export const useSetInCollection = () =>
  useRefreshingMutation(
    COLLECTIONS,
    async ({ id, recipeId, inIt }: { id: string; recipeId: string; inIt: boolean }) => {
      const params = { path: { id, recipeId } };
      await (inIt
        ? api.PUT('/collections/{id}/recipes/{recipeId}', { params })
        : api.DELETE('/collections/{id}/recipes/{recipeId}', { params }));
    },
  );

export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

/**
 * Moves a recipe one place earlier or later in a collection, past the one before or after it, which
 * may be on another page.
 */
export const useMoveInCollection = () =>
  useRefreshingMutation(
    COLLECTIONS,
    async ({
      id,
      recipeId,
      direction,
    }: {
      id: string;
      recipeId: string;
      direction: MoveDirection;
    }) => {
      await api.POST('/collections/{id}/recipes/{recipeId}/move', {
        params: { path: { id, recipeId } },
        body: { direction },
      });
    },
  );

/** How many recipes a collection shows: "3 recipes". */
export const recipeCountText = (count: number) =>
  `${String(count)} ${count === 1 ? 'recipe' : 'recipes'}`;
