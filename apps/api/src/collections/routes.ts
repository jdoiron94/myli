import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  COLLECTION_MAX_RECIPES,
  collectionIdParamsSchema,
  collectionListSchema,
  collectionOrderSchema,
  collectionRecipeParamsSchema,
  collectionRequestSchema,
  collectionSchema,
  collectionSummarySchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  recipeCollectionsSchema,
  recipeIdParamsSchema,
} from '@myli/shared';
import { notFound, requirePermission } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses, HttpProblem } from '../problems.ts';
import { recipeGuards } from '../recipes/http.ts';
import {
  addToCollection,
  collectionsHolding,
  createCollection,
  deleteCollection,
  listCollections,
  loadCollection,
  ownsCollection,
  removeFromCollection,
  renameCollection,
  reorderCollection,
} from './collections.ts';

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

const json = <T>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});

const PERSONAL =
  'Editors and admins. Collections are personal: no one else ever sees them, admins included.';
const viewersKeepNone = problem('Viewers keep no collections: they are read-only.');
const noCollection = problem('The caller has no collection with this ID.');
const noRecipe = problem(
  'The caller has no collection with this ID, or no recipe has this ID that they may see.',
);
const viewersCantAdd = problem(
  'The caller may see the recipe but keeps no collections: viewers are read-only.',
);

const TOO_MANY = `A collection holds at most ${String(COLLECTION_MAX_RECIPES)} recipes.`;
const CHANGED =
  'The collection changed since it was loaded. Load it again, then put its recipes in order.';

const getCollections = createRoute({
  method: 'get',
  path: '/collections',
  tags: ['Collections'],
  summary: 'List your collections',
  description: `${PERSONAL} By name, each with how many of its recipes they may see now.`,
  middleware: [requirePermission('personal.write')] as const,
  responses: {
    200: json('Their collections.', collectionListSchema),
    ...errorResponses,
  },
});

const postCollection = createRoute({
  method: 'post',
  path: '/collections',
  tags: ['Collections'],
  summary: 'Create a collection',
  description: `${PERSONAL} Its name needn't differ from their others'.`,
  middleware: [requirePermission('personal.write')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: collectionRequestSchema } } },
  },
  responses: {
    201: json('Created, with no recipes yet.', collectionSummarySchema),
    ...errorResponses,
  },
});

const getCollection = createRoute({
  method: 'get',
  path: '/collections/{id}',
  tags: ['Collections'],
  summary: 'Get a collection and its recipes',
  description:
    `${PERSONAL} Its recipes in the order they put them, only those they may see now. One they ` +
    'may no longer see stays in it, and shows again if it comes back.',
  middleware: [requirePermission('personal.write')] as const,
  request: { params: collectionIdParamsSchema },
  responses: {
    200: json('The collection.', collectionSchema),
    404: noCollection,
    ...errorResponses,
  },
});

const putCollection = createRoute({
  method: 'put',
  path: '/collections/{id}',
  tags: ['Collections'],
  summary: 'Rename a collection',
  description: PERSONAL,
  middleware: [requirePermission('personal.write')] as const,
  request: {
    params: collectionIdParamsSchema,
    body: { required: true, content: { 'application/json': { schema: collectionRequestSchema } } },
  },
  responses: {
    204: { description: 'Renamed.' },
    404: noCollection,
    ...errorResponses,
  },
});

const deleteCollectionRoute = createRoute({
  method: 'delete',
  path: '/collections/{id}',
  tags: ['Collections'],
  summary: 'Delete a collection',
  description: `${PERSONAL} Its recipes stay as they are.`,
  middleware: [requirePermission('personal.write')] as const,
  request: { params: collectionIdParamsSchema },
  responses: {
    204: { description: 'Deleted.' },
    404: noCollection,
    ...errorResponses,
  },
});

const putOrder = createRoute({
  method: 'put',
  path: '/collections/{id}/order',
  tags: ['Collections'],
  summary: 'Put the recipes in a collection in order',
  description:
    `${PERSONAL} Given every recipe the collection shows them, each once. They take the places ` +
    'those recipes had, so one the caller may not see now keeps its own.',
  middleware: [requirePermission('personal.write')] as const,
  request: {
    params: collectionIdParamsSchema,
    body: { required: true, content: { 'application/json': { schema: collectionOrderSchema } } },
  },
  responses: {
    204: { description: 'In their new order.' },
    404: noCollection,
    409: problem('The recipes given aren’t exactly those the collection shows now.'),
    ...errorResponses,
  },
});

const putRecipe = createRoute({
  method: 'put',
  path: '/collections/{id}/recipes/{recipeId}',
  tags: ['Collections'],
  summary: 'Add a recipe to a collection',
  description:
    `${PERSONAL} Any recipe they can see, put at the end. One already in it keeps its place. ` +
    TOO_MANY,
  middleware: [requireSession] as const,
  request: { params: collectionRecipeParamsSchema },
  responses: {
    204: { description: 'In it.' },
    403: viewersCantAdd,
    404: noRecipe,
    409: problem(`The collection is full. ${TOO_MANY}`),
    ...errorResponses,
  },
});

const deleteRecipe = createRoute({
  method: 'delete',
  path: '/collections/{id}/recipes/{recipeId}',
  tags: ['Collections'],
  summary: 'Take a recipe out of a collection',
  description: `${PERSONAL} With the recipe not in it, it changes nothing.`,
  middleware: [requireSession] as const,
  request: { params: collectionRecipeParamsSchema },
  responses: {
    204: { description: 'Not in it.' },
    403: viewersCantAdd,
    404: noRecipe,
    ...errorResponses,
  },
});

const getRecipeCollections = createRoute({
  method: 'get',
  path: '/recipes/{id}/collections',
  tags: ['Collections'],
  summary: 'Get which of your collections hold a recipe',
  description: `${PERSONAL} For any recipe they can see.`,
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: json('The IDs of those collections, by their names.', recipeCollectionsSchema),
    403: viewersKeepNone,
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...errorResponses,
  },
});

export function registerCollectionRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  const { db } = deps;
  const { authorizeOn } = recipeGuards(db);

  v1.openapi(getCollections, (c) => c.json({ collections: listCollections(db, c.var.user) }, 200));

  v1.openapi(postCollection, (c) => {
    return c.json(createCollection(db, c.var.user.id, c.req.valid('json').name), 201);
  });

  v1.openapi(getCollection, (c) => {
    const found = loadCollection(db, c.var.user, c.req.valid('param').id);
    if (!found) throw notFound('Collection');
    return c.json(found, 200);
  });

  v1.openapi(putCollection, (c) => {
    const { id } = c.req.valid('param');
    if (!renameCollection(db, c.var.user.id, id, c.req.valid('json').name)) {
      throw notFound('Collection');
    }
    return c.body(null, 204);
  });

  v1.openapi(deleteCollectionRoute, (c) => {
    if (!deleteCollection(db, c.var.user.id, c.req.valid('param').id)) {
      throw notFound('Collection');
    }
    return c.body(null, 204);
  });

  v1.openapi(putOrder, (c) => {
    const { id } = c.req.valid('param');
    if (!ownsCollection(db, c.var.user.id, id)) throw notFound('Collection');
    const result = reorderCollection(db, c.var.user, id, c.req.valid('json').recipeIds);
    if (!result.ok) throw new HttpProblem(409, CHANGED);
    return c.body(null, 204);
  });

  // The recipe first, as on every endpoint on one recipe: hidden from the caller, it's a 404 before
  // anything else, and a viewer's refusal is a 403.
  v1.openapi(putRecipe, (c) => {
    const { id, recipeId } = c.req.valid('param');
    authorizeOn(c, 'recipe.interact', recipeId);
    if (!ownsCollection(db, c.var.user.id, id)) throw notFound('Collection');
    const result = addToCollection(db, id, recipeId);
    if (!result.ok) throw new HttpProblem(409, `The collection is full. ${TOO_MANY}`);
    return c.body(null, 204);
  });

  v1.openapi(deleteRecipe, (c) => {
    const { id, recipeId } = c.req.valid('param');
    authorizeOn(c, 'recipe.interact', recipeId);
    if (!ownsCollection(db, c.var.user.id, id)) throw notFound('Collection');
    removeFromCollection(db, id, recipeId);
    return c.body(null, 204);
  });

  v1.openapi(getRecipeCollections, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.interact', id);
    return c.json({ collectionIds: collectionsHolding(db, c.var.user.id, id) }, 200);
  });
}
