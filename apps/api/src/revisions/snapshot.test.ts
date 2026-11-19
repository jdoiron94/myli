import { describe, expect, it } from 'vitest';
import { readSnapshot } from './snapshot.ts';

/**
 * A snapshot as version 1 of the format stores it. Stored snapshots are never rewritten, so this
 * must always read: if a change to the format breaks it, bump `schemaVersion` and upgrade the old
 * ones in `readSnapshot` (ADR 0007), keeping this test as it is.
 */
const STORED_V1 = {
  schemaVersion: 1,
  title: 'Weeknight Bread',
  description: 'A *simple* loaf.',
  source: { url: 'https://example.com/bread', title: 'Example Bakes', author: null },
  equipment: ['Loaf pan'],
  yield: { qty: 1, unit: 'loaf' },
  servings: 8,
  prepMinutes: 20,
  cookMinutes: 40,
  totalMinutes: null,
  difficulty: 'easy',
  nutrition: {
    calories: 210,
    proteinGrams: null,
    carbsGrams: null,
    fatGrams: null,
    fiberGrams: null,
    sugarGrams: null,
    sodiumMilligrams: null,
  },
  ingredientGroups: [
    {
      label: 'Dough',
      ingredients: [
        {
          rawText: '3 cups all-purpose flour, sifted',
          qty: 3,
          qtyMax: null,
          unit: 'cup',
          name: 'all-purpose flour',
          normalizedName: 'all purpose flour',
          note: 'sifted',
          scalable: true,
        },
      ],
    },
  ],
  steps: [
    { body: 'Mix everything.', image: null },
    { body: 'Bake at **400°F**.', image: { id: 'photo-2', alt: '' } },
  ],
  tags: [{ id: 3, type: 'allergen', name: 'wheat' }],
  images: [{ id: 'photo-1', alt: 'A loaf on a board.' }],
  coverImageId: 'photo-1',
};

describe('a stored snapshot', () => {
  it('reads as the current format, as it was stored', () => {
    expect(readSnapshot(structuredClone(STORED_V1))).toEqual(STORED_V1);
  });
});
