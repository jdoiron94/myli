import { z } from 'zod';
import { imageSchema } from './image.ts';
import { tagSchema } from './tags.ts';
import { findUnit } from './units.ts';
import { visibilitySchema } from './visibility.ts';

/** How hard a recipe is (spec §3.2). Optional on each recipe. */
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export const difficultySchema = z.enum(DIFFICULTIES).meta({ id: 'Difficulty' });

export type Difficulty = z.infer<typeof difficultySchema>;

/** How long or how many of each part of a recipe can be, for forms to show and check. */
export const RECIPE_LIMITS = {
  title: 200,
  description: 20_000,
  sourceUrl: 2_000,
  sourceText: 200,
  equipment: 50,
  equipmentItem: 100,
  yieldUnit: 50,
  servings: 1_000,
  /** Ten weeks, for things that cure. */
  minutes: 100_000,
  ingredientGroups: 20,
  groupLabel: 100,
  /** Across every group. */
  ingredients: 200,
  rawText: 500,
  ingredientName: 200,
  ingredientNote: 500,
  unit: 30,
  quantity: 1_000_000,
  steps: 100,
  stepBody: 10_000,
  tags: 50,
  /** Photos of the recipe as a whole. Each step can have one more. */
  images: 20,
  nutrition: 100_000,
} as const;

const L = RECIPE_LIMITS;

/** What a form says about text that's too long. */
const tooLong = (max: number) => `Keep it to ${String(max)} characters.`;

/** A photo, by the ID its upload answered with. */
const imageIdSchema = z.string().min(1).max(100);

/** Optional text: `null` or empty when there's none. The API stores an empty one as `null`. */
const optionalText = (max: number) => z.string().trim().max(max, tooLong(max)).nullable();

const quantitySchema = z
  .number({ error: 'Enter a number.' })
  .positive('Enter a number above 0.')
  .max(L.quantity, `Enter a number up to ${L.quantity.toLocaleString('en-US')}.`);

const minutesSchema = z
  .int({ error: 'Enter a whole number of minutes.' })
  .min(0, 'Enter 0 or more minutes.')
  .max(L.minutes, `Enter up to ${L.minutes.toLocaleString('en-US')} minutes.`)
  .nullable();

const nutrientSchema = z
  .number({ error: 'Enter a number.' })
  .min(0, 'Enter 0 or more.')
  .max(L.nutrition, `Enter up to ${L.nutrition.toLocaleString('en-US')}.`)
  .nullable();

/** One ingredient line as the user confirmed it (spec §3.2). */
export const ingredientLineInputSchema = z
  .object({
    rawText: z.string().trim().min(1, 'Enter the ingredient.').max(L.rawText, tooLong(L.rawText)),
    qty: quantitySchema.nullable().describe('`null` when the line has no quantity.'),
    qtyMax: quantitySchema
      .nullable()
      .describe('The top of a range ("2–3 cloves"): more than `qty`. Otherwise `null`.'),
    unit: z
      .string()
      .trim()
      .min(1, 'Enter the unit, or leave it out.')
      .max(L.unit, tooLong(L.unit))
      // "Tablespoons" is stored as the unit table's "tbsp"; a unit typed by hand stays as it is.
      .overwrite((unit) => findUnit(unit)?.name ?? unit)
      .nullable()
      .describe('A unit from the unit table, by any of its names, or one typed by hand.'),
    name: z
      .string()
      .trim()
      .min(1, 'Name the ingredient.')
      .max(L.ingredientName, tooLong(L.ingredientName)),
    note: optionalText(L.ingredientNote),
    scalable: z.boolean().describe('False for lines like "salt to taste", which never scale.'),
  })
  .refine(({ qty, qtyMax }) => qtyMax === null || (qty !== null && qtyMax > qty), {
    path: ['qtyMax'],
    message: 'The top of a range must be more than its bottom.',
  })
  .meta({ id: 'IngredientLineInput' });

export const ingredientGroupInputSchema = z
  .object({
    label: optionalText(L.groupLabel).describe('"For the dough". A lone group needs none.'),
    ingredients: z
      .array(ingredientLineInputSchema)
      .min(1, 'Add an ingredient to the group, or remove the group.')
      .max(L.ingredients, `A recipe can have up to ${String(L.ingredients)} ingredients.`),
  })
  .meta({ id: 'IngredientGroupInput' });

const sourceSchema = z
  .object({
    url: z
      .url({ protocol: /^https?$/, error: 'Enter a web address starting with http or https.' })
      .max(L.sourceUrl, tooLong(L.sourceUrl))
      .nullable(),
    title: optionalText(L.sourceText).describe('A book or site title.'),
    author: optionalText(L.sourceText),
  })
  .meta({ id: 'RecipeSource' });

const yieldSchema = z
  .object({ qty: quantitySchema, unit: optionalText(L.yieldUnit) })
  .nullable()
  .describe('"24 cookies", separate from the servings.');

const nutritionSchema = z
  .object({
    calories: nutrientSchema,
    proteinGrams: nutrientSchema,
    carbsGrams: nutrientSchema,
    fatGrams: nutrientSchema,
    fiberGrams: nutrientSchema,
    sugarGrams: nutrientSchema,
    sodiumMilligrams: nutrientSchema,
  })
  .describe('Per serving, entered by hand. `null` for each value nobody entered.')
  .meta({ id: 'Nutrition' });

/** Everything about a recipe that editing it changes. Its visibility is changed on its own. */
const recipeContentShape = {
  title: z.string().trim().min(1, 'Give the recipe a title.').max(L.title, tooLong(L.title)),
  description: z.string().trim().max(L.description, tooLong(L.description)).describe('Markdown.'),
  source: sourceSchema,
  equipment: z
    .array(
      z
        .string()
        .trim()
        .min(1, 'Name the equipment, or remove it.')
        .max(L.equipmentItem, tooLong(L.equipmentItem)),
    )
    .max(L.equipment, `A recipe can list up to ${String(L.equipment)} pieces of equipment.`),
  yield: yieldSchema,
  servings: z
    .int({ error: 'Enter a whole number of servings.' })
    .min(1, 'A recipe serves at least 1.')
    .max(L.servings, `A recipe serves at most ${L.servings.toLocaleString('en-US')}.`)
    .describe('The baseline scaling starts from.'),
  prepMinutes: minutesSchema,
  cookMinutes: minutesSchema,
  totalMinutes: minutesSchema.describe(
    'Only when it differs from prep plus cook: `null` means their sum.',
  ),
  difficulty: difficultySchema.nullable(),
  nutrition: nutritionSchema,
  ingredientGroups: z
    .array(ingredientGroupInputSchema)
    .max(
      L.ingredientGroups,
      `A recipe can have up to ${String(L.ingredientGroups)} groups of ingredients.`,
    ),
  steps: z
    .array(
      z.object({
        body: z.string().trim().min(1, 'Write the step.').max(L.stepBody, tooLong(L.stepBody)),
        imageId: imageIdSchema.nullable().describe('Its photo, if it has one.'),
      }),
    )
    .max(L.steps, `A recipe can have up to ${String(L.steps)} steps.`)
    .describe('In order. Each body is markdown.'),
  imageIds: z
    .array(imageIdSchema)
    .max(L.images, `A recipe can have up to ${String(L.images)} photos.`)
    .describe(
      'Its photos, in order: its own, or uploads of the caller’s no recipe was saved with. ' +
        'Those left out are deleted.',
    ),
  coverImageId: imageIdSchema
    .nullable()
    .describe('The photo shown for it in lists: one of `imageIds`, or `null` when there are none.'),
  tagIds: z
    .array(z.int().positive())
    .max(L.tags, `A recipe can have up to ${String(L.tags)} tags.`)
    .refine((ids) => new Set(ids).size === ids.length, 'Each tag can be added once.'),
};

/**
 * A recipe's photos hang together: the cover is one of them, there's one exactly when there are
 * photos, and no photo is used twice, in the recipe's photos or its steps'.
 */
function checkPhotos(
  recipe: { imageIds: string[]; coverImageId: string | null; steps: { imageId: string | null }[] },
  context: z.core.$RefinementCtx,
) {
  const { imageIds, coverImageId } = recipe;
  if (coverImageId === null ? imageIds.length > 0 : !imageIds.includes(coverImageId)) {
    context.addIssue({
      code: 'custom',
      path: ['coverImageId'],
      message: imageIds.length > 0 ? 'Choose one of its photos as the cover.' : 'It has no photos.',
    });
  }
  const used = new Set<string>();
  const uses: [string, PropertyKey[]][] = [
    ...imageIds.map((id, index): [string, PropertyKey[]] => [id, ['imageIds', index]]),
    ...recipe.steps.flatMap(({ imageId }, index): [string, PropertyKey[]][] =>
      imageId === null ? [] : [[imageId, ['steps', index, 'imageId']]],
    ),
  ];
  for (const [id, path] of uses) {
    if (used.has(id)) {
      context.addIssue({ code: 'custom', path, message: 'Each photo can be used once.' });
    }
    used.add(id);
  }
}

/** The 200-line limit counts every group together. */
const withinIngredientLimit = (recipe: { ingredientGroups: { ingredients: unknown[] }[] }) =>
  recipe.ingredientGroups.flatMap((group) => group.ingredients).length <= L.ingredients;

const INGREDIENT_LIMIT_ISSUE = {
  path: ['ingredientGroups'],
  message: `A recipe can have up to ${String(L.ingredients)} ingredients.`,
};

export const createRecipeRequestSchema = z
  .object({ ...recipeContentShape, visibility: visibilitySchema })
  .refine(withinIngredientLimit, INGREDIENT_LIMIT_ISSUE)
  .superRefine(checkPhotos)
  .meta({ id: 'CreateRecipeRequest' });

export type CreateRecipeRequest = z.output<typeof createRecipeRequestSchema>;

/**
 * Saving an existing recipe replaces all of it, lines, steps and tags included. Its visibility is
 * changed on its own, by its owner only.
 */
export const updateRecipeRequestSchema = z
  .object(recipeContentShape)
  .refine(withinIngredientLimit, INGREDIENT_LIMIT_ISSUE)
  .superRefine(checkPhotos)
  .meta({ id: 'UpdateRecipeRequest' });

export type UpdateRecipeRequest = z.output<typeof updateRecipeRequestSchema>;

export const changeVisibilityRequestSchema = z
  .object({ visibility: visibilitySchema })
  .meta({ id: 'ChangeVisibilityRequest' });

/** One ingredient line of a saved recipe. */
export const ingredientLineSchema = z
  .object({
    rawText: z.string(),
    qty: z.number().nullable(),
    qtyMax: z.number().nullable(),
    unit: z.string().nullable(),
    name: z.string(),
    normalizedName: z
      .string()
      .describe('The name lowercase and singular, without accents or punctuation.'),
    note: z.string().nullable(),
    scalable: z.boolean(),
  })
  .meta({ id: 'IngredientLine' });

export const recipeSchema = z
  .object({
    id: z.string(),
    owner: z.object({ id: z.string(), name: z.string() }),
    visibility: visibilitySchema,
    title: z.string(),
    description: z.string(),
    source: z.object({
      url: z.string().nullable(),
      title: z.string().nullable(),
      author: z.string().nullable(),
    }),
    equipment: z.array(z.string()),
    yield: z.object({ qty: z.number(), unit: z.string().nullable() }).nullable(),
    servings: z.int(),
    prepMinutes: z.int().nullable(),
    cookMinutes: z.int().nullable(),
    totalMinutes: z
      .int()
      .nullable()
      .describe('Set only when it differs from prep plus cook. See `recipeTotalMinutes`.'),
    difficulty: difficultySchema.nullable(),
    nutrition: z.object({
      calories: z.number().nullable(),
      proteinGrams: z.number().nullable(),
      carbsGrams: z.number().nullable(),
      fatGrams: z.number().nullable(),
      fiberGrams: z.number().nullable(),
      sugarGrams: z.number().nullable(),
      sodiumMilligrams: z.number().nullable(),
    }),
    ingredientGroups: z.array(
      z.object({ label: z.string().nullable(), ingredients: z.array(ingredientLineSchema) }),
    ),
    steps: z.array(
      // Not `imageSchema.nullable()`, which the OpenAPI document would make the Image component
      // itself nullable with, everywhere it's used.
      z.object({ body: z.string(), image: z.union([imageSchema, z.null()]) }),
    ),
    tags: z.array(tagSchema).describe('By type, then name.'),
    images: z.array(imageSchema).describe('Its photos, in order.'),
    coverImageId: z.string().nullable().describe('One of `images`, or `null` when there are none.'),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Recipe' });

export type Recipe = z.infer<typeof recipeSchema>;

export const recipeResultSchema = z.object({ recipe: recipeSchema }).meta({ id: 'RecipeResult' });

/** The path parameter of one recipe. Unknown IDs get 404, so the format isn't checked. */
export const recipeIdParamsSchema = z.object({ id: z.string().min(1).max(100) });

/**
 * How long a recipe takes in all: the total someone set by hand, or else prep plus cook. `null`
 * when neither is known.
 */
export function recipeTotalMinutes(
  recipe: Pick<Recipe, 'prepMinutes' | 'cookMinutes' | 'totalMinutes'>,
): number | null {
  if (recipe.totalMinutes !== null) return recipe.totalMinutes;
  if (recipe.prepMinutes === null && recipe.cookMinutes === null) return null;
  return (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
}
