import {
  type Recipe,
  type RecipeExport,
  recipeExportSchema,
  recipeTotalMinutes,
  tagNameKey,
} from '@myli/shared';
import { decodeHTMLStrict } from 'entities';

/** A recipe in myli's own format (spec §3.7), as published, without photos. */
export function nativeExport(recipe: Recipe, now = new Date()): RecipeExport {
  return recipeExportSchema.parse({
    format: 'myli.recipe',
    formatVersion: 1,
    exportedAt: now.toISOString(),
    recipe: {
      ...recipe,
      steps: recipe.steps.map(({ body }) => ({ body })),
      tags: recipe.tags.map(({ type, name }) => ({ type, name })),
    },
  });
}

/** schema.org's diets (`RestrictedDiet`), by the name a diet tag would have. */
const DIETS = [
  'Diabetic',
  'GlutenFree',
  'Halal',
  'Hindu',
  'Kosher',
  'LowCalorie',
  'LowFat',
  'LowLactose',
  'LowSalt',
  'Vegan',
  'Vegetarian',
];

/** Compared without case, spaces or punctuation: "Gluten-free" is schema.org's "GlutenFree". */
const looseKey = (name: string) => tagNameKey(name).replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * A recipe as schema.org/Recipe JSON-LD (spec §3.7), the format recipe sites publish and other apps
 * import: what it says as published, without photos. Markdown becomes the plain text it shows.
 * Cuisine and meal type tags are its cuisine and category, diets schema.org knows are its diets,
 * and other tags but allergens, which schema.org has no place for, are its keywords.
 */
export function schemaOrgExport(recipe: Recipe): Record<string, unknown> {
  const tagsOf = (type: string) => recipe.tags.filter((tag) => tag.type === type);
  const diets = tagsOf('diet').map((tag) => ({
    name: tag.name,
    term: DIETS.find((term) => term.toLowerCase() === looseKey(tag.name)),
  }));
  const keywords = [
    ...diets.filter(({ term }) => term === undefined).map(({ name }) => name),
    ...tagsOf('custom').map(({ name }) => name),
  ];
  const total = recipeTotalMinutes(recipe);
  const { nutrition } = recipe;
  const nutrients = (
    [
      ['calories', nutrition.calories, 'calories'],
      ['proteinContent', nutrition.proteinGrams, 'g'],
      ['carbohydrateContent', nutrition.carbsGrams, 'g'],
      ['fatContent', nutrition.fatGrams, 'g'],
      ['fiberContent', nutrition.fiberGrams, 'g'],
      ['sugarContent', nutrition.sugarGrams, 'g'],
      ['sodiumContent', nutrition.sodiumMilligrams, 'mg'],
    ] as const
  ).flatMap(([property, value, unit]) =>
    value === null ? [] : [[property, `${String(value)} ${unit}`] as const],
  );
  const description = markdownText(recipe.description);
  return withoutEmpty({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: recipe.title,
    description,
    author: recipe.source.author ? { '@type': 'Person', name: recipe.source.author } : undefined,
    isBasedOn: recipe.source.url ?? undefined,
    datePublished: recipe.createdAt,
    dateModified: recipe.updatedAt,
    // The servings, alone, then what it makes: how sites write both.
    recipeYield: [
      String(recipe.servings),
      ...(recipe.yield
        ? [`${String(recipe.yield.qty)}${recipe.yield.unit ? ` ${recipe.yield.unit}` : ''}`]
        : []),
    ],
    prepTime: duration(recipe.prepMinutes),
    cookTime: duration(recipe.cookMinutes),
    totalTime: duration(total),
    tool: recipe.equipment.map((name) => ({ '@type': 'HowToTool', name })),
    recipeIngredient: recipe.ingredientGroups.flatMap(({ ingredients }) =>
      ingredients.map(({ rawText }) => rawText),
    ),
    recipeInstructions: recipe.steps.map(({ body }) => ({
      '@type': 'HowToStep',
      text: markdownText(body),
    })),
    recipeCuisine: tagsOf('cuisine').map(({ name }) => name),
    recipeCategory: tagsOf('meal_type').map(({ name }) => name),
    suitableForDiet: diets.flatMap(({ term }) =>
      term === undefined ? [] : [`https://schema.org/${term}Diet`],
    ),
    keywords: keywords.join(', ') || undefined,
    nutrition:
      nutrients.length > 0
        ? { '@type': 'NutritionInformation', ...Object.fromEntries(nutrients) }
        : undefined,
  });
}

const duration = (minutes: number | null) =>
  minutes === null ? undefined : `PT${String(minutes)}M`;

/** Leaves out what has no value: `undefined`, an empty string or an empty list. */
const withoutEmpty = (object: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(object).filter(
      ([, value]) =>
        value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0),
    ),
  );

/** Stands in for an escaped character while the rest of the markdown is read. */
const ESCAPED_BASE = 0xe000;
const ESCAPED = /[-]/g;

/**
 * The plain text markdown shows (spec §3.2's subset): its formatting taken out, a link as its text
 * and address, and escaped characters and entities as they show.
 */
export function markdownText(markdown: string): string {
  const text = markdown
    // Escaped characters first, so they never count as formatting.
    .replace(/\\([!-/:-@[-`{-~])/g, (_, char: string) =>
      String.fromCharCode(ESCAPED_BASE + char.charCodeAt(0)),
    )
    .replace(
      /\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g,
      (_, label: string, url: string) =>
        label === '' || label === url ? url : `${label} (${url})`,
    )
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
    .replace(/(`+)([\s\S]*?)\1/g, '$2')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, '$2');
  return decodeHTMLStrict(text).replace(ESCAPED, (char) =>
    String.fromCharCode(char.charCodeAt(0) - ESCAPED_BASE),
  );
}

/** A file name for a recipe's export: its title, as letters, digits and dashes. */
export function exportFileName(title: string, extension: string): string {
  const name = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return `${name || 'recipe'}.${extension}`;
}
