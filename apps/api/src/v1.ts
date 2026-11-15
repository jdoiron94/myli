import { OpenAPIHono } from '@hono/zod-openapi';
import { API_BASE_PATH } from '@myli/shared';
import { registerAuditRoutes } from './audit/routes.ts';
import type { Auth } from './auth/auth.ts';
import type { AppEnv } from './context.ts';
import type { Db } from './db/database.ts';
import type { Env } from './env.ts';
import { registerInvitationRoutes } from './invitations/routes.ts';
import { jsonOnly } from './json-only.ts';
import { validationHook } from './problems.ts';
import { registerSetupRoutes } from './setup/routes.ts';
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
}

/** The settings route handlers need from the environment. */
export type AppSettings = Pick<Env, 'PUBLIC_URL' | 'INVITATION_TTL_DAYS' | 'SMTP_HOST'>;

export function createV1Router(deps: V1Deps) {
  const v1 = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // Before every route: requests that change data must be JSON, even without a body.
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
