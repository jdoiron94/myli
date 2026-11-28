import {
  recipeResultSchema,
  STALE_RECIPE_PROBLEM_TYPE,
  staleRecipeProblemSchema,
  trashListSchema,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditEvent, favorite, job, recipe as recipeTable } from '../db/schema.ts';
import { ifMatch, insertRecipe } from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

afterEach(() => {
  vi.useRealTimers();
});

function send(
  t: TestApp,
  method: string,
  path: string,
  cookie: string,
  headers: Record<string, string> = {},
) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: {
      ...(method !== 'GET' && { 'content-type': 'application/json' }),
      cookie,
      ...headers,
    },
  });
}

const remove = (t: TestApp, id: string, cookie: string) =>
  send(t, 'DELETE', `/recipes/${id}`, cookie, ifMatch(t.db, id));
const restore = (
  t: TestApp,
  id: string,
  cookie: string,
  headers: Record<string, string> = ifMatch(t.db, id),
) => send(t, 'POST', `/trash/${id}/restore`, cookie, headers);

async function trashOf(t: TestApp, cookie: string) {
  const res = await send(t, 'GET', '/trash', cookie);
  expect(res.status).toBe(200);
  return trashListSchema.parse(await res.json());
}

const retitle = (t: TestApp, id: string, title: string) =>
  t.db.update(recipeTable).set({ title }).where(eq(recipeTable.id, id)).run();

describe('GET /trash', () => {
  it('lists the deleted recipes the caller may restore, most recently deleted first', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-16T10:00:00Z') });
    const t = createTestApp();
    const editor = await signedInAs(t, 'editor');
    const admin = await signedInAs(t, 'admin');
    const recipes = {
      editorsPrivate: insertRecipe(t.db, editor.user.id, 'private'),
      editorsShared: insertRecipe(t.db, editor.user.id, 'shared'),
      adminsPrivate: insertRecipe(t.db, admin.user.id, 'private'),
      editorsLive: insertRecipe(t.db, editor.user.id, 'shared'),
    };
    for (const [name, id] of Object.entries(recipes)) retitle(t, id, name);
    for (const [id, owner] of [
      [recipes.editorsPrivate, editor],
      [recipes.adminsPrivate, admin],
      [recipes.editorsShared, editor],
    ] as const) {
      expect((await remove(t, id, owner.cookie)).status).toBe(204);
      vi.setSystemTime(Date.now() + 60_000);
    }

    const editorsTrash = await trashOf(t, editor.cookie);
    expect(editorsTrash.retentionDays).toBe(30);
    expect(editorsTrash.recipes).toEqual([
      {
        id: recipes.editorsShared,
        title: 'editorsShared',
        visibility: 'shared',
        owner: { id: editor.user.id, name: editor.user.name, avatar: null },
        deletedAt: '2026-11-16T10:02:00.000Z',
        purgeAt: '2026-12-16T10:02:00.000Z',
        version: 2,
      },
      expect.objectContaining({ title: 'editorsPrivate' }),
    ]);
    // An admin may restore their own, and anyone's shared recipe, but never sees another's private one.
    expect((await trashOf(t, admin.cookie)).recipes.map(({ title }) => title)).toEqual([
      'editorsShared',
      'adminsPrivate',
    ]);
  });
});

describe('POST /trash/{id}/restore', () => {
  it('brings the recipe back as it was, for everyone who saw it, and tells search', async () => {
    const t = createTestApp();
    const { user, cookie } = await signedInAs(t, 'editor');
    const viewer = await signedInAs(t, 'viewer');
    const id = insertRecipe(t.db, user.id, 'shared');
    t.db.insert(favorite).values({ userId: user.id, recipeId: id }).run();
    const before = recipeResultSchema.parse(
      await (await send(t, 'GET', `/recipes/${id}`, cookie)).json(),
    ).recipe;
    expect((await remove(t, id, cookie)).status).toBe(204);
    const indexed = () =>
      t.db.select().from(job).where(eq(job.type, 'search.index-recipe')).all().length;
    const indexedBefore = indexed();

    const res = await restore(t, id, cookie);

    expect(res.status).toBe(200);
    const restored = recipeResultSchema.parse(await res.json()).recipe;
    expect(restored).toEqual({ ...before, version: before.version + 2 });
    expect(res.headers.get('etag')).toBe(`"${String(before.version + 2)}"`);
    expect((await send(t, 'GET', `/recipes/${id}`, viewer.cookie)).status).toBe(200);
    expect(await (await send(t, 'GET', `/recipes/${id}/favorite`, cookie)).json()).toEqual({
      favorite: true,
    });
    expect((await trashOf(t, cookie)).recipes).toEqual([]);
    expect(indexed()).toBe(indexedBefore + 1);
  });

  it('records who restored it, and only a shared recipe’s title', async () => {
    const t = createTestApp();
    const { user, cookie } = await signedInAs(t, 'editor');
    const shared = insertRecipe(t.db, user.id, 'shared');
    const hidden = insertRecipe(t.db, user.id, 'private');
    for (const id of [shared, hidden]) {
      expect((await remove(t, id, cookie)).status).toBe(204);
      expect((await restore(t, id, cookie)).status).toBe(200);
    }

    const restorations = t.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.action, 'recipe.restored'))
      .all();
    expect(
      restorations.map(({ actorId, targetId, metadata }) => ({ actorId, targetId, metadata })),
    ).toEqual([
      {
        actorId: user.id,
        targetId: shared,
        metadata: { title: 'Weeknight Bread', visibility: 'shared' },
      },
      { actorId: user.id, targetId: hidden, metadata: { visibility: 'private' } },
    ]);
  });

  it('refuses a recipe that isn’t in the trash, and a restore based on another version', async () => {
    const t = createTestApp();
    const { user, cookie } = await signedInAs(t, 'editor');
    const live = insertRecipe(t.db, user.id, 'shared');
    const trashed = insertRecipe(t.db, user.id, 'shared');
    expect((await remove(t, trashed, cookie)).status).toBe(204);
    const stale = { 'if-match': '"1"' };

    const refusals = [
      await restore(t, live, cookie),
      await restore(t, 'no-such-recipe', cookie, stale),
      await restore(t, trashed, cookie, {}),
      await restore(t, trashed, cookie, stale),
    ];

    expect(refusals.map(({ status }) => status)).toEqual([404, 404, 428, 412]);
    // The 412 holds the recipe as it is now, in the trash, so the client knows its version.
    const problem = staleRecipeProblemSchema.parse(await refusals[3]?.json());
    expect(problem.type).toBe(STALE_RECIPE_PROBLEM_TYPE);
    expect(problem.recipe.version).toBe(2);
    expect(
      t.db.select().from(recipeTable).where(eq(recipeTable.id, trashed)).get()?.deletedAt,
    ).toBeInstanceOf(Date);
  });
});
