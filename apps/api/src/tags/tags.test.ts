import { ALLERGENS, tagListSchema, tagResultSchema, validationProblemSchema } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { tag } from '../db/schema.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

function send(t: TestApp, method: string, path: string, cookie?: string, body?: unknown) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: {
      ...(method !== 'GET' && { 'content-type': 'application/json' }),
      ...(cookie !== undefined && { cookie }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function tagNames(t: TestApp, cookie: string, query = '') {
  const res = await send(t, 'GET', `/tags${query}`, cookie);
  expect(res.status).toBe(200);
  return tagListSchema.parse(await res.json()).tags.map(({ type, name }) => `${type}:${name}`);
}

async function setUp() {
  const t = createTestApp();
  return { t, ...(await signedInAs(t, 'editor')) };
}

const create = (t: TestApp, cookie: string, type: string, name: string) =>
  send(t, 'POST', '/tags', cookie, { type, name });

describe('GET /tags', () => {
  it('lists the allergens on a new instance, by name', async () => {
    const { t, cookie } = await setUp();
    expect(await tagNames(t, cookie)).toEqual(
      [...ALLERGENS].sort().map((name) => `allergen:${name}`),
    );
  });

  it('lists every tag by type and then name, or the tags of one type', async () => {
    const { t, cookie } = await setUp();
    t.db
      .insert(tag)
      .values([
        { type: 'custom', name: 'Weeknight', nameKey: 'weeknight' },
        { type: 'cuisine', name: 'thai', nameKey: 'thai' },
        { type: 'cuisine', name: 'Italian', nameKey: 'italian' },
        { type: 'diet', name: 'Vegan', nameKey: 'vegan' },
        { type: 'meal_type', name: 'Breakfast', nameKey: 'breakfast' },
      ])
      .run();

    const names = await tagNames(t, cookie);
    expect(names.slice(0, 4)).toEqual([
      'cuisine:Italian',
      'cuisine:thai',
      'meal_type:Breakfast',
      'diet:Vegan',
    ]);
    expect(names.at(-1)).toBe('custom:Weeknight');
    expect(await tagNames(t, cookie, '?type=cuisine')).toEqual(['cuisine:Italian', 'cuisine:thai']);
  });
});

describe('POST /tags', () => {
  it('creates a tag, with its spacing tidied', async () => {
    const { t, cookie } = await setUp();
    const res = await create(t, cookie, 'cuisine', '  Middle   Eastern ');

    expect(res.status).toBe(201);
    const { tag: created } = tagResultSchema.parse(await res.json());
    expect(created).toEqual({ id: expect.any(Number), type: 'cuisine', name: 'Middle Eastern' });
    expect(await tagNames(t, cookie, '?type=cuisine')).toEqual(['cuisine:Middle Eastern']);
  });

  it('returns the tag that already has the name, ignoring case, instead of a second one', async () => {
    const { t, cookie } = await setUp();
    const first = tagResultSchema.parse(
      await (await create(t, cookie, 'cuisine', 'Italian')).json(),
    );

    const again = await create(t, cookie, 'cuisine', 'ITALIAN');
    expect(again.status).toBe(200);
    expect(tagResultSchema.parse(await again.json())).toEqual(first);
    expect(await tagNames(t, cookie, '?type=cuisine')).toEqual(['cuisine:Italian']);
  });

  it('creates the same name in another type as another tag', async () => {
    const { t, cookie } = await setUp();
    await create(t, cookie, 'cuisine', 'Italian');
    expect((await create(t, cookie, 'custom', 'Italian')).status).toBe(201);
  });

  it('refuses an allergen: the instance has the only ones', async () => {
    const { t, cookie } = await setUp();
    const res = await create(t, cookie, 'allergen', 'mustard');
    expect(res.status).toBe(422);
    const { errors } = validationProblemSchema.parse(await res.json());
    expect(errors.map((error) => error.pointer)).toEqual(['#/type']);
    expect(await tagNames(t, cookie)).toHaveLength(ALLERGENS.length);
  });
});
