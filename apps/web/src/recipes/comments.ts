import { queryOptions } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import { useRefreshingMutation } from '@/api/refreshing-mutation.ts';
import type { components } from '@/api/schema.ts';

export type Comment = components['schemas']['Comment'];

/** A recipe's comments, oldest first. */
export const recipeCommentsQuery = (id: string) =>
  queryOptions({
    queryKey: ['comments', id],
    queryFn: async () =>
      responseData(await api.GET('/recipes/{id}/comments', { params: { path: { id } } })).comments,
  });

// Each refreshes the recipe's comments when it's done, whether it worked or not.
const COMMENTS = ['comments'];

export const usePostComment = () =>
  useRefreshingMutation(COMMENTS, async ({ recipeId, body }: { recipeId: string; body: string }) =>
    responseData(
      await api.POST('/recipes/{id}/comments', {
        params: { path: { id: recipeId } },
        body: { body },
      }),
    ),
  );

export const useEditComment = () =>
  useRefreshingMutation(COMMENTS, async ({ id, body }: { id: string; body: string }) =>
    responseData(await api.PUT('/comments/{id}', { params: { path: { id } }, body: { body } })),
  );

export const useDeleteComment = () =>
  useRefreshingMutation(COMMENTS, async (id: string) => {
    await api.DELETE('/comments/{id}', { params: { path: { id } } });
  });
