import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type GroceryEntry,
  type GroceryIngredient,
  type GroceryLine,
  type GroceryRecipe,
  groceryList,
} from './groceries.ts';
import { normalizeIngredientName, parseIngredient } from './ingredients.ts';
import { displayTotal, formatAmount } from './quantities.ts';
import { UNITS, type UnitSystem } from './units.ts';

/** A recipe for `servings`, its ingredients typed as they would be in the editor. */
function recipe(title: string, lines: string[], servings = 4): GroceryRecipe {
  return {
    id: title.toLowerCase(),
    title,
    servings,
    ingredients: lines.map((line) => {
      const parsed = parseIngredient(line);
      return { ...parsed, normalizedName: normalizeIngredientName(parsed.name) };
    }),
  };
}

/** Each recipe at its own servings. */
const atOwn = (...recipes: GroceryRecipe[]): GroceryEntry[] =>
  recipes.map((recipe) => ({ recipe, servings: recipe.servings }));

/** A list as a reader sees it: "garlic: 3 cloves, 1 tbsp (Aioli, Stir-fry)". */
function read(lines: GroceryLine[], system: UnitSystem) {
  return lines.map(({ name, amounts, recipes }) => {
    const shown = amounts.map((amount) => formatAmount(displayTotal(amount, system)));
    const titles = recipes.map(({ title }) => title).join(', ');
    return `${[name, shown.join(', ')].filter(Boolean).join(': ')} (${titles})`;
  });
}

describe('groceryList', () => {
  it('adds up what each recipe asks for, one line per ingredient', () => {
    const cases: Record<string, { entries: GroceryEntry[]; system?: UnitSystem }> = {
      'the same unit': {
        entries: atOwn(recipe('A', ['2 cups flour']), recipe('B', ['1 cup flour'])),
      },
      'units that measure the same': {
        entries: atOwn(recipe('A', ['1 cup milk']), recipe('B', ['4 tbsp milk'])),
      },
      'units that don’t': {
        entries: atOwn(
          recipe('A', ['2 cloves garlic', '200 g butter']),
          recipe('B', ['1 tbsp garlic, minced', '2 tbsp butter']),
          recipe('C', ['1 clove garlic']),
        ),
      },
      'a dozen and a count': {
        entries: atOwn(recipe('A', ['1 dozen eggs']), recipe('B', ['3 eggs'])),
      },
      ranges: {
        entries: atOwn(recipe('A', ['2-3 cloves garlic']), recipe('B', ['1 clove garlic'])),
      },
      'no quantity': {
        entries: atOwn(recipe('A', ['salt to taste']), recipe('B', ['salt to taste'])),
      },
      'no quantity and a quantity': {
        entries: atOwn(recipe('A', ['salt to taste']), recipe('B', ['1 tsp salt'])),
      },
      'servings chosen, and a line that doesn’t scale': {
        entries: [{ recipe: recipe('A', ['1 cup rice', '2 cups oil for frying']), servings: 8 }],
      },
      'the name most lines use': {
        entries: atOwn(
          recipe('A', ['2 Roma tomatoes']),
          recipe('B', ['1 roma tomato']),
          recipe('C', ['3 Roma tomatoes']),
        ),
      },
      'as many lines with each name': {
        entries: atOwn(recipe('A', ['2 eggs']), recipe('B', ['1 egg'])),
      },
      'metric, in the largest sensible unit': {
        entries: atOwn(recipe('A', ['750 ml stock']), recipe('B', ['750 ml stock'])),
        system: 'metric',
      },
      'in the other system': {
        entries: atOwn(recipe('A', ['1 lb beef']), recipe('B', ['500 g beef'])),
      },
    };

    expect(
      Object.fromEntries(
        Object.entries(cases).map(([name, { entries, system = 'imperial' }]) => [
          name,
          read(groceryList(entries), system),
        ]),
      ),
    ).toEqual({
      'the same unit': ['flour: 3 cups (A, B)'],
      'units that measure the same': ['milk: 1¼ cups (A, B)'],
      'units that don’t': ['butter: 7 oz, 2 tbsp (A, B)', 'garlic: 3 cloves, 1 tbsp (A, B, C)'],
      'a dozen and a count': ['eggs: 15 (A, B)'],
      ranges: ['garlic: 3–4 cloves (A, B)'],
      'no quantity': ['salt (A, B)'],
      'no quantity and a quantity': ['salt: 1 tsp (A, B)'],
      'servings chosen, and a line that doesn’t scale': ['oil: 2 cups (A)', 'rice: 2 cups (A)'],
      'the name most lines use': ['Roma tomatoes: 6 (A, B, C)'],
      'as many lines with each name': ['eggs: 3 (A, B)'],
      'metric, in the largest sensible unit': ['stock: 1.5 l (A, B)'],
      'in the other system': ['beef: 2⅛ lb (A, B)'],
    });
  });
});

describe('for any recipes', () => {
  /** Quantities recipes are written with: a whole number plus a common fraction. */
  const written = fc
    .tuple(fc.integer({ min: 0, max: 20 }), fc.constantFrom(0, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3))
    .map(([whole, fraction]) => whole + fraction)
    .filter((qty) => qty > 0);
  const ingredient = (scalable: fc.Arbitrary<boolean>): fc.Arbitrary<GroceryIngredient> =>
    fc
      .record({
        name: fc.constantFrom('flour', 'Flour', 'garlic', 'eggs', 'egg', 'salt'),
        qty: fc.option(written, { nil: null }),
        more: fc.option(written, { nil: null }),
        // Every unit, none (a count), and one typed in by hand.
        unit: fc.constantFrom(null, 'knob', ...UNITS.keys()),
        scalable,
      })
      .map(({ name, qty, more, unit, scalable }) => ({
        name,
        normalizedName: normalizeIngredientName(name),
        qty,
        qtyMax: qty !== null && more !== null ? qty + more : null,
        unit,
        scalable,
      }));
  const entries = (scalable: fc.Arbitrary<boolean>) =>
    fc.uniqueArray(
      fc.record({
        recipe: fc.record({
          id: fc.uuid(),
          title: fc.constantFrom('Pancakes', 'Stew', 'Waffles'),
          servings: fc.integer({ min: 1, max: 12 }),
          ingredients: fc.array(ingredient(scalable), { maxLength: 8 }),
        }),
        servings: fc.integer({ min: 1, max: 24 }),
      }),
      { selector: ({ recipe }) => recipe.id, maxLength: 6 },
    );

  it('gives the same list whatever order the recipes come in', () => {
    fc.assert(
      fc.property(
        entries(fc.boolean()).chain((list) =>
          fc.tuple(
            fc.constant(list),
            fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length }),
          ),
        ),
        ([list, shuffled]) => {
          expect(groceryList(shuffled)).toEqual(groceryList(list));
        },
      ),
    );
  });

  it('adds up scaled recipes to the total scaled', () => {
    fc.assert(
      fc.property(entries(fc.constant(true)), fc.integer({ min: 2, max: 5 }), (list, times) => {
        const scaled = list.map((entry) => ({ ...entry, servings: entry.servings * times }));
        const expected = groceryList(list).map((line) => ({
          ...line,
          amounts: line.amounts.map(({ qty, qtyMax, unit }) => ({
            qty: qty === null ? null : expect.closeTo(qty * times, 6),
            qtyMax: qtyMax === null ? null : expect.closeTo(qtyMax * times, 6),
            unit,
          })),
        }));
        expect(groceryList(scaled)).toEqual(expected);
      }),
    );
  });
});
