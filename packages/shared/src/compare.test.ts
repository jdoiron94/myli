import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareRecipes,
  diffList,
  diffText,
  type ListEntry,
  type RecipeComparison,
} from './compare.ts';
import type { Image } from './image.ts';
import type { RecipeRevisionContent } from './revision.ts';

const beforeOf = <T>(entries: ListEntry<T>[]) =>
  entries.flatMap((entry) => {
    if (entry.change === 'changed') return [entry.before];
    return entry.change === 'added' ? [] : [entry.item];
  });
const afterOf = <T>(entries: ListEntry<T>[]) =>
  entries.flatMap((entry) => {
    if (entry.change === 'changed') return [entry.after];
    return entry.change === 'removed' ? [] : [entry.item];
  });

const photo = (id: string, alt: string): Image => ({
  id,
  alt,
  width: 1600,
  height: 1200,
  variants: [],
});
const line = (rawText: string) => ({
  rawText,
  qty: null,
  qtyMax: null,
  unit: null,
  name: rawText,
  normalizedName: rawText,
  note: null,
  scalable: false,
});

const bread: RecipeRevisionContent = {
  title: 'Bread',
  description: 'A *simple* loaf.',
  source: { url: null, title: null, author: null },
  equipment: ['Loaf pan'],
  yield: null,
  servings: 8,
  prepMinutes: 20,
  cookMinutes: 40,
  totalMinutes: null,
  difficulty: 'easy',
  nutrition: {
    calories: 200,
    proteinGrams: null,
    carbsGrams: null,
    fatGrams: null,
    fiberGrams: null,
    sugarGrams: null,
    sodiumMilligrams: null,
  },
  ingredientGroups: [
    { label: null, ingredients: [line('3 cups flour'), line('1 tsp salt')] },
    { label: 'Topping', ingredients: [line('1 egg')] },
  ],
  steps: [
    { body: 'Mix.', image: null },
    { body: 'Bake.', image: photo('p2', 'In the oven') },
  ],
  tags: [{ id: 1, type: 'cuisine', name: 'American' }],
  images: [photo('p1', 'The loaf'), photo('p2', 'In the oven')],
  coverImageId: 'p1',
};

/** A comparison in short: each list's entries as `= same`, `+ added`, `- removed`, `~ was → is`. */
function summary(comparison: RecipeComparison) {
  const entries = <T>(list: ListEntry<T>[] | null, text: (item: T) => string) =>
    list?.map((entry) =>
      entry.change === 'changed'
        ? `~ ${text(entry.before)} → ${text(entry.after)}`
        : `${{ same: '=', added: '+', removed: '-' }[entry.change]} ${text(entry.item)}`,
    );
  return Object.fromEntries(
    Object.entries({
      details: comparison.details.length > 0 ? comparison.details : undefined,
      description: comparison.description ? 'changed' : undefined,
      tags: entries(comparison.tags, ({ name }) => name),
      photos: entries(comparison.photos, ({ id, alt }) => `${id} ${alt}`),
      ingredients: entries(comparison.ingredients, ({ kind, text }) =>
        kind === 'group' ? `# ${text}` : text,
      ),
      equipment: entries(comparison.equipment, (item) => item),
      steps: entries(comparison.steps, ({ body, image }) =>
        image ? `${body} (${image.id})` : body,
      ),
      nutrition: comparison.nutrition.length > 0 ? comparison.nutrition : undefined,
    }).filter(([, value]) => value !== undefined),
  );
}

describe('comparing two versions', () => {
  it('keeps every entry of both lists, each in its order, pairing only what may pair', () => {
    const lists = fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 8 });
    fc.assert(
      fc.property(lists, lists, fc.func(fc.boolean()), (before, after, pairable) => {
        const entries = diffList(before, after, { same: Object.is, pairable });
        expect([beforeOf(entries), afterOf(entries)]).toEqual([before, after]);
        for (const entry of entries) {
          if (entry.change === 'changed') expect(pairable(entry.before, entry.after)).toBe(true);
        }
      }),
    );
  });

  it('keeps all of both texts, whitespace included', () => {
    const texts = fc
      .array(fc.constantFrom('flour', 'salt', ' ', '\n', '**', '400°F'), { maxLength: 10 })
      .map((words) => words.join(''));
    fc.assert(
      fc.property(texts, texts, (before, after) => {
        const parts = diffText(before, after);
        const without = (change: string) =>
          parts
            .filter((part) => part.change !== change)
            .map(({ text }) => text)
            .join('');
        expect([without('added'), without('removed')]).toEqual([before, after]);
      }),
    );
  });

  it('says what changed between two versions of a recipe, part by part', () => {
    const [flour, salt] = bread.ingredientGroups[0]?.ingredients ?? [];
    const changes: Record<string, Partial<RecipeRevisionContent>> = {
      'nothing changed': {},
      'a tag renamed in between': { tags: [{ id: 1, type: 'cuisine', name: 'Southern' }] },
      'one tag for another': { tags: [{ id: 2, type: 'cuisine', name: 'Italian' }] },
      'an ingredient edited where it was': {
        ingredientGroups: [
          { label: null, ingredients: [line('2 cups flour'), ...(salt ? [salt] : [])] },
          { label: 'Topping', ingredients: [line('1 egg')] },
        ],
      },
      'a group’s label where an ingredient was': {
        ingredientGroups: [
          { label: null, ingredients: flour ? [flour] : [] },
          { label: 'Dough', ingredients: [] },
          { label: 'Topping', ingredients: [line('1 egg')] },
        ],
      },
      'a photo’s alt text': { images: [photo('p1', 'The whole loaf'), photo('p2', 'In the oven')] },
      'another photo where one was, as the cover': {
        images: [photo('p3', 'Sliced'), photo('p2', 'In the oven')],
        coverImageId: 'p3',
      },
      'only a step’s photo': {
        steps: [
          { body: 'Mix.', image: null },
          { body: 'Bake.', image: null },
        ],
      },
      'details, the description and nutrition': {
        title: 'Plain Bread',
        description: 'A simple loaf.',
        totalMinutes: 90,
        nutrition: { ...bread.nutrition, calories: 210 },
      },
    };

    expect(
      Object.fromEntries(
        Object.entries(changes).map(([name, change]) => [
          name,
          summary(compareRecipes(bread, { ...bread, ...change })),
        ]),
      ),
    ).toEqual({
      'nothing changed': {},
      'a tag renamed in between': {},
      'one tag for another': { tags: ['+ Italian', '- American'] },
      'an ingredient edited where it was': {
        ingredients: ['~ 3 cups flour → 2 cups flour', '= 1 tsp salt', '= # Topping', '= 1 egg'],
      },
      'a group’s label where an ingredient was': {
        ingredients: ['= 3 cups flour', '- 1 tsp salt', '+ # Dough', '= # Topping', '= 1 egg'],
      },
      'a photo’s alt text': { photos: ['~ p1 The loaf → p1 The whole loaf', '= p2 In the oven'] },
      'another photo where one was, as the cover': {
        details: ['coverImageId'],
        photos: ['- p1 The loaf', '+ p3 Sliced', '= p2 In the oven'],
      },
      'only a step’s photo': { steps: ['= Mix.', '~ Bake. (p2) → Bake.'] },
      'details, the description and nutrition': {
        details: ['title', 'totalMinutes'],
        description: 'changed',
        nutrition: ['calories'],
      },
    });
  });
});
