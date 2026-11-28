import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { image, job } from '../db/schema.ts';
import { insertRecipeImage, uploadImage } from '../images/testing.ts';
import {
  ifMatch,
  insertRecipe,
  sampleRecipeContent,
  sampleRecipeRequest,
} from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

function send(
  t: TestApp,
  method: string,
  path: string,
  cookie?: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: {
      ...headers,
      ...(method !== 'GET' && { 'content-type': 'application/json' }),
      ...(cookie !== undefined && { cookie }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

const setAvatar = (t: TestApp, cookie: string, imageId: string) =>
  send(t, 'PUT', '/me/avatar', cookie, { imageId });

const avatarOf = async (t: TestApp, cookie: string) =>
  (await send(t, 'GET', '/me/avatar', cookie)).json();

/** Who gets the photo's smallest size: the status each of them is answered with. */
async function photoFor(t: TestApp, photo: { id: string; width: number }, cookie?: string) {
  return (await send(t, 'GET', `/images/${photo.id}/${String(photo.width)}`, cookie)).status;
}

/** The blob keys of each image, by ID, as stored. */
function keysOf(t: TestApp, id: string): string[] {
  const row = t.db.select({ variants: image.variants }).from(image).where(eq(image.id, id)).get();
  return row?.variants.map(({ key }) => key) ?? [];
}

const blobDeletions = (t: TestApp) =>
  t.db
    .select({ payload: job.payload })
    .from(job)
    .where(eq(job.type, 'blobs.delete'))
    .all()
    .map(({ payload }) => payload);

describe('profile photos', () => {
  it('a viewer sets one that every signed-in user then sees, and no one else', async () => {
    const t = createTestApp();
    const viewer = await signedInAs(t, 'viewer');
    const editor = await signedInAs(t, 'editor');
    const uploaded = await uploadImage(t, viewer.cookie);
    const photo = { id: uploaded.id, width: uploaded.variants[0]?.width ?? 0 };
    // An upload is its uploader's alone until it's used.
    expect(await photoFor(t, photo, editor.cookie)).toBe(404);

    const res = await setAvatar(t, viewer.cookie, photo.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imageId: photo.id });
    expect(await avatarOf(t, viewer.cookie)).toEqual({ imageId: photo.id });
    expect({
      'its owner': await photoFor(t, photo, viewer.cookie),
      'someone else': await photoFor(t, photo, editor.cookie),
      'no one signed in': await photoFor(t, photo),
    }).toEqual({ 'its owner': 200, 'someone else': 200, 'no one signed in': 401 });
  });

  it('deletes the photo before when it’s replaced or removed, its files in a job', async () => {
    const t = createTestApp();
    const editor = await signedInAs(t, 'editor');
    const first = await uploadImage(t, editor.cookie);
    const second = await uploadImage(t, editor.cookie);
    const [firstKeys, secondKeys] = [keysOf(t, first.id), keysOf(t, second.id)];
    await setAvatar(t, editor.cookie, first.id);

    expect((await setAvatar(t, editor.cookie, second.id)).status).toBe(200);
    expect(keysOf(t, first.id)).toEqual([]);
    expect(blobDeletions(t)).toEqual([{ keys: firstKeys }]);

    expect((await send(t, 'DELETE', '/me/avatar', editor.cookie)).status).toBe(204);
    expect(await avatarOf(t, editor.cookie)).toEqual({ imageId: null });
    expect(blobDeletions(t)).toEqual([{ keys: firstKeys }, { keys: secondKeys }]);
    // With none left, there's nothing to do.
    expect((await send(t, 'DELETE', '/me/avatar', editor.cookie)).status).toBe(204);
    expect(blobDeletions(t)).toHaveLength(2);
  });

  it('takes only an upload of the caller’s own that isn’t in a recipe, admins’ included', async () => {
    const t = createTestApp();
    const admin = await signedInAs(t, 'admin');
    const someoneElse = await signedInAs(t, 'viewer');
    const recipePhoto = await insertRecipeImage(t, insertRecipe(t.db, admin.user.id));
    const refusal = async (imageId: string) => {
      const res = await setAvatar(t, admin.cookie, imageId);
      return { status: res.status, errors: ((await res.json()) as { errors?: unknown }).errors };
    };

    const refused = {
      status: 422,
      errors: [
        {
          in: 'body',
          pointer: '#/imageId',
          detail: 'Choose a photo you uploaded that isn’t in a recipe.',
        },
      ],
    };
    expect({
      "someone else's upload": await refusal((await uploadImage(t, someoneElse.cookie)).id),
      'a photo of their own recipe': await refusal(recipePhoto),
      'no photo at all': await refusal(randomUUID()),
    }).toEqual({
      "someone else's upload": refused,
      'a photo of their own recipe': refused,
      'no photo at all': refused,
    });
    expect(t.db.select().from(image).where(eq(image.avatarOf, someoneElse.user.id)).all()).toEqual(
      [],
    );
  });

  it('can’t go in a recipe, even its owner’s', async () => {
    const t = createTestApp();
    const editor = await signedInAs(t, 'editor');
    const photo = await uploadImage(t, editor.cookie);
    await setAvatar(t, editor.cookie, photo.id);

    const res = await send(
      t,
      'POST',
      '/recipes',
      editor.cookie,
      sampleRecipeRequest({ images: [{ id: photo.id, alt: '' }], coverImageId: photo.id }),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      errors: expect.arrayContaining([expect.objectContaining({ pointer: '#/images/0/id' })]),
    });
    expect(await avatarOf(t, editor.cookie)).toEqual({ imageId: photo.id });
  });

  it('goes beside its owner’s name wherever the API names them', async () => {
    const t = createTestApp();
    const admin = await signedInAs(t, 'admin');
    const editor = await signedInAs(t, 'editor');
    const photo = await uploadImage(t, editor.cookie);
    await setAvatar(t, editor.cookie, photo.id);
    // The answers are checked by their schemas already: only who's named is under test.
    interface Named {
      id: string;
      name: string;
      avatar: string | null;
    }
    const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
    const read = <T>(path: string, cookie = editor.cookie) => json<T>(send(t, 'GET', path, cookie));

    const { recipe } = await json<{ recipe: { id: string; owner: Named } }>(
      send(t, 'POST', '/recipes', editor.cookie, sampleRecipeRequest()),
    );
    const path = `/recipes/${recipe.id}`;
    const comment = await json<{ author: Named }>(
      send(t, 'POST', `${path}/comments`, editor.cookie, { body: 'Lovely.' }),
    );
    const { draft } = await json<{ draft: { author: Named } }>(
      send(
        t,
        'PUT',
        `${path}/draft`,
        editor.cookie,
        sampleRecipeContent(),
        ifMatch(t.db, recipe.id),
      ),
    );
    const {
      revisions: [revision],
    } = await read<{ revisions: { author: Named }[] }>(`${path}/revisions`);
    const { users } = await read<{ users: Named[] }>('/users', admin.cookie);
    // Answered from the change itself (`returning`).
    const { user: promoted } = await json<{ user: Named }>(
      send(t, 'PUT', `/users/${editor.user.id}/role`, admin.cookie, { role: 'admin' }),
    );
    const { events } = await read<{ events: { actor: Named | null }[] }>(
      '/audit-events',
      admin.cookie,
    );
    await send(t, 'DELETE', path, editor.cookie, undefined, ifMatch(t.db, recipe.id));
    const {
      recipes: [trashed],
    } = await read<{ recipes: { owner: Named }[] }>('/trash');

    const named = ({ id, name, avatar }: Named) => ({ id, name, avatar });
    const actors = new Map(
      events.flatMap(({ actor }) => (actor ? [[actor.id, named(actor)]] : [])),
    );
    const withPhoto = { id: editor.user.id, name: editor.user.name, avatar: photo.id };
    const without = { id: admin.user.id, name: admin.user.name, avatar: null };
    expect({
      'recipe owner': recipe.owner,
      'comment author': comment.author,
      'draft author': draft.author,
      'revision author': revision?.author,
      'trashed recipe owner': trashed?.owner,
      users: users.map(named),
      'role change': named(promoted),
      'audit actors': [...actors.values()],
    }).toEqual({
      'recipe owner': withPhoto,
      'comment author': withPhoto,
      'draft author': withPhoto,
      'revision author': withPhoto,
      'trashed recipe owner': withPhoto,
      users: [without, withPhoto],
      'role change': withPhoto,
      // Newest first: the admin's role change, then the editor's sign-in.
      'audit actors': [without, withPhoto],
    });
  });
});
