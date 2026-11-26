import { type ImportedRecipe, importedRecipeSchema, parseIngredient } from '@myli/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readSchemaOrgRecipe } from './schema-org.ts';

const PAGE = new URL('https://www.example.com/recipes/bread#jump');

/** A page holding each value as a JSON-LD block, escaped as sites escape it. */
const page = (...blocks: unknown[]) =>
  `<html><head><title>Example</title>${blocks
    .map(
      (block) =>
        `<script type="application/ld+json">${JSON.stringify(block).replace(/</g, '\\u003c')}</script>`,
    )
    .join('')}</head><body></body></html>`;

/** An ingredient line as the editor would read it, typed. */
const line = (rawText: string) => ({ rawText, ...parseIngredient(rawText) });

const NO_NUTRITION = {
  calories: null,
  proteinGrams: null,
  carbsGrams: null,
  fatGrams: null,
  fiberGrams: null,
  sugarGrams: null,
  sodiumMilligrams: null,
};

/** What a recipe the page says nothing else about is read as. */
const imported = (recipe: Partial<ImportedRecipe>): ImportedRecipe => ({
  title: '',
  description: '',
  source: { url: 'https://www.example.com/recipes/bread', title: 'example.com', author: null },
  equipment: [],
  yield: null,
  servings: null,
  prepMinutes: null,
  cookMinutes: null,
  totalMinutes: null,
  difficulty: null,
  nutrition: NO_NUTRITION,
  ingredientGroups: [],
  steps: [],
  images: [],
  coverImageId: null,
  tagIds: [],
  ...recipe,
});

const step = (body: string) => ({ body, image: null });

describe('readSchemaOrgRecipe', () => {
  it('reads the shapes recipe sites publish', () => {
    const pages = {
      // As WordPress recipe plugins write it: a graph, whose author is a reference to a node in it.
      graph: page({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'Organization', '@id': 'https://www.example.com/#org', name: 'Bakes' },
          { '@type': 'Person', '@id': 'https://www.example.com/#ann', name: 'Ann Baker' },
          {
            '@type': 'Recipe',
            name: 'Weeknight Bread',
            author: { '@id': 'https://www.example.com/#ann' },
            publisher: { '@id': 'https://www.example.com/#org' },
            description: 'A <b>crusty</b> loaf &amp;amp; easy.',
            image: ['https://cdn.example.net/bread.jpg', 'https://cdn.example.net/bread-2.jpg'],
            recipeYield: ['8', '8 slices'],
            prepTime: 'PT15M',
            cookTime: 'PT45M',
            totalTime: 'PT1H',
            recipeIngredient: ['500 g bread flour', '1 tsp salt', '350 ml warm water'],
            recipeInstructions: [
              {
                '@type': 'HowToSection',
                name: 'Dough',
                itemListElement: [
                  { '@type': 'HowToStep', text: 'Mix *everything*.' },
                  { '@type': 'HowToStep', text: 'Knead for 10 minutes.' },
                ],
              },
              {
                '@type': 'HowToSection',
                name: 'Bake',
                itemListElement: [{ '@type': 'HowToStep', text: 'Bake at 230°C.' }],
              },
            ],
            tool: [{ '@type': 'HowToTool', name: 'Dutch oven' }],
            nutrition: { calories: '210 kcal', proteinContent: '7 g', sodiumContent: '0.4 g' },
            recipeCuisine: 'French',
            recipeCategory: 'Bread, Side',
            suitableForDiet: 'https://schema.org/GlutenFreeDiet',
          },
        ],
      }),
      // A list of nodes, the recipe typed twice, its steps in one string of HTML.
      list: page([
        { '@type': 'WebSite', name: 'Example' },
        {
          '@type': ['Recipe', 'NewsArticle'],
          name: 'Chili',
          author: 'Sam',
          recipeYield: 'Serves 4–6',
          totalTime: 'PT2H',
          recipeIngredient: '2 lb beef\n1 onion, diced',
          recipeInstructions:
            '<ol><li>1. Brown the beef.</li><li>Step 2: Add the onion; simmer 1.5 hours.</li></ol>',
          image: { '@type': 'ImageObject', url: '/img/chili.jpg' },
          suitableForDiet: 'Dairy free',
        },
      ]),
      // A page's main entity, with no name of its own, and a line break inside a JSON string.
      nested: `<title>Mint tea | Example</title><script type="application/ld+json">
        {"@type": "WebPage", "mainEntity": {"@type": "Recipe", "recipeYield": "Makes 2 mugs",
         "description": "Fresh.
No sugar.", "recipeInstructions": ["Boil water.", "Pour it over the mint."]}}</script>`,
      article: page({ '@type': 'Article', headline: 'Not a recipe' }),
      none: '<html><body><h1>Bread</h1></body></html>',
    };
    expect(
      Object.fromEntries(
        Object.entries(pages).map(([name, html]) => [name, readSchemaOrgRecipe(html, PAGE)]),
      ),
    ).toEqual({
      graph: {
        recipe: imported({
          title: 'Weeknight Bread',
          description: 'A crusty loaf & easy.',
          source: {
            url: 'https://www.example.com/recipes/bread',
            title: 'Bakes',
            author: 'Ann Baker',
          },
          equipment: ['Dutch oven'],
          yield: { qty: 8, unit: 'slices' },
          servings: 8,
          prepMinutes: 15,
          cookMinutes: 45,
          nutrition: { ...NO_NUTRITION, calories: 210, proteinGrams: 7, sodiumMilligrams: 400 },
          ingredientGroups: [
            {
              label: null,
              ingredients: [
                line('500 g bread flour'),
                line('1 tsp salt'),
                line('350 ml warm water'),
              ],
            },
          ],
          steps: [
            step('**Dough**\n\nMix \\*everything\\*.'),
            step('Knead for 10 minutes.'),
            step('**Bake**\n\nBake at 230°C.'),
          ],
        }),
        imageUrl: 'https://cdn.example.net/bread.jpg',
        tags: [
          { type: 'cuisine', name: 'French' },
          { type: 'meal_type', name: 'Bread' },
          { type: 'meal_type', name: 'Side' },
          { type: 'diet', name: 'Gluten Free' },
        ],
      },
      list: {
        recipe: imported({
          title: 'Chili',
          source: {
            url: 'https://www.example.com/recipes/bread',
            title: 'example.com',
            author: 'Sam',
          },
          servings: 4,
          totalMinutes: 120,
          ingredientGroups: [
            { label: null, ingredients: [line('2 lb beef'), line('1 onion, diced')] },
          ],
          steps: [step('Brown the beef.'), step('Add the onion; simmer 1.5 hours.')],
        }),
        imageUrl: 'https://www.example.com/img/chili.jpg',
        tags: [{ type: 'diet', name: 'Dairy free' }],
      },
      nested: {
        recipe: imported({
          title: 'Mint tea | Example',
          description: 'Fresh. No sugar.',
          yield: { qty: 2, unit: 'mugs' },
          steps: [step('Boil water.'), step('Pour it over the mint.')],
        }),
        imageUrl: null,
        tags: [],
      },
      article: null,
      none: null,
    });
  });

  it('makes a recipe the form can open of whatever a recipe’s data holds', () => {
    const anything = fc.oneof(
      fc.jsonValue({ maxDepth: 3 }),
      fc.string({ unit: 'binary', maxLength: 600 }),
      fc.array(fc.string({ maxLength: 600 }), { maxLength: 250 }),
      fc.stringMatching(/^P(\d{1,7}D)?(T(\d{1,7}H)?(\d{1,7}M)?)?$/),
      fc.stringMatching(/^(Serves |Makes )?\d{1,9}([.,]\d{1,3})?( servings| cookies|-\d)?$/),
    );
    const fields = fc.record(
      {
        name: anything,
        description: anything,
        recipeYield: anything,
        prepTime: anything,
        cookTime: anything,
        totalTime: anything,
        recipeIngredient: anything,
        recipeInstructions: fc.oneof(
          anything,
          fc.array(
            fc.record({
              '@type': fc.constant('HowToSection'),
              name: anything,
              itemListElement: anything,
            }),
          ),
        ),
        tool: anything,
        author: anything,
        publisher: anything,
        image: anything,
        nutrition: fc.oneof(
          anything,
          fc.dictionary(fc.constantFrom('calories', 'sodiumContent'), anything),
        ),
        recipeCuisine: anything,
        suitableForDiet: anything,
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(fields, (recipe) => {
        const read = readSchemaOrgRecipe(page({ '@type': 'Recipe', ...recipe }), PAGE);
        expect(read && importedRecipeSchema.safeParse(read.recipe).error).toBeUndefined();
      }),
    );
  });
});
