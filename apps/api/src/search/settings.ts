import type { KeyCreation, Settings } from 'meilisearch';
import type { RecipeSearchDocument } from './document.ts';

/** The index search queries go to. Rebuilds fill a fresh index and swap it in (spec §4). */
export const RECIPES_INDEX = 'recipes';

type Attribute = keyof RecipeSearchDocument;

/** The recipe index's settings, applied at startup (spec §4). */
export const RECIPES_SETTINGS = {
  // Most important first: a match in the title ranks above one in the steps.
  searchableAttributes: [
    'title',
    'ingredientNames',
    'cuisine',
    'mealType',
    'diet',
    'customTags',
    'description',
    'stepText',
  ] satisfies Attribute[],
  filterableAttributes: [
    // The access filter the API adds to every query.
    'deleted',
    'visibility',
    'ownerId',
    // Filters people choose (spec §3.4). Ingredient autocomplete is a facet search over
    // normalizedIngredientNames.
    'normalizedIngredientNames',
    'cuisine',
    'mealType',
    'diet',
    'customTags',
    'allergens',
    'difficulty',
    'totalMinutes',
  ] satisfies Attribute[],
  sortableAttributes: ['ratingScore', 'publishedAt', 'totalMinutes'] satisfies Attribute[],
  // Meilisearch's defaults, written out so a new version can't change them unnoticed.
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attributeRank',
    'sort',
    'wordPosition',
    'exactness',
  ],
  // Each name finds the others. Meilisearch needs every direction listed.
  synonyms: {
    scallion: ['green onion'],
    'green onion': ['scallion'],
  },
} satisfies Settings;

/**
 * The API's own key, which it uses for everything; the master key only creates it (spec §4).
 * Meilisearch derives a key from its ID and the master key, so it's the same after every restart
 * and isn't stored anywhere.
 */
export const API_KEY = {
  uid: '36c3ffa3-4960-4a33-a0a3-bb955e168014',
  name: 'myli API',
  description: "myli's API. Created at startup with the master key. Limited to the recipe indexes.",
  actions: [
    'search',
    'documents.add',
    'documents.delete',
    'indexes.create',
    'indexes.get',
    'indexes.delete',
    'indexes.swap',
    'settings.update',
    'stats.get',
    'tasks.get',
  ],
  // The recipe index, and the fresh ones a rebuild fills and swaps in.
  indexes: [`${RECIPES_INDEX}*`],
  expiresAt: null,
} satisfies KeyCreation;
