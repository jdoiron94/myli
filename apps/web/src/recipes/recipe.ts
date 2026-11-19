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
export type RecipeContent = components['schemas']['RecipeContent'];
export type RecipeDraft = components['schemas']['RecipeDraft'];
export type RecipeRevisionContent = components['schemas']['RecipeRevisionContent'];
export type RecipeRevisionSummary = components['schemas']['RecipeRevisionSummary'];
export type RecipeRevision = components['schemas']['RecipeRevision'];

/** One recipe, as the API shows it to the signed-in user. */
export const recipeQuery = (id: string) =>
  queryOptions({
    queryKey: ['recipes', id],
    queryFn: async () =>
      responseData(await api.GET('/recipes/{id}', { params: { path: { id } } })).recipe,
  });

/**
 * A recipe's draft, or `null` when it has none. Only for whoever may edit the recipe: the API
 * refuses anyone else, so ask only once `can()` allows it.
 */
export const recipeDraftQuery = (id: string) =>
  queryOptions({
    queryKey: ['recipes', id, 'draft'],
    queryFn: async () =>
      responseData(await api.GET('/recipes/{id}/draft', { params: { path: { id } } })).draft,
  });

/** A recipe's history: its revisions, newest first, the first being the one published. */
export const recipeRevisionsQuery = (id: string) =>
  queryOptions({
    queryKey: ['recipes', id, 'revisions'],
    queryFn: async () =>
      responseData(await api.GET('/recipes/{id}/revisions', { params: { path: { id } } }))
        .revisions,
  });

/** One revision of a recipe, as it recorded the recipe. Revisions never change. */
export const recipeRevisionQuery = (id: string, number: number) =>
  queryOptions({
    queryKey: ['recipes', id, 'revisions', number],
    queryFn: async () =>
      responseData(
        await api.GET('/recipes/{id}/revisions/{number}', { params: { path: { id, number } } }),
      ).revision,
    staleTime: Number.POSITIVE_INFINITY,
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
 * fetching it again. One that `discardsDraft` leaves the recipe without one.
 */
function useRecipeMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<Recipe>,
  { discardsDraft = false } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (recipe) => {
      queryClient.setQueryData(recipeQuery(recipe.id).queryKey, recipe);
      if (discardsDraft) queryClient.setQueryData(recipeDraftQuery(recipe.id).queryKey, null);
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
 * Publishes a recipe's content, replacing all of it, unless it changed since `version`, the one
 * the edit is based on. That discards its draft. Its visibility is changed on its own.
 */
export const usePublishRecipe = () =>
  useRecipeMutation(
    async ({ id, version, body }: { id: string; version: number; body: UpdateRecipeRequest }) =>
      responseData(
        await api.PUT('/recipes/{id}', {
          params: { path: { id }, header: basedOn(version) },
          body,
        }),
      ).recipe,
    { discardsDraft: true },
  );

/**
 * Saves a recipe's draft, unless the recipe changed since `version`. What's published stays as it
 * is, but its version moves on, which the cached recipe takes too, so its page can go on changing
 * it without being refused as out of date.
 */
export const useSaveDraft = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      version,
      body,
    }: {
      id: string;
      version: number;
      body: RecipeContent;
    }) =>
      responseData(
        await api.PUT('/recipes/{id}/draft', {
          params: { path: { id }, header: basedOn(version) },
          body,
        }),
      ).draft,
    onSuccess: (draft, { id }) => {
      queryClient.setQueryData(recipeDraftQuery(id).queryKey, draft);
      queryClient.setQueryData(
        recipeQuery(id).queryKey,
        (recipe) => recipe && { ...recipe, version: draft.version },
      );
    },
    onError: (error) => {
      showLatest(queryClient, error);
    },
  });
};

/**
 * Discards a recipe's draft, unless the recipe changed since `version`. What's published stays as
 * it is; the recipe is fetched again for its new version.
 */
export const useDiscardDraft = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: string; version: number }) => {
      await api.DELETE('/recipes/{id}/draft', {
        params: { path: { id }, header: basedOn(version) },
      });
    },
    onSuccess: async (_, { id }) => {
      queryClient.setQueryData(recipeDraftQuery(id).queryKey, null);
      await queryClient.invalidateQueries({ queryKey: recipeQuery(id).queryKey, exact: true });
    },
    onError: (error) => {
      showLatest(queryClient, error);
    },
  });
};

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
