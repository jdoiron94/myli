import { commentListSchema, commentSchema, problemDetailsSchema } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { deleteRecipe } from '../recipes/recipes.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

function send(t: TestApp, cookie: string, method: string, path: string, body?: string) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify({ body }) }),
  });
}

async function setUp() {
  const t = createTestApp();
  const [editor, admin, viewer] = await Promise.all([
    signedInAs(t, 'editor'),
    signedInAs(t, 'admin'),
    signedInAs(t, 'viewer'),
  ]);
  const recipeId = insertRecipe(t.db, editor.user.id);
  const post = async (cookie: string, body: string) => {
    const res = await send(t, cookie, 'POST', `/recipes/${recipeId}/comments`, body);
    expect(res.status).toBe(201);
    return commentSchema.parse(await res.json());
  };
  const list = async (cookie = viewer.cookie) => {
    const res = await send(t, cookie, 'GET', `/recipes/${recipeId}/comments`);
    expect(res.status).toBe(200);
    return commentListSchema.parse(await res.json()).comments;
  };
  return { t, editor, admin, viewer, recipeId, post, list };
}

describe('a recipe’s comments', () => {
  it('read oldest first, each with its author, and say when their author changed them', async () => {
    const { t, editor, admin, recipeId, post, list } = await setUp();

    const first = await post(editor.cookie, '  Made this **twice**.  ');
    await post(admin.cookie, 'Try it with rye.');
    const blank = await send(t, editor.cookie, 'POST', `/recipes/${recipeId}/comments`, '   ');

    expect(blank.status).toBe(422);
    expect(
      (await list()).map(({ author, body, editedAt }) => ({ author: author.name, body, editedAt })),
    ).toEqual([
      { author: editor.user.name, body: 'Made this **twice**.', editedAt: null },
      { author: admin.user.name, body: 'Try it with rye.', editedAt: null },
    ]);

    // Saving what it already says doesn't count as a change.
    await send(t, editor.cookie, 'PUT', `/comments/${first.id}`, 'Made this **twice**.');
    expect((await list())[0]?.editedAt).toBeNull();
    const res = await send(t, editor.cookie, 'PUT', `/comments/${first.id}`, 'Made this thrice.');
    expect(res.status).toBe(200);
    const edited = commentSchema.parse(await res.json());
    expect(edited).toEqual({
      ...first,
      body: 'Made this thrice.',
      editedAt: expect.any(String) as string,
    });
    expect((await list())[0]).toEqual(edited);
  });

  it('are deleted by their author, or by an admin', async () => {
    const { t, editor, admin, post, list } = await setUp();
    const own = await post(editor.cookie, 'Mine.');
    const editors = await post(editor.cookie, 'Also mine.');
    const admins = await post(admin.cookie, 'The admin’s.');

    for (const [cookie, { id }] of [
      [editor.cookie, own],
      [admin.cookie, editors],
    ] as const) {
      expect((await send(t, cookie, 'DELETE', `/comments/${id}`)).status).toBe(204);
    }

    expect((await list()).map(({ id }) => id)).toEqual([admins.id]);
  });

  it('are hidden with their recipe in the trash, as if they didn’t exist', async () => {
    const { t, editor, recipeId, post } = await setUp();
    const { id } = await post(editor.cookie, 'Mine.');
    deleteRecipe(t.db, { actorId: editor.user.id, ip: null, userAgent: null }, recipeId, 1);

    const answers = await Promise.all(
      [
        send(t, editor.cookie, 'GET', `/recipes/${recipeId}/comments`),
        send(t, editor.cookie, 'PUT', `/comments/${id}`, 'Changed.'),
        send(t, editor.cookie, 'DELETE', `/comments/${id}`),
        send(t, editor.cookie, 'DELETE', '/comments/no-such-comment'),
      ].map(async (sent) => {
        const res = await sent;
        return { status: res.status, detail: problemDetailsSchema.parse(await res.json()).detail };
      }),
    );

    const gone = { status: 404, detail: 'Comment not found.' };
    expect(answers).toEqual([{ status: 404, detail: 'Recipe not found.' }, gone, gone, gone]);
  });
});
