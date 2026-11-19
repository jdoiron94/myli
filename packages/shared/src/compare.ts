import { diffArrays, diffWordsWithSpace } from 'diff';
import type { Image } from './image.ts';
import type { RecipeRevisionContent } from './revision.ts';
import type { Tag } from './tags.ts';

/** A run of text that both versions have, or only the later one, or only the earlier one. */
export interface TextPart {
  change: 'same' | 'added' | 'removed';
  text: string;
}

const changeOf = ({ added, removed }: { added: boolean; removed: boolean }) => {
  if (added) return 'added';
  return removed ? 'removed' : 'same';
};

/**
 * How two versions of a text differ, word by word. Whitespace counts, since in markdown a line break
 * does: the parts that aren't added make up `before`, and those that aren't removed, `after`.
 */
export function diffText(before: string, after: string): TextPart[] {
  return diffWordsWithSpace(before, after).map((part) => ({
    change: changeOf(part),
    text: part.value,
  }));
}

/** An entry of a list compared between two versions: in both alike, in only one, or changed. */
export type ListEntry<T> =
  | { change: 'same' | 'added' | 'removed'; item: T }
  | { change: 'changed'; before: T; after: T };

export interface ListComparison<T> {
  /** Whether two entries are one entry, unchanged. */
  same: (a: T, b: T) => boolean;
  /**
   * Whether an entry taken out and one put in at its place are one entry, changed, rather than two.
   * Any two are, unless this says otherwise.
   */
  pairable?: (before: T, after: T) => boolean;
}

/**
 * How two versions of a list differ, in order: the entries both have, those only the earlier one has
 * and those only the later one has. Where entries were taken out and others put in at their place,
 * each pairable one taken out and the one put in at its place are one entry, changed. The entries
 * that aren't added make up `before`, and those that aren't removed, `after`.
 */
export function diffList<T>(
  before: readonly T[],
  after: readonly T[],
  { same, pairable = () => true }: ListComparison<T>,
): ListEntry<T>[] {
  const entries: ListEntry<T>[] = [];
  let taken: T[] = [];
  let put: T[] = [];
  const settle = () => {
    const paired = Math.min(taken.length, put.length);
    taken.slice(0, paired).forEach((was, index) => {
      const is = put[index] as T;
      if (pairable(was, is)) entries.push({ change: 'changed', before: was, after: is });
      else entries.push({ change: 'removed', item: was }, { change: 'added', item: is });
    });
    for (const item of taken.slice(paired)) entries.push({ change: 'removed', item });
    for (const item of put.slice(paired)) entries.push({ change: 'added', item });
    taken = [];
    put = [];
  };
  for (const part of diffArrays([...before], [...after], { comparator: same })) {
    if (part.removed) taken.push(...part.value);
    else if (part.added) put.push(...part.value);
    else {
      settle();
      for (const item of part.value) entries.push({ change: 'same', item });
    }
  }
  settle();
  return entries;
}

/** Whether two values from the API are the same, all the way down. */
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length && keys.every((key) => equal(left[key], right[key]))
  );
}

/** The parts of a recipe that hold one value each, in the order its page shows them. */
export const RECIPE_DETAILS = [
  'title',
  'coverImageId',
  'source',
  'prepMinutes',
  'cookMinutes',
  'totalMinutes',
  'servings',
  'yield',
  'difficulty',
] as const satisfies readonly (keyof RecipeRevisionContent)[];

export type RecipeDetail = (typeof RECIPE_DETAILS)[number];

export type Nutrient = keyof RecipeRevisionContent['nutrition'];

/** The nutrients a recipe has, in the order its page lists them. */
export const NUTRIENTS = [
  'calories',
  'proteinGrams',
  'carbsGrams',
  'fatGrams',
  'fiberGrams',
  'sugarGrams',
  'sodiumMilligrams',
] as const satisfies readonly Nutrient[];

/** A line of a recipe's ingredients as it reads: a group's label, or an ingredient as typed. */
export interface IngredientRow {
  kind: 'group' | 'line';
  text: string;
}

export type RecipeStep = RecipeRevisionContent['steps'][number];

/** How two versions of a recipe differ. Each list is `null` when it's the same in both. */
export interface RecipeComparison {
  /** The details that differ, in `RECIPE_DETAILS`' order. */
  details: RecipeDetail[];
  description: TextPart[] | null;
  /** By ID, so a tag renamed in between is the same tag. */
  tags: ListEntry<Tag>[] | null;
  /** A photo whose alt text changed is changed. */
  photos: ListEntry<Image>[] | null;
  ingredients: ListEntry<IngredientRow>[] | null;
  equipment: ListEntry<string>[] | null;
  /** A step whose text or photo changed is changed. */
  steps: ListEntry<RecipeStep>[] | null;
  /** The nutrients that differ, in `NUTRIENTS`' order. */
  nutrition: Nutrient[];
}

const changedOnly = <T>(entries: ListEntry<T>[]) =>
  entries.some(({ change }) => change !== 'same') ? entries : null;

const ingredientRows = ({ ingredientGroups }: RecipeRevisionContent): IngredientRow[] =>
  ingredientGroups.flatMap(({ label, ingredients }) => [
    ...(label === null ? [] : [{ kind: 'group' as const, text: label }]),
    ...ingredients.map(({ rawText }) => ({ kind: 'line' as const, text: rawText })),
  ]);

/** Tags by ID: the later version's in its order, each there before or added, then those removed. */
function compareTags(before: Tag[], after: Tag[]): ListEntry<Tag>[] {
  const was = new Set(before.map(({ id }) => id));
  const is = new Set(after.map(({ id }) => id));
  return [
    ...after.map((item) => ({
      change: was.has(item.id) ? ('same' as const) : ('added' as const),
      item,
    })),
    ...before.filter(({ id }) => !is.has(id)).map((item) => ({ change: 'removed' as const, item })),
  ];
}

const sameStep = (a: RecipeStep, b: RecipeStep) =>
  a.body === b.body && a.image?.id === b.image?.id && a.image?.alt === b.image?.alt;

/**
 * How two versions of a recipe differ (spec §3.3): each detail, the description word by word, and
 * each list entry by entry. Computed when shown, never stored.
 */
export function compareRecipes(
  before: RecipeRevisionContent,
  after: RecipeRevisionContent,
): RecipeComparison {
  return {
    details: RECIPE_DETAILS.filter((detail) => !equal(before[detail], after[detail])),
    description:
      before.description === after.description
        ? null
        : diffText(before.description, after.description),
    tags: changedOnly(compareTags(before.tags, after.tags)),
    photos: changedOnly(
      diffList(before.images, after.images, {
        same: (a, b) => a.id === b.id && a.alt === b.alt,
        pairable: (a, b) => a.id === b.id,
      }),
    ),
    ingredients: changedOnly(
      diffList(ingredientRows(before), ingredientRows(after), {
        same: (a, b) => a.kind === b.kind && a.text === b.text,
        pairable: (a, b) => a.kind === b.kind,
      }),
    ),
    equipment: changedOnly(diffList(before.equipment, after.equipment, { same: Object.is })),
    steps: changedOnly(diffList(before.steps, after.steps, { same: sameStep })),
    nutrition: NUTRIENTS.filter(
      (nutrient) => before.nutrition[nutrient] !== after.nutrition[nutrient],
    ),
  };
}
