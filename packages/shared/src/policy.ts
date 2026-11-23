/**
 * The permission policy (spec §2): the one place that decides who may do what. The API enforces
 * it and the web app uses it to hide controls. Neither checks roles anywhere else.
 */
import type { Role } from './roles.ts';
import type { Visibility } from './visibility.ts';

/** Actions that depend only on the user's role. */
export const ROLE_ACTIONS = [
  'recipe.create',
  /** Upload photos, for recipes they write or edit. */
  'image.upload',
  'tag.create',
  /** Rename, merge or delete tags. */
  'tag.manage',
  /** Favorites, collections, personal notes and shopping lists. */
  'personal.write',
  /** See the trash: the deleted recipes they may restore (`recipe.trash`). */
  'trash.read',
  'user.invite',
  /** Change roles and deactivate users. */
  'user.manage',
  'auditLog.read',
  'instance.export',
  /** Rebuild the search index, and see how the latest rebuild went. */
  'search.reindex',
] as const;

/** Actions on one recipe. They depend on its owner and visibility too. */
export const RECIPE_ACTIONS = [
  'recipe.read',
  /** Edit and publish, and restore an older revision. */
  'recipe.edit',
  /** Make it private or shared. */
  'recipe.setVisibility',
  /** Move to the trash, and restore from it. */
  'recipe.trash',
  /** Create or revoke the public link. */
  'recipe.share',
  /** Comment and rate. */
  'recipe.interact',
] as const;

/** Actions on one comment. They depend on its author, and on the recipe it belongs to. */
export const COMMENT_ACTIONS = ['comment.edit', 'comment.delete'] as const;

export type RoleAction = (typeof ROLE_ACTIONS)[number];
export type RecipeAction = (typeof RECIPE_ACTIONS)[number];
export type CommentAction = (typeof COMMENT_ACTIONS)[number];
export type Action = RoleAction | RecipeAction | CommentAction;

/** The signed-in user, or `null` for an anonymous request, which may do nothing. */
export interface PolicyUser {
  id: string;
  role: Role;
}

/** The parts of a recipe the policy looks at. */
export interface PolicyRecipe {
  ownerId: string;
  visibility: Visibility;
}

/** The parts of a comment the policy looks at. */
export interface PolicyComment {
  authorId: string;
  recipe: PolicyRecipe;
}

const ROLE_RULES = {
  'recipe.create': ['admin', 'editor'],
  'image.upload': ['admin', 'editor'],
  'tag.create': ['admin', 'editor'],
  'tag.manage': ['admin'],
  'personal.write': ['admin', 'editor'],
  // Whoever may delete a recipe: an admin any they can see, an editor their own.
  'trash.read': ['admin', 'editor'],
  'user.invite': ['admin'],
  'user.manage': ['admin'],
  'auditLog.read': ['admin'],
  'instance.export': ['admin'],
  'search.reindex': ['admin'],
} as const satisfies Record<RoleAction, readonly Role[]>;

/** Viewers are strictly read-only: every rule that changes anything requires this. */
const canWrite = (user: PolicyUser) => user.role !== 'viewer';
const isAdmin = (user: PolicyUser) => user.role === 'admin';
const owns = (user: PolicyUser, recipe: PolicyRecipe) => user.id === recipe.ownerId;

/**
 * Private recipes are visible to their owner only, admins included, whatever the owner's role: an
 * editor demoted to viewer can still read the private recipes they wrote, but not change them.
 * Every recipe and comment rule starts here, so nothing can act on a recipe it can't see.
 */
const canRead = (user: PolicyUser, recipe: PolicyRecipe) =>
  recipe.visibility === 'shared' || owns(user, recipe);

const RECIPE_RULES = {
  'recipe.read': canRead,
  'recipe.edit': (user, recipe) => canWrite(user) && canRead(user, recipe),
  // Only the owner, admins included: making a shared recipe private would hide it from everyone
  // else, and making a private one shared would publish someone else's notes.
  'recipe.setVisibility': (user, recipe) => canWrite(user) && owns(user, recipe),
  'recipe.trash': (user, recipe) =>
    canRead(user, recipe) && (isAdmin(user) || (canWrite(user) && owns(user, recipe))),
  // Only shared recipes can have a public link.
  'recipe.share': (user, recipe) =>
    recipe.visibility === 'shared' && (isAdmin(user) || (canWrite(user) && owns(user, recipe))),
  'recipe.interact': (user, recipe) => canWrite(user) && canRead(user, recipe),
} as const satisfies Record<RecipeAction, (user: PolicyUser, recipe: PolicyRecipe) => boolean>;

const COMMENT_RULES = {
  'comment.edit': (user, comment) =>
    canWrite(user) && canRead(user, comment.recipe) && user.id === comment.authorId,
  'comment.delete': (user, comment) =>
    canWrite(user) &&
    canRead(user, comment.recipe) &&
    (user.id === comment.authorId || isAdmin(user)),
} as const satisfies Record<CommentAction, (user: PolicyUser, comment: PolicyComment) => boolean>;

const isRoleAction = (action: Action): action is RoleAction => action in ROLE_RULES;
const isRecipeAction = (action: Action): action is RecipeAction => action in RECIPE_RULES;

/**
 * Whether `user` may perform `action`. Actions on a recipe or comment take that resource too, and
 * TypeScript requires it. Anonymous users (`null`) may do nothing; public links are checked
 * separately, by their token.
 */
export function can(user: PolicyUser | null, action: RoleAction): boolean;
export function can(user: PolicyUser | null, action: RecipeAction, recipe: PolicyRecipe): boolean;
export function can(
  user: PolicyUser | null,
  action: CommentAction,
  comment: PolicyComment,
): boolean;
export function can(
  user: PolicyUser | null,
  action: Action,
  resource?: PolicyRecipe | PolicyComment,
): boolean {
  if (user === null) return false;
  if (isRoleAction(action)) {
    return (ROLE_RULES[action] as readonly Role[]).includes(user.role);
  }
  if (resource === undefined) {
    throw new TypeError(`"${action}" needs the recipe or comment it applies to`);
  }
  if (isRecipeAction(action)) {
    return 'ownerId' in resource && RECIPE_RULES[action](user, resource);
  }
  return 'authorId' in resource && COMMENT_RULES[action](user, resource);
}
