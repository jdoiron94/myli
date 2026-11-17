import { RECIPE_LIMITS } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { formSchema } from '@/lib/forms.ts';
import {
  RECIPE_FORM_FIELDS,
  type RecipeFormValues,
  recipeFormSchema,
  recipeFormValues,
} from './recipe-form.ts';
import { sampleRecipe } from './testing.ts';

/** A new recipe's form with a title and servings, the two fields it needs, and `changes`. */
function filledIn(changes: (values: RecipeFormValues) => void = () => undefined) {
  const values = recipeFormValues();
  values.title = 'Weeknight Bread';
  values.servings = '8';
  changes(values);
  return values;
}

/** What the form submits, as VeeValidate gets it, or its errors by field. */
async function submitted(values: RecipeFormValues) {
  const { value, errors } = await formSchema(recipeFormSchema).parse(values);
  return { value, errors: Object.fromEntries(errors.map(({ path, errors }) => [path, errors])) };
}

const errorsFor = async (changes: (values: RecipeFormValues) => void) =>
  (await submitted(filledIn(changes))).errors;

describe('the recipe form', () => {
  it('needs only a title and servings, and leaves everything else unset', async () => {
    const { value, errors } = await submitted(filledIn());

    expect(errors).toEqual({});
    expect(value).toEqual({
      content: {
        title: 'Weeknight Bread',
        description: '',
        source: { url: null, title: '', author: '' },
        equipment: [],
        yield: null,
        servings: 8,
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
        tagIds: [],
      },
      visibility: 'private',
    });
  });

  it('says what an empty form is missing', async () => {
    const { errors } = await submitted(recipeFormValues());

    expect(errors).toEqual({
      title: ['Give the recipe a title.'],
      servings: ['Enter a whole number of servings.'],
    });
  });

  it('reads numbers as typed, with spaces around them', async () => {
    const { value } = await submitted(
      filledIn((values) => {
        values.servings = ' 12 ';
        values.prepMinutes = '20';
        values.nutrition.fatGrams = '2.5';
      }),
    );

    expect(value?.content).toMatchObject({
      servings: 12,
      prepMinutes: 20,
      nutrition: { fatGrams: 2.5 },
    });
  });

  it.each([
    ['servings', 'four', 'Enter a whole number of servings.'],
    ['servings', '2.5', 'Enter a whole number of servings.'],
    ['servings', '0', 'A recipe serves at least 1.'],
    ['servings', '1001', 'A recipe serves at most 1,000.'],
    ['prepMinutes', '1.5', 'Enter a whole number of minutes.'],
    ['cookMinutes', '-5', 'Enter 0 or more minutes.'],
    ['totalMinutes', '100001', 'Enter up to 100,000 minutes.'],
  ] as const)('refuses %s of %j', async (field, typed, message) => {
    expect(
      await errorsFor((values) => {
        values[field] = typed;
      }),
    ).toEqual({ [field]: [message] });
  });

  it.each([
    ['abc', 'Enter a number.'],
    ['1,5', 'Enter a number.'],
    ['-1', 'Enter 0 or more.'],
    ['100001', 'Enter up to 100,000.'],
  ])('refuses nutrition of %j', async (typed, message) => {
    expect(
      await errorsFor((values) => {
        values.nutrition.calories = typed;
      }),
    ).toEqual({ 'nutrition.calories': [message] });
  });

  describe('yield', () => {
    it('is how many and of what, the unit optional', async () => {
      const yieldOf = async (qty: string, unit: string) =>
        (
          await submitted(
            filledIn((values) => {
              values.yield = { qty, unit };
            }),
          )
        ).value?.content.yield;

      expect(await yieldOf('24', ' cookies ')).toEqual({ qty: 24, unit: 'cookies' });
      expect(await yieldOf('1', '')).toEqual({ qty: 1, unit: '' });
      expect(await yieldOf(' ', ' ')).toBeNull();
    });

    it('needs how many when it says of what', async () => {
      expect(
        await errorsFor((values) => {
          values.yield = { qty: '', unit: 'cookies' };
        }),
      ).toEqual({ 'yield.qty': ['Enter how many it makes, or leave both empty.'] });
    });

    it('refuses none', async () => {
      expect(
        await errorsFor((values) => {
          values.yield = { qty: '0', unit: 'cookies' };
        }),
      ).toEqual({ 'yield.qty': ['Enter a number above 0.'] });
    });
  });

  describe('equipment', () => {
    it('is a piece per line, without blank lines or spaces around', async () => {
      const { value } = await submitted(
        filledIn((values) => {
          values.equipment = '  Loaf pan \n\n\nStand mixer\n';
        }),
      );

      expect(value?.content.equipment).toEqual(['Loaf pan', 'Stand mixer']);
    });

    it('refuses too many pieces, or too long a line, on the whole box', async () => {
      const lines = (count: number) => Array.from({ length: count }, (_, i) => `Pan ${String(i)}`);

      expect(
        await errorsFor((values) => {
          values.equipment = lines(RECIPE_LIMITS.equipment + 1).join('\n');
        }),
      ).toEqual({ equipment: ['List up to 50 pieces of equipment.'] });
      expect(
        await errorsFor((values) => {
          values.equipment = `Pan\n${'x'.repeat(RECIPE_LIMITS.equipmentItem + 1)}`;
        }),
      ).toEqual({ equipment: ['Keep each line to 100 characters.'] });
      expect(
        await errorsFor((values) => {
          values.equipment = lines(RECIPE_LIMITS.equipment).join('\n');
        }),
      ).toEqual({});
    });
  });

  it('takes a source address only on the web', async () => {
    expect(
      await errorsFor((values) => {
        values.source.url = 'ftp://example.com/bread';
      }),
    ).toEqual({ 'source.url': ['Enter a web address starting with http or https.'] });
    expect(
      (
        await submitted(
          filledIn((values) => {
            values.source.url = ' https://example.com/bread ';
          }),
        )
      ).value?.content.source.url,
    ).toBe('https://example.com/bread');
  });

  it('says how long text can be', async () => {
    expect(
      await errorsFor((values) => {
        values.title = 'x'.repeat(RECIPE_LIMITS.title + 1);
        values.source.author = 'x'.repeat(RECIPE_LIMITS.sourceText + 1);
      }),
    ).toEqual({
      title: ['Keep it to 200 characters.'],
      'source.author': ['Keep it to 200 characters.'],
    });
  });

  it('gives back the recipe it was filled in from, unchanged', async () => {
    const recipe = sampleRecipe({ difficulty: null, yield: null, tags: [] });
    const withTags = sampleRecipe({
      tags: [
        { id: 3, type: 'cuisine', name: 'Italian' },
        { id: 7, type: 'allergen', name: 'wheat' },
      ],
    });

    const { value } = await submitted(recipeFormValues(recipe));
    expect(value).toEqual({
      content: {
        title: recipe.title,
        description: recipe.description,
        source: recipe.source,
        equipment: recipe.equipment,
        yield: null,
        servings: recipe.servings,
        prepMinutes: recipe.prepMinutes,
        cookMinutes: recipe.cookMinutes,
        totalMinutes: recipe.totalMinutes,
        difficulty: null,
        nutrition: recipe.nutrition,
        ingredientGroups: recipe.ingredientGroups.map(({ label, ingredients }) => ({
          label,
          ingredients: ingredients.map(({ rawText, qty, qtyMax, unit, name, note, scalable }) => ({
            rawText,
            qty,
            qtyMax,
            unit,
            name,
            note,
            scalable,
          })),
        })),
        steps: recipe.steps,
        tagIds: [],
      },
      visibility: 'shared',
    });
    expect((await submitted(recipeFormValues(withTags))).value?.content.tagIds).toEqual([3, 7]);
    expect((await submitted(recipeFormValues(sampleRecipe()))).value?.content).toMatchObject({
      yield: { qty: 1, unit: 'loaf' },
      difficulty: 'easy',
    });
  });

  it('names every field it has, so the API’s errors can find them', () => {
    /** The path of every text field in the form's values. */
    const textFields = (values: object, prefix = ''): string[] =>
      Object.entries(values).flatMap(([key, value]) => {
        if (typeof value === 'string') return [`${prefix}${key}`];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          return textFields(value, `${prefix}${key}.`);
        }
        return [];
      });

    expect([...RECIPE_FORM_FIELDS].sort()).toEqual(
      textFields(recipeFormValues())
        .filter((field) => field !== 'description')
        .sort(),
    );
  });
});
