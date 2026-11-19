import { describe, expect, it } from 'vitest';
import { formatMinutes, nutritionFacts, showLine, shownTags } from './format.ts';
import type { IngredientLine } from './recipe.ts';

const line = (overrides: Partial<IngredientLine>): IngredientLine => ({
  rawText: '',
  qty: null,
  qtyMax: null,
  unit: null,
  name: 'flour',
  normalizedName: 'flour',
  note: null,
  scalable: true,
  ...overrides,
});
const asWritten = { system: 'imperial', factor: 1 } as const;

describe('formatMinutes', () => {
  it('shows minutes, hours, or both', () => {
    expect([0, 45, 60, 90, 1500].map(formatMinutes)).toEqual([
      '0 min',
      '45 min',
      '1 hr',
      '1 hr 30 min',
      '25 hr',
    ]);
  });
});

describe('showLine', () => {
  it('shows the amount, the name and the note apart', () => {
    expect(
      showLine(line({ qty: 1.5, unit: 'cup', name: 'milk', note: 'warm' }), asWritten),
    ).toEqual({ amount: '1½ cups', name: 'milk', note: 'warm' });
  });

  it('shows ranges, counts and units typed by hand', () => {
    expect(showLine(line({ qty: 2, qtyMax: 3, unit: 'clove' }), asWritten).amount).toBe(
      '2–3 cloves',
    );
    expect(showLine(line({ qty: 2, name: 'eggs' }), asWritten).amount).toBe('2');
    expect(showLine(line({ qty: 1, unit: 'handful' }), asWritten).amount).toBe('1 handful');
  });

  it('reads a unit with no quantity as it was written: "pinch of salt"', () => {
    expect(showLine(line({ unit: 'pinch', name: 'salt' }), asWritten)).toEqual({
      amount: 'pinch of',
      name: 'salt',
      note: null,
    });
  });

  it('shows nothing for a line with no amount', () => {
    expect(showLine(line({ name: 'salt', note: 'to taste' }), asWritten).amount).toBe('');
  });

  it('scales by the factor, except lines that don’t scale', () => {
    expect(showLine(line({ qty: 1, unit: 'cup' }), { ...asWritten, factor: 2 }).amount).toBe(
      '2 cups',
    );
    expect(
      showLine(line({ qty: 1, unit: 'tbsp', scalable: false }), { ...asWritten, factor: 2 }).amount,
    ).toBe('1 tbsp');
  });
});

describe('shownTags', () => {
  it('puts the allergens apart, and the rest in order of type, keeping their order within it', () => {
    const { tags, allergens } = shownTags([
      { id: 1, type: 'custom', name: 'Weeknight' },
      { id: 2, type: 'allergen', name: 'milk' },
      { id: 3, type: 'diet', name: 'Vegetarian' },
      { id: 4, type: 'cuisine', name: 'Italian' },
      { id: 5, type: 'allergen', name: 'wheat' },
      { id: 6, type: 'meal_type', name: 'Lunch' },
      { id: 7, type: 'meal_type', name: 'Dinner' },
    ]);
    expect(tags.map(({ name }) => name)).toEqual([
      'Italian',
      'Lunch',
      'Dinner',
      'Vegetarian',
      'Weeknight',
    ]);
    expect(allergens.map(({ name }) => name)).toEqual(['milk', 'wheat']);
  });
});

describe('nutritionFacts', () => {
  it('lists what the recipe states, with units, and leaves out the rest', () => {
    expect(
      nutritionFacts({
        calories: 1250,
        proteinGrams: 6,
        carbsGrams: null,
        fatGrams: 2.25,
        fiberGrams: null,
        sugarGrams: 0,
        sodiumMilligrams: 380,
      }),
    ).toEqual([
      { label: 'Calories', value: (1250).toLocaleString() },
      { label: 'Protein', value: '6 g' },
      { label: 'Fat', value: `${(2.3).toLocaleString()} g` },
      { label: 'Sugar', value: '0 g' },
      { label: 'Sodium', value: '380 mg' },
    ]);
  });
});
