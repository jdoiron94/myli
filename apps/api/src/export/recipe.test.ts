import { normalizeIngredientName, parseIngredient, type Recipe } from '@myli/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readSchemaOrgRecipe } from '../import/schema-org.ts';
import { asMarkdown } from '../import/text.ts';
import { markdownText, schemaOrgExport } from './recipe.ts';

const NO_NUTRITION = {
  calories: null,
  proteinGrams: null,
  carbsGrams: null,
  fatGrams: null,
  fiberGrams: null,
  sugarGrams: null,
  sodiumMilligrams: null,
};

/** A saved recipe with `content`, as the API reads it. */
const recipe = (content: Partial<Recipe> = {}): Recipe => ({
  id: 'recipe-1',
  owner: { id: 'user-1', name: 'Ann', avatar: null },
  visibility: 'shared',
  title: 'Weeknight Bread',
  description: '',
  source: { url: null, title: null, author: null },
  equipment: [],
  yield: null,
  servings: 8,
  prepMinutes: null,
  cookMinutes: null,
  totalMinutes: null,
  difficulty: null,
  nutrition: NO_NUTRITION,
  ingredientGroups: [],
  steps: [],
  tags: [],
  images: [],
  coverImageId: null,
  revision: 1,
  version: 1,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-21T10:00:00.000Z',
  ...content,
});

/** An ingredient line as saving one stores it. */
const line = (rawText: string) => {
  const parsed = parseIngredient(rawText);
  return { rawText, ...parsed, normalizedName: normalizeIngredientName(parsed.name) };
};

describe('schemaOrgExport', () => {
  it('writes a recipe as sites publish it, its markdown as plain text', () => {
    const tag = (id: number, type: Recipe['tags'][number]['type'], name: string) => ({
      id,
      type,
      name,
    });
    expect(
      schemaOrgExport(
        recipe({
          description: 'A **crusty** loaf, from [Bakes](https://bakes.example).',
          source: { url: 'https://bakes.example/bread', title: 'Bakes', author: 'A. Baker' },
          equipment: ['Loaf pan'],
          yield: { qty: 2, unit: 'loaves' },
          prepMinutes: 20,
          cookMinutes: 40,
          nutrition: { ...NO_NUTRITION, calories: 210, fatGrams: 2.5, sodiumMilligrams: 380 },
          ingredientGroups: [
            { label: 'Dough', ingredients: [line('500 g bread flour')] },
            { label: null, ingredients: [line('salt to taste')] },
          ],
          steps: [
            { body: 'Mix *well*.', image: null },
            { body: '- Shape\n- Bake at 230\\*C', image: null },
          ],
          tags: [
            tag(1, 'cuisine', 'French'),
            tag(2, 'meal_type', 'Side'),
            tag(3, 'diet', 'Gluten-free'),
            tag(4, 'diet', 'Low FODMAP'),
            tag(5, 'custom', 'Weeknight'),
            tag(6, 'allergen', 'wheat'),
          ],
        }),
      ),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Weeknight Bread',
      description: 'A crusty loaf, from Bakes (https://bakes.example).',
      author: { '@type': 'Person', name: 'A. Baker' },
      isBasedOn: 'https://bakes.example/bread',
      datePublished: '2026-11-20T10:00:00.000Z',
      dateModified: '2026-11-21T10:00:00.000Z',
      recipeYield: ['8', '2 loaves'],
      prepTime: 'PT20M',
      cookTime: 'PT40M',
      totalTime: 'PT60M',
      tool: [{ '@type': 'HowToTool', name: 'Loaf pan' }],
      recipeIngredient: ['500 g bread flour', 'salt to taste'],
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Mix well.' },
        { '@type': 'HowToStep', text: '- Shape\n- Bake at 230*C' },
      ],
      recipeCuisine: ['French'],
      recipeCategory: ['Side'],
      suitableForDiet: ['https://schema.org/GlutenFreeDiet'],
      keywords: 'Low FODMAP, Weeknight',
      nutrition: {
        '@type': 'NutritionInformation',
        calories: '210 calories',
        fatContent: '2.5 g',
        sodiumContent: '380 mg',
      },
    });
  });

  it('gives back what import reads, for what the two formats share', () => {
    const word = fc.stringMatching(/^[A-Za-z0-9*_&.,'()!?#-]{1,12}$/);
    const text = (lines: number) =>
      fc
        .array(
          fc.array(word, { minLength: 1, maxLength: 8 }).map((words) => words.join(' ')),
          {
            minLength: 1,
            maxLength: lines,
          },
        )
        .map((each) => each.join('\n'));
    // A step's number would be taken for one the page gave it, which the recipe numbers itself.
    const stepText = text(3).filter((body) => !/^(?:step\s*)?\d+\s*[.):]/i.test(body));
    const minutes = fc.option(fc.integer({ min: 0, max: 100_000 }));
    const nutrient = fc.option(fc.integer({ min: 0, max: 1_000_000 }).map((tenths) => tenths / 10));
    const content = fc
      .record({
        title: text(1),
        description: fc.option(text(3)).map((plain) => (plain === null ? '' : asMarkdown(plain))),
        equipment: fc.array(text(1), { maxLength: 5 }),
        yield: fc.option(
          fc.record({
            qty: fc.integer({ min: 1, max: 10_000 }),
            unit: fc.constantFrom('loaves', 'cookies', 'jars', 'cups'),
          }),
        ),
        servings: fc.integer({ min: 1, max: 1000 }),
        prepMinutes: minutes,
        cookMinutes: minutes,
        totalMinutes: minutes,
        nutrition: fc.record({
          calories: nutrient,
          proteinGrams: nutrient,
          carbsGrams: nutrient,
          fatGrams: nutrient,
          fiberGrams: nutrient,
          sugarGrams: nutrient,
          sodiumMilligrams: nutrient,
        }),
        lines: fc.array(text(1), { maxLength: 10 }),
        steps: fc.array(stepText.map(asMarkdown), { maxLength: 6 }),
      })
      // A total is kept only when it isn't prep plus cook.
      .filter(
        ({ prepMinutes, cookMinutes, totalMinutes }) =>
          totalMinutes === null || totalMinutes !== (prepMinutes ?? 0) + (cookMinutes ?? 0),
      );

    fc.assert(
      fc.property(content, ({ lines, steps, ...rest }) => {
        const exported = recipe({
          ...rest,
          ingredientGroups: lines.length > 0 ? [{ label: null, ingredients: lines.map(line) }] : [],
          steps: steps.map((body) => ({ body, image: null })),
        });
        const page = `<script type="application/ld+json">${JSON.stringify(
          schemaOrgExport(exported),
        ).replace(/</g, '\\u003c')}</script>`;
        const read = readSchemaOrgRecipe(page, new URL('https://example.com/r'))?.recipe;
        /** What both formats carry, of a recipe exported or imported. */
        const shared = (
          from:
            | (Pick<
                Recipe,
                | 'title'
                | 'description'
                | 'equipment'
                | 'yield'
                | 'prepMinutes'
                | 'cookMinutes'
                | 'totalMinutes'
                | 'nutrition'
              > & {
                servings: number | null;
                ingredientGroups: { ingredients: { rawText: string }[] }[];
                steps: { body: string }[];
              })
            | undefined,
        ) => ({
          title: from?.title,
          description: from?.description,
          equipment: from?.equipment,
          yield: from?.yield,
          servings: from?.servings,
          prepMinutes: from?.prepMinutes,
          cookMinutes: from?.cookMinutes,
          totalMinutes: from?.totalMinutes,
          nutrition: from?.nutrition,
          lines: from?.ingredientGroups.flatMap(({ ingredients }) =>
            ingredients.map(({ rawText }) => rawText),
          ),
          steps: from?.steps.map(({ body }) => body),
        });
        expect(shared(read)).toEqual(shared(exported));
      }),
    );
  });
});

describe('markdownText', () => {
  it('gives the text markdown shows', () => {
    const cases = [
      'A **crusty** loaf, _well_ risen',
      'See [the rolls](/recipes/rolls) or [https://bakes.example](https://bakes.example)',
      'Use `00` flour',
      '2 \\* 3 is 6, not \\*\\*bold\\*\\*',
      'Fish &amp; chips &copy; &lt;3',
      '- one\n- two',
      'Half * a cup',
    ];
    expect(Object.fromEntries(cases.map((markdown) => [markdown, markdownText(markdown)]))).toEqual(
      {
        'A **crusty** loaf, _well_ risen': 'A crusty loaf, well risen',
        'See [the rolls](/recipes/rolls) or [https://bakes.example](https://bakes.example)':
          'See the rolls (/recipes/rolls) or https://bakes.example',
        'Use `00` flour': 'Use 00 flour',
        '2 \\* 3 is 6, not \\*\\*bold\\*\\*': '2 * 3 is 6, not **bold**',
        'Fish &amp; chips &copy; &lt;3': 'Fish & chips © <3',
        '- one\n- two': '- one\n- two',
        'Half * a cup': 'Half * a cup',
      },
    );
  });
});
