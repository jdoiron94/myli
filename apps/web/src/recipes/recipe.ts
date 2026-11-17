import { queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import type { components } from '@/api/schema.ts';

export type Recipe = components['schemas']['Recipe'];
export type IngredientLine = components['schemas']['IngredientLine'];
export type Tag = components['schemas']['Tag'];
export type CreateRecipeRequest = components['schemas']['CreateRecipeRequest'];
export type UpdateRecipeRequest = components['schemas']['UpdateRecipeRequest'];

/** One recipe, as the API shows it to the signed-in user. */
export const recipeQuery = (id: string) =>
  queryOptions({
    queryKey: ['recipes', id],
    queryFn: async () =>
      responseData(await api.GET('/recipes/{id}', { params: { path: { id } } })).recipe,
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
