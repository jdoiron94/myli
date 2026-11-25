import { z } from 'zod';
import { type Amount, scaleAmount, scaleFactor } from './quantities.ts';
import { ingredientLineSchema } from './recipe.ts';
import { convert, dimensionOf, resolveUnit, UNITS } from './units.ts';

/**
 * Grocery lists (spec §3.5): the ingredients of a collection's recipes, each at the servings chosen,
 * added up into one line per ingredient. Worked out whenever a list is shown; nothing is stored.
 */

/** What a grocery list takes from an ingredient line. */
export const groceryIngredientSchema = ingredientLineSchema
  .pick({ qty: true, qtyMax: true, unit: true, name: true, normalizedName: true, scalable: true })
  .meta({ id: 'GroceryIngredient' });

export type GroceryIngredient = z.infer<typeof groceryIngredientSchema>;

/** A recipe whose ingredients go on a grocery list. */
export const groceryRecipeSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    servings: z.number().int().describe('The servings its amounts are written for.'),
    ingredients: z.array(groceryIngredientSchema).describe('In the order the recipe lists them.'),
  })
  .meta({ id: 'GroceryRecipe' });

export type GroceryRecipe = z.infer<typeof groceryRecipeSchema>;

/** What a collection's grocery list is worked out from: its recipes' ingredients. */
export const collectionIngredientsSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    recipes: z
      .array(groceryRecipeSchema)
      .describe(
        'Every recipe in it that the caller may see now, as published, in the order they put ' +
          'them: all of them at once, not a page.',
      ),
  })
  .meta({ id: 'CollectionIngredients' });

export type CollectionIngredients = z.infer<typeof collectionIngredientsSchema>;

/** A recipe on the list, and the servings to buy for. */
export interface GroceryEntry {
  recipe: GroceryRecipe;
  servings: number;
}

/** One line of a grocery list: an ingredient, how much of it, and which recipes want it. */
export interface GroceryLine {
  /** The normalized name its ingredients share, which identifies the line, as when it's ticked. */
  key: string;
  /** The name most of its ingredients use. */
  name: string;
  /**
   * How much, as one amount for each kind of unit that can't be added to the others: a measure in
   * its dimension's base unit (ml or g), a count of items (no unit), or a named unit as itself (3
   * cloves). Named units come first, by name, then the count, mass and volume. Empty when none of
   * its ingredients says how much.
   */
  amounts: Amount[];
  /** The recipes that want it, by title. */
  recipes: { id: string; title: string }[];
}

/** Where amounts of each dimension are added up. A count is items, with no unit. */
const BASE_UNITS = { volume: UNITS.get('ml'), mass: UNITS.get('g'), count: null };

/** Where amounts in a kind of unit come in a line: named units first, by name. */
const DIMENSION_ORDER = { count: '1', mass: '2', volume: '3' };

/** Alphabetical, and still one order for two strings the locale counts as the same. */
function compareText(a: string, b: string): number {
  return a.localeCompare(b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The sum of `values`, smallest first: floating point addition depends on the order, and the order
 * of the recipes mustn't change the result.
 */
function sum(values: readonly number[]): number {
  return [...values].sort((a, b) => a - b).reduce((total, value) => total + value, 0);
}

/** The name used most, or the first alphabetically of those used most. */
function commonest(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const [first] = [...counts].sort(([a, m], [b, n]) => n - m || compareText(a, b));
  return first?.[0] ?? '';
}

interface Subtotal {
  /** Its unit, where it's added up. */
  unit: string | null;
  lows: number[];
  highs: number[];
  hasRange: boolean;
}

interface Group {
  names: string[];
  subtotals: Map<string, Subtotal>;
  recipes: Map<string, string>;
}

/** Adds one ingredient's amount, already scaled, to its group, in the unit its kind adds up in. */
function addAmount(group: Group, { qty, qtyMax, unit }: Amount) {
  if (qty === null) return;
  const written = resolveUnit(unit);
  const dimension = dimensionOf(written);
  const target = dimension === null ? written : BASE_UNITS[dimension];
  const place = dimension === null ? `0${written?.name ?? ''}` : DIMENSION_ORDER[dimension];
  const inTarget = (value: number) => convert(value, written, target ?? null) ?? value;
  const subtotal = group.subtotals.get(place) ?? {
    unit: target?.name ?? null,
    lows: [],
    highs: [],
    hasRange: false,
  };
  subtotal.lows.push(inTarget(qty));
  subtotal.highs.push(inTarget(qtyMax ?? qty));
  subtotal.hasRange ||= qtyMax !== null;
  group.subtotals.set(place, subtotal);
}

/**
 * The grocery list for `entries`: one line for each normalized name, in alphabetical order. Each
 * ingredient is scaled to its entry's servings first, unless it doesn't scale. Amounts are added up
 * within a dimension, converted to its base unit, and a named unit only with itself. A range adds
 * up end to end. An ingredient that doesn't say how much adds nothing, but its recipe still counts.
 */
export function groceryList(entries: readonly GroceryEntry[]): GroceryLine[] {
  const groups = new Map<string, Group>();
  for (const { recipe, servings } of entries) {
    const factor = scaleFactor(recipe.servings, servings);
    for (const ingredient of recipe.ingredients) {
      const group: Group = groups.get(ingredient.normalizedName) ?? {
        names: [],
        subtotals: new Map(),
        recipes: new Map(),
      };
      group.names.push(ingredient.name);
      group.recipes.set(recipe.id, recipe.title);
      addAmount(group, scaleAmount(ingredient, factor, ingredient.scalable));
      groups.set(ingredient.normalizedName, group);
    }
  }

  return [...groups]
    .map(([key, group]) => ({
      key,
      name: commonest(group.names),
      amounts: [...group.subtotals]
        .sort(([a], [b]) => compareText(a, b))
        .map(([, { unit, lows, highs, hasRange }]) => ({
          qty: sum(lows),
          qtyMax: hasRange ? sum(highs) : null,
          unit,
        })),
      recipes: [...group.recipes]
        .map(([id, title]) => ({ id, title }))
        .sort((a, b) => compareText(a.title, b.title) || compareText(a.id, b.id)),
    }))
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.key, b.key));
}
