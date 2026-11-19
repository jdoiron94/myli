import type { Recipe, RecipeContent } from './recipe.ts';
import { recipeContent } from './recipe-form.ts';

/** Whether two values from the API are the same, all the way down. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length && keys.every((key) => same(left[key], right[key]))
  );
}

/** The parts of a recipe an edit changes, named as the editor names them, in its order. */
const PARTS: readonly (readonly [string, (content: RecipeContent) => unknown])[] = [
  ['Title', (content) => content.title],
  ['Description', (content) => content.description],
  ['Photos', (content) => [content.images, content.coverImageId]],
  ['Servings', (content) => content.servings],
  ['What it makes', (content) => content.yield],
  ['Times', (content) => [content.prepMinutes, content.cookMinutes, content.totalMinutes]],
  ['Ingredients', (content) => content.ingredientGroups],
  ['Steps', (content) => content.steps],
  ['Tags', (content) => content.tagIds],
  ['Difficulty', (content) => content.difficulty],
  ['Source', (content) => content.source],
  ['Equipment', (content) => content.equipment],
  ['Nutrition', (content) => content.nutrition],
];

/** The parts of a recipe that differ between two of its versions, by name. */
export function changedParts(before: Recipe, after: Recipe): string[] {
  const [was, is] = [recipeContent(before), recipeContent(after)];
  return PARTS.filter(([, part]) => !same(part(was), part(is))).map(([name]) => name);
}
