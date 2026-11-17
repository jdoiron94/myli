import { recipeSearchQuerySchema } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { accessFilter, quote, searchFilter, searchSort } from './query.ts';

const query = (params: Record<string, unknown>) => recipeSearchQuerySchema.parse(params);
const ACCESS = 'deleted = false AND (visibility = "shared" OR ownerId = "me")';

describe('quote', () => {
  it('quotes a value, so quotes and backslashes in it can’t end it early', () => {
    expect(quote('Italian')).toBe('"Italian"');
    expect(quote('Grandma\'s "best"')).toBe('"Grandma\'s \\"best\\""');
    expect(quote('a\\" OR ownerId = "x')).toBe('"a\\\\\\" OR ownerId = \\"x"');
  });
});

describe('accessFilter', () => {
  it('limits a query to shared recipes and the caller’s own', () => {
    expect(accessFilter('me')).toBe(ACCESS);
    expect(accessFilter('"x" OR 1')).toBe(
      'deleted = false AND (visibility = "shared" OR ownerId = "\\"x\\" OR 1")',
    );
  });
});

describe('searchFilter', () => {
  it('is only the access filter with nothing chosen', () => {
    expect(searchFilter(query({}), 'me')).toEqual([ACCESS]);
  });

  it('takes any of a cuisine’s, meal’s or difficulty’s values, and all of the diets and tags', () => {
    const filter = searchFilter(
      query({
        cuisine: ['Thai', 'Italian'],
        mealType: 'Dinner',
        difficulty: ['easy', 'medium'],
        diet: ['Vegetarian', 'Gluten-free'],
        tag: 'Weeknight',
      }),
      'me',
    );

    expect(filter).toEqual([
      ACCESS,
      'cuisine IN ["Thai", "Italian"]',
      'mealType IN ["Dinner"]',
      'difficulty IN ["easy", "medium"]',
      'diet = "Vegetarian"',
      'diet = "Gluten-free"',
      'customTags = "Weeknight"',
    ]);
  });

  it('excludes recipes with any of the values excluded, allergens included', () => {
    const filter = searchFilter(
      query({
        excludeCuisine: 'Thai',
        excludeMealType: ['Breakfast'],
        excludeDiet: 'Keto',
        excludeTag: ['Holiday', 'Party'],
        excludeAllergen: ['milk', 'peanuts'],
      }),
      'me',
    );

    expect(filter).toEqual([
      ACCESS,
      'cuisine NOT IN ["Thai"]',
      'mealType NOT IN ["Breakfast"]',
      'diet NOT IN ["Keto"]',
      'customTags NOT IN ["Holiday", "Party"]',
      'allergens NOT IN ["milk", "peanuts"]',
    ]);
  });

  it('requires every ingredient chosen, each by any name that means the same', () => {
    expect(searchFilter(query({ ingredient: ['Scallions', 'tofu'] }), 'me')).toEqual([
      ACCESS,
      'normalizedIngredientNames IN ["scallion", "green onion", "spring onion"]',
      'normalizedIngredientNames IN ["tofu"]',
    ]);
  });

  it('refuses an ingredient that reads as nothing', () => {
    expect(recipeSearchQuerySchema.safeParse({ ingredient: '(chopped)' }).success).toBe(false);
  });

  it('bounds the total time, at either end or both', () => {
    expect(searchFilter(query({ minMinutes: '10' }), 'me')).toEqual([ACCESS, 'totalMinutes >= 10']);
    expect(searchFilter(query({ minMinutes: '0', maxMinutes: '30' }), 'me')).toEqual([
      ACCESS,
      'totalMinutes >= 0',
      'totalMinutes <= 30',
    ]);
  });

  it('leaves out one any-of filter’s choices when counting its values', () => {
    const chosen = query({ cuisine: 'Thai', mealType: 'Dinner', diet: 'Vegan' });

    expect(searchFilter(chosen, 'me', 'cuisine')).toEqual([
      ACCESS,
      'mealType IN ["Dinner"]',
      'diet = "Vegan"',
    ]);
  });
});

describe('searchSort', () => {
  it('orders by relevance with a query, and newest first without one', () => {
    expect(searchSort(query({ q: 'soup' }))).toBeUndefined();
    expect(searchSort(query({}))).toEqual(['publishedAt:desc']);
    expect(searchSort(query({ q: '   ' }))).toEqual(['publishedAt:desc']);
    expect(searchSort(query({ sort: 'relevance' }))).toEqual(['publishedAt:desc']);
  });

  it('orders as chosen', () => {
    expect(searchSort(query({ q: 'soup', sort: 'newest' }))).toEqual(['publishedAt:desc']);
    expect(searchSort(query({ sort: 'rating' }))).toEqual(['ratingScore:desc', 'publishedAt:desc']);
    expect(searchSort(query({ sort: 'quickest' }))).toEqual(['totalMinutes:asc']);
    expect(searchSort(query({ sort: 'slowest' }))).toEqual(['totalMinutes:desc']);
  });
});
