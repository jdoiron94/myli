import { RECIPE_LIMITS } from '@myli/shared';
import { computed, ref, watch } from 'vue';
import { type LocationQuery, useRoute, useRouter } from 'vue-router';
import { z } from 'zod';

const servingsQuerySchema = z.object({
  servings: z.coerce.number().int().min(1).max(RECIPE_LIMITS.servings),
});

/** The servings an address asks for (`?servings=8`), if they're a number a recipe can have. */
const servingsIn = (query: LocationQuery) => servingsQuerySchema.safeParse(query).data?.servings;

/** The servings in an address, for a link to the recipe's other page to carry: cook mode, or back. */
export function servingsQuery(query: LocationQuery): Record<string, string> {
  const servings = servingsIn(query);
  return servings === undefined ? {} : { servings: String(servings) };
}

/**
 * The servings to show a recipe for: what the address asks for, or the recipe's own. Choosing others
 * writes them into the address, so a reload keeps them, and links between the recipe's page and
 * cook mode carry them (`servingsQuery`). Going to another recipe starts again from its address.
 */
export function useServings(id: () => string, own: () => number | undefined) {
  const route = useRoute();
  const router = useRouter();
  const chosen = ref(servingsIn(route.query));
  watch(id, () => {
    chosen.value = servingsIn(route.query);
  });

  return computed({
    get: () => chosen.value ?? own() ?? 1,
    set: (value: number) => {
      // The recipe's own servings need no saying.
      chosen.value = value === own() ? undefined : value;
      const query = { ...route.query };
      delete query.servings;
      if (chosen.value !== undefined) query.servings = String(chosen.value);
      void router.replace({ query });
    },
  });
}
