import { queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';

/** Whether a recipe is one of the signed-in user's favorites. */
export const favoriteQuery = (id: string) =>
  queryOptions({
    queryKey: ['favorite', id],
    queryFn: async () =>
      responseData(await api.GET('/recipes/{id}/favorite', { params: { path: { id } } })).favorite,
  });

/** Makes a recipe one of the signed-in user's favorites, or not. */
export function useSetFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, favorite }: { id: string; favorite: boolean }) =>
      responseData(
        await api.PUT('/recipes/{id}/favorite', { params: { path: { id } }, body: { favorite } }),
      ).favorite,
    onSuccess: (favorite, { id }) => {
      queryClient.setQueryData(favoriteQuery(id).queryKey, favorite);
      // Every page of the favorites list from before is out of date: forget them all, so none shows
      // until fetched again (`recipeListQuery`).
      queryClient.removeQueries({ queryKey: ['recipe-list', 'favorites'] });
    },
  });
}
