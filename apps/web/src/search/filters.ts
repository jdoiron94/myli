import type { RecipeSearchQuery } from '@myli/shared';
import { formatMinutes } from '@/recipes/format.ts';
import type { SearchResult } from './search.ts';

/** How the search page's filters narrow a search (spec §3.4), apart from the words searched for. */

type Facets = SearchResult['facets'];

/** A filter by tags of one type, which can include some and leave out others. */
export interface TagFilter {
  facet: 'cuisine' | 'mealType' | 'diet' | 'tag';
  include: 'cuisine' | 'mealType' | 'diet' | 'tag';
  exclude: 'excludeCuisine' | 'excludeMealType' | 'excludeDiet' | 'excludeTag';
  legend: string;
  /** What checking several finds: recipes with any of them, or with all of them. */
  combine: 'any' | 'all';
  /** "Show all 12 cuisines". */
  plural: string;
}

export const TAG_FILTERS: readonly TagFilter[] = [
  {
    facet: 'cuisine',
    include: 'cuisine',
    exclude: 'excludeCuisine',
    legend: 'Cuisine',
    combine: 'any',
    plural: 'cuisines',
  },
  {
    facet: 'mealType',
    include: 'mealType',
    exclude: 'excludeMealType',
    legend: 'Meal',
    combine: 'any',
    plural: 'meals',
  },
  {
    facet: 'diet',
    include: 'diet',
    exclude: 'excludeDiet',
    legend: 'Diet',
    combine: 'all',
    plural: 'diets',
  },
  {
    facet: 'tag',
    include: 'tag',
    exclude: 'excludeTag',
    legend: 'Other tags',
    combine: 'all',
    plural: 'tags',
  },
];

export type ValueState = 'included' | 'excluded' | null;

export interface FilterValue {
  value: string;
  state: ValueState;
  /** How many results have it, or with an any-of filter, how many adding it would give. */
  count: number;
}

/**
 * A tag filter's values: those the results have, most common first, and those chosen that none
 * have. Values left out have no count, since no result has them.
 */
export function filterValues(
  filter: TagFilter,
  search: RecipeSearchQuery,
  facets: Facets,
): FilterValue[] {
  const counts = facets[filter.facet];
  const included = search[filter.include] ?? [];
  const excluded = search[filter.exclude] ?? [];
  const values = new Set([...Object.keys(counts), ...included, ...excluded]);
  return [...values]
    .map((value): FilterValue => {
      const state = included.includes(value)
        ? 'included'
        : excluded.includes(value)
          ? 'excluded'
          : null;
      return { value, state, count: counts[value] ?? 0 };
    })
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** The values a filter shows until asked for all: the most common, and every one chosen. */
export function shortList(values: FilterValue[], length: number): FilterValue[] {
  return values.filter((item, index) => index < length || item.state !== null);
}

/** The changes to the search that include `value`, leave it out, or neither. */
export function setValueState(
  filter: TagFilter,
  search: RecipeSearchQuery,
  value: string,
  state: ValueState,
): Partial<RecipeSearchQuery> {
  const others = (list: string[] | undefined) => (list ?? []).filter((item) => item !== value);
  const changes: Partial<RecipeSearchQuery> = {};
  changes[filter.include] = [
    ...others(search[filter.include]),
    ...(state === 'included' ? [value] : []),
  ];
  changes[filter.exclude] = [
    ...others(search[filter.exclude]),
    ...(state === 'excluded' ? [value] : []),
  ];
  return changes;
}

/** A bound on the total time, offered as a choice. */
export interface TimeRange {
  value: string;
  label: string;
  minMinutes?: number;
  maxMinutes?: number;
}

export const TIME_RANGES: readonly TimeRange[] = [
  { value: 'any', label: 'Any time' },
  { value: 'max-15', label: '15 min or less', maxMinutes: 15 },
  { value: 'max-30', label: '30 min or less', maxMinutes: 30 },
  { value: 'max-60', label: '1 hr or less', maxMinutes: 60 },
  { value: 'max-120', label: '2 hr or less', maxMinutes: 120 },
  { value: 'min-121', label: 'Over 2 hr', minMinutes: 121 },
];

/**
 * The time ranges to offer for this search: the usual ones, and the search's own when it's another,
 * as from a link written by hand. The second is the one chosen.
 */
export function timeRanges(search: RecipeSearchQuery): [TimeRange[], TimeRange] {
  const { minMinutes, maxMinutes } = search;
  const chosen = TIME_RANGES.find(
    (range) => range.minMinutes === minMinutes && range.maxMinutes === maxMinutes,
  );
  if (chosen) return [[...TIME_RANGES], chosen];
  const own: TimeRange = {
    value: 'own',
    label:
      minMinutes === undefined
        ? `${formatMinutes(maxMinutes ?? 0)} or less`
        : maxMinutes === undefined
          ? `${formatMinutes(minMinutes)} or more`
          : `${formatMinutes(minMinutes)} to ${formatMinutes(maxMinutes)}`,
    ...(minMinutes !== undefined && { minMinutes }),
    ...(maxMinutes !== undefined && { maxMinutes }),
  };
  return [[...TIME_RANGES, own], own];
}

/** The keys of every filter that holds values. */
const VALUE_KEYS = [
  'ingredient',
  ...TAG_FILTERS.flatMap(({ include, exclude }) => [include, exclude]),
  'excludeAllergen',
  'difficulty',
] as const;

/** How many filters' values are chosen, a time range counting as one. */
export function chosenCount(search: RecipeSearchQuery): number {
  const values = VALUE_KEYS.reduce((sum, key) => sum + (search[key]?.length ?? 0), 0);
  const timed = search.minMinutes !== undefined || search.maxMinutes !== undefined;
  return values + (timed ? 1 : 0);
}

/** The changes to the search that clear every filter, keeping the words and the order. */
export function clearedFilters(): Partial<RecipeSearchQuery> {
  return {
    ...Object.fromEntries(VALUE_KEYS.map((key) => [key, []])),
    minMinutes: undefined,
    maxMinutes: undefined,
  };
}
