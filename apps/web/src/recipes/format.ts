import {
  type Difficulty,
  displayAmount,
  formatAmount,
  NUTRIENTS,
  type Nutrient,
  type ParsedIngredient,
  resolveUnit,
  type TagType,
  type UnitSystem,
} from '@myli/shared';
import type { Recipe, Tag } from './recipe.ts';

/** How a recipe's parts read on its page. */

/** "20 min", "1 hr 30 min", "3 hr". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} hr` : `${String(hours)} hr ${String(rest)} min`;
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** A number as the reader's locale writes it, to one decimal place: "2.5", "1,200". */
export const formatNumber = (value: number) => numberFormat.format(value);

export interface ShownLine {
  /** "1½ cups", "2–3", "pinch of", or empty when there's no amount. */
  amount: string;
  name: string;
  note: string | null;
}

/** An ingredient line as the reader sees it, in their unit system, scaled by `factor`. */
export function showLine(
  line: ParsedIngredient,
  { system, factor }: { system: UnitSystem; factor: number },
): ShownLine {
  const shown = displayAmount(line, { system, factor, scalable: line.scalable });
  // A unit without a quantity was written before "of" ("pinch of salt"), so it reads that way.
  const amount =
    shown.quantity === null && shown.unit !== null ? `${shown.unit} of` : formatAmount(shown);
  return { amount, name: line.name, note: line.note };
}

/** A line as it was written, as the editor shows it: unscaled, in its own unit. */
export const showLineAsWritten = (line: ParsedIngredient) =>
  showLine(line, { system: resolveUnit(line.unit)?.system ?? 'imperial', factor: 1 });

export const UNIT_SYSTEM_LABELS: Readonly<Record<UnitSystem, string>> = {
  imperial: 'US customary',
  metric: 'Metric',
};

export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

/** The order a recipe's page shows its tags in, by type. */
const SHOWN_TAG_TYPES: readonly Exclude<TagType, 'allergen'>[] = [
  'cuisine',
  'meal_type',
  'diet',
  'custom',
];

/**
 * A recipe's tags as its page shows them: the allergens apart, since they're shown together first,
 * and the rest in one list, by type.
 */
export function shownTags(tags: readonly Tag[]): { tags: Tag[]; allergens: Tag[] } {
  return {
    tags: SHOWN_TAG_TYPES.flatMap((type) => tags.filter((tag) => tag.type === type)),
    allergens: tags.filter((tag) => tag.type === 'allergen'),
  };
}

/** Each nutrient's name and unit, as a recipe's page writes them. */
export const NUTRIENT_FACTS: Readonly<Record<Nutrient, { label: string; unit: string }>> = {
  calories: { label: 'Calories', unit: '' },
  proteinGrams: { label: 'Protein', unit: ' g' },
  carbsGrams: { label: 'Carbohydrates', unit: ' g' },
  fatGrams: { label: 'Fat', unit: ' g' },
  fiberGrams: { label: 'Fiber', unit: ' g' },
  sugarGrams: { label: 'Sugar', unit: ' g' },
  sodiumMilligrams: { label: 'Sodium', unit: ' mg' },
};

/** "210", "2.5 g", "380 mg". */
export const formatNutrient = (nutrient: Nutrient, value: number) =>
  `${formatNumber(value)}${NUTRIENT_FACTS[nutrient].unit}`;

/** The nutrition a recipe states per serving, as label and value, leaving out what it doesn't. */
export function nutritionFacts(nutrition: Recipe['nutrition']): { label: string; value: string }[] {
  return NUTRIENTS.flatMap((nutrient) => {
    const value = nutrition[nutrient];
    return value === null
      ? []
      : [{ label: NUTRIENT_FACTS[nutrient].label, value: formatNutrient(nutrient, value) }];
  });
}
