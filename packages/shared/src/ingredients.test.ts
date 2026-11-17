import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeIngredientName, type ParsedIngredient, parseIngredient } from './ingredients.ts';
import { displayAmount, formatAmount } from './quantities.ts';
import { UNITS, type UnitSystem } from './units.ts';

type Expected = Partial<ParsedIngredient>;

/** What `parseIngredient` reads, with the defaults most lines have. */
function parsed(expected: Expected): ParsedIngredient {
  return { qty: null, qtyMax: null, unit: null, name: '', note: null, scalable: true, ...expected };
}

describe('parseIngredient', () => {
  describe('quantities', () => {
    it.each<[string, Expected]>([
      ['2 cups flour', { qty: 2, unit: 'cup', name: 'flour' }],
      ['1 1/2 cups sugar', { qty: 1.5, unit: 'cup', name: 'sugar' }],
      ['1-1/2 cups sugar', { qty: 1.5, unit: 'cup', name: 'sugar' }],
      ['3/4 cup milk', { qty: 0.75, unit: 'cup', name: 'milk' }],
      ['1½ tsp baking soda', { qty: 1.5, unit: 'tsp', name: 'baking soda' }],
      ['1 ½ tsp baking soda', { qty: 1.5, unit: 'tsp', name: 'baking soda' }],
      ['⅓ cup oil', { qty: 1 / 3, unit: 'cup', name: 'oil' }],
      ['1⁄4 tsp salt', { qty: 0.25, unit: 'tsp', name: 'salt' }],
      ['.5 cup water', { qty: 0.5, unit: 'cup', name: 'water' }],
      ['1.25 lb beef', { qty: 1.25, unit: 'lb', name: 'beef' }],
      ['two eggs', { qty: 2, name: 'eggs' }],
      ['Twelve rolls', { qty: 12, name: 'rolls' }],
      ['3 large eggs', { qty: 3, name: 'large eggs' }],
      ['an onion', { qty: 1, name: 'onion' }],
      ['a pinch of salt', { qty: 1, unit: 'pinch', name: 'salt' }],
      ['A dozen eggs', { qty: 1, unit: 'dozen', name: 'eggs' }],
    ])('reads %j', (line, expected) => {
      expect(parseIngredient(line)).toEqual(parsed(expected));
    });

    it.each<[string, Expected]>([
      ['2-3 cloves garlic', { qty: 2, qtyMax: 3, unit: 'clove', name: 'garlic' }],
      ['2–3 cloves garlic', { qty: 2, qtyMax: 3, unit: 'clove', name: 'garlic' }],
      ['1 to 2 tbsp olive oil', { qty: 1, qtyMax: 2, unit: 'tbsp', name: 'olive oil' }],
      ['1 or 2 eggs', { qty: 1, qtyMax: 2, name: 'eggs' }],
      ['1/2-3/4 cup milk', { qty: 0.5, qtyMax: 0.75, unit: 'cup', name: 'milk' }],
      ['1½–2 cups stock', { qty: 1.5, qtyMax: 2, unit: 'cup', name: 'stock' }],
      ['3–2 cups flour', { qty: 2, qtyMax: 3, unit: 'cup', name: 'flour' }],
      ['2-2 cups flour', { qty: 2, unit: 'cup', name: 'flour' }],
    ])('reads the range in %j', (line, expected) => {
      expect(parseIngredient(line)).toEqual(parsed(expected));
    });

    it.each(['0 g sugar', '1/0 cup sugar', '0-2 cups sugar'])(
      'leaves %j, which has no usable quantity, in the name',
      (line) => {
        expect(parseIngredient(line)).toEqual(parsed({ name: line }));
      },
    );

    it.each(['a few sprigs of thyme', 'a little butter', 'juice of 1 lemon', 'about 2 cups flour'])(
      'leaves what it can’t read in the name: %j',
      (line) => {
        expect(parseIngredient(line)).toEqual(parsed({ name: line }));
      },
    );
  });

  describe('units', () => {
    it.each<[string, Expected]>([
      ['1 T sugar', { qty: 1, unit: 'tbsp', name: 'sugar' }],
      ['1 t salt', { qty: 1, unit: 'tsp', name: 'salt' }],
      ['2 Tbsp. honey', { qty: 2, unit: 'tbsp', name: 'honey' }],
      ['2 fl oz cream', { qty: 2, unit: 'fl oz', name: 'cream' }],
      ['2 fl. oz. cream', { qty: 2, unit: 'fl oz', name: 'cream' }],
      ['12 oz. cream cheese', { qty: 12, unit: 'oz', name: 'cream cheese' }],
      ['1 c. sugar', { qty: 1, unit: 'cup', name: 'sugar' }],
      ['200g butter', { qty: 200, unit: 'g', name: 'butter' }],
      ['1.5kg potatoes', { qty: 1.5, unit: 'kg', name: 'potatoes' }],
      ['2 sticks of butter', { qty: 2, unit: 'stick', name: 'butter' }],
      ['pinch of nutmeg', { qty: 1, unit: 'pinch', name: 'nutmeg' }],
      ['2 cups, divided', { qty: 2, unit: 'cup', note: 'divided' }],
      ['2 cups. flour', { qty: 2, unit: 'cup', name: 'flour' }],
      ['2 cups', { qty: 2, unit: 'cup' }],
    ])('reads %j', (line, expected) => {
      expect(parseIngredient(line)).toEqual(parsed(expected));
    });

    it('reads a unit without a quantity only before "of", so "Pinch salt" names nothing', () => {
      expect(parseIngredient('cup of sugar')).toEqual(
        parsed({ qty: 1, unit: 'cup', name: 'sugar' }),
      );
      expect(parseIngredient('Pinch salt')).toEqual(parsed({ name: 'Pinch salt' }));
      expect(parseIngredient('cloves')).toEqual(parsed({ name: 'cloves' }));
    });
  });

  describe('notes', () => {
    it.each<[string, Expected]>([
      ['½ cup butter, melted', { qty: 0.5, unit: 'cup', name: 'butter', note: 'melted' }],
      [
        '1 (14 oz) can diced tomatoes, drained',
        { qty: 1, unit: 'can', name: 'diced tomatoes', note: '14 oz, drained' },
      ],
      ['1 cup (2 sticks) butter', { qty: 1, unit: 'cup', name: 'butter', note: '2 sticks' }],
      ['250 g dark chocolate (70%)', { qty: 250, unit: 'g', name: 'dark chocolate', note: '70%' }],
      [
        '2 cups cherry tomatoes, halved, or grape tomatoes',
        { qty: 2, unit: 'cup', name: 'cherry tomatoes', note: 'halved, or grape tomatoes' },
      ],
      ['fresh parsley for garnish', { name: 'fresh parsley', note: 'for garnish' }],
      ['chopped walnuts, optional', { name: 'chopped walnuts', note: 'optional' }],
      ['1 cup sugar.', { qty: 1, unit: 'cup', name: 'sugar' }],
      ['- 1 cup rice', { qty: 1, unit: 'cup', name: 'rice' }],
      ['• 2 eggs', { qty: 2, name: 'eggs' }],
    ])('reads %j', (line, expected) => {
      expect(parseIngredient(line)).toEqual(parsed(expected));
    });
  });

  describe('lines that don’t scale', () => {
    it.each<[string, Expected]>([
      ['salt to taste', { name: 'salt', note: 'to taste' }],
      ['Salt and pepper, to taste', { name: 'Salt and pepper', note: 'to taste' }],
      ['oil as needed', { name: 'oil', note: 'as needed' }],
      ['4 cups oil for frying', { qty: 4, unit: 'cup', name: 'oil', note: 'for frying' }],
      ['butter, for greasing', { name: 'butter', note: 'for greasing' }],
      ['flour for dusting', { name: 'flour', note: 'for dusting' }],
    ])('reads %j as not scalable', (line, expected) => {
      expect(parseIngredient(line)).toEqual(parsed({ ...expected, scalable: false }));
    });

    it('scales what’s for serving or garnish, which grows with the servings', () => {
      expect(parseIngredient('2 tbsp parsley, for garnish').scalable).toBe(true);
    });
  });

  it.each(['', '   ', ',', '()', '1'])('reads %j without failing', (line) => {
    expect(() => parseIngredient(line)).not.toThrow();
  });

  // Each of these took seconds when a regex backtracked; linear, they take milliseconds.
  it.each([
    ['unclosed parentheses', '('.repeat(100_000)],
    ['unclosed remarks', '(x'.repeat(100_000)],
    ['spaces', `a${' '.repeat(100_000)}x`],
    ['trailing punctuation', `x${' ;'.repeat(100_000)}y`],
  ])('reads a long line of %s in linear time', (_, line) => {
    const start = Date.now();
    parseIngredient(line);
    normalizeIngredientName(line);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('normalizeIngredientName', () => {
  it.each([
    ['Cherry Tomatoes', 'cherry tomato'],
    ['eggs', 'egg'],
    ['large eggs', 'large egg'],
    ['berries', 'berry'],
    ['peaches', 'peach'],
    ['radishes', 'radish'],
    ['boxes', 'box'],
    ['glasses', 'glass'],
    ['cheeses', 'cheese'],
    ['sauces', 'sauce'],
    ['olives', 'olive'],
    ['leaves', 'leaf'],
    ['potatoes', 'potato'],
    ['cookies', 'cookie'],
    ['quiches', 'quiche'],
    ['brioches', 'brioche'],
    ['glazes', 'glaze'],
    ['chilies', 'chili'],
    ['molasses', 'molasses'],
    ['brussels', 'brussels'],
    ['collard greens', 'collard greens'],
    ['asparagus', 'asparagus'],
    ['couscous', 'couscous'],
    ['watercress', 'watercress'],
    ['peas', 'pea'],
    ['figs', 'fig'],
    ['gas', 'gas'],
  ])('makes %j singular: %j', (name, expected) => {
    expect(normalizeIngredientName(name)).toBe(expected);
  });

  it.each([
    ['Diced tomatoes, drained', 'diced tomato'],
    ['dark (70%) chocolate', 'dark chocolate'],
    ['dark (70%, bittersweet) chocolate, chopped', 'dark chocolate'],
    ['Jalapeños', 'jalapeno'],
    ['crème fraîche', 'creme fraiche'],
    ['All-Purpose Flour', 'all purpose flour'],
    ['confectioners’ sugar', 'confectioners sugar'],
    ["confectioners' sugar", 'confectioners sugar'],
    ["baker's yeast", 'bakers yeast'],
    ['Tabasco™ sauce', 'tabasco sauce'],
    ['𝐇𝐎𝐍𝐄𝐘', 'honey'],
    ['  salt   and pepper ', 'salt and pepper'],
    ['', ''],
    ['(optional)', ''],
  ])('normalizes %j to %j', (name, expected) => {
    expect(normalizeIngredientName(name)).toBe(expected);
  });

  it.each(['constructor', 'hasOwnProperty', '__proto__', 'toString'])(
    'treats %j as a word, not a property of an object',
    (name) => {
      expect(normalizeIngredientName(name)).toBe(name.toLowerCase().replace(/_/g, ''));
    },
  );
});

describe('for any line', () => {
  /** Strings of anything, and strings of the characters ingredient lines are made of. */
  const lines = fc.oneof(
    fc.string({ unit: 'binary', maxLength: 80 }),
    fc
      .array(
        fc.constantFrom(
          ...['1', '½', '/', '-', '–', '.', ',', '(', ')', ' ', 'a', 'of', 'to', 'cup', 'T'],
          ...['tbsp', 'fl', 'oz', 'two', 'salt', 'eggs', 'taste', 'for', 'frying', '⁄', '0'],
          ...['İ', '𝐇', '™', 'é', '\u0301', "'", 'Σ'],
        ),
        { maxLength: 20 },
      )
      .map((parts) => parts.join('')),
  );

  it('reads something well formed, and never throws', () => {
    fc.assert(
      fc.property(lines, (line) => {
        const { qty, qtyMax, unit, name, note } = parseIngredient(line);
        const trimmed = (text: string) => text === text.trim() && !/\s\s/.test(text);
        return (
          (qty === null || (Number.isFinite(qty) && qty > 0)) &&
          (qtyMax === null || (qty !== null && Number.isFinite(qtyMax) && qtyMax > qty)) &&
          (unit === null || UNITS.has(unit)) &&
          trimmed(name) &&
          (note === null || (note !== '' && note === note.trim()))
        );
      }),
    );
  });

  it('never makes up words: each one in the name and note is in the line', () => {
    fc.assert(
      fc.property(lines, (line) => {
        const { name, note } = parseIngredient(line);
        const words = `${name} ${note ?? ''}`.split(/[\s,]+/).filter((word) => word !== '');
        return words.every((word) => line.replace(/⁄/g, '/').includes(word));
      }),
    );
  });

  it('normalizes a name to the same thing a second time', () => {
    fc.assert(
      fc.property(lines, (line) => {
        const once = normalizeIngredientName(line);
        return normalizeIngredientName(once) === once;
      }),
    );
  });

  it('normalizes to lowercase words separated by single spaces', () => {
    fc.assert(
      fc.property(lines, (line) => {
        const normalized = normalizeIngredientName(line);
        return (
          normalized === normalized.toLowerCase() &&
          /^(?:[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*)?$/u.test(normalized)
        );
      }),
    );
  });
});

describe('for any amount shown and typed back in', () => {
  const names = fc.constantFrom(
    'flour',
    'brown sugar',
    'cherry tomatoes',
    'garlic',
    'eggs',
    'whole milk',
  );
  const notes = fc.constantFrom(null, 'chopped', 'at room temperature');
  const written = fc
    .tuple(
      fc.integer({ min: 0, max: 20 }),
      fc.constantFrom(0, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4),
    )
    .map(([whole, fraction]) => whole + fraction)
    .filter((qty) => qty > 0);

  /** The numbers a shown quantity stands for: "1½" is [1.5], "2–3" is [2, 3]. */
  function shownValues(quantity: string): number[] {
    const fractions: Record<string, number> = {
      '⅛': 1 / 8,
      '¼': 1 / 4,
      '⅓': 1 / 3,
      '½': 1 / 2,
      '⅔': 2 / 3,
      '¾': 3 / 4,
    };
    return quantity.split('–').map((end) => {
      const symbol = Object.keys(fractions).find((fraction) => end.includes(fraction));
      const whole = symbol ? end.replace(symbol, '') : end;
      return (whole === '' ? 0 : Number(whole)) + (symbol ? (fractions[symbol] ?? 0) : 0);
    });
  }

  it('reads back the quantity, unit, name and note shown', () => {
    fc.assert(
      fc.property(
        written,
        fc.option(fc.integer({ min: 1, max: 3 }), { nil: null }),
        fc.constantFrom<string | null>(null, ...UNITS.keys()),
        names,
        notes,
        (qty, extra, unit, name, note) => {
          // Shown as written: in the unit's own system, unscaled.
          const system: UnitSystem = UNITS.get(unit ?? '')?.system ?? 'imperial';
          const amount = { qty, qtyMax: extra === null ? null : qty + extra, unit };
          const shown = displayAmount(amount, { system, factor: 1, scalable: true });
          const line = `${formatAmount(shown)} ${name}${note === null ? '' : `, ${note}`}`;
          const [low = Number.NaN, high = null] = shownValues(shown.quantity ?? '');
          const read = parseIngredient(line);
          const close = (a: number | null, b: number | null) =>
            a === b || (a !== null && b !== null && Math.abs(a - b) <= 1e-9);
          return (
            close(read.qty, low) &&
            close(read.qtyMax, high) &&
            read.unit === unit &&
            read.name === name &&
            read.note === note
          );
        },
      ),
    );
  });

  it('normalizes a plural and its singular to the same name', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<readonly [string, string]>(
          ['tomato', 'tomatoes'],
          ['egg', 'eggs'],
          ['berry', 'berries'],
          ['peach', 'peaches'],
          ['leaf', 'leaves'],
          ['cheese', 'cheeses'],
          ['glaze', 'glazes'],
          ['clove', 'cloves'],
          ['box', 'boxes'],
        ),
        fc.constantFrom('', 'cherry ', 'Fresh ', 'large '),
        ([one, many], before) =>
          normalizeIngredientName(before + one) === normalizeIngredientName(before + many),
      ),
    );
  });
});
