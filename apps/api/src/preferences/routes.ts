import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { preferencesResultSchema, userPreferencesSchema } from '@myli/shared';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses } from '../problems.ts';
import { getPreferences, savePreferences } from './preferences.ts';

const preferencesResult = (description: string) => ({
  description,
  content: { 'application/json': { schema: preferencesResultSchema } },
});

const getMyPreferences = createRoute({
  method: 'get',
  path: '/me/preferences',
  tags: ['Preferences'],
  summary: 'Get your preferences',
  description: "Any signed-in user's own display preferences, or the defaults until they choose.",
  middleware: [requireSession] as const,
  responses: {
    200: preferencesResult('Your preferences.'),
    ...errorResponses,
  },
});

const putMyPreferences = createRoute({
  method: 'put',
  path: '/me/preferences',
  tags: ['Preferences'],
  summary: 'Save your preferences',
  description:
    'Any signed-in user, viewers included: preferences change only what they see. Replaces all ' +
    'of them.',
  middleware: [requireSession] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: userPreferencesSchema } } },
  },
  responses: {
    200: preferencesResult('Your preferences, as saved.'),
    ...errorResponses,
  },
});

export function registerPreferenceRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  v1.openapi(getMyPreferences, (c) =>
    c.json({ preferences: getPreferences(deps.db, c.var.user.id) }, 200),
  );

  v1.openapi(putMyPreferences, (c) => {
    savePreferences(deps.db, c.var.user.id, c.req.valid('json'));
    return c.json({ preferences: getPreferences(deps.db, c.var.user.id) }, 200);
  });
}
