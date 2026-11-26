import { API_BASE_PATH, recipeExportSchema } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { createRecipe } from '../recipes/recipes.ts';
import { sampleRecipeRequest } from '../recipes/testing.ts';
import { findOrCreateTag } from '../tags/tags.ts';
import { createTestApp, signedInAs } from '../testing.ts';

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
