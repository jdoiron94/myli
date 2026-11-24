import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  commentIdParamsSchema,
  commentListSchema,
  commentRequestSchema,
  commentSchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  recipeIdParamsSchema,
} from '@myli/shared';
import { authorize, notFound } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses } from '../problems.ts';
import { recipeGuards } from '../recipes/http.ts';
import {
  addComment,
  deleteComment,
  editComment,
  findCommentAccess,
  recipeComments,
} from './comments.ts';

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

const commentResult = (description: string) => ({
  description,
  content: { 'application/json': { schema: commentSchema } },
});

const commentBody = {
  required: true,
  content: { 'application/json': { schema: commentRequestSchema } },
};

const recipeNotFound = problem('No recipe has this ID, or the caller may not see it.');
const commentNotFound = problem(
  'No comment has this ID, its recipe is in the trash, or the caller may not see its recipe.',
);

const listComments = createRoute({
  method: 'get',
  path: '/recipes/{id}/comments',
  tags: ['Comments'],
  summary: "List a recipe's comments",
  description: 'Anyone who can see the recipe.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: {
      description: 'Its comments.',
      content: { 'application/json': { schema: commentListSchema } },
    },
    404: recipeNotFound,
    ...errorResponses,
  },
});

const postComment = createRoute({
  method: 'post',
  path: '/recipes/{id}/comments',
  tags: ['Comments'],
  summary: 'Comment on a recipe',
  description: 'Editors and admins, on any recipe they can see.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema, body: commentBody },
  responses: {
    201: commentResult('The comment, as saved.'),
    403: problem('The caller may see the recipe but not comment on it: viewers are read-only.'),
    404: recipeNotFound,
    ...errorResponses,
  },
});

const putComment = createRoute({
  method: 'put',
  path: '/comments/{id}',
  tags: ['Comments'],
  summary: 'Change a comment',
  description:
    'Its author, while they may comment. It shows as edited, unless what it says is unchanged.',
  middleware: [requireSession] as const,
  request: { params: commentIdParamsSchema, body: commentBody },
  responses: {
    200: commentResult('The comment, as saved.'),
    403: problem('The caller may see the comment but not change it: it isn’t theirs.'),
    404: commentNotFound,
    ...errorResponses,
  },
});

const removeComment = createRoute({
  method: 'delete',
  path: '/comments/{id}',
  tags: ['Comments'],
  summary: 'Delete a comment',
  description: 'Its author, while they may comment, or an admin. It’s gone for good.',
  middleware: [requireSession] as const,
  request: { params: commentIdParamsSchema },
  responses: {
    204: { description: 'Deleted.' },
    403: problem('The caller may see the comment but not delete it.'),
    404: commentNotFound,
    ...errorResponses,
  },
});

export function registerCommentRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  const { authorizeOn } = recipeGuards(deps.db);

  /** Throws unless the caller may do `action` to the comment: 401, 404 if hidden or gone, 403. */
  function authorizeOnComment(
    c: Parameters<typeof authorize>[0],
    action: 'comment.edit' | 'comment.delete',
    id: string,
  ) {
    const access = findCommentAccess(deps.db, id);
    if (!access) throw notFound('Comment');
    authorize(c, action, access);
  }

  v1.openapi(listComments, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.read', id);
    return c.json({ comments: recipeComments(deps.db, id) }, 200);
  });

  v1.openapi(postComment, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.interact', id);
    return c.json(addComment(deps.db, id, c.var.user.id, c.req.valid('json').body), 201);
  });

  v1.openapi(putComment, (c) => {
    const { id } = c.req.valid('param');
    authorizeOnComment(c, 'comment.edit', id);
    return c.json(editComment(deps.db, id, c.req.valid('json').body), 200);
  });

  v1.openapi(removeComment, (c) => {
    const { id } = c.req.valid('param');
    authorizeOnComment(c, 'comment.delete', id);
    deleteComment(deps.db, id);
    return c.body(null, 204);
  });
}
