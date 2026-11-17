import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Amount,
  type DisplayOptions,
  displayAmount,
  formatAmount,
  scaleAmount,
  scaleFactor,
} from './quantities.ts';
import { convert, findUnit, resolveUnit, UNITS, type UnitSystem } from './units.ts';

interface ShowOptions extends Partial<DisplayOptions> {
  qtyMax?: number;
}

/** How a line asking for `qty` of `unit` is shown: imperial, unscaled and scalable by default. */
function show(qty: number | null, unit: string | null, options: ShowOptions = {}) {
  const { qtyMax = null, system = 'imperial', factor = 1, scalable = true } = options;
  return formatAmount(displayAmount({ qty, qtyMax, unit }, { system, factor, scalable }));
}

const SYMBOLS: Record<string, number> = {
  '⅛': 1 / 8,
  '¼': 1 / 4,
  '⅓': 1 / 3,
  '½': 1 / 2,
  '⅔': 2 / 3,
  '¾': 3 / 4,
};

/** The number a shown quantity stands for: "1½" is 1.5, and a range stands for its top. */
function shownValue(quantity: string): number {
  const top = quantity.split('–').at(-1) ?? '';
  const symbol = Object.keys(SYMBOLS).find((fraction) => top.includes(fraction));
  const whole = symbol ? top.replace(symbol, '') : top;
  return (whole === '' ? 0 : Number(whole)) + (symbol ? (SYMBOLS[symbol] ?? 0) : 0);
}

describe('scaleFactor', () => {
  it('is the new servings over the recipe’s own', () => {
    expect(scaleFactor(4, 6)).toBe(1.5);
    expect(scaleFactor(4, 2)).toBe(0.5);
  });

  it.each([
    [0, 4],
    [4, 0],
    [-2, 4],
    [Number.NaN, 4],
  ])('refuses %d servings scaled to %d', (baseline, servings) => {
    expect(() => scaleFactor(baseline, servings)).toThrow(RangeError);
  });
});

describe('displayAmount', () => {
  describe('at the recipe’s own servings, in the reader’s system', () => {
    it.each([
      [8, 'tbsp', '8 tbsp'],
      [1.5, 'cup', '1½ cups'],
      [0.5, 'cup', '½ cup'],
      [1 / 3, 'cup', '⅓ cup'],
      [1, 'cup', '1 cup'],
      [0.125, 'tsp', '⅛ tsp'],
      [1, 'pint', '1 pint'],
      [2, null, '2'],
      [2, 'clove', '2 cloves'],
      [1, 'clove', '1 clove'],
      [2, 'knob', '2 knob'],
    ])('shows %d %s as written: %j', (qty, unit, expected) => {
      expect(show(qty, unit)).toBe(expected);
    });

    it('shows a metric line as written to a metric reader', () => {
      expect(show(250, 'g', { system: 'metric' })).toBe('250 g');
      expect(show(1.5, 'l', { system: 'metric' })).toBe('1.5 l');
    });
  });

  describe('scaled, moving to the largest sensible unit', () => {
    it.each([
      [1, 'tsp', 48, '1 cup'],
      [1, 'tsp', 3, '1 tbsp'],
      [1, 'tsp', 4, '1⅓ tbsp'],
      [1, 'tsp', 2, '2 tsp'],
      [1, 'tbsp', 12, '¾ cup'],
      [1, 'tbsp', 5, '5 tbsp'],
      [7, 'tbsp', 2, '14 tbsp'],
      [8, 'tbsp', 2, '1 cup'],
      [1, 'cup', 0.125, '2 tbsp'],
      [2, 'cup', 1.5, '3 cups'],
      [1, 'cup', 6, '1½ quarts'],
      [1, 'lb', 0.5, '8 oz'],
      [12, 'oz', 2, '1½ lb'],
      [3, null, 0.5, '1½'],
      [3, null, 4.1, '12'],
      [9, null, 0.125, '1'],
      [1, 'can', 0.75, '¾ can'],
      [1, 'dozen', 2, '2 dozen'],
      [2, 'clove', 1.5, '3 cloves'],
    ])('shows %d %s scaled by %d as %j', (qty, unit, factor, expected) => {
      expect(show(qty, unit, { factor })).toBe(expected);
    });

    it('shows an amount too small for any fraction as a decimal, never as nothing', () => {
      expect(show(1, 'tsp', { factor: 0.01 })).toBe('0.01 tsp');
      expect(show(1, null, { factor: 0.01 })).toBe('0.01');
    });
  });

  describe('converted to the reader’s system', () => {
    it.each([
      [1, 'cup', '235 ml'],
      [4, 'cup', '945 ml'],
      [5, 'cup', '1.2 l'],
      [1, 'tsp', '4.9 ml'],
      [0.5, 'tsp', '2.5 ml'],
      [1, 'lb', '455 g'],
      [2.2, 'lb', '1 kg'],
      [1, 'oz', '28 g'],
    ])('shows %d %s to a metric reader as %j', (qty, unit, expected) => {
      expect(show(qty, unit, { system: 'metric' })).toBe(expected);
    });

    it.each([
      [250, 'g', '8¾ oz'],
      [500, 'ml', '2⅛ cups'],
      [1, 'kg', '2¼ lb'],
      [15, 'ml', '1 tbsp'],
    ])('shows %d %s to an imperial reader as %j', (qty, unit, expected) => {
      expect(show(qty, unit)).toBe(expected);
    });

    it('never converts a count or a named unit', () => {
      expect(show(2, null, { system: 'metric' })).toBe('2');
      expect(show(2, 'clove', { system: 'metric' })).toBe('2 cloves');
      expect(show(1, 'dozen', { system: 'metric' })).toBe('1 dozen');
    });
  });

  describe('ranges', () => {
    it('shows both ends in a unit the smaller end reaches', () => {
      expect(show(2, 'clove', { qtyMax: 3 })).toBe('2–3 cloves');
      expect(show(2, 'tsp', { qtyMax: 3, factor: 4 })).toBe('2⅔–4 tbsp');
      expect(show(1, 'cup', { qtyMax: 2, system: 'metric' })).toBe('235–475 ml');
    });

    it('shows one quantity when both ends come out the same', () => {
      expect(show(1, 'cup', { qtyMax: 1.01 })).toBe('1 cup');
    });
  });

  describe('lines that don’t scale', () => {
    it('are shown exactly as written, never scaled or converted', () => {
      expect(show(1, 'tsp', { factor: 4, scalable: false })).toBe('1 tsp');
      expect(show(1, 'tsp', { system: 'metric', scalable: false })).toBe('1 tsp');
    });
  });

  it('shows a line with no quantity as its unit, or nothing', () => {
    expect(
      displayAmount(
        { qty: null, qtyMax: null, unit: null },
        { system: 'imperial', factor: 2, scalable: true },
      ),
    ).toEqual({ quantity: null, unit: null });
    expect(show(null, 'pinch')).toBe('pinch');
  });
});

describe('scaleAmount', () => {
  it('multiplies both ends of a range, and leaves lines that don’t scale alone', () => {
    const amount: Amount = { qty: 2, qtyMax: 3, unit: 'clove' };
    expect(scaleAmount(amount, 1.5, true)).toEqual({ qty: 3, qtyMax: 4.5, unit: 'clove' });
    expect(scaleAmount(amount, 1.5, false)).toBe(amount);
    const none: Amount = { qty: null, qtyMax: null, unit: null };
    expect(scaleAmount(none, 2, true)).toBe(none);
  });
});

describe('for any amount', () => {
  const units = fc.constantFrom<string | null>(null, ...UNITS.keys());
  const measures = fc.constantFrom(
    ...[...UNITS.values()].filter(
      ({ dimension }) => dimension === 'volume' || dimension === 'mass',
    ),
  );
  const systems = fc.constantFrom<UnitSystem>('imperial', 'metric');
  /** Quantities recipes are written with: a whole number plus a common fraction. */
  const written = fc
    .tuple(
      fc.integer({ min: 0, max: 20 }),
      fc.constantFrom(0, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4),
    )
    .map(([whole, fraction]) => whole + fraction)
    .filter((qty) => qty > 0);
  const factors = fc.double({ min: 0.1, max: 10, noNaN: true });
  /** The unit a shown amount is in: by name or plural, or one typed by hand. */
  const unitShown = (text: string | null) =>
    text === null ? null : (findUnit(text) ?? resolveUnit(text));

  // Compared as numbers: a value one rounding error from a tie (40.5) can be shown differently.
  it('scaling up then back down returns the original', () => {
    fc.assert(
      fc.property(written, units, factors, (qty, unit, factor) => {
        const amount: Amount = { qty, qtyMax: qty * 2, unit };
        const back = scaleAmount(scaleAmount(amount, factor, true), 1 / factor, true);
        const close = (a: number | null, b: number | null) =>
          a !== null && b !== null && Math.abs(a - b) <= Math.abs(b) * 1e-12;
        return close(back.qty, amount.qty) && close(back.qtyMax, amount.qtyMax);
      }),
    );
  });

  it('always shows a quantity: never zero, NaN or Infinity', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-4, max: 1e5, noNaN: true }),
        units,
        systems,
        factors,
        (qty, unit, system, factor) => {
          const { quantity } = displayAmount(
            { qty, qtyMax: null, unit },
            { system, factor, scalable: true },
          );
          return quantity !== null && quantity !== '0' && !/NaN|Infinity/.test(quantity);
        },
      ),
    );
  });

  it('keeps what a unit measures, and shows measures in the reader’s system', () => {
    fc.assert(
      fc.property(written, units, systems, factors, (qty, unit, system, factor) => {
        const shown = displayAmount(
          { qty, qtyMax: null, unit },
          { system, factor, scalable: true },
        );
        const from = resolveUnit(unit);
        const to = unitShown(shown.unit);
        if (from?.system == null) return to?.name === from?.name;
        return to?.dimension === from.dimension && to.system === system;
      }),
    );
  });

  // The widest gap between the fractions shown is from ¾ to the next whole number, so the worst
  // case from 1 up is half of it, just under 2: 1.875 shows as 1¾, 6.7% under.
  it('shows a measure within 6.7% of the exact amount, from one of the smallest unit up', () => {
    fc.assert(
      fc.property(written, measures, systems, factors, (qty, unit, system, factor) => {
        const shown = displayAmount(
          { qty, qtyMax: null, unit: unit.name },
          { system, factor, scalable: true },
        );
        const exact = convert(qty * factor, unit, unitShown(shown.unit)) ?? Number.NaN;
        fc.pre(exact >= 1);
        return Math.abs(shownValue(shown.quantity ?? '') - exact) <= exact * 0.067;
      }),
    );
  });
});
