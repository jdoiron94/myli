import { API_BASE_PATH, publicRecipeUrl } from '@myli/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import type { PhotoAddress } from './photos.ts';

/** A recipe's public link, cached for whoever may share it. */
export const publicLinkKey = (recipeId: string) => ['public-link', recipeId];

/** A recipe's public link, `null` if it has none. Only whoever may share the recipe may ask. */
export const publicLinkQuery = (recipeId: string) =>
  queryOptions({
    queryKey: publicLinkKey(recipeId),
    queryFn: async () =>
      responseData(
        await api.GET('/recipes/{id}/public-link', { params: { path: { id: recipeId } } }),
      ).publicLink,
  });

/** Gives a recipe a public link, or keeps the one it has, and shows it. */
export function useCreatePublicLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recipeId: string) =>
      responseData(
        await api.PUT('/recipes/{id}/public-link', { params: { path: { id: recipeId } } }),
      ).publicLink,
    onSuccess: (link, recipeId) => {
      queryClient.setQueryData(publicLinkKey(recipeId), link);
    },
  });
}

/** Revokes a recipe's public link: no one can open it any more. */
export function useRevokePublicLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recipeId: string) => {
      await api.DELETE('/recipes/{id}/public-link', { params: { path: { id: recipeId } } });
    },
    onSuccess: (_, recipeId) => {
      queryClient.setQueryData(publicLinkKey(recipeId), null);
    },
  });
}

/** A public link's address, on the instance the app is open on. */
export const publicLinkUrl = (token: string) => publicRecipeUrl(window.location.origin, token);

/** The recipe a public link shows, to anyone, signed in or not. */
export const publicRecipeQuery = (token: string) =>
  queryOptions({
    queryKey: ['public-recipe', token],
    queryFn: async () =>
      responseData(await api.GET('/public/recipes/{token}', { params: { path: { token } } }))
        .recipe,
  });

/** Where a public link's page gets its recipe's photos: by the link's token. */
export const publicPhotoAddress =
  (token: string): PhotoAddress =>
  (id, width) =>
    `${API_BASE_PATH}/public/recipes/${encodeURIComponent(token)}/images/${encodeURIComponent(id)}/${String(width)}`;
