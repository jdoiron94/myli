import { ALLERGENS, STALE_RECIPE_PROBLEM_TYPE } from '@myli/shared';
import { within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { answerPreferences } from '@/account/testing.ts';
import { apiServer, problemResponse, testUsers } from '@/testing.ts';
import type {
  Image,
  Recipe,
  RecipeDraft,
  RecipeRevision,
  RecipeRevisionContent,
  RecipeSummary,
  Tag,
} from './recipe.ts';
import { recipeContent } from './recipe-form.ts';

/** A 1600×1200 photo, with the sizes the API makes of one that wide. */
export const sampleImage = (id: string, alt = ''): Image => ({
  id,
  alt,
  width: 1600,
  height: 1200,
  variants: [
    { width: 640, height: 480 },
    { width: 1280, height: 960 },
    { width: 1600, height: 1200 },
  ],
});

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
    steps: [
      { body: 'Mix everything.', image: null },
      { body: 'Bake at **400°F**.', image: null },
    ],
    tags: [],
    images: [],
    coverImageId: null,
    revision: 1,
    version: 1,
    createdAt: '2026-11-10T09:00:00.000Z',
    updatedAt: '2026-11-12T09:00:00.000Z',
    ...overrides,
  };
}

/**
 * A draft of the sample recipe as the API would send it, unchanged so far, saved by the admin from
 * its first revision.
 */
export function sampleDraft(overrides: Partial<RecipeDraft> = {}): RecipeDraft {
  return {
    content: recipeContent(sampleRecipe()),
    photos: [],
    author: { id: testUsers.admin.id, name: testUsers.admin.name },
    updatedAt: '2026-11-18T09:00:00.000Z',
    revision: 1,
    version: 2,
    ...overrides,
  };
}

/** The API's 412 for a change based on an older version, holding the recipe as it is now. */
export const staleRecipeResponse = (recipe: Recipe) =>
  problemResponse(412, 'This recipe changed after you loaded it.', {
    type: STALE_RECIPE_PROBLEM_TYPE,
    recipe,
  });

/** What a revision records of a recipe: its content, with its tags and photos as they were. */
export function revisionContent({
  title,
  description,
  source,
  equipment,
  yield: makes,
  servings,
  prepMinutes,
  cookMinutes,
  totalMinutes,
  difficulty,
  nutrition,
  ingredientGroups,
  steps,
  tags,
  images,
  coverImageId,
}: Recipe): RecipeRevisionContent {
  return {
    title,
    description,
    source,
    equipment,
    yield: makes,
    servings,
    prepMinutes,
    cookMinutes,
    totalMinutes,
    difficulty,
    nutrition,
    ingredientGroups,
    steps,
    tags,
    images,
    coverImageId,
  };
}

/** Revision `number` of the sample recipe as the API would send it, saved by its owner, the editor. */
export function sampleRevision(
  number: number,
  overrides: Partial<RecipeRevision> = {},
): RecipeRevision {
  return {
    number,
    author: { id: testUsers.editor.id, name: testUsers.editor.name },
    message: null,
    createdAt: `2026-11-1${String(number)}T09:00:00.000Z`,
    content: revisionContent(sampleRecipe()),
    ...overrides,
  };
}

/**
 * Answers a recipe's history with these revisions, newest first as given, and each one by its
 * number, 404 for any other.
 */
export function answerRevisions(revisions: RecipeRevision[]) {
  apiServer.use(
    http.get('/api/v1/recipes/:id/revisions', () =>
      HttpResponse.json({
        revisions: revisions.map(({ number, author, message, createdAt }) => ({
          number,
          author,
          message,
          createdAt,
        })),
      }),
    ),
    http.get('/api/v1/recipes/:id/revisions/:number', ({ params }) => {
      const revision = revisions.find(({ number }) => String(number) === params.number);
      return revision
        ? HttpResponse.json({ revision })
        : problemResponse(404, 'There is no revision with this number.');
    }),
  );
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

/** A recipe as a list or search results give it, for its card. */
export const sampleSummary = (overrides: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id: 'curry',
  title: 'Green Curry',
  difficulty: 'medium',
  totalMinutes: 40,
  cuisine: ['Thai'],
  mealType: ['Dinner'],
  diet: ['Vegan'],
  tags: ['Weeknight'],
  allergens: [],
  visibility: 'shared',
  cover: null,
  rating: { average: null, count: 0 },
  ...overrides,
});

/**
 * What a recipe card says: its title, the line of facts under it, and its tags. Read part by part,
 * since Vue drops the spaces between elements that a browser would read.
 */
export function cardParts(card: HTMLElement) {
  const text = (element: Element | null | undefined) =>
    element?.textContent.replace(/\s+/g, ' ').trim();
  const tags = within(card).queryByRole('list', { name: 'Tags' });
  return {
    title: text(within(card).getByRole('heading', { level: 2 })),
    facts: [...card.querySelectorAll('p span')].map((span) => text(span)).join(' '),
    tags: tags
      ? within(tags)
          .getAllByRole('listitem')
          .map((item) => text(item))
      : [],
  };
}

/** A file to pick as a photo: its bytes aren't an image, which only the API would check. */
export const photoFile = (name: string, type = 'image/jpeg', size = 1000) =>
  new File([new Uint8Array(size)], name, { type });

/**
 * Answers uploads with `answer`, given how many there have been, by default the photos `upload-1`,
 * `upload-2` and so on. Keeps the type and size of each.
 */
export function answerUploads(answer?: (count: number) => Response | Promise<Response>) {
  const sent: { type: string | null; size: number }[] = [];
  apiServer.use(
    http.post('/api/v1/images', async ({ request }) => {
      sent.push({
        type: request.headers.get('content-type'),
        size: (await request.arrayBuffer()).byteLength,
      });
      const count = sent.length;
      return answer
        ? answer(count)
        : HttpResponse.json({ image: sampleImage(`upload-${String(count)}`) }, { status: 201 });
    }),
  );
  return sent;
}
