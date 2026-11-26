import { API_BASE_PATH, recipeExportSchema } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { auditEvent, image } from '../db/schema.ts';
import { insertRecipeImage } from '../images/testing.ts';
import { createRecipe, loadRecipe, updateRecipe } from '../recipes/recipes.ts';
import { insertRecipe, sampleRecipeContent, sampleRecipeRequest } from '../recipes/testing.ts';
import { findOrCreateTag } from '../tags/tags.ts';
import { createTestApp, signedInAs } from '../testing.ts';
import type { ArchivedRecipe } from './instance.ts';

describe('exporting a recipe', () => {
  it('downloads it as published, in myli’s JSON or as JSON-LD, its tags by name', async () => {
    const t = createTestApp();
    const owner = await signedInAs(t, 'editor');
    const viewer = await signedInAs(t, 'viewer');
    const french = findOrCreateTag(t.db, 'cuisine', 'French').tag;
    const saved = createRecipe(
      t.db,
      owner.user.id,
      sampleRecipeRequest({ title: 'Pain de campagne', tagIds: [french.id] }),
    );
    if (!saved.ok) throw new Error('the recipe could not be saved');
    const download = (format: string) =>
      t.app.request(`${API_BASE_PATH}/recipes/${saved.id}/export?format=${format}`, {
        headers: { cookie: viewer.cookie },
      });

    const json = await download('json');
    expect([json.status, json.headers.get('content-disposition')]).toEqual([
      200,
      'attachment; filename="pain-de-campagne.json"',
    ]);
    const { recipe } = recipeExportSchema.parse(await json.json());
    expect([recipe.title, recipe.tags, recipe.steps[1]]).toEqual([
      'Pain de campagne',
      [{ type: 'cuisine', name: 'French' }],
      { body: 'Bake at **400°F**.' },
    ]);

    const jsonLd = await download('jsonld');
    expect([
      jsonLd.status,
      jsonLd.headers.get('content-type'),
      jsonLd.headers.get('content-disposition'),
    ]).toEqual([200, 'application/ld+json', 'attachment; filename="pain-de-campagne.jsonld"']);
    expect(await jsonLd.json()).toMatchObject({
      '@type': 'Recipe',
      name: 'Pain de campagne',
      recipeCuisine: ['French'],
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Mix everything.' },
        { '@type': 'HowToStep', text: 'Bake at 400°F.' },
      ],
    });
  });
});

describe('exporting the instance', () => {
  it('downloads every recipe the admin may see, with its revisions, tags and photos', async () => {
    const t = createTestApp();
    const admin = await signedInAs(t, 'admin');
    const editor = await signedInAs(t, 'editor');
    findOrCreateTag(t.db, 'diet', 'Vegan');
    const shared = insertRecipe(t.db, editor.user.id);
    const adminsPrivate = insertRecipe(t.db, admin.user.id, 'private');
    const editorsPrivate = insertRecipe(t.db, editor.user.id, 'private');
    const hiddenPhoto = await insertRecipeImage(t, editorsPrivate);
    // The shared recipe shows one photo now, and showed another in its second revision.
    const kept = await insertRecipeImage(t, shared);
    const dropped = await insertRecipeImage(t, shared);
    const publish = (content: Parameters<typeof sampleRecipeContent>[0]) => {
      const version = loadRecipe(t.db, shared)?.version ?? 0;
      const saved = updateRecipe(
        t.db,
        shared,
        sampleRecipeContent(content),
        editor.user.id,
        version,
      );
      if (!saved.ok) throw new Error('the recipe could not be saved');
    };
    const photos = [{ id: kept, alt: 'The crumb' }];
    publish({
      images: photos,
      coverImageId: kept,
      steps: [{ body: 'Mix.', image: { id: dropped, alt: '' } }],
    });
    publish({ images: photos, coverImageId: kept });
    // Its file is gone: the archive goes on without it, and says so.
    const [droppedVariant] =
      t.db.select().from(image).where(eq(image.id, dropped)).get()?.variants ?? [];
    if (droppedVariant) await t.blobs.delete(droppedVariant.key);

    const response = await t.app.request(`${API_BASE_PATH}/export`, {
      headers: { cookie: admin.cookie },
    });
    expect([response.status, response.headers.get('content-type')]).toEqual([
      200,
      'application/zip',
    ]);
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="myli-export-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const read = (name: string): unknown => JSON.parse(new TextDecoder().decode(files[name]));

    expect(Object.keys(files).sort()).toEqual(
      [
        `recipes/${shared}.json`,
        `recipes/${adminsPrivate}.json`,
        `photos/${kept}.webp`,
        'tags.json',
        'manifest.json',
      ].sort(),
    );
    expect(Object.keys(files)).not.toContain(`recipes/${editorsPrivate}.json`);
    expect(Object.keys(files)).not.toContain(`photos/${hiddenPhoto}.webp`);
    const keptBlob = await t.blobs.get(`images/${kept}/64.webp`);
    expect(files[`photos/${kept}.webp`]).toEqual(
      new Uint8Array(Buffer.concat((await keptBlob?.body.toArray()) ?? [])),
    );
    const archived = read(`recipes/${shared}.json`) as ArchivedRecipe;
    expect({
      owner: archived.owner,
      cover: archived.coverPhotoId,
      revisions: archived.revisions.map(({ number, author, steps }) => ({
        number,
        author: author.name,
        stepPhotos: steps.map(({ photo }) => photo?.id ?? null),
      })),
    }).toEqual({
      owner: { name: editor.user.name },
      cover: kept,
      revisions: [
        { number: 1, author: editor.user.name, stepPhotos: [null, null] },
        { number: 2, author: editor.user.name, stepPhotos: [dropped] },
        { number: 3, author: editor.user.name, stepPhotos: [null, null] },
      ],
    });
    expect([read('tags.json'), read('manifest.json')]).toEqual([
      expect.arrayContaining([{ type: 'diet', name: 'Vegan' }]),
      expect.objectContaining({ recipes: 2, photos: 1, missingPhotos: [dropped] }),
    ]);
    expect(
      t.db
        .select({ actorId: auditEvent.actorId, metadata: auditEvent.metadata })
        .from(auditEvent)
        .where(eq(auditEvent.action, 'instance.exported'))
        .all(),
    ).toEqual([{ actorId: admin.user.id, metadata: { recipes: 2, photos: 2 } }]);
  });
});
