import type { RatingSummary } from '@myli/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';

/** A recipe's ratings, and the signed-in user's own. */
export const recipeRatingQuery = (id: string) =>
  queryOptions({
    queryKey: ['rating', id],
    queryFn: async () =>
      responseData(await api.GET('/recipes/{id}/rating', { params: { path: { id } } })),
  });

/** Rates a recipe, or with `null`, takes the signed-in user's rating back. */
export function useRateRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stars }: { id: string; stars: number | null }) => {
      const params = { path: { id } };
      return responseData(
        stars === null
          ? await api.DELETE('/recipes/{id}/rating', { params })
          : await api.PUT('/recipes/{id}/rating', { params, body: { stars } }),
      );
    },
    onSuccess: (rating, { id }) => {
      queryClient.setQueryData(recipeRatingQuery(id).queryKey, rating);
      // Their cards show the ratings, and sorting by rating may order them differently.
      void queryClient.invalidateQueries({ queryKey: ['recipe-list'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    },
  });
}

const averageFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** How a recipe's ratings read, on its page and its card: "4.5 stars from 2 ratings". */
export function ratingText({ average, count }: RatingSummary): string {
  if (average === null) return 'No ratings yet';
  return `${averageFormat.format(average)} stars from ${String(count)} ${count === 1 ? 'rating' : 'ratings'}`;
}
