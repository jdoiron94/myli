import { describe, expect, it } from 'vitest';
import { narrowed, queryFromSearch, searchFromQuery } from './search.ts';

describe('searchFromQuery', () => {
  it('reads the whole search from the address', () => {
    expect(
      searchFromQuery({
        q: 'soup',
        in: 'ingredients',
        cuisine: ['Thai', 'Italian'],
        diet: 'Vegan',
        excludeAllergen: 'milk',
        maxMinutes: '30',
        sort: 'quickest',
        page: '2',
      }),
    ).toEqual({
      q: 'soup',
      in: 'ingredients',
      cuisine: ['Thai', 'Italian'],
      diet: ['Vegan'],
      excludeAllergen: ['milk'],
      maxMinutes: 30,
      sort: 'quickest',
      page: 2,
    });
  });

  it('is every recipe, newest first, for an address with nothing in it', () => {
    expect(searchFromQuery({})).toEqual({ in: 'all', page: 1 });
  });

  it('leaves out what it can’t read, and searches for the rest', () => {
    expect(
      searchFromQuery({
        q: 'soup',
        page: 'two',
        difficulty: ['easy', 'extreme'],
        sort: 'alphabetical',
        minMinutes: '60',
        maxMinutes: '30',
        flag: null,
      }),
    ).toEqual({ q: 'soup', in: 'all', minMinutes: 60, page: 1 });
  });
});

describe('queryFromSearch', () => {
  it('writes only what differs from the defaults', () => {
    expect(queryFromSearch(searchFromQuery({}))).toEqual({});
    expect(queryFromSearch({ q: '', in: 'all', cuisine: [], page: 1 })).toEqual({});
  });

  it('writes back what it reads', () => {
    const query = {
      q: 'soup',
      in: 'ingredients',
      ingredient: ['basil', 'tomato'],
      excludeTag: ['Party'],
      minMinutes: '0',
      sort: 'newest',
      page: '3',
    };
    expect(queryFromSearch(searchFromQuery(query))).toEqual(query);
  });
});

describe('narrowed', () => {
  it('is whether the search leaves any recipe out, whatever its order or page', () => {
    expect(narrowed(searchFromQuery({ sort: 'quickest', page: '2' }))).toBe(false);
    expect(narrowed(searchFromQuery({ q: 'soup' }))).toBe(true);
    expect(narrowed(searchFromQuery({ excludeAllergen: 'milk' }))).toBe(true);
    expect(narrowed(searchFromQuery({ minMinutes: '0' }))).toBe(true);
  });
});
