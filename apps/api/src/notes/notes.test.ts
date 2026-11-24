import { recipeNoteSchema } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recipe } from '../db/schema.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

/** Sends `method` to the recipe's note as whoever has `cookie`. */
function send(
  t: TestApp,
  cookie: string,
  recipeId: string,
  method: 'GET' | 'PUT' | 'DELETE' = 'GET',
  body?: string,
) {
  return t.app.request(`/api/v1/recipes/${recipeId}/note`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify({ body }) }),
  });
}

/** The note whoever has `cookie` keeps on the recipe: what it says, or `null`. */
async function noteOf(t: TestApp, cookie: string, recipeId: string) {
  const res = await send(t, cookie, recipeId);
  expect(res.status).toBe(200);
  return recipeNoteSchema.parse(await res.json()).note?.body ?? null;
}

describe('a personal note on a recipe', () => {
  it('is written, changed and deleted by its writer, and no one else ever sees it, admins included', async () => {
    const t = createTestApp();
    const [owner, admin] = await Promise.all([signedInAs(t, 'editor'), signedInAs(t, 'admin')]);
    const id = insertRecipe(t.db, owner.user.id);

    expect(await noteOf(t, owner.cookie, id)).toBeNull();
    expect((await send(t, owner.cookie, id, 'PUT', '  Less **salt**.  ')).status).toBe(200);
    expect((await send(t, admin.cookie, id, 'PUT', 'Double it.')).status).toBe(200);
    expect({
      owner: await noteOf(t, owner.cookie, id),
      admin: await noteOf(t, admin.cookie, id),
    }).toEqual({ owner: 'Less **salt**.', admin: 'Double it.' });

    await send(t, owner.cookie, id, 'PUT', 'Less salt, more lemon.');
    expect((await send(t, admin.cookie, id, 'DELETE')).status).toBe(204);
    expect({
      owner: await noteOf(t, owner.cookie, id),
      admin: await noteOf(t, admin.cookie, id),
    }).toEqual({ owner: 'Less salt, more lemon.', admin: null });
  });

  it('is kept while the recipe is out of its writer’s sight, and shows again once it’s back', async () => {
    const t = createTestApp();
    const [owner, reader] = await Promise.all([signedInAs(t, 'editor'), signedInAs(t, 'editor')]);
    const id = insertRecipe(t.db, owner.user.id);
    await send(t, reader.cookie, id, 'PUT', 'Bake it longer.');
    const setRecipe = (values: Partial<typeof recipe.$inferInsert>) =>
      t.db.update(recipe).set(values).where(eq(recipe.id, id)).run();

    setRecipe({ visibility: 'private' });
    expect((await send(t, reader.cookie, id)).status).toBe(404);
    expect((await send(t, reader.cookie, id, 'PUT', 'Changed.')).status).toBe(404);
    setRecipe({ visibility: 'shared', deletedAt: new Date() });
    expect((await send(t, reader.cookie, id)).status).toBe(404);

    setRecipe({ deletedAt: null });
    expect(await noteOf(t, reader.cookie, id)).toBe('Bake it longer.');
  });
});
