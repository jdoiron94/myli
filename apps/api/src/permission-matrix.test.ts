import type { PolicyRecipe, RecipeAction } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { authorize, notFound, requirePermission } from './auth/authorize.ts';
import { requireSession } from './auth/session.ts';
import { renderOpenApiDocument } from './openapi-document.ts';
import {
  type Access,
  CALLERS,
  ENDPOINTS,
  type EndpointCase,
  expectedOutcome,
  findMismatches,
  RECIPE_CASES,
} from './permission-matrix.ts';
import { findRecipeAccess } from './recipes/recipes.ts';
import { createTestApp } from './testing.ts';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const label = ({ method, path }: Pick<EndpointCase, 'method' | 'path'>) =>
  `${method.toUpperCase()} ${path}`;

describe('the permission matrix', () => {
  it('lists exactly the operations in the OpenAPI document, each once', async () => {
    const document = JSON.parse(await renderOpenApiDocument()) as {
      paths?: Record<string, Record<string, unknown>>;
    };
    const operations = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((key) => HTTP_METHODS.has(key))
        .map((method) => label({ method: method as EndpointCase['method'], path })),
    );
    const listed = ENDPOINTS.map(label);

    expect(listed.toSorted()).toEqual(operations.toSorted());
    expect(new Set(listed).size).toBe(listed.length);
  });

  for (const endpoint of ENDPOINTS) {
    it(`${label(endpoint)} lets in exactly the callers the policy allows`, async () => {
      expect(await findMismatches(endpoint, () => createTestApp())).toEqual([]);
    });
  }
});

describe('expectedOutcome', () => {
  it.each([
    ['public', ['allowed', 'allowed', 'allowed', 'allowed']],
    ['signed-in', [401, 'allowed', 'allowed', 'allowed']],
    ['user.invite', [401, 'allowed', 403, 403]],
    ['recipe.create', [401, 'allowed', 'allowed', 403]],
  ] as const)('%s, for %j', (access, expected) => {
    expect(CALLERS).toEqual(['anonymous', 'admin', 'editor', 'viewer']);
    expect(CALLERS.map((caller) => expectedOutcome(access, caller))).toEqual(expected);
  });

  // One row per recipe case: their own private, their own shared, someone else's private, shared.
  it.each([
    ['recipe.read', 'admin', ['allowed', 'allowed', 404, 'allowed']],
    ['recipe.read', 'viewer', ['allowed', 'allowed', 404, 'allowed']],
    ['recipe.edit', 'editor', ['allowed', 'allowed', 404, 'allowed']],
    ['recipe.edit', 'viewer', [403, 403, 404, 403]],
    ['recipe.trash', 'editor', ['allowed', 'allowed', 404, 403]],
  ] as const)('%s on each recipe, for %s', (action, caller, expected) => {
    expect(
      RECIPE_CASES.map((recipe) => expectedOutcome({ recipe: action }, caller, recipe)),
    ).toEqual(expected);
  });

  it('expects 401 before anything about the recipe', () => {
    for (const recipe of RECIPE_CASES)
      expect(expectedOutcome({ recipe: 'recipe.read' }, 'anonymous', recipe)).toBe(401);
  });
});

describe('the harness itself', () => {
  /** The test app with routes protected in each way, plus one that crashes. */
  function appWithTestRoutes() {
    const t = createTestApp();
    t.app.get('/api/v1/test/open', (c) => c.json({}));
    t.app.get('/api/v1/test/members', requireSession, (c) => c.json({}));
    t.app.get('/api/v1/test/admins', requirePermission('user.invite'), (c) => c.json({}));
    t.app.get('/api/v1/test/crashes', requireSession, () => {
      throw new Error('a bug in the handler');
    });
    // Recipe routes: one that checks the action, one that checks only reading, and one that leaks.
    type Check = (c: Parameters<typeof authorize>[0], recipe: PolicyRecipe) => void;
    const recipeRoute = (path: string, check: Check) =>
      t.app.get(`/api/v1/test/${path}/:id`, requireSession, (c) => {
        const recipe = findRecipeAccess(t.db, c.req.param('id'));
        if (!recipe) throw notFound('Recipe');
        check(c, recipe);
        return c.json({});
      });
    recipeRoute('edit', (c, recipe) => {
      authorize(c, 'recipe.edit', recipe);
    });
    recipeRoute('read-only-check', (c, recipe) => {
      authorize(c, 'recipe.read', recipe);
    });
    recipeRoute('leaky', () => undefined);
    return t;
  }

  const recipeEndpoint = (path: string, action: RecipeAction): EndpointCase => ({
    method: 'get',
    path: `/${path}/{id}`,
    access: { recipe: action },
    send: (t, cookie, recipeId) =>
      t.app.request(`/api/v1/test/${path}/${recipeId}`, { headers: cookie ? { cookie } : {} }),
  });

  const endpoint = (path: string, access: Access): EndpointCase => ({
    method: 'get',
    path,
    access,
    send: (t, cookie) =>
      t.app.request(`/api/v1/test${path}`, { headers: cookie ? { cookie } : {} }),
  });

  it('finds nothing wrong with endpoints protected as listed', async () => {
    for (const [path, access] of [
      ['/open', 'public'],
      ['/members', 'signed-in'],
      ['/admins', 'user.invite'],
    ] as const) {
      expect(await findMismatches(endpoint(path, access), appWithTestRoutes)).toEqual([]);
    }
  });

  it('reports an endpoint that lets in more callers than the policy allows', async () => {
    expect(await findMismatches(endpoint('/members', 'user.invite'), appWithTestRoutes)).toEqual([
      'editor GET /members: expected 403, got 200',
      'viewer GET /members: expected 403, got 200',
    ]);
  });

  it('reports an endpoint that turns away callers the policy allows', async () => {
    expect(await findMismatches(endpoint('/admins', 'signed-in'), appWithTestRoutes)).toEqual([
      'editor GET /admins: expected allowed, got 403',
      'viewer GET /admins: expected allowed, got 403',
    ]);
    expect(await findMismatches(endpoint('/members', 'public'), appWithTestRoutes)).toEqual([
      'anonymous GET /members: expected allowed, got 401',
    ]);
  });

  it('finds nothing wrong with a recipe endpoint that authorizes its action', async () => {
    expect(await findMismatches(recipeEndpoint('edit', 'recipe.edit'), appWithTestRoutes)).toEqual(
      [],
    );
  });

  it('reports a recipe endpoint that shows hidden recipes', async () => {
    expect(await findMismatches(recipeEndpoint('leaky', 'recipe.read'), appWithTestRoutes)).toEqual(
      [
        "admin GET /leaky/{id} on someone else's private recipe: expected 404, got 200",
        "editor GET /leaky/{id} on someone else's private recipe: expected 404, got 200",
        "viewer GET /leaky/{id} on someone else's private recipe: expected 404, got 200",
      ],
    );
  });

  it('reports a recipe endpoint that checks reading but not the action', async () => {
    expect(
      await findMismatches(recipeEndpoint('read-only-check', 'recipe.edit'), appWithTestRoutes),
    ).toEqual([
      'viewer GET /read-only-check/{id} on their own private recipe: expected 403, got 200',
      'viewer GET /read-only-check/{id} on their own shared recipe: expected 403, got 200',
      "viewer GET /read-only-check/{id} on someone else's shared recipe: expected 403, got 200",
    ]);
  });

  it('does not count a crash as getting through', async () => {
    expect(await findMismatches(endpoint('/crashes', 'signed-in'), appWithTestRoutes)).toEqual([
      'admin GET /crashes: expected allowed, got 500',
      'editor GET /crashes: expected allowed, got 500',
      'viewer GET /crashes: expected allowed, got 500',
    ]);
  });
});
