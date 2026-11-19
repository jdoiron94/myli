import {
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  type Recipe,
  type RecipeAction,
  recipeResultSchema,
  STALE_RECIPE_PROBLEM_TYPE,
  staleRecipeProblemSchema,
  versionETag,
} from '@myli/shared';
import { authorize, notFound } from '../auth/authorize.ts';
import type { Db } from '../db/database.ts';
import { HttpProblem, InvalidFields } from '../problems.ts';
import { type ContentRefusal, findRecipeAccess, loadRecipe, type WriteResult } from './recipes.ts';

/** What the routes on one recipe share: their responses, `If-Match`, and how they refuse. */

export const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

interface HeaderObject {
  schema: { type: 'string' };
  description: string;
}

/** A response holding a recipe, with its version as the `ETag`. */
export const result = (description: string, headers: Record<string, HeaderObject> = {}) => ({
  description,
  content: { 'application/json': { schema: recipeResultSchema } },
  headers: {
    ETag: {
      schema: { type: 'string' as const },
      description: "The recipe's version, for the `If-Match` of a change to it.",
    },
    ...headers,
  },
});

/** The answers a write to an existing recipe can get from its `If-Match` (ADR 0007). */
export const conditionalResponses = {
  412: {
    description:
      'The recipe changed since the version in `If-Match`. The body holds it as it is now.',
    content: { [PROBLEM_CONTENT_TYPE]: { schema: staleRecipeProblemSchema } },
  },
  428: problem('The request has no `If-Match`.'),
};

/** The headers of a response holding a recipe: its version, as the `ETag`. */
export const etag = (recipe: Recipe) => ({ ETag: versionETag(recipe.version) });

/**
 * The version a write's `If-Match` names (ADR 0007): 428 without one. Anything but one strong
 * `ETag`, `*` included, counts as version 0, which no recipe has, so it's refused as out of date.
 */
export function ifMatchVersion(header: string | undefined): number {
  if (header === undefined) {
    throw new HttpProblem(428, 'Send the version this change is based on, in If-Match.');
  }
  const match = /^"(\d{1,15})"$/.exec(header.trim());
  return match ? Number(match[1]) : 0;
}

/**
 * The problem that stopped a save: 404 if the recipe is gone, or the 422 naming the photos it
 * can't use or the tags in `tagIds` that don't exist.
 */
export function refusal(failure: ContentRefusal | { ok: false; reason: 'not-found' }): Error {
  if (failure.reason === 'not-found') return notFound('Recipe');
  if (failure.reason === 'unusable-images') {
    return new InvalidFields(
      failure.paths.map((path) => ({
        path,
        detail: "This photo isn't available any more. Upload it again.",
      })),
    );
  }
  return new InvalidFields(
    failure.missingTags.map((index) => ({
      path: ['tagIds', index],
      detail: 'This tag no longer exists. Choose another.',
    })),
  );
}

/** Authorizing and answering for one recipe, against `db`. */
export function recipeGuards(db: Db) {
  /** The recipe, which the handler just authorized or wrote. */
  function found(id: string): Recipe {
    const recipe = loadRecipe(db, id);
    if (!recipe) throw notFound('Recipe');
    return recipe;
  }

  /** The 412 for a write based on an old version, with the recipe as it is now. */
  function staleProblem(id: string): HttpProblem {
    return new HttpProblem(412, 'This recipe changed after you loaded it.', {
      type: STALE_RECIPE_PROBLEM_TYPE,
      recipe: found(id),
    });
  }

  /** Throws unless the caller may do `action` to the recipe: 401, 404 if hidden or gone, 403. */
  function authorizeOn(c: Parameters<typeof authorize>[0], action: RecipeAction, id: string) {
    const access = findRecipeAccess(db, id);
    if (!access) throw notFound('Recipe');
    authorize(c, action, access);
  }

  /**
   * Throws unless the write happened: 404 if the recipe is gone, 412 if it changed meanwhile, or
   * the 422 for content it can't save.
   */
  function written(id: string, outcome: WriteResult | ContentRefusal) {
    if (outcome.ok) return;
    throw outcome.reason === 'stale' ? staleProblem(id) : refusal(outcome);
  }

  return { found, staleProblem, authorizeOn, written };
}
