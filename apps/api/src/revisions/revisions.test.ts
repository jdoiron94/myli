import {
  recipeDraftResultSchema,
  recipeResultSchema,
  recipeRevisionListSchema,
  recipeRevisionResultSchema,
} from '@myli/shared';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { auditEvent, image, job, recipe, recipeRevision, recipeTag, tag } from '../db/schema.ts';
import { uploadImage } from '../images/testing.ts';
import { deleteRecipe } from '../recipes/recipes.ts';
import {
  ifMatch,
  insertRecipe,
  sampleRecipeContent,
  sampleRecipeRequest,
} from '../recipes/testing.ts';
import { findOrCreateTag } from '../tags/tags.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { BACKFILLED_MESSAGE, backfillRevisions } from './revisions.ts';
import { readSnapshot } from './snapshot.ts';

const revisionsOf = (t: TestApp, recipeId: string) =>
  t.db
    .select()
    .from(recipeRevision)
    .where(eq(recipeRevision.recipeId, recipeId))
    .orderBy(asc(recipeRevision.number))
    .all();

function send(t: TestApp, method: string, path: string, cookie: string, body: unknown, id: string) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json', ...ifMatch(t.db, id) },
    body: JSON.stringify(body),
  });
}

describe('revisions', () => {
  it('records each save as the next revision: the recipe as published, by whoever saved it', async () => {
    const t = createTestApp();
    const owner = await signedInAs(t, 'editor');
    const other = await signedInAs(t, 'editor');
    const id = insertRecipe(t.db, owner.user.id, 'shared');
    const photo = await uploadImage(t, other.cookie);
    const wheat = t.db.select().from(tag).where(eq(tag.name, 'wheat')).get();

    const content = sampleRecipeContent({
      title: 'Sunday Bread',
      images: [{ id: photo.id, alt: 'A loaf on a board.' }],
      coverImageId: photo.id,
      tagIds: wheat ? [wheat.id] : [],
    });
    expect((await send(t, 'PUT', `/recipes/${id}`, other.cookie, content, id)).status).toBe(200);
    // Neither changes the content: no revision.
    const visibility = { visibility: 'private' };
    await send(t, 'PUT', `/recipes/${id}/visibility`, owner.cookie, visibility, id);
    const stale = await t.app.request(`/api/v1/recipes/${id}`, {
      method: 'PUT',
      headers: { cookie: owner.cookie, 'content-type': 'application/json', 'if-match': '"1"' },
      body: JSON.stringify(sampleRecipeContent({ title: 'Too Late' })),
    });
    expect(stale.status).toBe(412);

    const revisions = revisionsOf(t, id);
    expect(revisions.map(({ number, authorId }) => ({ number, authorId }))).toEqual([
      { number: 1, authorId: owner.user.id },
      { number: 2, authorId: other.user.id },
    ]);
    expect(readSnapshot(revisions[0]?.snapshot).title).toBe('Weeknight Bread');
    expect(readSnapshot(revisions[1]?.snapshot)).toMatchObject({
      schemaVersion: 1,
      title: 'Sunday Bread',
      // What the server works out is kept too, and a tag's name as it was.
      ingredientGroups: [{ ingredients: [{ normalizedName: 'all purpose flour' }, {}] }],
      tags: [{ id: wheat?.id, type: 'allergen', name: 'wheat' }],
      images: [{ id: photo.id, alt: 'A loaf on a board.' }],
      coverImageId: photo.id,
    });
  });

  it('gives each recipe saved before revisions were kept its first, once', async () => {
    const t = createTestApp();
    const ownerId = (await signedInAs(t, 'editor')).user.id;
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T08:00:00Z') });
    const kept = insertRecipe(t.db, ownerId);
    const deleted = insertRecipe(t.db, ownerId);
    deleteRecipe(t.db, { actorId: ownerId, ip: null, userAgent: null }, deleted, 1);
    const recorded = insertRecipe(t.db, ownerId);
    // As the database was before revisions: none for these two.
    for (const id of [kept, deleted]) {
      t.db.delete(recipeRevision).where(eq(recipeRevision.recipeId, id)).run();
    }
    vi.setSystemTime(new Date('2026-11-19T08:00:00Z'));

    expect(backfillRevisions(t.db)).toBe(2);
    expect(backfillRevisions(t.db)).toBe(0);
    vi.useRealTimers();

    for (const id of [kept, deleted]) {
      const changed = t.db.select().from(recipe).where(eq(recipe.id, id)).get()?.updatedAt;
      expect(revisionsOf(t, id)).toEqual([
        expect.objectContaining({
          number: 1,
          authorId: ownerId,
          message: BACKFILLED_MESSAGE,
          createdAt: changed,
        }),
      ]);
      expect(readSnapshot(revisionsOf(t, id)[0]?.snapshot).title).toBe('Weeknight Bread');
    }
    expect(revisionsOf(t, recorded)).toEqual([expect.objectContaining({ message: null })]);
  });
});

describe('the history of a recipe', () => {
  const read = async (t: TestApp, path: string, cookie: string) =>
    t.app.request(`/api/v1${path}`, { headers: { cookie } });

  /** A shared recipe by an editor, published again by another: two revisions, a photo in the first. */
  async function withHistory() {
    const t = createTestApp();
    const owner = await signedInAs(t, 'editor');
    const other = await signedInAs(t, 'editor');
    const photo = await uploadImage(t, owner.cookie);
    const weeknight = findOrCreateTag(t.db, 'custom', 'Weeknight').tag;
    const res = await t.app.request('/api/v1/recipes', {
      method: 'POST',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify(
        sampleRecipeRequest({
          images: [{ id: photo.id, alt: 'A loaf.' }],
          coverImageId: photo.id,
          tagIds: [weeknight.id],
        }),
      ),
    });
    const { id } = recipeResultSchema.parse(await res.json()).recipe;
    const published = sampleRecipeContent({ title: 'Sunday Bread' });
    await send(t, 'PUT', `/recipes/${id}`, other.cookie, { ...published, message: 'Slower' }, id);
    return { t, owner, other, photo, weeknight, id };
  }

  it('lists every revision newest first, and shows each as it was', async () => {
    const { t, owner, other, photo, weeknight, id } = await withHistory();
    // Since then, the tag was renamed, and the photo described otherwise, out of place.
    t.db.update(tag).set({ name: 'Quick' }).where(eq(tag.id, weeknight.id)).run();
    t.db.update(image).set({ altText: 'Changed.' }).where(eq(image.id, photo.id)).run();

    const list = recipeRevisionListSchema.parse(
      await (await read(t, `/recipes/${id}/revisions`, owner.cookie)).json(),
    );
    const by = ({ id: userId, name }: { id: string; name: string }) => ({
      id: userId,
      name,
      avatar: null,
    });
    expect(list.revisions).toEqual([
      { number: 2, author: by(other.user), message: 'Slower', createdAt: expect.any(String) },
      { number: 1, author: by(owner.user), message: null, createdAt: expect.any(String) },
    ]);

    const first = recipeRevisionResultSchema.parse(
      await (await read(t, `/recipes/${id}/revisions/1`, other.cookie)).json(),
    ).revision;
    expect(first.content).toMatchObject({
      title: 'Weeknight Bread',
      images: [{ ...photo, alt: 'A loaf.' }],
      coverImageId: photo.id,
      tags: [{ id: weeknight.id, type: 'custom', name: 'Weeknight' }],
    });
    expect((await read(t, `/recipes/${id}/revisions/3`, owner.cookie)).status).toBe(404);
  });

  it('restores a revision as the next one, keeping the draft, and records it', async () => {
    const { t, owner, other, photo, weeknight, id } = await withHistory();
    const draft = await t.app.request(`/api/v1/recipes/${id}/draft`, {
      method: 'PUT',
      headers: { cookie: owner.cookie, 'content-type': 'application/json', ...ifMatch(t.db, id) },
      body: JSON.stringify(sampleRecipeContent({ title: 'Work in Progress' })),
    });
    expect(draft.status).toBe(200);
    // A tag deleted since can't come back.
    t.db.delete(recipeTag).where(eq(recipeTag.tagId, weeknight.id)).run();
    t.db.delete(tag).where(eq(tag.id, weeknight.id)).run();
    const indexed = t.db.select().from(job).where(eq(job.type, 'search.index-recipe')).all();

    const res = await t.app.request(`/api/v1/recipes/${id}/revisions/1/restore`, {
      method: 'POST',
      headers: { cookie: other.cookie, 'content-type': 'application/json', ...ifMatch(t.db, id) },
    });

    expect(res.status).toBe(200);
    expect(recipeResultSchema.parse(await res.json()).recipe).toMatchObject({
      title: 'Weeknight Bread',
      images: [{ ...photo, alt: 'A loaf.' }],
      tags: [],
      revision: 3,
    });
    expect(
      revisionsOf(t, id).map(({ number, authorId, message }) => [number, authorId, message]),
    ).toEqual([
      [1, owner.user.id, null],
      [2, other.user.id, 'Slower'],
      [3, other.user.id, 'Restored from revision #1'],
    ]);
    // Started from revision 2: whoever opens it can tell the recipe was published since.
    const kept = recipeDraftResultSchema.parse(
      await (await read(t, `/recipes/${id}/draft`, owner.cookie)).json(),
    ).draft;
    expect(kept).toMatchObject({ content: { title: 'Work in Progress' }, revision: 2 });
    expect(t.db.select().from(job).where(eq(job.type, 'search.index-recipe')).all()).toHaveLength(
      indexed.length + 1,
    );
    expect(
      t.db.select().from(auditEvent).where(eq(auditEvent.action, 'revision.restored')).all(),
    ).toEqual([
      expect.objectContaining({
        actorId: other.user.id,
        targetType: 'recipe',
        targetId: id,
        metadata: { restored: 1, revision: 3, title: 'Weeknight Bread', visibility: 'shared' },
      }),
    ]);
  });

  it('refuses to restore a revision it doesn’t have, or based on an older version', async () => {
    const { t, owner, id } = await withHistory();
    const restore = (number: number, headers: Record<string, string>) =>
      t.app.request(`/api/v1/recipes/${id}/revisions/${String(number)}/restore`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json', ...headers },
      });

    const statuses = [
      (await restore(9, ifMatch(t.db, id))).status,
      (await restore(1, { 'if-match': '"1"' })).status,
    ];
    expect(statuses).toEqual([404, 412]);
    expect(revisionsOf(t, id)).toHaveLength(2);
  });
});
