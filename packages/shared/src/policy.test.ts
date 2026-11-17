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
  type RoleAction,
} from './policy.ts';
import { ROLES, type Role } from './roles.ts';

// The expectations below restate spec §2 as tables: ✓ allowed, – not allowed.

const ME = 'me';
const SOMEONE_ELSE = 'someone-else';
const userWith = (role: Role): PolicyUser => ({ id: ME, role });

type RoleRow = Record<Role, '✓' | '–'>;

const ROLE_TABLE: Record<RoleAction, RoleRow> = {
  'recipe.create': { admin: '✓', editor: '✓', viewer: '–' },
  'tag.create': { admin: '✓', editor: '✓', viewer: '–' },
  'tag.manage': { admin: '✓', editor: '–', viewer: '–' },
  'personal.write': { admin: '✓', editor: '✓', viewer: '–' },
  'user.invite': { admin: '✓', editor: '–', viewer: '–' },
  'user.manage': { admin: '✓', editor: '–', viewer: '–' },
  'auditLog.read': { admin: '✓', editor: '–', viewer: '–' },
  'instance.export': { admin: '✓', editor: '–', viewer: '–' },
  'search.reindex': { admin: '✓', editor: '–', viewer: '–' },
};

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

const allowed = (mark: string) => mark === '✓';

describe('the tables', () => {
  it('cover every action, so a new one needs its expectations written down', () => {
    expect(Object.keys(ROLE_TABLE)).toEqual([...ROLE_ACTIONS]);
    expect(Object.keys(RECIPE_TABLE)).toEqual([...RECIPE_ACTIONS]);
    expect(Object.keys(COMMENT_TABLE)).toEqual([...COMMENT_ACTIONS]);
  });

  it('have one ✓ or – per resource in every row', () => {
    const rows = [
      ...Object.values(RECIPE_TABLE).map((row) => ({ row, width: Object.keys(RECIPES).length })),
      ...Object.values(COMMENT_TABLE).map((row) => ({ row, width: Object.keys(COMMENTS).length })),
    ];
    for (const { row, width } of rows) {
      for (const marks of Object.values(row))
        expect(marks).toMatch(new RegExp(`^[✓–]{${String(width)}}$`));
    }
  });
});

describe('actions that depend only on the role', () => {
  const cases = ROLE_ACTIONS.flatMap((action) =>
    ROLES.map((role) => ({ action, role, expected: allowed(ROLE_TABLE[action][role]) })),
  );

  it.each(cases)('$role may $action: $expected', ({ action, role, expected }) => {
    expect(can(userWith(role), action)).toBe(expected);
  });
});

describe('actions on a recipe', () => {
  const cases = RECIPE_ACTIONS.flatMap((action) =>
    ROLES.flatMap((role) =>
      Object.entries(RECIPES).map(([on, recipe], index) => ({
        action,
        role,
        on,
        recipe,
        expected: allowed(RECIPE_TABLE[action][role].charAt(index)),
      })),
    ),
  );

  it.each(cases)('$role may $action $on: $expected', ({ action, role, recipe, expected }) => {
    expect(can(userWith(role), action, recipe)).toBe(expected);
  });
});

describe('actions on a comment', () => {
  const cases = COMMENT_ACTIONS.flatMap((action) =>
    ROLES.flatMap((role) =>
      Object.entries(COMMENTS).map(([on, comment], index) => ({
        action,
        role,
        on,
        comment,
        expected: allowed(COMMENT_TABLE[action][role].charAt(index)),
      })),
    ),
  );

  it.each(cases)('$role may $action $on: $expected', ({ action, role, comment, expected }) => {
    expect(can(userWith(role), action, comment)).toBe(expected);
  });
});

describe('invariants, checked against every action and resource', () => {
  it('anonymous users may do nothing', () => {
    expect(ALL_CASES.filter(({ check }) => check(null))).toEqual([]);
  });

  it('viewers are strictly read-only', () => {
    const viewer = userWith('viewer');
    const writes = ALL_CASES.filter(({ action }) => action !== 'recipe.read');
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

  it('a private recipe can never get a public link', () => {
    for (const role of ROLES) {
      expect(can(userWith(role), 'recipe.share', RECIPES['my private recipe'])).toBe(false);
    }
  });
});

describe('how can() must be called', () => {
  const editor = userWith('editor');
  const recipe = RECIPES['my shared recipe'];
  const comment = COMMENTS['my comment on a shared recipe'];

  it('requires the resource for recipe and comment actions, at compile time and at runtime', () => {
    // @ts-expect-error -- a recipe action without its recipe
    expect(() => can(editor, 'recipe.read')).toThrow(TypeError);
    // @ts-expect-error -- a comment action without its comment
    expect(() => can(editor, 'comment.delete')).toThrow(TypeError);
  });

  it('rejects the wrong kind of resource at compile time, and fails closed at runtime', () => {
    // @ts-expect-error -- a role action takes no resource
    expect(can(editor, 'recipe.create', recipe)).toBe(true);
    // @ts-expect-error -- a comment action given a recipe
    expect(can(editor, 'comment.edit', recipe)).toBe(false);
    // @ts-expect-error -- a recipe action given a comment
    expect(can(editor, 'recipe.read', comment)).toBe(false);
  });
});
