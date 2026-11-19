import type { Visibility } from '@myli/shared';
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import type { components } from '@/api/schema.ts';

export type Recipe = components['schemas']['Recipe'];
export type IngredientLine = components['schemas']['IngredientLine'];
export type Tag = components['schemas']['Tag'];
export type Image = components['schemas']['Image'];
export type RecipeSummary = components['schemas']['RecipeSummary'];
export type RecipeList = components['schemas']['RecipeList'];
export type CreateRecipeRequest = components['schemas']['CreateRecipeRequest'];
export type UpdateRecipeRequest = components['schemas']['UpdateRecipeRequest'];

/** One recipe, as the API shows it to the signed-in user. */
export const recipeQuery = (id: string) =>
  queryOptions({
    queryKey: ['recipes', id],
    queryFn: async () =>
      responseData(await api.GET('/recipes/{id}', { params: { path: { id } } })).recipe,
  });

/** The lists of recipes: every one the reader may see, newest first, or their favorites. */
export type RecipeListName = 'all' | 'favorites';

/**
 * One page of a list of recipes. While another page loads, the last one stays, so the page doesn't
 * jump back to its loading state.
 */
export const recipeListQuery = (list: RecipeListName, page: number) =>
  queryOptions({
    queryKey: ['recipe-list', list, page],
    queryFn: async () =>
      list === 'favorites'
        ? responseData(await api.GET('/me/favorites', { params: { query: { page } } }))
        : responseData(await api.GET('/recipes', { params: { query: { page } } })),
    placeholderData: keepPreviousData,
  });

/**
 * A mutation that answers with a recipe as saved, which then becomes what its page shows, without
 * fetching it again.
 */
function useRecipeMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<Recipe>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (recipe) => {
      queryClient.setQueryData(recipeQuery(recipe.id).queryKey, recipe);
    },
  });
}

export const useCreateRecipe = () =>
  useRecipeMutation(
    async (body: CreateRecipeRequest) => responseData(await api.POST('/recipes', { body })).recipe,
  );

/** Saves a recipe's content, replacing all of it. Its visibility is changed on its own. */
export const useSaveRecipe = () =>
  useRecipeMutation(
    async ({ id, body }: { id: string; body: UpdateRecipeRequest }) =>
      responseData(await api.PUT('/recipes/{id}', { params: { path: { id } }, body })).recipe,
  );

/** Makes a recipe private or shared. Only its owner can. */
export const useChangeVisibility = () =>
  useRecipeMutation(
    async ({ id, visibility }: { id: string; visibility: Visibility }) =>
      responseData(
        await api.PUT('/recipes/{id}/visibility', {
          params: { path: { id } },
          body: { visibility },
        }),
      ).recipe,
  );

/**
 * Deletes a recipe. Its page is left before the recipe is forgotten (`removeQueries`), so nothing
 * there loads it again meanwhile.
 */
export const useDeleteRecipe = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.DELETE('/recipes/{id}', { params: { path: { id } } });
    },
    // Lists (favorites too) and searches from before would show it, until each was fetched again.
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['recipe-list'] });
      queryClient.removeQueries({ queryKey: ['search'] });
    },
  });
};
