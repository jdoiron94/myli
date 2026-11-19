import { describe, expect, it } from 'vitest';
import { type CreateRecipeRequest, createRecipeRequestSchema } from './recipe.ts';

/** A recipe with nothing but a title and servings, with what a case changes. */
function recipe(changes: Partial<Record<keyof CreateRecipeRequest, unknown>> = {}) {
  return {
    title: 'Bread',
    description: '',
    source: { url: null, title: null, author: null },
    equipment: [],
    yield: null,
    servings: 4,
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    difficulty: null,
    nutrition: {
      calories: null,
      proteinGrams: null,
      carbsGrams: null,
      fatGrams: null,
      fiberGrams: null,
      sugarGrams: null,
      sodiumMilligrams: null,
    },
    ingredientGroups: [],
    steps: [],
    images: [],
    coverImageId: null,
    tagIds: [],
    visibility: 'shared',
    ...changes,
  };
}

/** Each problem the schema finds, by the path of its field. */
function problems(request: unknown) {
  const issues = createRecipeRequestSchema.safeParse(request).error?.issues ?? [];
  return Object.fromEntries(issues.map(({ path, message }) => [path.join('.'), message]));
}

const line = (qty: number | null, qtyMax: number | null) => ({
  rawText: 'flour',
  qty,
  qtyMax,
  unit: null,
  name: 'flour',
  note: null,
  scalable: true,
});
const group = (lines: number) => ({
  label: null,
  ingredients: Array.from({ length: lines }, () => line(1, null)),
});
const photo = (id: string) => ({ id, alt: '' });
const step = (id: string) => ({ body: 'Bake.', image: photo(id) });

describe('a recipe request', () => {
  it('needs nothing but a title and servings', () => {
    expect(problems(recipe())).toEqual({});
  });

  it('refuses what doesn’t hang together, at the field where it doesn’t', () => {
    const cases = {
      'a range that goes down': recipe({
        ingredientGroups: [{ label: null, ingredients: [line(3, 2)] }],
      }),
      'over 200 ingredients across the groups': recipe({
        ingredientGroups: [group(101), group(100)],
      }),
      'a source that isn’t a web address': recipe({
        source: { url: 'javascript:alert(1)', title: null, author: null },
      }),
      'the same tag twice': recipe({ tagIds: [1, 1] }),
      'a cover that isn’t one of its photos': recipe({ images: [photo('a')], coverImageId: 'b' }),
      'photos without a cover': recipe({ images: [photo('a')] }),
      'a cover without photos': recipe({ coverImageId: 'a' }),
      'the same photo twice': recipe({ images: [photo('a'), photo('a')], coverImageId: 'a' }),
      'a step’s photo that’s also the recipe’s': recipe({
        images: [photo('a')],
        coverImageId: 'a',
        steps: [step('a')],
      }),
      'two steps with the same photo': recipe({ steps: [step('a'), step('a')] }),
    };
    const once = 'Each photo can be used once.';

    expect(
      Object.fromEntries(Object.entries(cases).map(([name, r]) => [name, problems(r)])),
    ).toEqual({
      'a range that goes down': {
        'ingredientGroups.0.ingredients.0.qtyMax':
          'The top of a range must be more than its bottom.',
      },
      'over 200 ingredients across the groups': {
        ingredientGroups: 'A recipe can have up to 200 ingredients.',
      },
      'a source that isn’t a web address': {
        'source.url': 'Enter a web address starting with http or https.',
      },
      'the same tag twice': { tagIds: 'Each tag can be added once.' },
      'a cover that isn’t one of its photos': {
        coverImageId: 'Choose one of its photos as the cover.',
      },
      'photos without a cover': { coverImageId: 'Choose one of its photos as the cover.' },
      'a cover without photos': { coverImageId: 'It has no photos.' },
      'the same photo twice': { 'images.1.id': once },
      'a step’s photo that’s also the recipe’s': { 'steps.0.image.id': once },
      'two steps with the same photo': { 'steps.1.image.id': once },
    });
  });
});
