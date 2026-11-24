import { VALIDATION_PROBLEM_TYPE } from '@myli/shared';
import { HttpResponse, http } from 'msw';
import type { RecipeSummary } from '@/recipes/recipe.ts';
import { apiServer, problemResponse } from '@/testing.ts';

interface StoredCollection {
  id: string;
  name: string;
  recipes: RecipeSummary[];
}

/**
 * Stands in for the API's copy of the signed-in user's collections, as it answers them, and keeps
 * what each change sent. A name another of theirs has, whatever its case, is refused at its field.
 */
export function storeCollections(initial: StoredCollection[]) {
  let collections = initial;
  const sent: { method: string; path: string; body?: unknown }[] = [];
  const find = (id: unknown) => collections.find((collection) => collection.id === id);
  const missing = () => problemResponse(404, 'Collection not found.');
  const taken = (name: string, except?: string) => {
    const existing = collections.find(
      (collection) =>
        collection.id !== except && collection.name.toLowerCase() === name.toLowerCase(),
    );
    return existing
      ? problemResponse(422, 'The request has invalid fields.', {
          type: VALIDATION_PROBLEM_TYPE,
          errors: [
            {
              in: 'body',
              pointer: '#/name',
              detail: `You already have a collection called “${existing.name}”.`,
            },
          ],
        })
      : undefined;
  };
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
      const refused = taken(name);
      if (refused) return refused;
      const created = { id: `collection-${String(collections.length + 1)}`, name, recipes: [] };
      collections = [...collections, created];
      return HttpResponse.json({ id: created.id, name, recipeCount: 0 }, { status: 201 });
    }),
    http.get('/api/v1/collections/:id', ({ params }) => {
      const found = find(params.id);
      return found ? HttpResponse.json(found) : missing();
    }),
    http.put('/api/v1/collections/:id', async ({ request, params }) => {
      const { name } = (await record(request)) as { name: string };
      const found = find(params.id);
      if (!found) return missing();
      const refused = taken(name, found.id);
      if (refused) return refused;
      found.name = name;
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/v1/collections/:id', async ({ request, params }) => {
      await record(request);
      if (!find(params.id)) return missing();
      collections = collections.filter((collection) => collection.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.put('/api/v1/collections/:id/order', async ({ request, params }) => {
      const { recipeIds } = (await record(request)) as { recipeIds: string[] };
      const found = find(params.id);
      if (!found) return missing();
      found.recipes = recipeIds.map((id) => {
        const recipe = found.recipes.find((candidate) => candidate.id === id);
        if (!recipe) throw new Error(`${id} isn't in the collection`);
        return recipe;
      });
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
