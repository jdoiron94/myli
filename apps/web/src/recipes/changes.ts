import { compareRecipes, type RecipeComparison } from '@myli/shared';
import type { Recipe } from './recipe.ts';

const detail =
  (...names: RecipeComparison['details']) =>
  ({ details }: RecipeComparison) =>
    names.some((name) => details.includes(name));

/** The parts of a recipe an edit changes, named as the editor names them, in its order. */
const PARTS: readonly (readonly [string, (comparison: RecipeComparison) => boolean])[] = [
  ['Title', detail('title')],
  ['Description', ({ description }) => description !== null],
  ['Photos', (comparison) => comparison.photos !== null || detail('coverImageId')(comparison)],
  ['Servings', detail('servings')],
  ['What it makes', detail('yield')],
  ['Times', detail('prepMinutes', 'cookMinutes', 'totalMinutes')],
  ['Ingredients', ({ ingredients }) => ingredients !== null],
  ['Steps', ({ steps }) => steps !== null],
  ['Tags', ({ tags }) => tags !== null],
  ['Difficulty', detail('difficulty')],
  ['Source', detail('source')],
  ['Equipment', ({ equipment }) => equipment !== null],
  ['Nutrition', ({ nutrition }) => nutrition.length > 0],
];

/** The parts of a recipe that differ between two of its versions, by name. */
export function changedParts(before: Recipe, after: Recipe): string[] {
  const comparison = compareRecipes(before, after);
  return PARTS.filter(([, changed]) => changed(comparison)).map(([name]) => name);
}
