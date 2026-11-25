import { OpenAPIHono } from '@hono/zod-openapi';
import { API_BASE_PATH } from '@myli/shared';
import { registerAuditRoutes } from './audit/routes.ts';
import type { Auth } from './auth/auth.ts';
import type { BlobStore } from './blobs/store.ts';
import { registerCollectionRoutes } from './collections/routes.ts';
import { registerCommentRoutes } from './comments/routes.ts';
import type { AppEnv } from './context.ts';
import type { Db } from './db/database.ts';
import { registerDraftRoutes } from './drafts/routes.ts';
import type { Env } from './env.ts';
import { registerFavoriteRoutes } from './favorites/routes.ts';
import { registerImageRoutes } from './images/routes.ts';
import { registerInvitationRoutes } from './invitations/routes.ts';
import { jsonOnly } from './json-only.ts';
import { registerNoteRoutes } from './notes/routes.ts';
import { registerPreferenceRoutes } from './preferences/routes.ts';
import { validationHook } from './problems.ts';
import { registerPublicLinkRoutes } from './public-links/routes.ts';
import { registerRatingRoutes } from './ratings/routes.ts';
import { registerRecipeRoutes } from './recipes/routes.ts';
import { registerRevisionRoutes } from './revisions/routes.ts';
import { registerSearchRoutes } from './search/routes.ts';
import type { SearchAccess } from './search/service.ts';
import { registerSetupRoutes } from './setup/routes.ts';
import { registerTagRoutes } from './tags/routes.ts';
import { registerTrashRoutes } from './trash/routes.ts';
import { registerUserRoutes } from './users/routes.ts';

/**
 * The versioned REST API, mounted at `API_BASE_PATH`. Every route is declared with `createRoute`
 * from Zod schemas, which drive request validation, response types and the OpenAPI document.
 * Every route spreads `errorResponses` into its `responses`. Feature modules declare their routes
 * and register them here.
 */
export interface V1Deps {
  db: Db;
  auth: Auth;
  env: AppSettings;
  search: SearchAccess;
  blobs: BlobStore;
}

/** The settings route handlers need from the environment. */
export type AppSettings = Pick<
  Env,
  'PUBLIC_URL' | 'INVITATION_TTL_DAYS' | 'TRASH_RETENTION_DAYS' | 'SMTP_HOST'
>;

export function createV1Router(deps: V1Deps) {
  const v1 = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // Before every route: requests that change data must be JSON, even without a body, except an
  // image upload.
  v1.use(jsonOnly());

  v1.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'myli API',
      version: 'v1',
      description: 'REST API of a self-hosted myli instance. Errors use RFC 9457 problem details.',
    },
    servers: [{ url: API_BASE_PATH }],
  });

  registerSetupRoutes(v1, deps);
  registerAuditRoutes(v1, { db: deps.db });
  registerUserRoutes(v1, { db: deps.db });
  registerRecipeRoutes(v1, { db: deps.db });
  registerDraftRoutes(v1, { db: deps.db });
  registerRevisionRoutes(v1, { db: deps.db });
  registerTrashRoutes(v1, { db: deps.db, retentionDays: deps.env.TRASH_RETENTION_DAYS });
  registerImageRoutes(v1, { db: deps.db, blobs: deps.blobs });
  registerTagRoutes(v1, { db: deps.db });
  registerPreferenceRoutes(v1, { db: deps.db });
  registerFavoriteRoutes(v1, { db: deps.db });
  registerRatingRoutes(v1, { db: deps.db });
  registerCommentRoutes(v1, { db: deps.db });
  registerNoteRoutes(v1, { db: deps.db });
  registerCollectionRoutes(v1, { db: deps.db });
  registerPublicLinkRoutes(v1, { db: deps.db, blobs: deps.blobs });
  registerSearchRoutes(v1, { db: deps.db, search: deps.search });
  registerInvitationRoutes(v1, {
    db: deps.db,
    auth: deps.auth,
    publicUrl: deps.env.PUBLIC_URL,
    ttlDays: deps.env.INVITATION_TTL_DAYS,
    // The same condition main.ts uses to create the mailer.
    emailEnabled: deps.env.SMTP_HOST !== undefined,
  });

  return v1;
}
