import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { type RebuildState, type SearchIndexStatus, searchIndexStatusSchema } from '@myli/shared';
import { desc, eq } from 'drizzle-orm';
import { requirePermission } from '../auth/authorize.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { job } from '../db/schema.ts';
import { errorResponses } from '../problems.ts';
import { queueReindex, reindexRecipesJob } from './reindex.ts';
import type { SearchService } from './service.ts';

const status = (description: string) => ({
  description,
  content: { 'application/json': { schema: searchIndexStatusSchema } },
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
  { db, search }: { db: Db; search: Pick<SearchService, 'isReady'> },
) {
  app.openapi(getIndex, async (c) => c.json(await indexStatus(db, search), 200));

  app.openapi(postRebuild, async (c) => {
    queueReindex(db);
    return c.json(await indexStatus(db, search), 202);
  });
}
