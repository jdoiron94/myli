import { describe, expect, it } from 'vitest';
import {
  type Action,
  COMMENT_ACTIONS,
  type CommentAction,
  can,
  type PolicyComment,
  type PolicyRecipe,
  type PolicyUser,
  RECIPE_ACTIONS,
  type RecipeAction,
  ROLE_ACTIONS,
} from './policy.ts';
import { ROLES, type Role } from './roles.ts';

// The expectations below restate spec §2 for what depends on more than the role: ✓ allowed, – not
// allowed. What depends only on the role is a table in policy.ts itself, so restating it here would
// test nothing; the invariants at the end still cover it.

const ME = 'me';
const SOMEONE_ELSE = 'someone-else';
const userWith = (role: Role): PolicyUser => ({ id: ME, role });

const RECIPES = {
  'my private recipe': { ownerId: ME, visibility: 'private' },
  'my shared recipe': { ownerId: ME, visibility: 'shared' },
  "someone else's private recipe": { ownerId: SOMEONE_ELSE, visibility: 'private' },
  "someone else's shared recipe": { ownerId: SOMEONE_ELSE, visibility: 'shared' },
} as const satisfies Record<string, PolicyRecipe>;

/** One character per recipe above, in order. */
const RECIPE_TABLE: Record<RecipeAction, Record<Role, string>> = {
  //                  mine:   private, shared | someone else's: private, shared
  // A viewer's own recipes were written before they were demoted from editor.
  'recipe.read': { admin: '✓✓–✓', editor: '✓✓–✓', viewer: '✓✓–✓' },
  'recipe.edit': { admin: '✓✓–✓', editor: '✓✓–✓', viewer: '––––' },
  'recipe.setVisibility': { admin: '✓✓––', editor: '✓✓––', viewer: '––––' },
  'recipe.trash': { admin: '✓✓–✓', editor: '✓✓––', viewer: '––––' },
  'recipe.share': { admin: '–✓–✓', editor: '–✓––', viewer: '––––' },
  'recipe.interact': { admin: '✓✓–✓', editor: '✓✓–✓', viewer: '––––' },
};

const COMMENTS = {
  'my comment on a shared recipe': {
    authorId: ME,
    recipe: RECIPES["someone else's shared recipe"],
  },
  "someone else's comment on a shared recipe": {
    authorId: SOMEONE_ELSE,
    recipe: RECIPES["someone else's shared recipe"],
  },
  // A recipe can be made private after people commented on it.
  'my comment on a recipe that became private': {
    authorId: ME,
    recipe: RECIPES["someone else's private recipe"],
  },
  "someone else's comment on my recipe that became private": {
    authorId: SOMEONE_ELSE,
    recipe: RECIPES['my private recipe'],
  },
} as const satisfies Record<string, PolicyComment>;

/** One character per comment above, in order. */
const COMMENT_TABLE: Record<CommentAction, Record<Role, string>> = {
  'comment.edit': { admin: '✓–––', editor: '✓–––', viewer: '––––' },
  'comment.delete': { admin: '✓✓–✓', editor: '✓–––', viewer: '––––' },
};

/** Every (action, resource) pair, so the invariants below can sweep all of them. */
const ALL_CASES: { action: Action; on: string; check: (user: PolicyUser | null) => boolean }[] = [
  ...ROLE_ACTIONS.map((action) => ({
    action,
    on: 'the instance',
    check: (u: PolicyUser | null) => can(u, action),
  })),
  ...RECIPE_ACTIONS.flatMap((action) =>
    Object.entries(RECIPES).map(([on, recipe]) => ({
      action,
      on,
      check: (u: PolicyUser | null) => can(u, action, recipe),
    })),
  ),
  ...COMMENT_ACTIONS.flatMap((action) =>
    Object.entries(COMMENTS).map(([on, comment]) => ({
      action,
      on,
      check: (u: PolicyUser | null) => can(u, action, comment),
    })),
  ),
];

/** One ✓ or – per resource, in order, as the tables write them. */
const marks = <R>(resources: Record<string, R>, allowed: (resource: R) => boolean) =>
  Object.values(resources)
    .map((resource) => (allowed(resource) ? '✓' : '–'))
    .join('');

/** For each action and role, what `decide` says. */
const table = <A extends Action>(
  actions: readonly A[],
  decide: (action: A, user: PolicyUser) => string,
) =>
  Object.fromEntries(
    actions.map((action) => [
      action,
      Object.fromEntries(ROLES.map((role) => [role, decide(action, userWith(role))])),
    ]),
  );

describe('can()', () => {
  it('decides actions on a recipe as the table says', () => {
    expect(
      table(RECIPE_ACTIONS, (action, user) =>
        marks(RECIPES, (recipe) => can(user, action, recipe)),
      ),
    ).toEqual(RECIPE_TABLE);
  });

  it('decides actions on a comment as the table says', () => {
    expect(
      table(COMMENT_ACTIONS, (action, user) =>
        marks(COMMENTS, (comment) => can(user, action, comment)),
      ),
    ).toEqual(COMMENT_TABLE);
  });
});

describe('invariants, checked against every action and resource', () => {
  it('anonymous users may do nothing', () => {
    expect(ALL_CASES.filter(({ check }) => check(null))).toEqual([]);
  });

  it('viewers are strictly read-only, but for their own profile photo', () => {
    const viewer = userWith('viewer');
    // An upload of a viewer's can only become their profile photo: a recipe takes the rest.
    const writes = ALL_CASES.filter(
      ({ action }) => action !== 'recipe.read' && action !== 'image.upload',
    );
    expect(
      writes.filter(({ check }) => check(viewer)).map(({ action, on }) => `${action} ${on}`),
    ).toEqual([]);
  });

  it("no one, admins included, can do anything with someone else's private recipe or its comments", () => {
    const invisible = new Set<string>([
      "someone else's private recipe",
      'my comment on a recipe that became private',
    ]);
    const hidden = ALL_CASES.filter(({ on }) => invisible.has(on));
    expect(hidden).toHaveLength(RECIPE_ACTIONS.length + COMMENT_ACTIONS.length);

    for (const role of ROLES) {
      const user = userWith(role);
      expect(hidden.filter(({ check }) => check(user))).toEqual([]);
    }
  });
});

describe('how can() must be called', () => {
  const editor = userWith('editor');
  const recipe = RECIPES['my shared recipe'];
  const comment = COMMENTS['my comment on a shared recipe'];

  it('fails closed without its resource, or with the wrong kind, which typecheck refuses too', () => {
    // @ts-expect-error -- a recipe action without its recipe
    expect(() => can(editor, 'recipe.read')).toThrow(TypeError);
    // @ts-expect-error -- a comment action without its comment
    expect(() => can(editor, 'comment.delete')).toThrow(TypeError);
    // @ts-expect-error -- a role action takes no resource
    expect(can(editor, 'recipe.create', recipe)).toBe(true);
    // @ts-expect-error -- a comment action given a recipe
    expect(can(editor, 'comment.edit', recipe)).toBe(false);
    // @ts-expect-error -- a recipe action given a comment
    expect(can(editor, 'recipe.read', comment)).toBe(false);
  });
});
