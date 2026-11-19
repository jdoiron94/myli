import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  normalizeIngredientName,
  type ParsedIngredient,
  parseIngredient,
  parseQuantity,
} from './ingredients.ts';
import { displayAmount, formatAmount } from './quantities.ts';
import { UNITS, type UnitSystem } from './units.ts';

type Expected = Partial<ParsedIngredient>;

/** What `parseIngredient` reads, with the defaults most lines have. */
function parsed(expected: Expected): ParsedIngredient {
  return { qty: null, qtyMax: null, unit: null, name: '', note: null, scalable: true, ...expected };
}

/** Checks every line's reading at once, so one diff shows each line read wrong. */
function expectReadings(cases: Record<string, Expected>) {
  expect(
    Object.fromEntries(Object.keys(cases).map((line) => [line, parseIngredient(line)])),
  ).toEqual(Object.fromEntries(Object.entries(cases).map(([line, e]) => [line, parsed(e)])));
}

describe('parseIngredient', () => {
  it('reads quantities and ranges', () => {
    expectReadings({
      '2 cups flour': { qty: 2, unit: 'cup', name: 'flour' },
      // A mixed number, not a range.
      '1-1/2 cups sugar': { qty: 1.5, unit: 'cup', name: 'sugar' },
      '1 ½ tsp baking soda': { qty: 1.5, unit: 'tsp', name: 'baking soda' },
      'Twelve rolls': { qty: 12, name: 'rolls' },
      '3 large eggs': { qty: 3, name: 'large eggs' },
      'an onion': { qty: 1, name: 'onion' },
      'A dozen eggs': { qty: 1, unit: 'dozen', name: 'eggs' },
      '2-3 cloves garlic': { qty: 2, qtyMax: 3, unit: 'clove', name: 'garlic' },
      '2–3 cloves garlic': { qty: 2, qtyMax: 3, unit: 'clove', name: 'garlic' },
      '1 to 2 tbsp olive oil': { qty: 1, qtyMax: 2, unit: 'tbsp', name: 'olive oil' },
      '1 or 2 eggs': { qty: 1, qtyMax: 2, name: 'eggs' },
      '1/2-3/4 cup milk': { qty: 0.5, qtyMax: 0.75, unit: 'cup', name: 'milk' },
      '3–2 cups flour': { qty: 2, qtyMax: 3, unit: 'cup', name: 'flour' },
      '2-2 cups flour': { qty: 2, unit: 'cup', name: 'flour' },
    });
  });

  it('reads units however they’re written', () => {
    expectReadings({
      '1 T sugar': { qty: 1, unit: 'tbsp', name: 'sugar' },
      '1 t salt': { qty: 1, unit: 'tsp', name: 'salt' },
      '2 Tbsp. honey': { qty: 2, unit: 'tbsp', name: 'honey' },
      '2 fl. oz. cream': { qty: 2, unit: 'fl oz', name: 'cream' },
      '200g butter': { qty: 200, unit: 'g', name: 'butter' },
      '1.5kg potatoes': { qty: 1.5, unit: 'kg', name: 'potatoes' },
      '2 sticks of butter': { qty: 2, unit: 'stick', name: 'butter' },
      // Without a quantity, a unit only before "of".
      'pinch of nutmeg': { qty: 1, unit: 'pinch', name: 'nutmeg' },
      'Pinch salt': { name: 'Pinch salt' },
      cloves: { name: 'cloves' },
      '2 cups, divided': { qty: 2, unit: 'cup', note: 'divided' },
      '2 cups. flour': { qty: 2, unit: 'cup', name: 'flour' },
    });
  });

  it('reads notes, and which lines don’t scale', () => {
    expectReadings({
      '½ cup butter, melted': { qty: 0.5, unit: 'cup', name: 'butter', note: 'melted' },
      '1 (14 oz) can diced tomatoes, drained': {
        qty: 1,
        unit: 'can',
        name: 'diced tomatoes',
        note: '14 oz, drained',
      },
      '1 cup (2 sticks) butter': { qty: 1, unit: 'cup', name: 'butter', note: '2 sticks' },
      '250 g dark chocolate (70%)': { qty: 250, unit: 'g', name: 'dark chocolate', note: '70%' },
      '2 cups cherry tomatoes, halved, or grape tomatoes': {
        qty: 2,
        unit: 'cup',
        name: 'cherry tomatoes',
        note: 'halved, or grape tomatoes',
      },
      'fresh parsley for garnish': { name: 'fresh parsley', note: 'for garnish' },
      '1 cup sugar.': { qty: 1, unit: 'cup', name: 'sugar' },
      '- 1 cup rice': { qty: 1, unit: 'cup', name: 'rice' },
      'Salt and pepper, to taste': { name: 'Salt and pepper', note: 'to taste', scalable: false },
      'oil as needed': { name: 'oil', note: 'as needed', scalable: false },
      '4 cups oil for frying': {
        qty: 4,
        unit: 'cup',
        name: 'oil',
        note: 'for frying',
        scalable: false,
      },
      // What's for serving grows with the servings.
      '2 tbsp parsley, for garnish': { qty: 2, unit: 'tbsp', name: 'parsley', note: 'for garnish' },
    });
  });

  it('leaves in the name what it can’t read', () => {
    const lines = [
      '0 g sugar',
      '1/0 cup sugar',
      '0-2 cups sugar',
      'a few sprigs of thyme',
      'juice of 1 lemon',
      'about 2 cups flour',
    ];
    expectReadings(Object.fromEntries(lines.map((line) => [line, { name: line }])));
  });

  // Each of these took seconds when a regex backtracked; linear, they take milliseconds.
  it('reads a long line in linear time', () => {
    const lines = {
      'unclosed parentheses': '('.repeat(100_000),
      'unclosed remarks': '(x'.repeat(100_000),
      spaces: `a${' '.repeat(100_000)}x`,
      'trailing punctuation': `x${' ;'.repeat(100_000)}y`,
    };
    const slow = Object.entries(lines).filter(([, line]) => {
      const start = Date.now();
      parseIngredient(line);
      normalizeIngredientName(line);
      return Date.now() - start >= 1000;
    });
    expect(slow.map(([kind]) => kind)).toEqual([]);
  });
});

describe('parseQuantity', () => {
  it('reads what people type as a quantity, and nothing else', () => {
    const quantities = {
      '2': 2,
      ' 2.5 ': 2.5,
      '.5': 0.5,
      '3/4': 0.75,
      '1 1/2': 1.5,
      '1-1/2': 1.5,
      '1½': 1.5,
      '1 ½': 1.5,
      '⅓': 1 / 3,
      '1⁄4': 0.25,
      Twelve: 12,
      '0': null,
      '1/0': null,
      '-1': null,
      '2-3': null,
      '2 cups': null,
      'a few': null,
      '1,5': null,
      '1e3': null,
      Infinity: null,
    };
    expect(
      Object.fromEntries(
        Object.keys(quantities).map((text) => [text, parseQuantity(text) ?? null]),
      ),
    ).toEqual(quantities);
  });

  it('reads a quantity as it does at the start of a line', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 1, max: 999 }).map(String),
          fc
            .tuple(
              fc.integer({ min: 0, max: 20 }),
              fc.integer({ min: 1, max: 16 }),
              fc.integer({ min: 1, max: 16 }),
            )
            .map(([whole, top, bottom]) =>
              whole === 0
                ? `${String(top)}/${String(bottom)}`
                : `${String(whole)} ${String(top)}/${String(bottom)}`,
            ),
          fc.constantFrom('½', '1¾', '2 ⅓', 'three', '.25', '0.5'),
        ),
        (text) => parseQuantity(text) === (parseIngredient(`${text} cups flour`).qty ?? undefined),
      ),
    );
  });
});

describe('normalizeIngredientName', () => {
  it('makes names singular, leaving alone those that only look plural', () => {
    const names = {
      'Cherry Tomatoes': 'cherry tomato',
      eggs: 'egg',
      berries: 'berry',
      cookies: 'cookie',
      chilies: 'chili',
      peaches: 'peach',
      boxes: 'box',
      glasses: 'glass',
      cheeses: 'cheese',
      quiches: 'quiche',
      olives: 'olive',
      leaves: 'leaf',
      potatoes: 'potato',
      peas: 'pea',
      gas: 'gas',
      molasses: 'molasses',
      'collard greens': 'collard greens',
      asparagus: 'asparagus',
      watercress: 'watercress',
    };
    expect(
      Object.fromEntries(Object.keys(names).map((name) => [name, normalizeIngredientName(name)])),
    ).toEqual(names);
  });

  it('drops case, accents, remarks, punctuation and extra spaces', () => {
    const names = {
      'Diced tomatoes, drained': 'diced tomato',
      'dark (70%, bittersweet) chocolate, chopped': 'dark chocolate',
      'crème fraîche': 'creme fraiche',
      'All-Purpose Flour': 'all purpose flour',
      'confectioners’ sugar': 'confectioners sugar',
      "confectioners' sugar": 'confectioners sugar',
      'Tabasco™ sauce': 'tabasco sauce',
      𝐇𝐎𝐍𝐄𝐘: 'honey',
      '  salt   and pepper ': 'salt and pepper',
      '(optional)': '',
    };
    expect(
      Object.fromEntries(Object.keys(names).map((name) => [name, normalizeIngredientName(name)])),
    ).toEqual(names);
    // Words, not properties of an object.
    expect(['constructor', 'hasOwnProperty', '__proto__'].map(normalizeIngredientName)).toEqual([
      'constructor',
      'hasownproperty',
      'proto',
    ]);
  });
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

  it('normalizes to lowercase words separated by single spaces, the same a second time', () => {
    fc.assert(
      fc.property(lines, (line) => {
        const normalized = normalizeIngredientName(line);
        return (
          normalized === normalized.toLowerCase() &&
          /^(?:[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*)?$/u.test(normalized) &&
          normalizeIngredientName(normalized) === normalized
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
});
