import { parseQuantity, RECIPE_LIMITS } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { formSchema } from '@/lib/forms.ts';
import type { IngredientLine } from './recipe.ts';
import {
  type IngredientGroupValues,
  type LineDetails,
  quantityText,
  RECIPE_FORM_FIELDS,
  RECIPE_TEXT_FIELDS,
  type RecipeFormValues,
  recipeFormSchema,
  recipeFormValues,
} from './recipe-form.ts';
import { sampleImage, sampleRecipe } from './testing.ts';

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
        imageIds: [],
        coverImageId: null,
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

  describe('steps', () => {
    const steps = (...bodies: string[]) => bodies.map((body) => ({ body, imageId: null }));

    it('starts with a blank step to write in, for a new recipe or one without steps', () => {
      expect(recipeFormValues().steps).toEqual(steps(''));
      expect(recipeFormValues(sampleRecipe({ steps: [] })).steps).toEqual(steps(''));
    });

    it('is the steps in order, without blank ones or spaces around', async () => {
      const { value } = await submitted(
        filledIn((values) => {
          values.steps = steps('', ' Mix **well**. ', ' \n ', 'Bake.\nCool.');
        }),
      );

      expect(value?.content.steps).toEqual(steps('Mix **well**.', 'Bake.\nCool.'));
    });

    it('keeps a step with a photo but no words, to say it needs them', async () => {
      expect(
        await errorsFor((values) => {
          values.steps = [{ body: ' ', imageId: 'photo' }, ...steps('')];
        }),
      ).toEqual({ 'steps[0].body': ['Write the step.'] });
    });

    it('says what’s wrong with a step, on that step, wherever blank steps are', async () => {
      expect(
        await errorsFor((values) => {
          values.steps = steps('', 'Mix.', 'x'.repeat(RECIPE_LIMITS.stepBody + 1));
        }),
      ).toEqual({ 'steps[2].body': ['Keep it to 10000 characters.'] });
    });

    it(`allows up to ${String(RECIPE_LIMITS.steps)} steps`, async () => {
      const many = Array.from(
        { length: RECIPE_LIMITS.steps + 1 },
        (_, index) => `Step ${String(index)}`,
      );

      expect(
        await errorsFor((values) => {
          values.steps = steps(...many);
        }),
      ).toEqual({ steps: ['A recipe can have up to 100 steps.'] });
      expect(
        await errorsFor((values) => {
          values.steps = steps(...many.slice(1), '');
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
        steps: recipe.steps.map(({ body }) => ({ body, imageId: null })),
        tagIds: [],
        imageIds: [],
        coverImageId: null,
      },
      visibility: 'shared',
    });
    expect((await submitted(recipeFormValues(withTags))).value?.content.tagIds).toEqual([3, 7]);
    const withPhotos = sampleRecipe({
      images: [sampleImage('a'), sampleImage('b')],
      coverImageId: 'b',
      steps: [
        { body: 'Mix.', image: null },
        { body: 'Shape.', image: sampleImage('c') },
      ],
    });
    expect((await submitted(recipeFormValues(withPhotos))).value?.content).toMatchObject({
      imageIds: ['a', 'b'],
      coverImageId: 'b',
      steps: [
        { body: 'Mix.', imageId: null },
        { body: 'Shape.', imageId: 'c' },
      ],
    });
    expect((await submitted(recipeFormValues(sampleRecipe()))).value?.content).toMatchObject({
      yield: { qty: 1, unit: 'loaf' },
      difficulty: 'easy',
    });
  });

  describe('ingredients', () => {
    /** Groups of lines the parser reads, each written as `[label, lines]`. */
    const groups = (...written: [string, string[]][]): IngredientGroupValues[] =>
      written.map(([label, lines]) => ({
        label,
        ingredients: lines.map((rawText) => ({ rawText, details: null })),
      }));
    const withIngredients = (ingredientGroups: IngredientGroupValues[]) =>
      filledIn((values) => {
        values.ingredientGroups = ingredientGroups;
      });

    it('reads each line as the parser does, leaving out blank lines and empty groups', async () => {
      const { value, errors } = await submitted(
        withIngredients(groups(['', ['2 cups flour, sifted', ' ', 'salt to taste', '']], ['', []])),
      );

      expect(errors).toEqual({});
      expect(value?.content.ingredientGroups).toEqual([
        {
          label: null,
          ingredients: [
            {
              rawText: '2 cups flour, sifted',
              qty: 2,
              qtyMax: null,
              unit: 'cup',
              name: 'flour',
              note: 'sifted',
              scalable: true,
            },
            {
              rawText: 'salt to taste',
              qty: null,
              qtyMax: null,
              unit: null,
              name: 'salt',
              note: 'to taste',
              scalable: false,
            },
          ],
        },
      ]);
    });

    it('has none when nothing was typed', async () => {
      const { value } = await submitted(filledIn());

      expect(value?.content.ingredientGroups).toEqual([]);
    });

    it('keeps each group’s name', async () => {
      const { value } = await submitted(
        withIngredients(groups([' For the dough ', ['flour']], ['For the filling', ['jam']])),
      );

      expect(value?.content.ingredientGroups.map((group) => group.label)).toEqual([
        'For the dough',
        'For the filling',
      ]);
    });

    it('says when a line names no ingredient, on that line, wherever blank lines are', async () => {
      expect(
        await errorsFor((values) => {
          values.ingredientGroups = groups(['', ['flour']], ['', ['', '2 cups']]);
        }),
      ).toEqual({
        'ingredientGroups[1].ingredients[1].rawText': [
          "Name the ingredient: myli can't find a name in this line.",
        ],
      });
    });

    it('needs a line in a group that has a name', async () => {
      expect(
        await errorsFor((values) => {
          values.ingredientGroups = groups(['For the dough', ['flour']], ['For the filling', ['']]);
        }),
      ).toEqual({
        'ingredientGroups[1].ingredients': ['Add an ingredient to the group, or remove the group.'],
      });
    });

    it('says how long a line can be', async () => {
      expect(
        await errorsFor((values) => {
          values.ingredientGroups = groups(['', [`2 cups ${'flour '.repeat(100)}`]]);
        }),
      ).toEqual({ 'ingredientGroups[0].ingredients[0].rawText': ['Keep it to 500 characters.'] });
      expect(
        await errorsFor((values) => {
          values.ingredientGroups = groups(['', [`2 cups ${'x'.repeat(201)}`]]);
        }),
      ).toEqual({
        'ingredientGroups[0].ingredients[0].rawText': [
          "Keep the ingredient's name to 200 characters.",
        ],
      });
    });

    it(`allows up to ${String(RECIPE_LIMITS.ingredients)} ingredients in all`, async () => {
      const lines = (count: number) => Array.from({ length: count }, () => '1 egg');

      expect(
        await errorsFor((values) => {
          values.ingredientGroups = groups(['', lines(150)], ['', lines(51)]);
        }),
      ).toEqual({ ingredientGroups: ['A recipe can have up to 200 ingredients.'] });
      expect(
        await errorsFor((values) => {
          values.ingredientGroups = groups(['', lines(150)], ['', lines(50)]);
        }),
      ).toEqual({});
    });

    describe('a line corrected by hand', () => {
      const corrected = (details: Partial<LineDetails>) =>
        withIngredients([
          {
            label: '',
            ingredients: [
              {
                rawText: 'a few sprigs of thyme',
                details: {
                  qty: '3',
                  qtyMax: '',
                  unit: 'sprig',
                  name: 'thyme',
                  note: '',
                  scalable: true,
                  ...details,
                },
              },
            ],
          },
        ]);

      it('is read as corrected, keeping what was typed', async () => {
        const { value } = await submitted(corrected({ qty: '1½', qtyMax: ' 2 ', note: ' fresh ' }));

        expect(value?.content.ingredientGroups[0]?.ingredients).toEqual([
          {
            rawText: 'a few sprigs of thyme',
            qty: 1.5,
            qtyMax: 2,
            unit: 'sprig',
            name: 'thyme',
            note: 'fresh',
            scalable: true,
          },
        ]);
      });

      it('may have no amount, unit or note', async () => {
        const { value } = await submitted(
          corrected({ qty: '', unit: ' ', note: '  ', scalable: false }),
        );

        expect(value?.content.ingredientGroups[0]?.ingredients[0]).toMatchObject({
          qty: null,
          unit: null,
          note: null,
          scalable: false,
        });
      });

      it.each([
        [{ qty: 'lots' }, 'qty', 'Enter an amount, like 2, 1½ or 0.5.'],
        [{ qtyMax: '0' }, 'qtyMax', 'Enter an amount, like 2, 1½ or 0.5.'],
        [{ qtyMax: '2' }, 'qtyMax', 'The top of a range must be more than its bottom.'],
        [{ qty: '', qtyMax: '2' }, 'qtyMax', 'The top of a range must be more than its bottom.'],
        [{ name: ' ' }, 'name', 'Name the ingredient.'],
        [{ unit: 'x'.repeat(31) }, 'unit', 'Keep it to 30 characters.'],
      ] as const)('refuses %j, on the part that’s wrong', async (details, part, message) => {
        const { errors } = await submitted(corrected({ qty: '2', ...details }));

        expect(errors).toEqual({
          [`ingredientGroups[0].ingredients[0].details.${part}`]: [message],
        });
      });

      it('still needs the line as it was typed', async () => {
        const values = corrected({});
        const line = values.ingredientGroups[0]?.ingredients[0];
        if (line) line.rawText = ' ';

        expect((await submitted(values)).errors).toEqual({
          'ingredientGroups[0].ingredients[0].rawText': ['Enter the ingredient.'],
        });
      });
    });

    it.each([
      ['amount', { qty: 4 }],
      ['range', { qtyMax: 4 }],
      ['unit', { unit: 'tbsp' }],
      ['name', { name: 'bread flour' }],
      ['note', { note: 'sifted' }],
      ['scaling', { scalable: false }],
    ])('takes a saved line with a different %s as corrected', (_, difference) => {
      const asTyped: IngredientLine = {
        rawText: '3 cups flour',
        qty: 3,
        qtyMax: null,
        unit: 'cup',
        name: 'flour',
        normalizedName: 'flour',
        note: null,
        scalable: true,
      };
      const linesOf = (line: IngredientLine) =>
        recipeFormValues(sampleRecipe({ ingredientGroups: [{ label: null, ingredients: [line] }] }))
          .ingredientGroups[0]?.ingredients;

      expect(linesOf(asTyped)).toEqual([{ rawText: '3 cups flour', details: null }]);
      expect(linesOf({ ...asTyped, ...difference })?.[0]?.details).not.toBeNull();
    });

    it('fills in a saved line as typed, and a corrected one with its corrections', () => {
      const saved = sampleRecipe({
        ingredientGroups: [
          {
            label: 'For the dough',
            ingredients: [
              {
                rawText: '3 cups all-purpose flour',
                qty: 3,
                qtyMax: null,
                unit: 'cup',
                name: 'all-purpose flour',
                normalizedName: 'all purpose flour',
                note: null,
                scalable: true,
              },
              {
                rawText: 'a few sprigs of thyme',
                qty: 7 / 3,
                qtyMax: 3,
                unit: 'sprig',
                name: 'thyme',
                normalizedName: 'thyme',
                note: null,
                scalable: false,
              },
            ],
          },
        ],
      });

      expect(recipeFormValues(saved).ingredientGroups).toEqual([
        {
          label: 'For the dough',
          ingredients: [
            { rawText: '3 cups all-purpose flour', details: null },
            {
              rawText: 'a few sprigs of thyme',
              details: {
                qty: '2⅓',
                qtyMax: '3',
                unit: 'sprig',
                name: 'thyme',
                note: '',
                scalable: false,
              },
            },
          ],
        },
      ]);
      expect(recipeFormValues(sampleRecipe({ ingredientGroups: [] })).ingredientGroups).toEqual([
        { label: '', ingredients: [{ rawText: '', details: null }] },
      ]);
    });
  });

  describe('quantityText', () => {
    it('writes the fractions cooks use as fractions, and other numbers as they are', () => {
      expect([1, 0.5, 1.5, 7 / 3, 0.125, 2.875, 0.3, 1.05].map(quantityText)).toEqual([
        '1',
        '½',
        '1½',
        '2⅓',
        '⅛',
        '2⅞',
        '0.3',
        '1.05',
      ]);
      expect(quantityText(null)).toBe('');
    });

    it('is read back as the same number', () => {
      const wholes = Array.from({ length: 21 }, (_, whole) => whole);
      const values = [
        ...wholes.flatMap((whole) =>
          [3, 4, 8].flatMap((bottom) =>
            Array.from({ length: bottom }, (_, top) => whole + top / bottom),
          ),
        ),
        0.3,
        0.05,
        1.05,
        2.2,
        12.345,
        99_999.5,
      ].filter((value) => value > 0);

      for (const value of values) {
        expect(parseQuantity(quantityText(value)), quantityText(value)).toBeCloseTo(value, 9);
      }
    });
  });

  it('names every text field it has, so the API’s errors can find them', () => {
    /** The path of every text field in the form's values. */
    const textFields = (values: object, prefix = ''): string[] =>
      Object.entries(values).flatMap(([key, value]) => {
        if (typeof value === 'string') return [`${prefix}${key}`];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          return textFields(value, `${prefix}${key}.`);
        }
        return [];
      });

    expect([...RECIPE_TEXT_FIELDS].sort()).toEqual(textFields(recipeFormValues()).sort());
    expect(RECIPE_FORM_FIELDS).toEqual(expect.arrayContaining([...RECIPE_TEXT_FIELDS]));
  });
});
