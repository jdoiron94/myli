import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  noteRequestSchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  recipeIdParamsSchema,
  recipeNoteSchema,
  savedNoteSchema,
} from '@myli/shared';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses } from '../problems.ts';
import { recipeGuards } from '../recipes/http.ts';
import { deleteNote, findNote, saveNote } from './notes.ts';

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

const noteResult = (description: string) => ({
  description,
  content: { 'application/json': { schema: recipeNoteSchema } },
});

const notFoundResponse = problem('No recipe has this ID, or the caller may not see it.');
const viewersKeepNone = problem(
  'The caller may see the recipe but keeps no notes: viewers are read-only.',
);

const getNote = createRoute({
  method: 'get',
  path: '/recipes/{id}/note',
  tags: ['Notes'],
  summary: 'Get your note on a recipe',
  description:
    'Editors and admins, for any recipe they can see. Notes are personal: no one else ever sees ' +
    'them, admins included.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: noteResult('Their note, if they have one.'),
    403: viewersKeepNone,
    404: notFoundResponse,
    ...errorResponses,
  },
});

const putNote = createRoute({
  method: 'put',
  path: '/recipes/{id}/note',
  tags: ['Notes'],
  summary: 'Write your note on a recipe',
  description:
    'Editors and admins, for any recipe they can see: one note each, which this writes or replaces.',
  middleware: [requireSession] as const,
  request: {
    params: recipeIdParamsSchema,
    body: { required: true, content: { 'application/json': { schema: noteRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Their note now.',
      content: { 'application/json': { schema: savedNoteSchema } },
    },
    403: viewersKeepNone,
    404: notFoundResponse,
    ...errorResponses,
  },
});

const deleteNoteRoute = createRoute({
  method: 'delete',
  path: '/recipes/{id}/note',
  tags: ['Notes'],
  summary: 'Delete your note on a recipe',
  description: 'Editors and admins. With no note of theirs, it changes nothing.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    204: { description: 'Deleted, or there was none.' },
    403: viewersKeepNone,
    404: notFoundResponse,
    ...errorResponses,
  },
});

export function registerNoteRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  const { authorizeOn } = recipeGuards(deps.db);

  v1.openapi(getNote, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.interact', id);
    return c.json({ note: findNote(deps.db, c.var.user.id, id) }, 200);
  });

  v1.openapi(putNote, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.interact', id);
    return c.json({ note: saveNote(deps.db, c.var.user.id, id, c.req.valid('json').body) }, 200);
  });

  v1.openapi(deleteNoteRoute, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.interact', id);
    deleteNote(deps.db, c.var.user.id, id);
    return c.body(null, 204);
  });
}
