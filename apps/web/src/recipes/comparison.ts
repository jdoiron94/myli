import { type RecipeDetail, recipeTotalMinutes } from '@myli/shared';
import { DIFFICULTY_LABELS, formatMinutes, formatNumber } from './format.ts';
import type { RecipeRevisionContent } from './recipe.ts';

/** How a comparison names each detail of a recipe. */
export const DETAIL_LABELS: Readonly<Record<RecipeDetail, string>> = {
  title: 'Title',
  coverImageId: 'Cover photo',
  source: 'Source',
  prepMinutes: 'Prep',
  cookMinutes: 'Cook',
  totalMinutes: 'Total',
  servings: 'Servings',
  yield: 'Makes',
  difficulty: 'Difficulty',
};

const minutes = (value: number | null) => (value === null ? null : formatMinutes(value));

/** How each detail but the cover reads in a version of a recipe, `null` when it has none. */
export const DETAIL_TEXT: Readonly<
  Record<Exclude<RecipeDetail, 'coverImageId'>, (content: RecipeRevisionContent) => string | null>
> = {
  title: ({ title }) => title,
  source: ({ source: { url, title, author } }) => {
    const text = [title, author === null ? null : `by ${author}`, url]
      .filter((part) => part !== null)
      .join(', ');
    return text === '' ? null : text;
  },
  prepMinutes: ({ prepMinutes }) => minutes(prepMinutes),
  cookMinutes: ({ cookMinutes }) => minutes(cookMinutes),
  // As its page shows it: prep plus cook, unless it says otherwise.
  totalMinutes: (content) => minutes(recipeTotalMinutes(content)),
  servings: ({ servings }) => String(servings),
  yield: ({ yield: makes }) => {
    if (!makes) return null;
    const amount = formatNumber(makes.qty);
    return makes.unit === null ? amount : `${amount} ${makes.unit}`;
  },
  difficulty: ({ difficulty }) => (difficulty === null ? null : DIFFICULTY_LABELS[difficulty]),
};

/** The cover photo of a version of a recipe, if it has one. */
export const coverOf = ({ images, coverImageId }: RecipeRevisionContent) =>
  images.find(({ id }) => id === coverImageId);
