import { versionETag } from '@myli/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import type { components } from '@/api/schema.ts';
import { recipeQuery } from './recipe.ts';

export type TrashedRecipe = components['schemas']['TrashedRecipe'];

/**
 * The trash (spec §3.2): the deleted recipes the reader may restore, most recently deleted first,
 * and how many days each stays. Deleting a recipe forgets it (`useDeleteRecipe`).
 */
export const trashQuery = queryOptions({
  queryKey: ['trash'],
  queryFn: async () => responseData(await api.GET('/trash')),
});

/**
 * Restores a recipe from the trash, unless it changed since `version`, the one the trash showed.
 * Either way, it returns once the trash is fetched again. The recipe's page then shows it as
 * restored, and lists and searches from before, which left it out, are forgotten.
 *
 * A 412's recipe isn't cached, unlike other changes' (`staleRecipe`): it's still in the trash, and
 * its page would show it as if it weren't.
 */
export const useRestoreFromTrash = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: string; version: number }) =>
      responseData(
        await api.POST('/trash/{id}/restore', {
          params: { path: { id }, header: { 'if-match': versionETag(version) } },
        }),
      ).recipe,
    onSuccess: (recipe) => {
      queryClient.setQueryData(recipeQuery(recipe.id).queryKey, recipe);
      queryClient.removeQueries({ queryKey: ['recipe-list'] });
      queryClient.removeQueries({ queryKey: ['search'] });
      queryClient.removeQueries({ queryKey: ['collections'] });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: trashQuery.queryKey }),
  });
};
