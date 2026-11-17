import { z } from 'zod';

/**
 * Units of measure (spec §3.2): what each unit is called, what it measures, and how it converts.
 *
 * "Imperial" means US customary measures, the ones American recipes use: a cup is 236.6 ml and a
 * pint 16 fluid ounces, not the British 20. Every factor is exact, from the legal definitions
 * (1 gallon = 3.785411784 liters, 1 pound = 453.59237 grams).
 */

export const UNIT_SYSTEMS = ['imperial', 'metric'] as const;

export const unitSystemSchema = z.enum(UNIT_SYSTEMS).meta({ id: 'UnitSystem' });

export type UnitSystem = z.infer<typeof unitSystemSchema>;

/** A user's display preference until they choose one (spec §3.2). */
export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'imperial';

/**
 * What a unit measures. A quantity converts only within one dimension: volume never becomes mass.
 * A count is a number of items: a line with no unit ("2 eggs") is one, and so is a dozen.
 */
export type Dimension = 'volume' | 'mass' | 'count';

export interface Unit {
  /** How the unit is shown, and its ID where it's stored: 'cup', 'tbsp', 'clove'. */
  readonly name: string;
  /** Shown for more than one. The same as `name` for abbreviations: '2 tbsp'. */
  readonly plural: string;
  /**
   * What it measures, or `null` for a named unit like a clove or a can: those scale, but convert
   * to nothing, not even to each other.
   */
  readonly dimension: Dimension | null;
  /** The system it belongs to, or `null` for units both systems use (a dozen, a clove). */
  readonly system: UnitSystem | null;
  /** How many of its dimension's base unit it is: milliliters, grams or items. 1 when named. */
  readonly factor: number;
}

interface UnitDefinition extends Unit {
  /** What a recipe may call it, matched ignoring case. Includes `name` and `plural`. */
  readonly aliases: readonly string[];
  /** Aliases that only mean this unit in this exact case: "T" is a tablespoon, "t" a teaspoon. */
  readonly exactAliases?: readonly string[];
}

const TEASPOON_ML = 4.92892159375;
const OUNCE_G = 28.349523125;

function measure(
  name: string,
  plural: string,
  dimension: Dimension,
  system: UnitSystem | null,
  factor: number,
  aliases: readonly string[],
  exactAliases?: readonly string[],
): UnitDefinition {
  return {
    name,
    plural,
    dimension,
    system,
    factor,
    aliases: [name, plural, ...aliases],
    ...(exactAliases && { exactAliases }),
  };
}

/** A unit that scales but converts to nothing. Its name and plural are its aliases. */
function named(name: string, plural: string, aliases: readonly string[] = []): UnitDefinition {
  return {
    name,
    plural,
    dimension: null,
    system: null,
    factor: 1,
    aliases: [name, plural, ...aliases],
  };
}

const DEFINITIONS: readonly UnitDefinition[] = [
  // US customary volume. 3 tsp = 1 tbsp, 2 tbsp = 1 fl oz, 8 fl oz = 1 cup, 2 cups = 1 pint,
  // 2 pints = 1 quart, 4 quarts = 1 gallon.
  measure(
    'tsp',
    'tsp',
    'volume',
    'imperial',
    TEASPOON_ML,
    ['teaspoon', 'teaspoons', 'tsp.', 'tsps', 'tspn'],
    ['t'],
  ),
  measure(
    'tbsp',
    'tbsp',
    'volume',
    'imperial',
    TEASPOON_ML * 3,
    ['tablespoon', 'tablespoons', 'tbsp.', 'tbsps', 'tbs', 'tbs.', 'tbl', 'tblsp'],
    ['T', 'Tb'],
  ),
  measure('fl oz', 'fl oz', 'volume', 'imperial', TEASPOON_ML * 6, [
    'fl. oz.',
    'fl. oz',
    'fl oz.',
    'fluid ounce',
    'fluid ounces',
  ]),
  measure('cup', 'cups', 'volume', 'imperial', TEASPOON_ML * 48, ['c', 'c.']),
  measure('pint', 'pints', 'volume', 'imperial', TEASPOON_ML * 96, ['pt', 'pt.']),
  measure('quart', 'quarts', 'volume', 'imperial', TEASPOON_ML * 192, ['qt', 'qt.']),
  measure('gallon', 'gallons', 'volume', 'imperial', TEASPOON_ML * 768, ['gal', 'gal.']),
  // Metric volume.
  measure('ml', 'ml', 'volume', 'metric', 1, [
    'milliliter',
    'milliliters',
    'millilitre',
    'millilitres',
  ]),
  measure('cl', 'cl', 'volume', 'metric', 10, [
    'centiliter',
    'centiliters',
    'centilitre',
    'centilitres',
  ]),
  measure('dl', 'dl', 'volume', 'metric', 100, [
    'deciliter',
    'deciliters',
    'decilitre',
    'decilitres',
  ]),
  measure('l', 'l', 'volume', 'metric', 1000, ['liter', 'liters', 'litre', 'litres']),
  // US customary mass. 16 oz = 1 lb.
  measure('oz', 'oz', 'mass', 'imperial', OUNCE_G, ['oz.', 'ounce', 'ounces']),
  measure('lb', 'lb', 'mass', 'imperial', OUNCE_G * 16, ['lb.', 'lbs', 'lbs.', 'pound', 'pounds']),
  // Metric mass.
  measure('mg', 'mg', 'mass', 'metric', 0.001, ['milligram', 'milligrams']),
  measure('g', 'g', 'mass', 'metric', 1, ['g.', 'gram', 'grams', 'gramme', 'grammes']),
  measure('kg', 'kg', 'mass', 'metric', 1000, [
    'kg.',
    'kgs',
    'kilogram',
    'kilograms',
    'kilo',
    'kilos',
  ]),
  // Counts: a line with no unit counts items, and a dozen is 12 of them.
  measure('dozen', 'dozen', 'count', null, 12, ['doz', 'doz.']),
  // Named units.
  named('bag', 'bags'),
  named('bottle', 'bottles'),
  named('box', 'boxes'),
  named('bunch', 'bunches'),
  named('can', 'cans'),
  named('clove', 'cloves'),
  named('cube', 'cubes'),
  named('dash', 'dashes'),
  named('drop', 'drops'),
  named('handful', 'handfuls'),
  named('head', 'heads'),
  named('jar', 'jars'),
  named('package', 'packages', ['pkg', 'pkg.']),
  named('packet', 'packets'),
  named('piece', 'pieces', ['pc', 'pcs']),
  named('pinch', 'pinches'),
  named('sheet', 'sheets'),
  named('slice', 'slices'),
  named('sprig', 'sprigs'),
  named('stalk', 'stalks'),
  named('stick', 'sticks'),
];

const toUnit = ({ name, plural, dimension, system, factor }: UnitDefinition): Unit => ({
  name,
  plural,
  dimension,
  system,
  factor,
});

/** Every unit, by name. */
export const UNITS: ReadonlyMap<string, Unit> = new Map(
  DEFINITIONS.map((definition) => [definition.name, toUnit(definition)]),
);

const BY_ALIAS = new Map<string, Unit>();
const BY_EXACT_ALIAS = new Map<string, Unit>();
/** Adds an alias, refusing one another unit already has, so no alias is ambiguous. */
function addAlias(map: Map<string, Unit>, alias: string, unit: Unit) {
  const existing = map.get(alias);
  if (existing && existing !== unit) {
    throw new Error(`"${alias}" names both ${existing.name} and ${unit.name}`);
  }
  map.set(alias, unit);
}
for (const definition of DEFINITIONS) {
  const unit = UNITS.get(definition.name);
  if (!unit) continue;
  for (const alias of definition.aliases) addAlias(BY_ALIAS, alias.toLowerCase(), unit);
  for (const alias of definition.exactAliases ?? []) addAlias(BY_EXACT_ALIAS, alias, unit);
}

/** The unit `text` names ("Tablespoons", "T", "fl. oz."), or `undefined` if it names none. */
export function findUnit(text: string): Unit | undefined {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return BY_EXACT_ALIAS.get(trimmed) ?? BY_ALIAS.get(trimmed.toLowerCase());
}

/**
 * The unit a stored line names: one from the table, or a named unit for one typed in by hand, which
 * scales but converts to nothing. `null` for a line with no unit.
 */
export function resolveUnit(name: string | null): Unit | null {
  if (name === null) return null;
  return UNITS.get(name) ?? { name, plural: name, dimension: null, system: null, factor: 1 };
}

/**
 * What a stored unit measures. A line with no unit is a count of items. A unit this table doesn't
 * know, which someone typed in by hand, is treated as a named unit.
 */
export function dimensionOf(unit: Unit | null): Dimension | null {
  return unit ? unit.dimension : 'count';
}

/**
 * `value` of `from`, in `to`: `null` means a count of items. `undefined` when the two don't share
 * a dimension, or either is a named unit, which converts only to itself.
 */
export function convert(value: number, from: Unit | null, to: Unit | null): number | undefined {
  if (from === to || (from !== null && to !== null && from.name === to.name)) return value;
  const dimension = dimensionOf(from);
  if (dimension === null || dimension !== dimensionOf(to)) return undefined;
  return (value * (from?.factor ?? 1)) / (to?.factor ?? 1);
}
