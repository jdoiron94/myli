import { staleRecipeProblemSchema, type Visibility, versionETag } from '@myli/shared';
import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import { ApiProblem } from '@/api/problem.ts';
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
 * The recipe as it is now, when a change was refused because it was based on an older version
 * (412): someone changed it meanwhile.
 */
export function staleRecipe(error: unknown): Recipe | undefined {
  if (!(error instanceof ApiProblem)) return undefined;
  const stale = staleRecipeProblemSchema.safeParse(error.problem);
  return stale.success ? stale.data.recipe : undefined;
}

/** The headers of a change to a recipe at `version`, which it's refused unless it still is. */
const basedOn = (version: number) => ({ 'if-match': versionETag(version) });

/** After a change refused as out of date, the recipe's page shows it as it is now. */
function showLatest(queryClient: QueryClient, error: unknown) {
  const latest = staleRecipe(error);
  if (latest) queryClient.setQueryData(recipeQuery(latest.id).queryKey, latest);
}

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
    onError: (error) => {
      showLatest(queryClient, error);
    },
  });
}

export const useCreateRecipe = () =>
  useRecipeMutation(
    async (body: CreateRecipeRequest) => responseData(await api.POST('/recipes', { body })).recipe,
  );

/**
 * Saves a recipe's content, replacing all of it, unless it changed since `version`, the one the
 * edit started from. Its visibility is changed on its own.
 */
export const useSaveRecipe = () =>
  useRecipeMutation(
    async ({ id, version, body }: { id: string; version: number; body: UpdateRecipeRequest }) =>
      responseData(
        await api.PUT('/recipes/{id}', {
          params: { path: { id }, header: basedOn(version) },
          body,
        }),
      ).recipe,
  );

/** Makes a recipe private or shared, unless it changed since `version`. Only its owner can. */
export const useChangeVisibility = () =>
  useRecipeMutation(
    async ({ id, version, visibility }: { id: string; version: number; visibility: Visibility }) =>
      responseData(
        await api.PUT('/recipes/{id}/visibility', {
          params: { path: { id }, header: basedOn(version) },
          body: { visibility },
        }),
      ).recipe,
  );

/**
 * Deletes a recipe, unless it changed since `version`. Its page is left before the recipe is
 * forgotten (`removeQueries`), so nothing there loads it again meanwhile.
 */
export const useDeleteRecipe = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: string; version: number }) => {
      await api.DELETE('/recipes/{id}', { params: { path: { id }, header: basedOn(version) } });
    },
    onError: (error) => {
      showLatest(queryClient, error);
    },
    // Lists (favorites too) and searches from before would show it, until each was fetched again.
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['recipe-list'] });
      queryClient.removeQueries({ queryKey: ['search'] });
    },
  });
};
