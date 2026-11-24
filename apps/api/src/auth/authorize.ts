import {
  type CommentAction,
  can,
  type PolicyComment,
  type PolicyRecipe,
  type RecipeAction,
  type RoleAction,
} from '@myli/shared';
import { createMiddleware } from 'hono/factory';
import { HttpProblem } from '../problems.ts';
import { type CurrentSession, type CurrentUser, signInRequired } from './session.ts';

/** The 403 for a signed-in user who isn't allowed to do this. */
export function forbidden(): HttpProblem {
  return new HttpProblem(403, "You don't have permission to do this.");
}

/**
 * The 404 for a resource that doesn't exist. `authorize` answers with the same one for a resource
 * the user may not see, so the two can't be told apart (spec §2). Handlers use it too, for IDs
 * they can't find.
 */
export function notFound(
  kind: 'Recipe' | 'Revision' | 'Comment' | 'Image' | 'Collection',
): HttpProblem {
  return new HttpProblem(404, `${kind} not found.`);
}

/**
 * Route middleware for actions that depend only on the role, e.g. `requirePermission('user.invite')`:
 * 401 when signed out, 403 when the role doesn't allow it (decided by `can()`). Like
 * `requireSession`, it tells the handler's types that the user is set.
 */
export function requirePermission(action: RoleAction) {
  return createMiddleware<{ Variables: { user: CurrentUser; session: CurrentSession } }>(
    async (c, next) => {
      // Typed as set by this middleware's own declaration; at runtime it's null until signed in.
      const user = c.var.user as CurrentUser | null;
      if (!user) throw signInRequired();
      if (!can(user, action)) throw forbidden();
      await next();
    },
  );
}

/** Anything with the request's user on it: a Hono context, narrowed or not. */
interface WithUser {
  var: { user: CurrentUser | null };
}

/**
 * Checks an action on a recipe or comment the handler has loaded, and throws unless it's allowed:
 * - 401 when signed out
 * - 404, identical to `notFound()`, when the user may not see the recipe (or the comment's recipe)
 * - 403 when they may see it but not do this
 */
export function authorize(c: WithUser, action: RecipeAction, recipe: PolicyRecipe): void;
export function authorize(c: WithUser, action: CommentAction, comment: PolicyComment): void;
export function authorize(
  c: WithUser,
  action: RecipeAction | CommentAction,
  resource: PolicyRecipe | PolicyComment,
): void {
  const user = c.var.user;
  if (!user) throw signInRequired();

  const isComment = 'authorId' in resource;
  const recipe = isComment ? resource.recipe : resource;
  if (!can(user, 'recipe.read', recipe)) throw notFound(isComment ? 'Comment' : 'Recipe');

  const allowed = isComment
    ? can(user, action as CommentAction, resource)
    : can(user, action as RecipeAction, resource);
  if (!allowed) throw forbidden();
}

/**
 * Checks that the caller may restore a recipe in the trash, which is all anyone does with one, and
 * throws unless they may: 401 when signed out, otherwise 404, identical to `notFound()`. A deleted
 * recipe is hidden from everyone else, as if it didn't exist (spec §3.2 Trash), so there's no 403:
 * it would tell someone who may only read the recipe that it was deleted.
 */
export function authorizeTrashed(c: WithUser, recipe: PolicyRecipe): void {
  const user = c.var.user;
  if (!user) throw signInRequired();
  if (!can(user, 'recipe.trash', recipe)) throw notFound('Recipe');
}
