import { normalizeIngredientName } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { INGREDIENT_SYNONYMS, RECIPES_SETTINGS, synonymGroup } from './settings.ts';

describe('INGREDIENT_SYNONYMS', () => {
  it('names each ingredient as recipes’ ingredient names are read, so filters find them', () => {
    for (const name of INGREDIENT_SYNONYMS.flat()) expect(normalizeIngredientName(name)).toBe(name);
  });

  it('puts each name in one group only, of two names at least', () => {
    const names = INGREDIENT_SYNONYMS.flat();
    expect(new Set(names).size).toBe(names.length);
    for (const group of INGREDIENT_SYNONYMS) expect(group.length).toBeGreaterThan(1);
  });

  it('becomes Meilisearch synonyms in every direction', () => {
    expect(RECIPES_SETTINGS.synonyms.scallion).toEqual(['green onion', 'spring onion']);
    expect(RECIPES_SETTINGS.synonyms['spring onion']).toEqual(['scallion', 'green onion']);
    expect(Object.keys(RECIPES_SETTINGS.synonyms)).toHaveLength(INGREDIENT_SYNONYMS.flat().length);
  });
});

describe('synonymGroup', () => {
  it('gives every name that means the same, or just the name', () => {
    expect(synonymGroup('prawn')).toEqual(['shrimp', 'prawn']);
    expect(synonymGroup('tofu')).toEqual(['tofu']);
  });
});
