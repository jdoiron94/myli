import { OpenAPIHono } from '@hono/zod-openapi';
import { API_BASE_PATH } from '@myli/shared';
import type { AppEnv } from './context.ts';
import { validationHook } from './problems.ts';

/**
 * The versioned REST API, mounted at `API_BASE_PATH`. Every route is declared with `createRoute`
 * from Zod schemas, which drive request validation, response types and the OpenAPI document.
 * Every route spreads `errorResponses` into its `responses`.
 */
export function createV1Router() {
  const v1 = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  v1.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'myli API',
      version: 'v1',
      description: 'REST API of a self-hosted myli instance. Errors use RFC 9457 problem details.',
    },
    servers: [{ url: API_BASE_PATH }],
  });

  return v1;
}
