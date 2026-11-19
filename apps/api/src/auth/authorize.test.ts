import { type PolicyComment, type PolicyRecipe, problemDetailsSchema } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp, signedInAs } from '../testing.ts';
import { authorize, notFound, requirePermission } from './authorize.ts';

const SOMEONE_ELSE = 'someone-else';

/**
 * The test app with throwaway routes that load stand-in recipes and comments by ID, the way real
 * handlers will, and authorize the action on them.
 */
function appWithResources() {
  const t = createTestApp();
  const recipes = new Map<string, PolicyRecipe>();
  const comments = new Map<string, PolicyComment>();

  const recipeById = (id: string) => {
    const recipe = recipes.get(id);
    if (!recipe) throw notFound('Recipe');
    return recipe;
  };

  t.app.get('/api/v1/test/recipes/:id', (c) => {
    authorize(c, 'recipe.read', recipeById(c.req.param('id')));
    return c.json({ ok: true });
  });
  t.app.delete('/api/v1/test/recipes/:id', (c) => {
    authorize(c, 'recipe.trash', recipeById(c.req.param('id')));
    return c.json({ ok: true });
  });
  t.app.delete('/api/v1/test/comments/:id', (c) => {
    const comment = comments.get(c.req.param('id'));
    if (!comment) throw notFound('Comment');
    authorize(c, 'comment.delete', comment);
    return c.json({ ok: true });
  });
  // `c.var.user.role` only typechecks because requirePermission narrows the type.
  t.app.get('/api/v1/test/invite', requirePermission('user.invite'), (c) =>
    c.json({ role: c.var.user.role }),
  );

  const send = (method: 'GET' | 'DELETE', path: string, cookie?: string, requestId?: string) =>
    t.app.request(`/api/v1/test${path}`, {
      method,
      headers: {
        ...(cookie && { cookie }),
        ...(requestId && { 'x-request-id': requestId }),
        // Every /api/v1 request that changes data must say it's JSON (json-only.ts).
        ...(method === 'DELETE' && { 'content-type': 'application/json' }),
      },
    });
  return { ...t, recipes, comments, send };
}

async function expectProblem(res: Response, status: number, detail: string) {
  expect(res.status).toBe(status);
  expect(problemDetailsSchema.parse(await res.json())).toMatchObject({ status, detail });
}

describe('requirePermission', () => {
  it('answers 401 when signed out, 403 when the role may not, and lets the rest through', async () => {
    const t = appWithResources();
    const editor = await signedInAs(t, 'editor');
    const admin = await signedInAs(t, 'admin');

    await expectProblem(await t.send('GET', '/invite'), 401, 'Sign in to continue.');
    await expectProblem(
      await t.send('GET', '/invite', editor.cookie),
      403,
      "You don't have permission to do this.",
    );
    const allowed = await t.send('GET', '/invite', admin.cookie);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ role: 'admin' });
  });
});

describe('authorize on a recipe', () => {
  it("answers someone else's private recipe exactly like one that doesn't exist", async () => {
    const t = appWithResources();
    const { cookie } = await signedInAs(t, 'admin');
    t.recipes.set('hidden', { ownerId: SOMEONE_ELSE, visibility: 'private' });

    // The same request ID, so even the bodies must match byte for byte.
    const hidden = await t.send('GET', '/recipes/hidden', cookie, 'same-request-id');
    const missing = await t.send('GET', '/recipes/missing', cookie, 'same-request-id');

    expect(hidden.status).toBe(404);
    expect([...hidden.headers]).toEqual([...missing.headers]);
    expect(await hidden.text()).toBe(await missing.text());
  });

  // Routes check the session first; this is in case one forgets.
  it('answers 401 when signed out, even on a route that doesn’t check the session first', async () => {
    const t = appWithResources();
    t.recipes.set('theirs', { ownerId: SOMEONE_ELSE, visibility: 'shared' });

    await expectProblem(await t.send('GET', '/recipes/theirs'), 401, 'Sign in to continue.');
  });
});

describe('authorize on a comment', () => {
  it("answers a comment on a recipe the user can't see like a missing comment", async () => {
    const t = appWithResources();
    const { cookie } = await signedInAs(t, 'admin');
    t.comments.set('hidden', {
      authorId: SOMEONE_ELSE,
      recipe: { ownerId: SOMEONE_ELSE, visibility: 'private' },
    });

    const hidden = await t.send('DELETE', '/comments/hidden', cookie, 'same-request-id');
    const missing = await t.send('DELETE', '/comments/missing', cookie, 'same-request-id');

    await expectProblem(hidden.clone(), 404, 'Comment not found.');
    expect(await hidden.text()).toBe(await missing.text());
  });

  it("answers 403 when an editor deletes someone else's comment, which an admin may", async () => {
    const t = appWithResources();
    const editor = await signedInAs(t, 'editor');
    const admin = await signedInAs(t, 'admin');
    t.comments.set('theirs', {
      authorId: SOMEONE_ELSE,
      recipe: { ownerId: SOMEONE_ELSE, visibility: 'shared' },
    });

    expect((await t.send('DELETE', '/comments/theirs', editor.cookie)).status).toBe(403);
    expect((await t.send('DELETE', '/comments/theirs', admin.cookie)).status).toBe(200);
  });
});
