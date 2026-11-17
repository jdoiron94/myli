import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  type RebuildState,
  recipeSearchQuerySchema,
  recipeSearchResultSchema,
  type SearchIndexStatus,
  searchIndexStatusSchema,
} from '@myli/shared';
import { desc, eq } from 'drizzle-orm';
import { requirePermission } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { job } from '../db/schema.ts';
import { errorResponses } from '../problems.ts';
import { searchRecipes } from './query.ts';
import { queueReindex, reindexRecipesJob } from './reindex.ts';
import type { SearchAccess, SearchService } from './service.ts';

const status = (description: string) => ({
  description,
  content: { 'application/json': { schema: searchIndexStatusSchema } },
});

const getRecipes = createRoute({
  method: 'get',
  path: '/search/recipes',
  tags: ['Search'],
  summary: 'Search recipes',
  description:
    'Any signed-in user. Finds only recipes the caller may see: shared ones, and their own private ' +
    'ones. Filters on different things all hold; within one, cuisines, meals and difficulties ' +
    'take any of their values, and diets and other tags all of them. Repeat a parameter for more ' +
    'than one value.',
  middleware: [requireSession] as const,
  request: { query: recipeSearchQuerySchema },
  responses: {
    200: {
      description: 'One page of matching recipes, with the count of each filter value.',
      content: { 'application/json': { schema: recipeSearchResultSchema } },
    },
    503: {
      description: 'Search is unavailable. Everything else works.',
      content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
    },
    ...errorResponses,
  },
});

const getIndex = createRoute({
  method: 'get',
  path: '/search/index',
  tags: ['Search'],
  summary: 'Show the search index',
  description: 'Admins only. Whether search works, and how the latest rebuild of its index went.',
  middleware: [requirePermission('search.reindex')] as const,
  responses: {
    200: status('The search index.'),
    ...errorResponses,
  },
});

const postRebuild = createRoute({
  method: 'post',
  path: '/search/index/rebuild',
  tags: ['Search'],
  summary: 'Rebuild the search index',
  description:
    'Admins only. Rebuilds the index from the database in the background, then swaps it in; ' +
    'search keeps working meanwhile. If a rebuild is already waiting or under way, that one ' +
    'stands. While search is unavailable, the rebuild waits for it.',
  middleware: [requirePermission('search.reindex')] as const,
  responses: {
    202: status('The search index, with the rebuild asked for.'),
    ...errorResponses,
  },
});

/** How the job's status reads to an admin. Its error stays in the log: it can hold internals. */
function rebuildState({ status, attempts }: typeof job.$inferSelect): RebuildState {
  switch (status) {
    case 'pending':
      return attempts > 0 ? 'retrying' : 'queued';
    case 'running':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'dead':
      return 'failed';
  }
}

async function indexStatus(db: Db, search: Pick<SearchService, 'isReady'>) {
  const latest = db
    .select()
    .from(job)
    .where(eq(job.type, reindexRecipesJob.type))
    .orderBy(desc(job.id))
    .get();
  return {
    available: await search.isReady(),
    rebuild: latest
      ? { state: rebuildState(latest), queuedAt: latest.createdAt.toISOString() }
      : null,
  } satisfies SearchIndexStatus;
}

export function registerSearchRoutes(
  app: OpenAPIHono<AppEnv>,
  { db, search }: { db: Db; search: SearchAccess },
) {
  app.openapi(getRecipes, async (c) => {
    const found = await searchRecipes(
      { db, client: search.client, logger: c.var.logger },
      c.var.user,
      c.req.valid('query'),
    );
    return c.json(found, 200);
  });

  app.openapi(getIndex, async (c) => c.json(await indexStatus(db, search), 200));

  app.openapi(postRebuild, async (c) => {
    queueReindex(db);
    return c.json(await indexStatus(db, search), 202);
  });
}
