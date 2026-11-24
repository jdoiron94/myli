import { recipeRatingSchema } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { job } from '../db/schema.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

/** Sends `method` to the recipe's rating as whoever has `cookie`, and reads what it answers. */
async function rating(
  t: TestApp,
  cookie: string,
  recipeId: string,
  method: 'GET' | 'PUT' | 'DELETE' = 'GET',
  stars?: number,
) {
  const res = await t.app.request(`/api/v1/recipes/${recipeId}/rating`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    ...(stars === undefined ? {} : { body: JSON.stringify({ stars }) }),
  });
  expect(res.status).toBe(200);
  return recipeRatingSchema.parse(await res.json());
}

describe('a recipe’s ratings', () => {
  it('are one each, which each person changes or takes back, with the average and count', async () => {
    const t = createTestApp();
    const [owner, other, viewer] = await Promise.all([
      signedInAs(t, 'editor'),
      signedInAs(t, 'admin'),
      signedInAs(t, 'viewer'),
    ]);
    const id = insertRecipe(t.db, owner.user.id);

    expect(await rating(t, owner.cookie, id)).toEqual({ average: null, count: 0, mine: null });
    await rating(t, other.cookie, id, 'PUT', 4);
    expect(await rating(t, owner.cookie, id, 'PUT', 5)).toEqual({
      average: 4.5,
      count: 2,
      mine: 5,
    });
    // Viewers see them, and have none of their own.
    expect(await rating(t, viewer.cookie, id)).toEqual({ average: 4.5, count: 2, mine: null });
    expect(await rating(t, owner.cookie, id, 'PUT', 2)).toEqual({
      average: 3,
      count: 2,
      mine: 2,
    });
    expect(await rating(t, owner.cookie, id, 'DELETE')).toEqual({
      average: 4,
      count: 1,
      mine: null,
    });
  });

  it('queue the recipe’s search update when they change, and not when nothing does', async () => {
    const t = createTestApp();
    const { user, cookie } = await signedInAs(t, 'editor');
    const id = insertRecipe(t.db, user.id);
    const updates = () =>
      t.db.select().from(job).where(eq(job.type, 'search.index-recipe')).all().length;
    const saved = updates();

    await rating(t, cookie, id, 'PUT', 4);
    await rating(t, cookie, id, 'PUT', 4);
    await rating(t, cookie, id, 'PUT', 5);
    await rating(t, cookie, id, 'DELETE');
    await rating(t, cookie, id, 'DELETE');

    expect(updates() - saved).toBe(3);
  });
});
