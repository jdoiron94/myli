import {
  convert,
  type Dimension,
  resolveUnit,
  UNITS,
  type Unit,
  type UnitSystem,
} from './units.ts';

/**
 * Scaling and showing ingredient quantities (spec §3.2). Scaling changes only what's shown, never
 * the stored recipe.
 */

/** How much of something a line asks for: "1½ cups", "2–3 cloves", "2" (eggs), or nothing. */
export interface Amount {
  /** `null` when the line has no quantity ("salt to taste"). */
  qty: number | null;
  /** The top of a range ("2–3 cloves"), or `null`. */
  qtyMax: number | null;
  /** A unit's name ('cup', 'clove'), one typed by hand, or `null` for a count of items. */
  unit: string | null;
}

/** An amount ready to show: "1½" and "cups". Either is `null` when there's nothing to show. */
export interface DisplayedAmount {
  quantity: string | null;
  unit: string | null;
}

export interface DisplayOptions {
  /** The reader's unit system. */
  system: UnitSystem;
  /** What to multiply quantities by: 1 at the recipe's own servings (see `scaleFactor`). */
  factor: number;
  /** Lines that don't scale ("salt to taste") are shown exactly as written. */
  scalable: boolean;
}

/** What quantities are multiplied by to make `servings` from a recipe that makes `baseline`. */
export function scaleFactor(baseline: number, servings: number): number {
  if (!(baseline > 0) || !(servings > 0)) {
    throw new RangeError('Servings must be positive');
  }
  return servings / baseline;
}

/**
 * `amount` with its quantities multiplied by `factor`, unless the line doesn't scale. Grocery lists
 * add up amounts scaled this way (spec §3.5).
 */
export function scaleAmount(amount: Amount, factor: number, scalable: boolean): Amount {
  if (!scalable || amount.qty === null) return amount;
  return {
    qty: amount.qty * factor,
    qtyMax: amount.qtyMax === null ? null : amount.qtyMax * factor,
    unit: amount.unit,
  };
}

/** The fractions cooks use, as they're shown (spec §3.2). Eighths only for measures. */
const FRACTIONS: readonly (readonly [number, string])[] = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
];

/**
 * The units a dimension is shown in, smallest first, each with the least amount shown in it (in
 * that unit). Converting up picks the largest one the amount reaches: 48 tsp is 1 cup.
 */
const LADDERS: Record<
  UnitSystem,
  Partial<Record<Dimension, readonly (readonly [string, number])[]>>
> = {
  imperial: {
    volume: [
      ['tsp', 0],
      ['tbsp', 1],
      ['cup', 1 / 4],
      ['quart', 1],
      ['gallon', 1],
    ],
    mass: [
      ['oz', 0],
      ['lb', 1],
    ],
  },
  metric: {
    volume: [
      ['ml', 0],
      ['l', 1],
    ],
    mass: [
      ['g', 0],
      ['kg', 1],
    ],
  },
};

/** How close an amount must be to a fraction, relatively, to count as that fraction. */
const NICE_TOLERANCE = 0.05;

/** From 10 up, quantities in fractions are shown as whole numbers: "12 cups", not "12¼ cups". */
const WHOLE_FROM = 10;

/** The value nearest `value` that's a whole number plus one of `fractions`. */
function nearestFraction(value: number, fractions: readonly (readonly [number, string])[]) {
  const whole = Math.floor(value);
  let best = { value: whole, text: String(whole) };
  for (const [fraction, symbol] of [...fractions, [1, ''] as const]) {
    const candidate = whole + fraction;
    if (Math.abs(candidate - value) < Math.abs(best.value - value)) {
      const wholeText = fraction === 1 ? String(whole + 1) : whole === 0 ? '' : String(whole);
      best = { value: candidate, text: wholeText + symbol };
    }
  }
  return best;
}

/** `value` in whole numbers and fractions: "1½", "⅓", "12". */
function fractionText(value: number, unit: Unit | null) {
  if (value >= WHOLE_FROM) {
    const whole = Math.round(value);
    return { value: whole, text: String(whole) };
  }
  // ⅛ tsp and 2⅛ cups are measures; ⅛ of a can or an egg isn't how anyone writes it.
  const fractions = unit?.system === 'imperial' ? FRACTIONS : FRACTIONS.slice(1);
  const nearest = nearestFraction(value, fractions);
  // Too small for the smallest fraction: show it as a decimal rather than as nothing.
  if (nearest.value === 0) return { value, text: String(Number(value.toPrecision(2))) };
  return nearest;
}

/** `value` rounded as metric cooks would: "2.5 g", "40 g", "235 ml", "1.25 kg". */
function decimalText(value: number, unit: Unit) {
  const step =
    unit.factor >= 1000 ? (value < 10 ? 0.05 : 0.5) : value < 10 ? 0.1 : value < 100 ? 1 : 5;
  const rounded = Math.round(value / step) * step;
  // Rounding a tiny amount to nothing would hide it.
  const shown = rounded === 0 ? Number(value.toPrecision(2)) : Number(rounded.toFixed(2));
  return { value: shown, text: String(shown) };
}

function quantityText(value: number, unit: Unit | null) {
  return unit?.system === 'metric' ? decimalText(value, unit) : fractionText(value, unit);
}

/** Whether `value` in `unit` is within the tolerance of a whole number plus a fraction. */
function isNice(value: number, unit: Unit) {
  if (unit.system === 'metric' || value >= WHOLE_FROM) return true;
  const nearest = fractionText(value, unit).value;
  return Math.abs(nearest - value) <= value * NICE_TOLERANCE;
}

/**
 * The unit to show `value` (in `from`) in, for `system`: the largest one the amount reaches where
 * it comes out as a common fraction, or else the largest one it reaches. `from` when its dimension
 * has no ladder in `system`, as for a count or a named unit.
 */
function chooseUnit(value: number, from: Unit, system: UnitSystem): Unit {
  const dimension = from.dimension;
  const ladder = dimension && LADDERS[system][dimension];
  if (!ladder) return from;
  const reached = ladder
    .map(([name, least]) => {
      const unit = UNITS.get(name);
      const inUnit = unit && convert(value, from, unit);
      // Rounded first, so 997.9 g reaches 1 kg rather than showing as 1000 g.
      const reaches = unit && inUnit !== undefined && quantityText(inUnit, unit).value >= least;
      return reaches ? { unit, inUnit } : undefined;
    })
    .filter((candidate) => candidate !== undefined)
    .reverse();
  const largest = reached[0];
  if (!largest) return from;
  return (reached.find(({ unit, inUnit }) => isNice(inUnit, unit)) ?? largest).unit;
}

/**
 * How `amount` is shown to a reader. At the recipe's own servings, in the reader's own system, a
 * line is shown in the unit it was written in. Otherwise its quantity is scaled, converted to the
 * reader's system, and moved to the largest sensible unit.
 */
export function displayAmount(amount: Amount, options: DisplayOptions): DisplayedAmount {
  const written = resolveUnit(amount.unit);
  if (amount.qty === null) return { quantity: null, unit: written?.name ?? null };

  const factor = options.scalable ? options.factor : 1;
  const scaled = scaleAmount(amount, factor, options.scalable);
  const qty = scaled.qty ?? amount.qty;
  const qtyMax = scaled.qtyMax;

  // A count, a named unit, a line that doesn't scale, or one unchanged in its own system: as written.
  // Otherwise a range is shown in a unit both ends reach, so the smaller end chooses it.
  const unit =
    written?.system == null ||
    !options.scalable ||
    (factor === 1 && written.system === options.system)
      ? written
      : chooseUnit(qty, written, options.system);
  const inUnit = (value: number) => convert(value, written, unit) ?? value;

  const low = quantityText(inUnit(qty), unit);
  const high = qtyMax === null ? null : quantityText(inUnit(qtyMax), unit);
  const shownTop = high?.value ?? low.value;
  return {
    quantity: high && high.text !== low.text ? `${low.text}–${high.text}` : low.text,
    unit: unit === null ? null : shownTop > 1 ? unit.plural : unit.name,
  };
}

/** An amount as one string: "1½ cups", "2–3 cloves", "2". Empty when there's nothing to show. */
export function formatAmount({ quantity, unit }: DisplayedAmount): string {
  return [quantity, unit].filter((part) => part !== null).join(' ');
}
