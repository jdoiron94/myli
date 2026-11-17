import {
  DIFFICULTIES,
  RECIPE_LIMITS,
  updateRecipeRequestSchema,
  visibilitySchema,
} from '@myli/shared';
import { z } from 'zod';
import type { Recipe } from './recipe.ts';

/**
 * The recipe editor's form: what's typed in its fields, and the API's request it becomes. Every
 * field is text, as typed, and the form's schema turns it into the request's values, checked by the
 * API's own schemas (`@myli/shared`), so the form and the API refuse the same things with the same
 * words. Field names are the request's paths (`source.url`, `nutrition.calories`), so the API's
 * field errors land on the right field.
 */

const content = updateRecipeRequestSchema.shape;
const nutrient = content.nutrition.shape;
const L = RECIPE_LIMITS;

/** A number typed in a text box, as `schema` takes it: `null` when the box is empty. */
const typedNumber = <TSchema extends z.ZodType<unknown, number | null>>(schema: TSchema) =>
  z
    .string()
    .trim()
    .transform((text) => (text === '' ? null : Number(text)))
    .pipe(schema);

/** "Not set" is a choice of its own, since a radio button can't be unchecked. */
export const DIFFICULTY_CHOICES = ['none', ...DIFFICULTIES] as const;

/** The nutrition facts, in the order the form asks for them. */
export const NUTRIENTS = [
  'calories',
  'proteinGrams',
  'carbsGrams',
  'fatGrams',
  'fiberGrams',
  'sugarGrams',
  'sodiumMilligrams',
] as const satisfies readonly (keyof typeof nutrient)[];

export const recipeFormSchema = z
  .object({
    title: content.title,
    source: z.object({
      url: z
        .string()
        .trim()
        .transform((url) => (url === '' ? null : url))
        .pipe(content.source.shape.url),
      title: content.source.shape.title,
      author: content.source.shape.author,
    }),
    /** One piece of equipment per line. */
    equipment: z
      .string()
      .transform((text, context) => {
        const items = text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '');
        // On the field as a whole: the form has one box for the list.
        if (items.length > L.equipment) {
          context.issues.push({
            code: 'custom',
            input: text,
            message: `List up to ${String(L.equipment)} pieces of equipment.`,
          });
        }
        if (items.some((item) => item.length > L.equipmentItem)) {
          context.issues.push({
            code: 'custom',
            input: text,
            message: `Keep each line to ${String(L.equipmentItem)} characters.`,
          });
        }
        return items;
      })
      .pipe(content.equipment),
    yield: z
      .object({ qty: z.string().trim(), unit: z.string().trim() })
      .transform(({ qty, unit }, context): { qty: number; unit: string | null } | null => {
        if (qty === '' && unit === '') return null;
        if (qty === '') {
          context.issues.push({
            code: 'custom',
            input: qty,
            path: ['qty'],
            message: 'Enter how many it makes, or leave both empty.',
          });
          return z.NEVER;
        }
        return { qty: Number(qty), unit };
      })
      .pipe(content.yield),
    servings: typedNumber(content.servings),
    prepMinutes: typedNumber(content.prepMinutes),
    cookMinutes: typedNumber(content.cookMinutes),
    totalMinutes: typedNumber(content.totalMinutes),
    difficulty: z
      .enum(DIFFICULTY_CHOICES)
      .transform((choice) => (choice === 'none' ? null : choice)),
    nutrition: z.object({
      calories: typedNumber(nutrient.calories),
      proteinGrams: typedNumber(nutrient.proteinGrams),
      carbsGrams: typedNumber(nutrient.carbsGrams),
      fatGrams: typedNumber(nutrient.fatGrams),
      fiberGrams: typedNumber(nutrient.fiberGrams),
      sugarGrams: typedNumber(nutrient.sugarGrams),
      sodiumMilligrams: typedNumber(nutrient.sodiumMilligrams),
    }),
    // Not in the form yet: carried over as they were, until the editor has fields for them.
    description: content.description,
    ingredientGroups: content.ingredientGroups,
    steps: content.steps,
    tagIds: content.tagIds,
    /** Chosen only when creating a recipe. Afterwards it's changed on its own, by the owner. */
    visibility: visibilitySchema,
  })
  .transform(({ visibility, ...recipe }) => ({ content: recipe, visibility }));

export type RecipeFormValues = z.input<typeof recipeFormSchema>;
export type RecipeFormResult = z.output<typeof recipeFormSchema>;

/** Every field of the form, by its path, for the API's field errors. */
export const RECIPE_FORM_FIELDS = [
  'title',
  'servings',
  'yield.qty',
  'yield.unit',
  'prepMinutes',
  'cookMinutes',
  'totalMinutes',
  'difficulty',
  'source.url',
  'source.title',
  'source.author',
  'equipment',
  ...NUTRIENTS.map((name) => `nutrition.${name}` as const),
  'visibility',
] as const;

const typed = (value: number | null) => (value === null ? '' : String(value));

/** What the form starts with: a new recipe's empty fields, or an existing one's values. */
export function recipeFormValues(recipe?: Recipe): RecipeFormValues {
  if (!recipe) {
    return {
      title: '',
      source: { url: '', title: '', author: '' },
      equipment: '',
      yield: { qty: '', unit: '' },
      servings: '',
      prepMinutes: '',
      cookMinutes: '',
      totalMinutes: '',
      difficulty: 'none',
      nutrition: {
        calories: '',
        proteinGrams: '',
        carbsGrams: '',
        fatGrams: '',
        fiberGrams: '',
        sugarGrams: '',
        sodiumMilligrams: '',
      },
      description: '',
      ingredientGroups: [],
      steps: [],
      tagIds: [],
      // Nothing is shared by accident: sharing is a choice.
      visibility: 'private',
    };
  }
  const { source, nutrition } = recipe;
  return {
    title: recipe.title,
    source: { url: source.url ?? '', title: source.title ?? '', author: source.author ?? '' },
    equipment: recipe.equipment.join('\n'),
    yield: { qty: typed(recipe.yield?.qty ?? null), unit: recipe.yield?.unit ?? '' },
    servings: String(recipe.servings),
    prepMinutes: typed(recipe.prepMinutes),
    cookMinutes: typed(recipe.cookMinutes),
    totalMinutes: typed(recipe.totalMinutes),
    difficulty: recipe.difficulty ?? 'none',
    nutrition: {
      calories: typed(nutrition.calories),
      proteinGrams: typed(nutrition.proteinGrams),
      carbsGrams: typed(nutrition.carbsGrams),
      fatGrams: typed(nutrition.fatGrams),
      fiberGrams: typed(nutrition.fiberGrams),
      sugarGrams: typed(nutrition.sugarGrams),
      sodiumMilligrams: typed(nutrition.sodiumMilligrams),
    },
    description: recipe.description,
    ingredientGroups: recipe.ingredientGroups.map((group) => ({
      label: group.label,
      ingredients: group.ingredients.map(
        ({ rawText, qty, qtyMax, unit, name, note, scalable }) => ({
          rawText,
          qty,
          qtyMax,
          unit,
          name,
          note,
          scalable,
        }),
      ),
    })),
    steps: recipe.steps.map(({ body }) => ({ body })),
    tagIds: recipe.tags.map((tag) => tag.id),
    visibility: recipe.visibility,
  };
}
