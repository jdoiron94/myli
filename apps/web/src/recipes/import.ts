import { useMutation } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import type { components } from '@/api/schema.ts';

export type ImportRecipeResult = components['schemas']['ImportRecipeResult'];

/** Reads the recipe on another site's page (spec §3.7), to fill in the New recipe form. */
export const useImportRecipe = () =>
  useMutation({
    mutationFn: async (url: string) =>
      responseData(await api.POST('/recipes/import', { body: { url } })),
  });
