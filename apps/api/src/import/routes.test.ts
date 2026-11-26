import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { API_BASE_PATH, importRecipeResultSchema, validationProblemSchema } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { image, job, recipe } from '../db/schema.ts';
import { testImage } from '../images/testing.ts';
import { fetchPublic, type Outbound } from '../outbound/fetch.ts';
import { findOrCreateTag } from '../tags/tags.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { IMPORT_DETAIL } from './import.ts';

/** A recipe site, on the loopback address: each path's content type and body. */
const pages = new Map<string, [string, string | Buffer]>();
let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const found = pages.get(request.url ?? '');
    if (!found) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': found[0] }).end(found[1]);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** The real fetcher, which lets the test site through as if it were a public one. */
const outbound: Outbound = (url, options) =>
  fetchPublic(url, { ...options, isAllowed: (address) => address === '127.0.0.1' });

const recipePage = (data: object) =>
  `<html><script type="application/ld+json">${JSON.stringify(data)}</script></html>`;

const importing = (t: TestApp, cookie: string, url: string) =>
  t.app.request(`${API_BASE_PATH}/recipes/import`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });

describe('importing a recipe from a link', () => {
  it('fills in a new recipe from the page, with its photo as the importer’s upload and the tags that exist', async () => {
    const t = createTestApp({ outbound });
    const { user, cookie } = await signedInAs(t, 'editor');
    const french = findOrCreateTag(t.db, 'cuisine', 'French').tag;
    const glutenFree = findOrCreateTag(t.db, 'diet', 'Gluten-free').tag;
    findOrCreateTag(t.db, 'cuisine', 'Italian');
    pages.set('/bread.jpg', ['image/jpeg', await testImage(800, 600)]);
    pages.set('/bread', [
      'text/html; charset=utf-8',
      recipePage({
        '@type': 'Recipe',
        name: 'Weeknight Bread',
        recipeYield: '8',
        recipeIngredient: ['500 g bread flour'],
        recipeInstructions: 'Mix.\nBake.',
        image: '/bread.jpg',
        // "Mediterranean" and "Bread" are tags no one has made, so they're left out.
        recipeCuisine: 'French, Mediterranean',
        recipeCategory: 'Bread',
        suitableForDiet: 'https://schema.org/GlutenFreeDiet',
      }),
    ]);

    const res = await importing(t, cookie, `${origin}/bread`);
    expect(res.status).toBe(200);
    const { recipe: imported, images } = importRecipeResultSchema.parse(await res.json());
    const photoId = images[0]?.id ?? '';
    expect(imported).toMatchObject({
      title: 'Weeknight Bread',
      servings: 8,
      source: { url: `${origin}/bread`, title: '127.0.0.1' },
      steps: [
        { body: 'Mix.', image: null },
        { body: 'Bake.', image: null },
      ],
      tagIds: [french.id, glutenFree.id],
      images: [{ id: photoId, alt: '' }],
      coverImageId: photoId,
    });
    // Saved as the editor's upload, which goes after a day unless a recipe is saved with it.
    expect(t.db.select().from(image).where(eq(image.id, photoId)).get()).toMatchObject({
      uploaderId: user.id,
      recipeId: null,
    });
    expect(
      t.db
        .select({ type: job.type })
        .from(job)
        .all()
        .map(({ type }) => type),
    ).toContain('images.discard-unsaved');
    expect(t.db.select().from(recipe).all()).toEqual([]);

    // A photo that can't be fetched leaves the recipe without one.
    pages.set('/soup', [
      'text/html',
      recipePage({ '@type': 'Recipe', name: 'Soup', image: '/gone.jpg' }),
    ]);
    const withoutPhoto = importRecipeResultSchema.parse(
      await (await importing(t, cookie, `${origin}/soup`)).json(),
    );
    expect([
      withoutPhoto.recipe.images,
      withoutPhoto.recipe.coverImageId,
      withoutPhoto.images,
    ]).toEqual([[], null, []]);
  });

  it('says at the address why a page can’t be imported', async () => {
    const t = createTestApp({ outbound });
    const { cookie } = await signedInAs(t, 'editor');
    pages.set('/article', ['text/html', recipePage({ '@type': 'Article', headline: 'News' })]);
    const urls = {
      ftp: 'ftp://recipes.example.com/bread',
      private: 'http://10.0.0.1/bread',
      missing: `${origin}/missing`,
      article: `${origin}/article`,
    };
    const details = await Promise.all(
      Object.entries(urls).map(async ([name, url]) => {
        const res = await importing(t, cookie, url);
        const { errors } = validationProblemSchema.parse(await res.json());
        return [name, [res.status, errors.map(({ pointer, detail }) => `${pointer}: ${detail}`)]];
      }),
    );
    expect(Object.fromEntries(details)).toEqual({
      ftp: [422, ['#/url: Enter a web address starting with http or https.']],
      private: [422, [`#/url: ${IMPORT_DETAIL.notPublic}`]],
      missing: [422, [`#/url: ${IMPORT_DETAIL.unreachable}`]],
      article: [422, [`#/url: ${IMPORT_DETAIL.noRecipe}`]],
    });
  });
});
