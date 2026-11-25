import { RECIPE_LIMITS } from '@myli/shared';
import { queryOptions } from '@tanstack/vue-query';
import { ref } from 'vue';
import { type LocationQueryValue, useRoute, useRouter } from 'vue-router';
import { api, responseData } from '@/api/client.ts';
import { collectionKey } from './collections.ts';

/**
 * What one of the signed-in user's collections' grocery list is added up from (spec §3.5): the
 * ingredients of every recipe in it they may see, as published. Under the collection's key, so a
 * change to it shows here too.
 */
export const collectionIngredientsQuery = (id: string) =>
  queryOptions({
    queryKey: [...collectionKey(id), 'ingredients'],
    queryFn: async () =>
      responseData(await api.GET('/collections/{id}/ingredients', { params: { path: { id } } })),
  });

/** A recipe as the choices take it: its ID, and the servings it's written for. */
interface ChosenFor {
  id: string;
  servings: number;
}

/** The values of a query parameter, given once, several times, or not at all. */
const valuesOf = (value: LocationQueryValue | LocationQueryValue[] | undefined): string[] =>
  (Array.isArray(value) ? value : [value]).filter((item) => typeof item === 'string');

/** "pancakes:6", a recipe's ID and servings, as the address holds them. */
const SERVINGS = /^(.+):(\d+)$/;

/**
 * What the reader chose on a grocery list: the servings for each recipe, and the lines ticked
 * (spec §3.5). Both live in the address (`?servings=<recipe ID>:6&got=garlic`), so a reload keeps
 * them, and nothing is saved. They're read as the page opens, and each change writes the address
 * again from them, so a second change before the first has reached the address loses nothing.
 */
export function useGroceryChoices() {
  const route = useRoute();
  const router = useRouter();

  const servings = ref(
    new Map(
      valuesOf(route.query.servings).flatMap((value) => {
        const [, id, count] = SERVINGS.exec(value) ?? [];
        const number = Number(count);
        return id && number >= 1 && number <= RECIPE_LIMITS.servings ? [[id, number] as const] : [];
      }),
    ),
  );
  const ticked = ref(new Set(valuesOf(route.query.got)));

  function write() {
    void router.replace({
      query: {
        ...(servings.value.size > 0 && {
          servings: [...servings.value].map(([id, count]) => `${id}:${String(count)}`).sort(),
        }),
        ...(ticked.value.size > 0 && { got: [...ticked.value].sort() }),
      },
    });
  }

  return {
    /** The servings to buy for: those chosen, or the recipe's own. */
    servingsOf: (recipe: ChosenFor) => servings.value.get(recipe.id) ?? recipe.servings,
    setServings(recipe: ChosenFor, count: number) {
      const next = new Map(servings.value);
      // The recipe's own servings need no saying.
      if (count === recipe.servings) next.delete(recipe.id);
      else next.set(recipe.id, count);
      servings.value = next;
      write();
    },
    /** Whether the line with this key (its normalized name) is ticked. */
    isTicked: (key: string) => ticked.value.has(key),
    tick(key: string, on: boolean) {
      const next = new Set(ticked.value);
      if (on) next.add(key);
      else next.delete(key);
      ticked.value = next;
      write();
    },
  };
}
