import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  convert,
  DEFAULT_UNIT_SYSTEM,
  dimensionOf,
  findUnit,
  resolveUnit,
  UNITS,
  type Unit,
  unitSystemSchema,
} from './units.ts';

function unit(name: string): Unit {
  const found = UNITS.get(name);
  if (!found) throw new Error(`no unit ${name}`);
  return found;
}

const MEASURES = [...UNITS.values()].filter(({ dimension }) => dimension !== null);
const NAMED = [...UNITS.values()].filter(({ dimension }) => dimension === null);

describe('unit systems', () => {
  it('are imperial and metric, imperial until a user chooses', () => {
    expect(unitSystemSchema.options).toEqual(['imperial', 'metric']);
    expect(DEFAULT_UNIT_SYSTEM).toBe('imperial');
  });
});

describe('findUnit', () => {
  it.each([
    ['teaspoons', 'tsp'],
    ['Tsp.', 'tsp'],
    ['t', 'tsp'],
    ['T', 'tbsp'],
    ['Tbsp', 'tbsp'],
    ['TABLESPOON', 'tbsp'],
    ['fl. oz.', 'fl oz'],
    ['fluid  ounces', 'fl oz'],
    ['c.', 'cup'],
    ['Cups', 'cup'],
    ['L', 'l'],
    ['litres', 'l'],
    ['lbs', 'lb'],
    ['ounce', 'oz'],
    ['Grams', 'g'],
    ['kilo', 'kg'],
    ['doz', 'dozen'],
    ['cloves', 'clove'],
    ['Pinch', 'pinch'],
  ])('reads %j as %s', (text, name) => {
    expect(findUnit(text)?.name).toBe(name);
  });

  it.each(['flour', 'tablespoonful', '', 'cupcakes', 'tb'])('finds no unit in %j', (text) => {
    expect(findUnit(text)).toBeUndefined();
  });

  it('finds every unit by its name and its plural', () => {
    for (const { name, plural } of UNITS.values()) {
      expect(findUnit(name)?.name).toBe(name);
      expect(findUnit(plural)?.name).toBe(name);
    }
  });
});

describe('resolveUnit', () => {
  it('gives the stored unit, a named unit for one typed by hand, and null for none', () => {
    expect(resolveUnit('cup')).toBe(unit('cup'));
    expect(resolveUnit('knob')).toEqual({
      name: 'knob',
      plural: 'knob',
      dimension: null,
      system: null,
      factor: 1,
    });
    expect(resolveUnit(null)).toBeNull();
  });
});

describe('convert', () => {
  it.each([
    [3, 'tsp', 1, 'tbsp'],
    [2, 'tbsp', 1, 'fl oz'],
    [8, 'fl oz', 1, 'cup'],
    [16, 'tbsp', 1, 'cup'],
    [48, 'tsp', 1, 'cup'],
    [2, 'cup', 1, 'pint'],
    [2, 'pint', 1, 'quart'],
    [4, 'quart', 1, 'gallon'],
    [1000, 'ml', 1, 'l'],
    [10, 'dl', 1, 'l'],
    [16, 'oz', 1, 'lb'],
    [1000, 'g', 1, 'kg'],
  ])('converts %d %s to %d %s exactly', (value, from, expected, to) => {
    expect(convert(value, unit(from), unit(to))).toBe(expected);
  });

  it.each([
    [1, 'cup', 236.5882365, 'ml'],
    [1, 'gallon', 3.785411784, 'l'],
    [1, 'lb', 453.59237, 'g'],
    [1, 'oz', 28.349523125, 'g'],
  ])('converts %d %s to %d %s between systems', (value, from, expected, to) => {
    expect(convert(value, unit(from), unit(to))).toBeCloseTo(expected, 9);
  });

  it('counts items: a dozen is 12, and a line with no unit is one item', () => {
    expect(convert(2, unit('dozen'), null)).toBe(24);
    expect(convert(6, null, unit('dozen'))).toBe(0.5);
    expect(dimensionOf(null)).toBe('count');
  });

  it('never converts volume to mass or back', () => {
    expect(convert(1, unit('cup'), unit('g'))).toBeUndefined();
    expect(convert(1, unit('oz'), unit('fl oz'))).toBeUndefined();
    expect(convert(1, unit('ml'), null)).toBeUndefined();
  });

  it('converts a named unit only to itself', () => {
    expect(convert(2, unit('clove'), unit('clove'))).toBe(2);
    expect(convert(2, unit('clove'), unit('can'))).toBeUndefined();
    expect(convert(2, unit('clove'), null)).toBeUndefined();
    expect(convert(2, resolveUnit('knob'), resolveUnit('knob'))).toBe(2);
  });

  it('returns the original value after converting there and back', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MEASURES),
        fc.constantFrom(...MEASURES),
        fc.double({ min: 1e-3, max: 1e6, noNaN: true }),
        (from, to, value) => {
          const there = convert(value, from, to);
          if (from.dimension !== to.dimension) return there === undefined;
          return Math.abs((convert(there ?? Number.NaN, to, from) ?? 0) - value) <= value * 1e-12;
        },
      ),
    );
  });

  it('gives the same result converting directly or through another unit', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MEASURES),
        fc.constantFrom(...MEASURES),
        fc.constantFrom(...MEASURES),
        fc.double({ min: 1e-3, max: 1e6, noNaN: true }),
        (a, b, c, value) => {
          fc.pre(a.dimension === b.dimension && b.dimension === c.dimension);
          const direct = convert(value, a, c) ?? Number.NaN;
          const through = convert(convert(value, a, b) ?? Number.NaN, b, c) ?? Number.NaN;
          return Math.abs(direct - through) <= Math.abs(direct) * 1e-12;
        },
      ),
    );
  });

  it('has a named unit for each thing that converts to nothing', () => {
    expect(NAMED.every(({ system, factor }) => system === null && factor === 1)).toBe(true);
  });
});
