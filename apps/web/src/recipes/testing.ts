import { ALLERGENS } from '@myli/shared';
import { HttpResponse, http } from 'msw';
import { answerPreferences } from '@/account/testing.ts';
import { apiServer, problemResponse, testUsers } from '@/testing.ts';
import type { Recipe, Tag } from './recipe.ts';

/** A recipe as the API would send it, owned by the editor `renderApp` signs in by default. */
export function sampleRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-bread',
    owner: { id: testUsers.editor.id, name: testUsers.editor.name },
    visibility: 'shared',
    title: 'Weeknight Bread',
    description: 'A *simple* loaf.',
    source: { url: 'https://example.com/bread', title: 'Example Bakes', author: 'A. Baker' },
    equipment: ['Loaf pan', 'Stand mixer'],
    yield: { qty: 1, unit: 'loaf' },
    servings: 8,
    prepMinutes: 20,
    cookMinutes: 40,
    totalMinutes: 180,
    difficulty: 'easy',
    nutrition: {
      calories: 210,
      proteinGrams: 6,
      carbsGrams: 40,
      fatGrams: 2.5,
      fiberGrams: null,
      sugarGrams: null,
      sodiumMilligrams: 380,
    },
    ingredientGroups: [
      {
        label: null,
        ingredients: [
          {
            rawText: '3 cups all-purpose flour',
            qty: 3,
            qtyMax: null,
            unit: 'cup',
            name: 'all-purpose flour',
            normalizedName: 'all purpose flour',
            note: null,
            scalable: true,
          },
          {
            rawText: 'salt to taste',
            qty: null,
            qtyMax: null,
            unit: null,
            name: 'salt',
            normalizedName: 'salt',
            note: 'to taste',
            scalable: false,
          },
        ],
      },
    ],
    steps: [{ body: 'Mix everything.' }, { body: 'Bake at **400°F**.' }],
    tags: [],
    createdAt: '2026-11-10T09:00:00.000Z',
    updatedAt: '2026-11-12T09:00:00.000Z',
    ...overrides,
  };
}

/**
 * Answers GET /recipes/{id} with this recipe, and 404 for any other, and counts the requests. Also
 * answers the reader's preferences with imperial, unless the test answers them itself afterwards.
 */
export function answerRecipe(recipe: Recipe) {
  answerPreferences();
  const requests: string[] = [];
  apiServer.use(
    http.get('/api/v1/recipes/:id', ({ params }) => {
      requests.push(String(params.id));
      return params.id === recipe.id
        ? HttpResponse.json({ recipe })
        : problemResponse(404, 'There is no recipe with this ID.');
    }),
  );
  return requests;
}

/** The tags of an instance, as GET /tags lists them: by type, then name. */
export const sampleTags = (): Tag[] => [
  { id: 20, type: 'cuisine', name: 'Italian' },
  { id: 21, type: 'cuisine', name: 'Mexican' },
  { id: 30, type: 'meal_type', name: 'Dinner' },
  { id: 40, type: 'diet', name: 'Vegetarian' },
  ...ALLERGENS.map((name, index) => ({ id: index + 1, type: 'allergen' as const, name })),
  { id: 50, type: 'custom', name: 'Weeknight' },
];

/** Answers GET /tags, which the recipe editor loads, with these tags. */
export function answerTags(tags: Tag[] = sampleTags()) {
  apiServer.use(http.get('/api/v1/tags', () => HttpResponse.json({ tags })));
}
