import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createdPublicLinkSchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  publicImageParamsSchema,
  publicRecipeResultSchema,
  publicTokenParamsSchema,
  recipeIdParamsSchema,
  recipePublicLinkSchema,
} from '@myli/shared';
import { auditOrigin } from '../audit/audit.ts';
import { notFound } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { BlobStore } from '../blobs/store.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { imageFile } from '../images/routes.ts';
import { errorResponses } from '../problems.ts';
import { recipeGuards } from '../recipes/http.ts';
import {
  createPublicLink,
  findPublicLink,
  findPublicPhoto,
  findPublicRecipe,
  revokePublicLink,
} from './public-links.ts';

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

const json = <T>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});

const WHO =
  'The recipe’s owner, or an admin, while it’s shared: only a shared recipe has a public link, ' +
  'and making it private takes the link away.';
const notFoundResponse = problem('No recipe has this ID, or the caller may not see it.');
const mayNotShare = problem(
  'The caller may see the recipe but not share it: it’s private, or someone else’s, or the ' +
    'caller is a viewer.',
);
const noLink = problem(
  'No public link has this token now: it never did, it was revoked, or its recipe was made ' +
    'private or is in the trash.',
);

const getPublicLink = createRoute({
  method: 'get',
  path: '/recipes/{id}/public-link',
  tags: ['Public links'],
  summary: 'Get a recipe’s public link',
  description: WHO,
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: json('Its public link, if it has one.', recipePublicLinkSchema),
    403: mayNotShare,
    404: notFoundResponse,
    ...errorResponses,
  },
});

const putPublicLink = createRoute({
  method: 'put',
  path: '/recipes/{id}/public-link',
  tags: ['Public links'],
  summary: 'Give a recipe a public link',
  description:
    `${WHO} Anyone with the link can see the recipe as it’s published, without signing in. One ` +
    'it already has stays as it is. It doesn’t change the recipe, so it takes no `If-Match`.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: json('Its public link.', createdPublicLinkSchema),
    403: mayNotShare,
    404: notFoundResponse,
    ...errorResponses,
  },
});

const deletePublicLink = createRoute({
  method: 'delete',
  path: '/recipes/{id}/public-link',
  tags: ['Public links'],
  summary: 'Revoke a recipe’s public link',
  description: `${WHO} Anyone who has it can no longer open it. With no link, it changes nothing.`,
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    204: { description: 'It has no public link now.' },
    403: mayNotShare,
    404: notFoundResponse,
    ...errorResponses,
  },
});

const getPublicRecipe = createRoute({
  method: 'get',
  path: '/public/recipes/{token}',
  tags: ['Public links'],
  summary: 'Get the recipe a public link shows',
  description:
    'Anyone, signed in or not. The recipe as it’s published: what it says, not who wrote it, its ' +
    'ratings, comments or history. Never cached, so revoking the link takes effect at once.',
  request: { params: publicTokenParamsSchema },
  responses: {
    200: json('The recipe.', publicRecipeResultSchema),
    404: noLink,
    ...errorResponses,
  },
});

const getPublicImage = createRoute({
  method: 'get',
  path: '/public/recipes/{token}/images/{id}/{width}',
  tags: ['Public links'],
  summary: 'Get a photo of the recipe a public link shows',
  description:
    'Anyone, signed in or not, for a photo the recipe uses as published: one of its own or a ' +
    'step’s. Not one only its older revisions or its draft use. `width` is one of the widths in ' +
    'its `variants`.',
  request: { params: publicImageParamsSchema },
  responses: {
    200: {
      description: 'The photo at that size, as WebP.',
      content: { 'image/webp': { schema: z.string().openapi({ format: 'binary' }) } },
    },
    404: problem(`${noLink.description} Or the recipe doesn’t use a photo with this ID and size.`),
    ...errorResponses,
  },
});

export function registerPublicLinkRoutes(
  v1: OpenAPIHono<AppEnv>,
  deps: { db: Db; blobs: BlobStore },
) {
  const { db } = deps;
  const { authorizeOn } = recipeGuards(db);

  v1.openapi(getPublicLink, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.share', id);
    return c.json({ publicLink: findPublicLink(db, id) }, 200);
  });

  v1.openapi(putPublicLink, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.share', id);
    return c.json({ publicLink: createPublicLink(db, auditOrigin(c), id) }, 200);
  });

  v1.openapi(deletePublicLink, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.share', id);
    revokePublicLink(db, auditOrigin(c), id);
    return c.body(null, 204);
  });

  v1.openapi(getPublicRecipe, (c) => {
    const found = findPublicRecipe(db, c.req.valid('param').token);
    if (!found) throw notFound('Public link');
    return c.json({ recipe: found }, 200, { 'Cache-Control': 'no-store' });
  });

  v1.openapi(getPublicImage, async (c) => {
    const { token, id, width } = c.req.valid('param');
    const photo = findPublicPhoto(db, token, id);
    if (!photo) throw notFound('Image');
    return imageFile(c, deps.blobs, { id, variants: photo.variants }, width);
  });
}
