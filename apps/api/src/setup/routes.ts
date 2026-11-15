import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  setupRequestSchema,
  setupResultSchema,
  setupStatusSchema,
} from '@myli/shared';
import { auditOrigin } from '../audit/audit.ts';
import type { AppEnv } from '../context.ts';
import { errorResponses, HttpProblem } from '../problems.ts';
import { isSetupNeeded, recordSetupCompleted, runSetup, type SetupDeps } from './setup.ts';

const UNAVAILABLE = {
  complete: 'Setup is already complete. Sign in instead.',
  'in-progress': 'Setup is already in progress. Try again in a moment.',
} as const;

const getSetup = createRoute({
  method: 'get',
  path: '/setup',
  tags: ['Setup'],
  summary: 'Whether first-run setup is needed',
  description: 'Public. True until the first admin exists, so the web app knows to show setup.',
  responses: {
    200: {
      description: 'Whether setup is needed.',
      content: { 'application/json': { schema: setupStatusSchema } },
    },
    ...errorResponses,
  },
});

const postSetup = createRoute({
  method: 'post',
  path: '/setup',
  tags: ['Setup'],
  summary: 'Create the first admin',
  description:
    'Public, and only works while no user exists. The new admin then signs in with the same ' +
    'email and password.',
  request: {
    body: { required: true, content: { 'application/json': { schema: setupRequestSchema } } },
  },
  responses: {
    201: {
      description: 'The first admin was created.',
      content: { 'application/json': { schema: setupResultSchema } },
    },
    409: {
      description: 'Setup is already complete, or another setup is in progress.',
      content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
    },
    ...errorResponses,
  },
});

export function registerSetupRoutes(v1: OpenAPIHono<AppEnv>, deps: SetupDeps) {
  v1.openapi(getSetup, (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ needed: isSetupNeeded(deps.db) }, 200);
  });

  v1.openapi(postSetup, async (c) => {
    const result = await runSetup(deps, c.req.valid('json'));
    if (!result.ok) throw new HttpProblem(409, UNAVAILABLE[result.reason]);
    c.var.logger.info({ userId: result.user.id }, 'first admin created');
    recordSetupCompleted(deps.db, c.var.logger, auditOrigin(c), result.user.id, 'api');
    return c.json({ user: result.user }, 201);
  });
}
