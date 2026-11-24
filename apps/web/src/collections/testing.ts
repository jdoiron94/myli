import { RECIPES_PER_PAGE } from '@myli/shared';
import { HttpResponse, http } from 'msw';
import type { RecipeSummary } from '@/recipes/recipe.ts';
import { apiServer, problemResponse } from '@/testing.ts';

interface StoredCollection {
  id: string;
  name: string;
  recipes: RecipeSummary[];
}

/**
 * Stands in for the API's copy of the signed-in user's collections, as it answers them, `perPage`
 * recipes to a page, and keeps what each change sent.
 */
export function storeCollections(initial: StoredCollection[], perPage = RECIPES_PER_PAGE) {
  let collections = initial;
  const sent: { method: string; path: string; body?: unknown }[] = [];
  const find = (id: unknown) => collections.find((collection) => collection.id === id);
  const missing = () => problemResponse(404, 'Collection not found.');
  const record = async (request: Request) => {
    const text = await request.text();
    sent.push({
      method: request.method,
      path: new URL(request.url).pathname.replace('/api/v1', ''),
      ...(text && { body: JSON.parse(text) as unknown }),
    });
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  };

  apiServer.use(
    http.get('/api/v1/collections', () =>
      HttpResponse.json({
        collections: [...collections]
          .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
          .map(({ id, name, recipes }) => ({ id, name, recipeCount: recipes.length })),
      }),
    ),
    http.post('/api/v1/collections', async ({ request }) => {
      const { name } = (await record(request)) as { name: string };
      const created = { id: `collection-${String(collections.length + 1)}`, name, recipes: [] };
      collections = [...collections, created];
      return HttpResponse.json({ id: created.id, name, recipeCount: 0 }, { status: 201 });
    }),
    http.get('/api/v1/collections/:id', ({ request, params }) => {
      const found = find(params.id);
      if (!found) return missing();
      const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
      const total = found.recipes.length;
      return HttpResponse.json({
        id: found.id,
        name: found.name,
        recipes: found.recipes.slice((page - 1) * perPage, page * perPage),
        total,
        page,
        totalPages: Math.max(1, Math.ceil(total / perPage)),
      });
    }),
    http.put('/api/v1/collections/:id', async ({ request, params }) => {
      const { name } = (await record(request)) as { name: string };
      const found = find(params.id);
      if (!found) return missing();
      found.name = name;
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/v1/collections/:id', async ({ request, params }) => {
      await record(request);
      if (!find(params.id)) return missing();
      collections = collections.filter((collection) => collection.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/v1/collections/:id/recipes/:recipeId/move', async ({ request, params }) => {
      const { direction } = (await record(request)) as { direction: 'earlier' | 'later' };
      const found = find(params.id);
      if (!found) return missing();
      const from = found.recipes.findIndex((recipe) => recipe.id === params.recipeId);
      const to = direction === 'earlier' ? from - 1 : from + 1;
      const [moving, passed] = [found.recipes[from], found.recipes[to]];
      if (moving && passed)
        found.recipes.splice(
          Math.min(from, to),
          2,
          ...(to < from ? [moving, passed] : [passed, moving]),
        );
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/v1/collections/:id/recipes/:recipeId', async ({ request, params }) => {
      await record(request);
      const found = find(params.id);
      if (!found) return missing();
      found.recipes = found.recipes.filter((recipe) => recipe.id !== params.recipeId);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return sent;
}
