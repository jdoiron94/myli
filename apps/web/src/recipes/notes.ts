import { queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import type { components } from '@/api/schema.ts';

export type Note = components['schemas']['Note'];

/** The signed-in user's note on a recipe, `null` if they have none. Only they ever see it. */
export const recipeNoteQuery = (id: string) =>
  queryOptions({
    queryKey: ['note', id],
    queryFn: async () =>
      responseData(await api.GET('/recipes/{id}/note', { params: { path: { id } } })).note,
  });

/** Writes the signed-in user's note on a recipe, or replaces it. */
export function useSaveNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) =>
      responseData(
        await api.PUT('/recipes/{id}/note', { params: { path: { id } }, body: { body } }),
      ).note,
    onSuccess: (note, { id }) => {
      queryClient.setQueryData(recipeNoteQuery(id).queryKey, note);
    },
  });
}

/** Deletes the signed-in user's note on a recipe. */
export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.DELETE('/recipes/{id}/note', { params: { path: { id } } });
    },
    onSuccess: (_, id) => {
      queryClient.setQueryData(recipeNoteQuery(id).queryKey, null);
    },
  });
}
