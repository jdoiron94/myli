import { asc, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { recipe, recipeRevision, tag } from '../db/schema.ts';
import { uploadImage } from '../images/testing.ts';
import { deleteRecipe } from '../recipes/recipes.ts';
import { ifMatch, insertRecipe, sampleRecipeContent } from '../recipes/testing.ts';
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
