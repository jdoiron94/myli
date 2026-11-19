import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { convert, dimensionOf, findUnit, resolveUnit, UNITS, type Unit } from './units.ts';

function unit(name: string): Unit {
  const found = UNITS.get(name);
  if (!found) throw new Error(`no unit ${name}`);
  return found;
}

const MEASURES = [...UNITS.values()].filter(({ dimension }) => dimension !== null);

describe('findUnit', () => {
  it('finds a unit however it’s written, and nothing in other words', () => {
    const units = {
      teaspoons: 'tsp',
      'Tsp.': 'tsp',
      t: 'tsp',
      T: 'tbsp',
      TABLESPOON: 'tbsp',
      'fl. oz.': 'fl oz',
      'fluid  ounces': 'fl oz',
      'c.': 'cup',
      L: 'l',
      litres: 'l',
      lbs: 'lb',
      kilo: 'kg',
      doz: 'dozen',
      flour: null,
      tablespoonful: null,
      cupcakes: null,
      tb: null,
    };
    expect(
      Object.fromEntries(Object.keys(units).map((text) => [text, findUnit(text)?.name ?? null])),
    ).toEqual(units);
    for (const { name, plural } of UNITS.values()) {
      expect([findUnit(name)?.name, findUnit(plural)?.name]).toEqual([name, name]);
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
  it('converts exactly within a system, and by the definitions between them', () => {
    expect([
      convert(3, unit('tsp'), unit('tbsp')),
      convert(48, unit('tsp'), unit('cup')),
      convert(4, unit('quart'), unit('gallon')),
      convert(1000, unit('ml'), unit('l')),
      convert(16, unit('oz'), unit('lb')),
    ]).toEqual([1, 1, 1, 1, 1]);
    expect(convert(1, unit('cup'), unit('ml'))).toBeCloseTo(236.5882365, 9);
    expect(convert(1, unit('lb'), unit('g'))).toBeCloseTo(453.59237, 9);
  });

  it('converts only between units that measure the same thing, counting a dozen as 12', () => {
    expect(convert(2, unit('dozen'), null)).toBe(24);
    expect(convert(6, null, unit('dozen'))).toBe(0.5);
    expect(dimensionOf(null)).toBe('count');
    expect(convert(1, unit('cup'), unit('g'))).toBeUndefined();
    expect(convert(1, unit('oz'), unit('fl oz'))).toBeUndefined();
    expect(convert(1, unit('ml'), null)).toBeUndefined();
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
});
