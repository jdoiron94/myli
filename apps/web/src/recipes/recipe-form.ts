import {
  DIFFICULTIES,
  ingredientGroupInputSchema,
  ingredientLineInputSchema,
  type ParsedIngredient,
  parseIngredient,
  parseQuantity,
  RECIPE_LIMITS,
  updateRecipeRequestSchema,
  visibilitySchema,
} from '@myli/shared';
import { z } from 'zod';
import type { IngredientLine, Recipe } from './recipe.ts';

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

/**
 * How someone corrected the way a line is read, each part as typed. Lines without corrections are
 * read by the parser from what was typed, each time it changes.
 */
export interface LineDetails {
  qty: string;
  qtyMax: string;
  unit: string;
  name: string;
  note: string;
  scalable: boolean;
}

export interface IngredientLineValues {
  rawText: string;
  /** `null` while the parser reads the line. */
  details: LineDetails | null;
}

export interface IngredientGroupValues {
  label: string;
  ingredients: IngredientLineValues[];
}

/** A photo the recipe or a step has, and its alt text as typed. */
export interface PhotoValues {
  id: string;
  alt: string;
}

export interface StepValues {
  /** Markdown. */
  body: string;
  image: PhotoValues | null;
}

export const emptyLine = (): IngredientLineValues => ({ rawText: '', details: null });

export const emptyStep = (): StepValues => ({ body: '', image: null });

/** A group starts with a line to type in. */
export const emptyGroup = (): IngredientGroupValues => ({ label: '', ingredients: [emptyLine()] });

/** A line as myli reads it: as corrected, or else by the parser. */
export function readLine({ rawText, details }: IngredientLineValues): ParsedIngredient {
  if (!details) return parseIngredient(rawText);
  return {
    qty: parseQuantity(details.qty) ?? null,
    qtyMax: parseQuantity(details.qtyMax) ?? null,
    unit: details.unit.trim() || null,
    name: details.name.trim(),
    note: details.note.trim() || null,
    scalable: details.scalable,
  };
}

const lineDetailsSchema = z.object({
  qty: z.string(),
  qtyMax: z.string(),
  unit: z.string(),
  name: z.string(),
  note: z.string(),
  scalable: z.boolean(),
});

/** What's wrong with the name the parser read from a line. */
const parsedNameProblem = (name: string) =>
  name === ''
    ? "Name the ingredient: myli can't find a name in this line."
    : `Keep the ingredient's name to ${String(L.ingredientName)} characters.`;

/**
 * One line, as the API takes it, or `null` for a blank line, which is left out. Its problems are
 * on the field that shows them: the line itself while the parser reads it, or the corrected part.
 */
const ingredientLineSchema = z
  .object({ rawText: z.string(), details: lineDetailsSchema.nullable() })
  .transform((line, context) => {
    if (line.details === null && line.rawText.trim() === '') return null;
    for (const part of ['qty', 'qtyMax'] as const) {
      const typed = line.details?.[part].trim() ?? '';
      if (typed !== '' && parseQuantity(typed) === undefined) {
        context.issues.push({
          code: 'custom',
          input: typed,
          path: ['details', part],
          message: 'Enter an amount, like 2, 1½ or 0.5.',
        });
      }
    }
    const read = readLine(line);
    const result = ingredientLineInputSchema.safeParse({ rawText: line.rawText, ...read });
    const issues = result.error?.issues ?? [];
    if (line.details === null) {
      // Only the line shows, so one problem at a time, the line's own first: a name that's too long
      // may only be because the line is.
      const issue = issues.find(({ path }) => path[0] === 'rawText') ?? issues[0];
      if (issue) {
        context.issues.push({
          code: 'custom',
          input: line,
          path: ['rawText'],
          message: issue.path[0] === 'name' ? parsedNameProblem(read.name) : issue.message,
        });
      }
    } else {
      for (const issue of issues) {
        const [part = 'rawText'] = issue.path;
        context.issues.push({
          code: 'custom',
          input: line,
          path: part === 'rawText' ? ['rawText'] : ['details', String(part)],
          message: issue.message,
        });
      }
    }
    return result.success && context.issues.length === 0 ? result.data : z.NEVER;
  });

/** A group as the API takes it, or `null` for one with no lines and no name, which is left out. */
const ingredientGroupSchema = z
  .object({
    label: ingredientGroupInputSchema.shape.label,
    ingredients: z.array(ingredientLineSchema),
  })
  .transform(({ label, ingredients }, context) => {
    const lines = ingredients.filter((line) => line !== null);
    if (lines.length > 0) return { label: label === '' ? null : label, ingredients: lines };
    if (label !== null && label !== '') {
      context.issues.push({
        code: 'custom',
        input: ingredients,
        path: ['ingredients'],
        message: 'Add an ingredient to the group, or remove the group.',
      });
    }
    return null;
  });

/**
 * A step as the API takes it, or `null` for a blank one, which is left out once it's checked. One
 * with a photo isn't blank: it still needs its words.
 */
const stepSchema = z
  .object({ body: z.string(), image: content.steps.element.shape.image })
  .transform((step, context) => {
    if (step.body.trim() === '' && step.image === null) return null;
    const result = content.steps.element.safeParse(step);
    for (const issue of result.error?.issues ?? []) {
      context.issues.push({
        code: 'custom',
        input: step,
        path: issue.path,
        message: issue.message,
      });
    }
    return result.success ? result.data : z.NEVER;
  });

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
    ingredientGroups: z
      .array(ingredientGroupSchema)
      .transform((groups, context) => {
        const kept = groups.filter((group) => group !== null);
        // On the section as a whole, like the limits below it.
        if (kept.flatMap((group) => group.ingredients).length > L.ingredients) {
          context.issues.push({
            code: 'custom',
            input: groups,
            message: `A recipe can have up to ${String(L.ingredients)} ingredients.`,
          });
        }
        return kept;
      })
      .pipe(content.ingredientGroups),
    description: content.description,
    steps: z
      .array(stepSchema)
      .transform((steps) => steps.filter((step) => step !== null))
      .pipe(content.steps),
    tagIds: content.tagIds,
    images: content.images,
    coverImageId: content.coverImageId,
    /** Chosen only when creating a recipe. Afterwards it's changed on its own, by the owner. */
    visibility: visibilitySchema,
  })
  .transform(({ visibility, ...recipe }) => ({ content: recipe, visibility }));

export type RecipeFormValues = z.input<typeof recipeFormSchema>;
export type RecipeFormResult = z.output<typeof recipeFormSchema>;

/** Every text field of the form, by its path. */
export const RECIPE_TEXT_FIELDS = [
  'title',
  'description',
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

/**
 * The recipe's photos and its steps': each one, which the API refuses one by one when it can't
 * use it, and its alt text.
 */
const PHOTO_FIELDS = [
  'images',
  ...Array.from({ length: RECIPE_LIMITS.images }, (_, index) =>
    (['id', 'alt'] as const).map((part) => `images[${String(index)}].${part}` as const),
  ).flat(),
  'coverImageId',
  ...Array.from({ length: RECIPE_LIMITS.steps }, (_, index) =>
    (['id', 'alt'] as const).map((part) => `steps[${String(index)}].image.${part}` as const),
  ).flat(),
] as const;

/** Every field of the form, by its path, for the API's field errors. */
export const RECIPE_FORM_FIELDS = [...RECIPE_TEXT_FIELDS, ...PHOTO_FIELDS] as const;

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
      ingredientGroups: [emptyGroup()],
      steps: [emptyStep()],
      tagIds: [],
      images: [],
      coverImageId: null,
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
    ingredientGroups:
      recipe.ingredientGroups.length === 0
        ? [emptyGroup()]
        : recipe.ingredientGroups.map((group) => ({
            label: group.label ?? '',
            ingredients: group.ingredients.map(lineValues),
          })),
    steps:
      recipe.steps.length === 0
        ? [emptyStep()]
        : recipe.steps.map(({ body, image }) => ({
            body,
            image: image && { id: image.id, alt: image.alt },
          })),
    tagIds: recipe.tags.map((tag) => tag.id),
    images: recipe.images.map(({ id, alt }) => ({ id, alt })),
    coverImageId: recipe.coverImageId,
    visibility: recipe.visibility,
  };
}

const FRACTIONS = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
] as const;

/**
 * A quantity as it's typed back: "1½" or "⅓" for the fractions cooks use, which `parseQuantity`
 * reads as the same number, or else the number as it is.
 */
export function quantityText(value: number | null): string {
  if (value === null) return '';
  const whole = Math.floor(value);
  const fraction = FRACTIONS.find(([part]) => Math.abs(value - whole - part) < 1e-9);
  if (!fraction) return String(value);
  return whole === 0 ? fraction[1] : `${String(whole)}${fraction[1]}`;
}

/** A saved line: corrected by hand when it isn't what the parser reads from its text. */
function lineValues(line: IngredientLine): IngredientLineValues {
  const read = parseIngredient(line.rawText);
  const asRead =
    read.qty === line.qty &&
    read.qtyMax === line.qtyMax &&
    read.unit === line.unit &&
    read.name === line.name &&
    read.note === line.note &&
    read.scalable === line.scalable;
  return {
    rawText: line.rawText,
    details: asRead
      ? null
      : {
          qty: quantityText(line.qty),
          qtyMax: quantityText(line.qtyMax),
          unit: line.unit ?? '',
          name: line.name,
          note: line.note ?? '',
          scalable: line.scalable,
        },
  };
}
