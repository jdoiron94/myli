import { describe, expect, it } from 'vitest';
import { NO_SEARCH_RESULTS } from '@/testing.ts';
import {
  chosenCount,
  clearedFilters,
  filterValues,
  setValueState,
  shortList,
  TAG_FILTERS,
  type TagFilter,
  timeRanges,
} from './filters.ts';
import { queryFromSearch, searchFromQuery } from './search.ts';

const filter = (facet: TagFilter['facet']) => {
  const found = TAG_FILTERS.find((item) => item.facet === facet);
  if (!found) throw new Error(facet);
  return found;
};
const cuisine = filter('cuisine');
const facets = (cuisines: Record<string, number>) => ({
  ...NO_SEARCH_RESULTS.facets,
  cuisine: cuisines,
});

describe('filterValues', () => {
  it('lists what the results have, most common first, then by name', () => {
    expect(
      filterValues(cuisine, searchFromQuery({}), facets({ Thai: 2, Italian: 5, Greek: 2 })),
    ).toEqual([
      { value: 'Italian', state: null, count: 5 },
      { value: 'Greek', state: null, count: 2 },
      { value: 'Thai', state: null, count: 2 },
    ]);
  });

  it('marks what’s chosen, keeping values chosen that no result has', () => {
    const search = searchFromQuery({ cuisine: ['Thai', 'Basque'], excludeCuisine: 'Greek' });

    expect(filterValues(cuisine, search, facets({ Thai: 2, Italian: 5 }))).toEqual([
      { value: 'Italian', state: null, count: 5 },
      { value: 'Thai', state: 'included', count: 2 },
      { value: 'Basque', state: 'included', count: 0 },
      { value: 'Greek', state: 'excluded', count: 0 },
    ]);
  });
});

describe('shortList', () => {
  it('keeps the first values, and every one chosen after them', () => {
    const values = filterValues(
      cuisine,
      searchFromQuery({ excludeCuisine: 'Greek' }),
      facets({ Thai: 3, Italian: 2, Mexican: 1 }),
    );

    expect(shortList(values, 2).map(({ value }) => value)).toEqual(['Thai', 'Italian', 'Greek']);
  });
});

describe('setValueState', () => {
  const search = searchFromQuery({ diet: ['Vegan', 'Keto'], excludeDiet: 'Paleo' });
  const diet = filter('diet');

  it('includes a value, taking it out of those left out', () => {
    expect(setValueState(diet, search, 'Paleo', 'included')).toEqual({
      diet: ['Vegan', 'Keto', 'Paleo'],
      excludeDiet: [],
    });
  });

  it('leaves a value out, taking it out of those included', () => {
    expect(setValueState(diet, search, 'Keto', 'excluded')).toEqual({
      diet: ['Vegan'],
      excludeDiet: ['Paleo', 'Keto'],
    });
  });

  it('takes a value out of both', () => {
    expect(setValueState(diet, search, 'Vegan', null)).toEqual({
      diet: ['Keto'],
      excludeDiet: ['Paleo'],
    });
  });
});

describe('timeRanges', () => {
  it('offers the usual ranges, with the search’s chosen', () => {
    const [ranges, chosen] = timeRanges(searchFromQuery({ maxMinutes: '30' }));

    expect(ranges.map(({ label }) => label)).toEqual([
      'Any time',
      '15 min or less',
      '30 min or less',
      '1 hr or less',
      '2 hr or less',
      'Over 2 hr',
    ]);
    expect(chosen.label).toBe('30 min or less');
    expect(timeRanges(searchFromQuery({}))[1].label).toBe('Any time');
  });

  it.each([
    [
      { minMinutes: '20', maxMinutes: '45' },
      '20 min to 45 min',
      { minMinutes: 20, maxMinutes: 45 },
    ],
    [{ minMinutes: '90' }, '1 hr 30 min or more', { minMinutes: 90 }],
    [{ maxMinutes: '10' }, '10 min or less', { maxMinutes: 10 }],
  ])('adds the search’s own range when it’s another: %o', (query, label, bounds) => {
    const [ranges, chosen] = timeRanges(searchFromQuery(query));

    expect(ranges).toHaveLength(7);
    expect(ranges.at(-1)).toBe(chosen);
    expect(chosen).toEqual({ value: 'own', label, ...bounds });
  });
});

describe('chosenCount and clearedFilters', () => {
  it('counts every value chosen, and a time range as one', () => {
    const search = searchFromQuery({
      q: 'soup',
      ingredient: 'basil',
      cuisine: ['Thai', 'Italian'],
      excludeTag: 'Party',
      excludeAllergen: 'milk',
      difficulty: 'easy',
      minMinutes: '10',
      maxMinutes: '30',
      sort: 'quickest',
    });

    expect(chosenCount(search)).toBe(7);
    expect(chosenCount(searchFromQuery({ q: 'soup' }))).toBe(0);
  });

  it('clears every filter, keeping the words and the order', () => {
    const search = searchFromQuery({
      q: 'soup',
      in: 'ingredients',
      ingredient: 'basil',
      diet: 'Vegan',
      excludeMealType: 'Dessert',
      excludeAllergen: 'milk',
      difficulty: 'easy',
      maxMinutes: '30',
      sort: 'quickest',
    });

    expect(queryFromSearch({ ...search, ...clearedFilters() })).toEqual({
      q: 'soup',
      in: 'ingredients',
      sort: 'quickest',
    });
  });
});
