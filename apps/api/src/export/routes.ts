import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { recipeExportQuerySchema, recipeExportSchema, recipeIdParamsSchema } from '@myli/shared';
import { auditOrigin, recordAuditEvent } from '../audit/audit.ts';
import { requirePermission } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { BlobStore } from '../blobs/store.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import type { Logger } from '../logger.ts';
import { errorResponses } from '../problems.ts';
import { problem, recipeGuards } from '../recipes/http.ts';
import { instanceArchive, readInstance } from './instance.ts';
import { exportFileName, nativeExport, schemaOrgExport } from './recipe.ts';

const download = {
  'Content-Disposition': {
    schema: { type: 'string' as const },
    description: 'An attachment, named after the recipe.',
  },
};

const getRecipeExport = createRoute({
  method: 'get',
  path: '/recipes/{id}/export',
  tags: ['Recipes'],
  summary: 'Export a recipe',
  description:
    'Anyone who may see the recipe, as a file to download: as published, in myli’s own JSON or ' +
    'as schema.org/Recipe JSON-LD, without its photos, whose addresses only work signed in here.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema, query: recipeExportQuerySchema },
  responses: {
    200: {
      description: 'The recipe in the format asked for.',
      content: {
        'application/json': { schema: recipeExportSchema },
        'application/ld+json': { schema: z.record(z.string(), z.unknown()) },
      },
      headers: download,
    },
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...errorResponses,
  },
});

const getInstanceExport = createRoute({
  method: 'get',
  path: '/export',
  tags: ['Export'],
  summary: 'Export the instance',
  description:
    'Admins only. A zip archive of every recipe the caller may see, as published, with its ' +
    'revisions; every tag; and each photo they show, at its largest size. Other people’s private ' +
    'recipes aren’t in it: backups hold everything.',
  middleware: [requirePermission('instance.export')] as const,
  responses: {
    200: {
      description: 'The archive, made as it downloads.',
      content: { 'application/zip': { schema: z.string().openapi({ format: 'binary' }) } },
      headers: {
        'Content-Disposition': {
          schema: { type: 'string' as const },
          description: 'An attachment, named after the day.',
        },
      },
    },
    ...errorResponses,
  },
});

export function registerExportRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db; blobs: BlobStore }) {
  const { authorizeOn, found } = recipeGuards(deps.db);

  v1.openapi(getRecipeExport, (c) => {
    const { id } = c.req.valid('param');
    const { format } = c.req.valid('query');
    authorizeOn(c, 'recipe.read', id);
    const recipe = found(id);
    if (format === 'jsonld') {
      return c.json(schemaOrgExport(recipe), 200, {
        'Content-Type': 'application/ld+json',
        'Content-Disposition': attachment(exportFileName(recipe.title, 'jsonld')),
      });
    }
    return c.json(nativeExport(recipe), 200, {
      'Content-Disposition': attachment(exportFileName(recipe.title, 'json')),
    });
  });

  v1.openapi(getInstanceExport, (c) => {
    const now = new Date();
    // What's exported, and that it was, at the same moment.
    const contents = deps.db.transaction((tx) => {
      const read = readInstance(tx, c.var.user);
      recordAuditEvent(tx, auditOrigin(c), {
        action: 'instance.exported',
        metadata: { recipes: read.recipes.length, photos: read.photos.length },
      });
      return read;
    });
    const { logger } = c.var;
    logger.info({ recipes: contents.recipes.length }, 'instance export started');
    const archive = instanceArchive(contents, { blobs: deps.blobs, logger, now });
    return c.body(ReadableStream.from(loggingFailure(archive, logger)), 200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachment(`myli-export-${now.toISOString().slice(0, 10)}.zip`),
      'Cache-Control': 'no-store',
    });
  });
}

/**
 * `chunks`, logging a failure partway: the response has started, so the client only sees it end
 * early, and the error handler never sees it.
 */
async function* loggingFailure(chunks: AsyncGenerator<Uint8Array>, logger: Logger) {
  try {
    yield* chunks;
  } catch (error) {
    logger.error({ err: error }, 'instance export failed partway');
    throw error;
  }
}

/** Downloaded, under `name`, which is only letters, digits, dots and dashes. */
export const attachment = (name: string) => `attachment; filename="${name}"`;
