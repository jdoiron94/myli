import { createdPublicLinkSchema, recipePublicLinkSchema } from '@myli/shared';
import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditEvent, image, recipe, recipeStep } from '../db/schema.ts';
import { insertRecipeImage } from '../images/testing.ts';
import { createLogger } from '../logger.ts';
import { ifMatch, insertRecipe } from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

/** Sends a request to `/api/v1` + `path`, as whoever has `cookie`, if anyone. */
function send(
  t: TestApp,
  cookie: string | undefined,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: {
      ...(cookie !== undefined && { cookie }),
      ...(method !== 'GET' && { 'content-type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });
}

/** Gives the recipe a public link, as whoever has `cookie`: its token. */
async function share(t: TestApp, cookie: string, recipeId: string) {
  const res = await send(t, cookie, 'PUT', `/recipes/${recipeId}/public-link`);
  expect(res.status).toBe(200);
  return createdPublicLinkSchema.parse(await res.json()).publicLink.token;
}

/** What opening a public link answers, to someone not signed in: its status. */
async function opened(t: TestApp, token: string) {
  return (await send(t, undefined, 'GET', `/public/recipes/${token}`)).status;
}

/** The recipe's audit events, oldest first, as their action and metadata. */
function auditedFor(t: TestApp, recipeId: string) {
  return t.db
    .select({ action: auditEvent.action, metadata: auditEvent.metadata })
    .from(auditEvent)
    .where(eq(auditEvent.targetId, recipeId))
    .orderBy(asc(auditEvent.id))
    .all();
}

describe('a recipe’s public link', () => {
  it('is given and revoked by its owner or an admin, opens for anyone meanwhile, and is never logged', async () => {
    const logs: string[] = [];
    const t = createTestApp({
      logger: createLogger('info', {
        write(line: string) {
          logs.push(line);
        },
      }),
    });
    const [owner, admin] = await Promise.all([signedInAs(t, 'editor'), signedInAs(t, 'admin')]);
    const id = insertRecipe(t.db, owner.user.id);
    const version = ifMatch(t.db, id);

    const token = await share(t, owner.cookie, id);
    expect(token).toMatch(/^[\w-]{43}$/);
    // The one it has, which the admin sees too. What the recipe says didn't change.
    expect(await share(t, admin.cookie, id)).toBe(token);
    const shown = await send(t, admin.cookie, 'GET', `/recipes/${id}/public-link`);
    expect(recipePublicLinkSchema.parse(await shown.json())).toEqual({ publicLink: { token } });
    expect(ifMatch(t.db, id)).toEqual(version);

    const res = await send(t, undefined, 'GET', `/public/recipes/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { recipe: shared } = (await res.json()) as { recipe: Record<string, unknown> };
    // What it says, and nothing about who wrote it or its version.
    expect(shared.title).toBe('Weeknight Bread');
    for (const kept of ['id', 'owner', 'visibility', 'version', 'revision']) {
      expect(shared).not.toHaveProperty(kept);
    }

    expect((await send(t, owner.cookie, 'DELETE', `/recipes/${id}/public-link`)).status).toBe(204);
    expect(await opened(t, token)).toBe(404);
    const after = await send(t, owner.cookie, 'GET', `/recipes/${id}/public-link`);
    expect(recipePublicLinkSchema.parse(await after.json())).toEqual({ publicLink: null });
    const renewed = await share(t, owner.cookie, id);
    expect(renewed).not.toBe(token);

    const events = auditedFor(t, id);
    expect(events.map(({ action }) => action)).toEqual([
      'public_link.created',
      'public_link.revoked',
      'public_link.created',
    ]);
    for (const secret of [token, renewed]) {
      expect(JSON.stringify(events)).not.toContain(secret);
      expect(logs.join('\n')).not.toContain(secret);
    }
    expect(logs.join('\n')).toContain('"path":"/api/v1/public/recipes/{token}"');
  });

  it('stops once its recipe is made private, and is hidden while it’s in the trash', async () => {
    const t = createTestApp();
    const owner = await signedInAs(t, 'editor');
    const id = insertRecipe(t.db, owner.user.id);
    const setVisibility = (visibility: string) =>
      send(t, owner.cookie, 'PUT', `/recipes/${id}/visibility`, {
        body: { visibility },
        headers: ifMatch(t.db, id),
      });

    const token = await share(t, owner.cookie, id);
    expect((await setVisibility('private')).status).toBe(200);
    expect(await opened(t, token)).toBe(404);
    // A private recipe's title never enters the audit log.
    expect(auditedFor(t, id).at(-1)).toEqual({
      action: 'public_link.revoked',
      metadata: { visibility: 'private', reason: 'made private' },
    });
    // Shared again, it has no link until it's given a new one.
    expect((await setVisibility('shared')).status).toBe(200);
    expect(await opened(t, token)).toBe(404);

    const renewed = await share(t, owner.cookie, id);
    const trash = (method: string, path: string) =>
      send(t, owner.cookie, method, path, { headers: ifMatch(t.db, id) });
    expect((await trash('DELETE', `/recipes/${id}`)).status).toBe(204);
    expect(await opened(t, renewed)).toBe(404);
    expect((await trash('POST', `/trash/${id}/restore`)).status).toBe(200);
    expect(await opened(t, renewed)).toBe(200);
  });

  it('serves the photos its recipe uses as published, and no others', async () => {
    const t = createTestApp();
    const owner = await signedInAs(t, 'editor');
    const id = insertRecipe(t.db, owner.user.id);
    const other = insertRecipe(t.db, owner.user.id);
    const [cover, stepPhoto, older, othersCover] = [
      await insertRecipeImage(t, id),
      await insertRecipeImage(t, id),
      // Its own still, for an older revision, but in no place now.
      await insertRecipeImage(t, id),
      await insertRecipeImage(t, other),
    ];
    for (const [photo, recipeId] of [
      [cover, id],
      [othersCover, other],
    ] as const) {
      t.db.update(image).set({ position: 0 }).where(eq(image.id, photo)).run();
      t.db.update(recipe).set({ coverImageId: photo }).where(eq(recipe.id, recipeId)).run();
    }
    t.db
      .update(recipeStep)
      .set({ imageId: stepPhoto })
      .where(and(eq(recipeStep.recipeId, id), eq(recipeStep.position, 0)))
      .run();
    const token = await share(t, owner.cookie, id);
    const photoStatus = async (photo: string, width = 64) =>
      (await send(t, undefined, 'GET', `/public/recipes/${token}/images/${photo}/${String(width)}`))
        .status;

    const res = await send(t, undefined, 'GET', `/public/recipes/${token}/images/${cover}/64`);
    expect([res.status, res.headers.get('content-type')]).toEqual([200, 'image/webp']);
    expect({
      step: await photoStatus(stepPhoto),
      older: await photoStatus(older),
      someoneElses: await photoStatus(othersCover),
      noSuchSize: await photoStatus(cover, 640),
    }).toEqual({ step: 200, older: 404, someoneElses: 404, noSuchSize: 404 });
  });
});
