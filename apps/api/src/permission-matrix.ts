/**
 * The permission matrix (CLAUDE.md, Authorization): every endpoint of the versioned API, who may
 * call it, and a valid request to it. `permission-matrix.test.ts` sends each request as every kind
 * of caller and checks the status against the policy, and fails if an endpoint in the OpenAPI
 * document is missing here.
 */
import { randomUUID } from 'node:crypto';
import {
  API_BASE_PATH,
  type CommentAction,
  can,
  type RecipeAction,
  ROLES,
  type Role,
  type RoleAction,
  type Visibility,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import { issueUserToken } from './account/user-tokens.ts';
import { createUserWithPassword } from './auth/users.ts';
import {
  comment as commentTable,
  image as imageTable,
  recipe as recipeTable,
  type UserTokenPurpose,
} from './db/schema.ts';
import { insertRecipeImage, testImage, uploadImage } from './images/testing.ts';
import { createInvitation } from './invitations/invitations.ts';
import { createPublicLink } from './public-links/public-links.ts';
import {
  ifMatch,
  insertRecipe,
  sampleRecipeContent,
  sampleRecipeRequest,
} from './recipes/testing.ts';
import { findOrCreateTag } from './tags/tags.ts';
import { signedInAs, type TestApp } from './testing.ts';

export const CALLERS = ['anonymous', ...ROLES] as const;
export type Caller = 'anonymous' | Role;

/**
 * Who may call an endpoint: anyone, any signed-in user, users whose role allows an action, or, for
 * an endpoint on one recipe or comment, users the policy lets do an action to it. An endpoint on a
 * recipe in the trash is tried against one that was deleted, which is hidden from everyone the
 * policy doesn't let do the action: they get 404, never 403.
 */
export type Access =
  | 'public'
  | 'signed-in'
  | RoleAction
  | { recipe: RecipeAction }
  | { trashedRecipe: RecipeAction }
  | { comment: CommentAction };

/**
 * The recipes an endpoint on one recipe is tried against, as in `policy.test.ts`: whose it is,
 * relative to the caller, and who may see it. A viewer's own recipes were written before they were
 * demoted from editor. Anonymous callers own nothing, so they're tried against the others only.
 */
export const RECIPE_CASES = [
  { owner: 'caller', visibility: 'private' },
  { owner: 'caller', visibility: 'shared' },
  { owner: 'someone else', visibility: 'private' },
  { owner: 'someone else', visibility: 'shared' },
] as const satisfies readonly { owner: 'caller' | 'someone else'; visibility: Visibility }[];

export type RecipeCase = (typeof RECIPE_CASES)[number];

/**
 * Whose comment an endpoint on one comment is tried against, on each of `RECIPE_CASES`. Someone's
 * comment on a recipe they can't see now was written while it was shared, and a viewer's while
 * they were an editor. Anonymous callers wrote none.
 */
export const COMMENT_AUTHORS = ['caller', 'someone else'] as const;

export type CommentAuthor = (typeof COMMENT_AUTHORS)[number];

export interface EndpointCase {
  /** Lower case, as in the OpenAPI document. */
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** The OpenAPI path, relative to `API_BASE_PATH`, e.g. `/invitations/{id}`. */
  path: string;
  access: Access;
  /**
   * Sends a valid request to the endpoint, with `cookie` as the `Cookie` header when it's set.
   * Each caller gets a fresh app, so this can create whatever the request needs first. Endpoints
   * on one recipe get the ID of the recipe to send it about, and those on one comment the ID of
   * that comment, on that recipe.
   */
  send: (
    t: TestApp,
    cookie: string | undefined,
    recipeId: string,
    commentId: string,
  ) => Response | Promise<Response>;
}

/**
 * A request to `API_BASE_PATH` + `path`, as the given caller, with a JSON body if there is one.
 * Requests that change data say they're JSON even without a body, as the API requires.
 */
function request(
  t: TestApp,
  method: string,
  path: string,
  cookie: string | undefined,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return t.app.request(`${API_BASE_PATH}${path}`, {
    method,
    headers: {
      ...(cookie !== undefined && { cookie }),
      ...(method !== 'GET' && { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

/**
 * A collection of the caller's, made through the API, for an endpoint on one: its ID. Callers who
 * may keep none get an ID no collection has, which their refusal comes before.
 */
async function ownCollection(t: TestApp, cookie: string | undefined): Promise<string> {
  const res = await request(t, 'POST', '/collections', cookie, { name: 'Weeknight' });
  return res.status === 201 ? ((await res.json()) as { id: string }).id : randomUUID();
}

/** A photo the caller uploaded through the API, for their profile: its ID. Anyone else, one none has. */
async function ownUpload(t: TestApp, cookie: string | undefined): Promise<string> {
  return cookie === undefined ? randomUUID() : (await uploadImage(t, cookie)).id;
}

/** A new, open invitation, made by a new admin directly in the database: its ID and token. */
async function openInvitation(t: TestApp): Promise<{ id: string; token: string }> {
  const admin = await createUserWithPassword(t.auth, {
    name: 'Inviting Admin',
    email: `inviter-${randomUUID()}@example.com`,
    password: 'An inviting admin password 1',
    role: 'admin',
  });
  const result = createInvitation(
    { db: t.db, auth: t.auth, publicUrl: t.publicUrl, ttlDays: 7, emailEnabled: false },
    { email: `invitee-${randomUUID()}@example.com`, role: 'viewer', invitedBy: admin.id },
    { actorId: admin.id, ip: null, userAgent: null },
  );
  if (!result.ok) throw new Error(`could not create an invitation: ${result.reason}`);
  if (result.link === undefined) throw new Error('expected a link: email is off here');
  return { id: result.invitation.id, token: new URL(result.link).hash.slice(1) };
}

/** A working link's token, of this kind, for a new user made directly in the database. */
async function linkToken(t: TestApp, purpose: UserTokenPurpose): Promise<string> {
  const email = `linked-${randomUUID()}@example.com`;
  const created = await createUserWithPassword(t.auth, {
    name: 'Linked User',
    email,
    password: 'A linked user password 1',
    role: 'viewer',
  });
  return issueUserToken(t.db, { userId: created.id, email, purpose, at: new Date() }).token;
}

/** A cuisine tag's ID, created if there isn't one with this name. */
function someTagId(t: TestApp, name: string): string {
  return String(findOrCreateTag(t.db, 'cuisine', name).tag.id);
}

/** The ID of a new viewer, made directly in the database, for user-management requests. */
async function someUserId(t: TestApp): Promise<string> {
  const created = await createUserWithPassword(t.auth, {
    name: 'Managed User',
    email: `managed-${randomUUID()}@example.com`,
    password: 'A managed user password 1',
    role: 'viewer',
  });
  return created.id;
}

/**
 * Someone else's shared recipe with a public link and a cover photo, made directly in the
 * database: the link's token and the photo's ID.
 */
async function linkedRecipe(t: TestApp): Promise<{ token: string; imageId: string }> {
  const owner = await createUserWithPassword(t.auth, {
    name: 'Sharing Editor',
    email: `sharer-${randomUUID()}@example.com`,
    password: 'A sharing editor password 1',
    role: 'editor',
  });
  const recipeId = insertRecipe(t.db, owner.id);
  const imageId = await insertRecipeImage(t, recipeId);
  t.db.update(imageTable).set({ position: 0 }).where(eq(imageTable.id, imageId)).run();
  t.db.update(recipeTable).set({ coverImageId: imageId }).where(eq(recipeTable.id, recipeId)).run();
  const origin = { actorId: owner.id, ip: null, userAgent: null };
  return { token: createPublicLink(t.db, origin, recipeId).token, imageId };
}

/** Every endpoint of the versioned API. Add an entry with each new endpoint. */
export const ENDPOINTS: readonly EndpointCase[] = [
  {
    method: 'get',
    path: '/setup',
    access: 'public',
    send: (t, cookie) => request(t, 'GET', '/setup', cookie),
  },
  {
    // Signed-in callers mean users exist, so they get 409, which still counts as getting through.
    method: 'post',
    path: '/setup',
    access: 'public',
    send: (t, cookie) =>
      request(t, 'POST', '/setup', cookie, {
        name: 'First Admin',
        email: 'first-admin@example.com',
        password: 'A first-admin password 1',
      }),
  },
  {
    method: 'get',
    path: '/invitations',
    access: 'user.invite',
    send: (t, cookie) => request(t, 'GET', '/invitations', cookie),
  },
  {
    method: 'post',
    path: '/invitations',
    access: 'user.invite',
    send: (t, cookie) =>
      request(t, 'POST', '/invitations', cookie, { email: 'invitee@example.com', role: 'viewer' }),
  },
  {
    method: 'post',
    path: '/invitations/lookup',
    access: 'public',
    send: async (t, cookie) =>
      request(t, 'POST', '/invitations/lookup', cookie, {
        token: (await openInvitation(t)).token,
      }),
  },
  {
    // Signed-in users may accept too: it creates a separate account and leaves their session alone.
    method: 'post',
    path: '/invitations/accept',
    access: 'public',
    send: async (t, cookie) =>
      request(t, 'POST', '/invitations/accept', cookie, {
        token: (await openInvitation(t)).token,
        name: 'Invitee',
        password: 'An invitee password 1',
      }),
  },
  {
    method: 'get',
    path: '/audit-events',
    access: 'auditLog.read',
    send: (t, cookie) => request(t, 'GET', '/audit-events', cookie),
  },
  {
    method: 'get',
    path: '/search/recipes',
    access: 'signed-in',
    send: (t, cookie) => request(t, 'GET', '/search/recipes?q=bread&cuisine=Thai', cookie),
  },
  {
    method: 'get',
    path: '/search/ingredients',
    access: 'signed-in',
    send: (t, cookie) => request(t, 'GET', '/search/ingredients?q=bas', cookie),
  },
  {
    method: 'get',
    path: '/search/index',
    access: 'search.reindex',
    send: (t, cookie) => request(t, 'GET', '/search/index', cookie),
  },
  {
    method: 'post',
    path: '/search/index/rebuild',
    access: 'search.reindex',
    send: (t, cookie) => request(t, 'POST', '/search/index/rebuild', cookie),
  },
  {
    method: 'get',
    path: '/users',
    access: 'user.manage',
    send: (t, cookie) => request(t, 'GET', '/users', cookie),
  },
  {
    method: 'put',
    path: '/users/{id}/role',
    access: 'user.manage',
    send: async (t, cookie) =>
      request(t, 'PUT', `/users/${await someUserId(t)}/role`, cookie, { role: 'editor' }),
  },
  {
    method: 'post',
    path: '/users/{id}/deactivate',
    access: 'user.manage',
    send: async (t, cookie) =>
      request(t, 'POST', `/users/${await someUserId(t)}/deactivate`, cookie),
  },
  {
    method: 'post',
    path: '/users/{id}/reactivate',
    access: 'user.manage',
    send: async (t, cookie) =>
      request(t, 'POST', `/users/${await someUserId(t)}/reactivate`, cookie),
  },
  {
    method: 'post',
    path: '/invitations/{id}/resend',
    access: 'user.invite',
    send: async (t, cookie) =>
      request(t, 'POST', `/invitations/${(await openInvitation(t)).id}/resend`, cookie),
  },
  {
    method: 'post',
    path: '/invitations/{id}/revoke',
    access: 'user.invite',
    send: async (t, cookie) =>
      request(t, 'POST', `/invitations/${(await openInvitation(t)).id}/revoke`, cookie),
  },
  {
    method: 'get',
    path: '/recipes',
    access: 'signed-in',
    send: (t, cookie) => request(t, 'GET', '/recipes?page=1', cookie),
  },
  {
    method: 'post',
    path: '/recipes',
    access: 'recipe.create',
    send: (t, cookie) => request(t, 'POST', '/recipes', cookie, sampleRecipeRequest()),
  },
  {
    method: 'get',
    path: '/export',
    access: 'instance.export',
    send: (t, cookie) => request(t, 'GET', '/export', cookie),
  },
  {
    method: 'get',
    path: '/recipes/{id}/export',
    access: { recipe: 'recipe.read' },
    send: (t, cookie, id) => request(t, 'GET', `/recipes/${id}/export?format=jsonld`, cookie),
  },
  {
    method: 'post',
    path: '/recipes/import',
    access: 'recipe.create',
    // The test app fetches nothing, so whoever may import gets the address field's 422.
    send: (t, cookie) =>
      request(t, 'POST', '/recipes/import', cookie, { url: 'https://recipes.example.com/bread' }),
  },
  {
    method: 'post',
    path: '/images',
    access: 'image.upload',
    send: async (t, cookie) =>
      t.app.request(`${API_BASE_PATH}/images`, {
        method: 'POST',
        headers: { ...(cookie !== undefined && { cookie }), 'content-type': 'image/jpeg' },
        body: await testImage(64, 48),
      }),
  },
  {
    method: 'get',
    path: '/images/{id}/{width}',
    access: { recipe: 'recipe.read' },
    send: async (t, cookie, recipeId) =>
      request(t, 'GET', `/images/${await insertRecipeImage(t, recipeId)}/64`, cookie),
  },
  {
    method: 'get',
    path: '/recipes/{id}',
    access: { recipe: 'recipe.read' },
    send: (t, cookie, recipeId) => request(t, 'GET', `/recipes/${recipeId}`, cookie),
  },
  {
    method: 'put',
    path: '/recipes/{id}',
    access: { recipe: 'recipe.edit' },
    send: (t, cookie, recipeId) =>
      request(
        t,
        'PUT',
        `/recipes/${recipeId}`,
        cookie,
        sampleRecipeContent(),
        ifMatch(t.db, recipeId),
      ),
  },
  {
    method: 'put',
    path: '/recipes/{id}/visibility',
    access: { recipe: 'recipe.setVisibility' },
    send: (t, cookie, recipeId) =>
      request(
        t,
        'PUT',
        `/recipes/${recipeId}/visibility`,
        cookie,
        { visibility: 'shared' },
        ifMatch(t.db, recipeId),
      ),
  },
  {
    method: 'delete',
    path: '/recipes/{id}',
    access: { recipe: 'recipe.trash' },
    send: (t, cookie, recipeId) =>
      request(t, 'DELETE', `/recipes/${recipeId}`, cookie, undefined, ifMatch(t.db, recipeId)),
  },
  {
    method: 'get',
    path: '/recipes/{id}/draft',
    access: { recipe: 'recipe.edit' },
    send: (t, cookie, recipeId) => request(t, 'GET', `/recipes/${recipeId}/draft`, cookie),
  },
  {
    method: 'put',
    path: '/recipes/{id}/draft',
    access: { recipe: 'recipe.edit' },
    send: (t, cookie, recipeId) =>
      request(
        t,
        'PUT',
        `/recipes/${recipeId}/draft`,
        cookie,
        sampleRecipeContent(),
        ifMatch(t.db, recipeId),
      ),
  },
  {
    method: 'delete',
    path: '/recipes/{id}/draft',
    access: { recipe: 'recipe.edit' },
    send: (t, cookie, recipeId) =>
      request(
        t,
        'DELETE',
        `/recipes/${recipeId}/draft`,
        cookie,
        undefined,
        ifMatch(t.db, recipeId),
      ),
  },
  {
    method: 'get',
    path: '/recipes/{id}/revisions',
    access: { recipe: 'recipe.read' },
    send: (t, cookie, recipeId) => request(t, 'GET', `/recipes/${recipeId}/revisions`, cookie),
  },
  {
    method: 'get',
    path: '/recipes/{id}/revisions/{number}',
    access: { recipe: 'recipe.read' },
    send: (t, cookie, recipeId) => request(t, 'GET', `/recipes/${recipeId}/revisions/1`, cookie),
  },
  {
    method: 'post',
    path: '/recipes/{id}/revisions/{number}/restore',
    access: { recipe: 'recipe.edit' },
    send: (t, cookie, recipeId) =>
      request(
        t,
        'POST',
        `/recipes/${recipeId}/revisions/1/restore`,
        cookie,
        undefined,
        ifMatch(t.db, recipeId),
      ),
  },
  {
    method: 'get',
    path: '/trash',
    access: 'trash.read',
    send: (t, cookie) => request(t, 'GET', '/trash', cookie),
  },
  {
    method: 'post',
    path: '/trash/{id}/restore',
    access: { trashedRecipe: 'recipe.trash' },
    send: (t, cookie, recipeId) =>
      request(t, 'POST', `/trash/${recipeId}/restore`, cookie, undefined, ifMatch(t.db, recipeId)),
  },
  {
    method: 'get',
    path: '/recipes/{id}/favorite',
    access: { recipe: 'recipe.interact' },
    send: (t, cookie, recipeId) => request(t, 'GET', `/recipes/${recipeId}/favorite`, cookie),
  },
  {
    method: 'put',
    path: '/recipes/{id}/favorite',
    access: { recipe: 'recipe.interact' },
    send: (t, cookie, recipeId) =>
      request(t, 'PUT', `/recipes/${recipeId}/favorite`, cookie, { favorite: true }),
  },
  {
    method: 'get',
    path: '/recipes/{id}/rating',
    access: { recipe: 'recipe.read' },
    send: (t, cookie, recipeId) => request(t, 'GET', `/recipes/${recipeId}/rating`, cookie),
  },
  {
    method: 'put',
    path: '/recipes/{id}/rating',
    access: { recipe: 'recipe.interact' },
    send: (t, cookie, recipeId) =>
      request(t, 'PUT', `/recipes/${recipeId}/rating`, cookie, { stars: 4 }),
  },
  {
    method: 'delete',
    path: '/recipes/{id}/rating',
    access: { recipe: 'recipe.interact' },
    send: (t, cookie, recipeId) => request(t, 'DELETE', `/recipes/${recipeId}/rating`, cookie),
  },
  {
    method: 'get',
    path: '/recipes/{id}/note',
    access: { recipe: 'recipe.interact' },
    send: (t, cookie, recipeId) => request(t, 'GET', `/recipes/${recipeId}/note`, cookie),
  },
  {
    method: 'put',
    path: '/recipes/{id}/note',
    access: { recipe: 'recipe.interact' },
    send: (t, cookie, recipeId) =>
      request(t, 'PUT', `/recipes/${recipeId}/note`, cookie, { body: 'Less salt.' }),
  },
  {
    method: 'delete',
    path: '/recipes/{id}/note',
    access: { recipe: 'recipe.interact' },
    send: (t, cookie, recipeId) => request(t, 'DELETE', `/recipes/${recipeId}/note`, cookie),
  },
  {
    method: 'get',
    path: '/recipes/{id}/comments',
    access: { recipe: 'recipe.read' },
    send: (t, cookie, recipeId) => request(t, 'GET', `/recipes/${recipeId}/comments`, cookie),
  },
  {
    method: 'post',
    path: '/recipes/{id}/comments',
    access: { recipe: 'recipe.interact' },
    send: (t, cookie, recipeId) =>
      request(t, 'POST', `/recipes/${recipeId}/comments`, cookie, { body: 'Lovely.' }),
  },
  {
    method: 'put',
    path: '/comments/{id}',
    access: { comment: 'comment.edit' },
    send: (t, cookie, _recipeId, commentId) =>
      request(t, 'PUT', `/comments/${commentId}`, cookie, { body: 'Lovelier.' }),
  },
  {
    method: 'delete',
    path: '/comments/{id}',
    access: { comment: 'comment.delete' },
    send: (t, cookie, _recipeId, commentId) =>
      request(t, 'DELETE', `/comments/${commentId}`, cookie),
  },
  {
    method: 'get',
    path: '/collections',
    access: 'personal.write',
    send: (t, cookie) => request(t, 'GET', '/collections', cookie),
  },
  {
    method: 'post',
    path: '/collections',
    access: 'personal.write',
    send: (t, cookie) => request(t, 'POST', '/collections', cookie, { name: 'Weeknight' }),
  },
  {
    method: 'get',
    path: '/collections/{id}',
    access: 'personal.write',
    send: async (t, cookie) =>
      request(t, 'GET', `/collections/${await ownCollection(t, cookie)}`, cookie),
  },
  {
    method: 'get',
    path: '/collections/{id}/ingredients',
    access: 'personal.write',
    send: async (t, cookie) =>
      request(t, 'GET', `/collections/${await ownCollection(t, cookie)}/ingredients`, cookie),
  },
  {
    method: 'put',
    path: '/collections/{id}',
    access: 'personal.write',
    send: async (t, cookie) =>
      request(t, 'PUT', `/collections/${await ownCollection(t, cookie)}`, cookie, {
        name: 'Weekend',
      }),
  },
  {
    method: 'delete',
    path: '/collections/{id}',
    access: 'personal.write',
    send: async (t, cookie) =>
      request(t, 'DELETE', `/collections/${await ownCollection(t, cookie)}`, cookie),
  },
  {
    method: 'put',
    path: '/collections/{id}/recipes/{recipeId}',
    access: { recipe: 'recipe.interact' },
    send: async (t, cookie, recipeId) =>
      request(
        t,
        'PUT',
        `/collections/${await ownCollection(t, cookie)}/recipes/${recipeId}`,
        cookie,
      ),
  },
  {
    method: 'delete',
    path: '/collections/{id}/recipes/{recipeId}',
    access: { recipe: 'recipe.interact' },
    send: async (t, cookie, recipeId) =>
      request(
        t,
        'DELETE',
        `/collections/${await ownCollection(t, cookie)}/recipes/${recipeId}`,
        cookie,
      ),
  },
  {
    method: 'post',
    path: '/collections/{id}/recipes/{recipeId}/move',
    access: { recipe: 'recipe.interact' },
    send: async (t, cookie, recipeId) => {
      const id = await ownCollection(t, cookie);
      await request(t, 'PUT', `/collections/${id}/recipes/${recipeId}`, cookie);
      return request(t, 'POST', `/collections/${id}/recipes/${recipeId}/move`, cookie, {
        direction: 'later',
      });
    },
  },
  {
    method: 'get',
    path: '/recipes/{id}/public-link',
    access: { recipe: 'recipe.share' },
    send: (t, cookie, recipeId) => request(t, 'GET', `/recipes/${recipeId}/public-link`, cookie),
  },
  {
    method: 'put',
    path: '/recipes/{id}/public-link',
    access: { recipe: 'recipe.share' },
    send: (t, cookie, recipeId) => request(t, 'PUT', `/recipes/${recipeId}/public-link`, cookie),
  },
  {
    method: 'delete',
    path: '/recipes/{id}/public-link',
    access: { recipe: 'recipe.share' },
    send: (t, cookie, recipeId) => request(t, 'DELETE', `/recipes/${recipeId}/public-link`, cookie),
  },
  {
    method: 'get',
    path: '/public/recipes/{token}',
    access: 'public',
    send: async (t, cookie) =>
      request(t, 'GET', `/public/recipes/${(await linkedRecipe(t)).token}`, cookie),
  },
  {
    method: 'get',
    path: '/public/recipes/{token}/images/{id}/{width}',
    access: 'public',
    send: async (t, cookie) => {
      const { token, imageId } = await linkedRecipe(t);
      return request(t, 'GET', `/public/recipes/${token}/images/${imageId}/64`, cookie);
    },
  },
  {
    method: 'delete',
    path: '/collections/{id}/recipes',
    access: 'personal.write',
    send: async (t, cookie) =>
      request(t, 'DELETE', `/collections/${await ownCollection(t, cookie)}/recipes`, cookie),
  },
  {
    method: 'get',
    path: '/recipes/{id}/collections',
    access: { recipe: 'recipe.interact' },
    send: (t, cookie, recipeId) => request(t, 'GET', `/recipes/${recipeId}/collections`, cookie),
  },
  {
    method: 'get',
    path: '/me/favorites',
    access: 'personal.write',
    send: (t, cookie) => request(t, 'GET', '/me/favorites?page=1', cookie),
  },
  {
    method: 'get',
    path: '/tags',
    access: 'signed-in',
    send: (t, cookie) => request(t, 'GET', '/tags', cookie),
  },
  {
    method: 'post',
    path: '/tags',
    access: 'tag.create',
    send: (t, cookie) => request(t, 'POST', '/tags', cookie, { type: 'cuisine', name: 'Italian' }),
  },
  {
    method: 'get',
    path: '/tags/usage',
    access: 'tag.manage',
    send: (t, cookie) => request(t, 'GET', '/tags/usage', cookie),
  },
  {
    method: 'put',
    path: '/tags/{id}',
    access: 'tag.manage',
    send: (t, cookie) =>
      request(t, 'PUT', `/tags/${someTagId(t, 'Italien')}`, cookie, { name: 'Italian' }),
  },
  {
    method: 'post',
    path: '/tags/{id}/merge',
    access: 'tag.manage',
    send: (t, cookie) =>
      request(t, 'POST', `/tags/${someTagId(t, 'Italien')}/merge`, cookie, {
        intoId: someTagId(t, 'Italian'),
      }),
  },
  {
    method: 'delete',
    path: '/tags/{id}',
    access: 'tag.manage',
    send: (t, cookie) => request(t, 'DELETE', `/tags/${someTagId(t, 'Italien')}`, cookie),
  },
  {
    method: 'get',
    path: '/me/preferences',
    access: 'signed-in',
    send: (t, cookie) => request(t, 'GET', '/me/preferences', cookie),
  },
  {
    method: 'put',
    path: '/me/preferences',
    access: 'signed-in',
    send: (t, cookie) => request(t, 'PUT', '/me/preferences', cookie, { unitSystem: 'metric' }),
  },
  {
    method: 'get',
    path: '/me/email-verification',
    access: 'signed-in',
    send: (t, cookie) => request(t, 'GET', '/me/email-verification', cookie),
  },
  {
    // Email is off in the test app, so signed-in callers get 409, which still counts as getting
    // through.
    method: 'post',
    path: '/me/email-verification',
    access: 'signed-in',
    send: (t, cookie) => request(t, 'POST', '/me/email-verification', cookie),
  },
  {
    // The link proves the address, whoever opens it, signed in or not.
    method: 'post',
    path: '/email-verification/confirm',
    access: 'public',
    send: async (t, cookie) =>
      request(t, 'POST', '/email-verification/confirm', cookie, {
        token: await linkToken(t, 'verify_email'),
      }),
  },
  {
    method: 'get',
    path: '/me/avatar',
    access: 'signed-in',
    send: (t, cookie) => request(t, 'GET', '/me/avatar', cookie),
  },
  {
    // Viewers included: a profile photo is their own account (spec §2).
    method: 'put',
    path: '/me/avatar',
    access: 'signed-in',
    send: async (t, cookie) =>
      request(t, 'PUT', '/me/avatar', cookie, { imageId: await ownUpload(t, cookie) }),
  },
  {
    method: 'delete',
    path: '/me/avatar',
    access: 'signed-in',
    send: (t, cookie) => request(t, 'DELETE', '/me/avatar', cookie),
  },
  {
    // Someone who forgot their password isn't signed in.
    method: 'get',
    path: '/password-reset',
    access: 'public',
    send: (t, cookie) => request(t, 'GET', '/password-reset', cookie),
  },
  {
    // Email is off in the test app, so every caller gets 409, which still counts as getting
    // through.
    method: 'post',
    path: '/password-reset',
    access: 'public',
    send: (t, cookie) =>
      request(t, 'POST', '/password-reset', cookie, { email: 'anyone@example.com' }),
  },
  {
    // The link stands in for the password, whoever opens it, signed in or not.
    method: 'post',
    path: '/password-reset/confirm',
    access: 'public',
    send: async (t, cookie) =>
      request(t, 'POST', '/password-reset/confirm', cookie, {
        token: await linkToken(t, 'reset_password'),
        newPassword: 'A new linked password 2',
      }),
  },
];

export type Outcome = 'allowed' | 401 | 403 | 404;

/**
 * What the policy says should happen: the request goes through, or exactly this status. For an
 * endpoint on one recipe or comment, a recipe the caller may not see answers 404, before any other
 * check.
 */
export function expectedOutcome(
  access: Access,
  caller: Caller,
  recipeCase?: RecipeCase,
  commentAuthor?: CommentAuthor,
): Outcome {
  if (access === 'public') return 'allowed';
  if (caller === 'anonymous') return 401;
  if (access === 'signed-in') return 'allowed';
  const user = { id: 'caller', role: caller };
  if (typeof access === 'string') return can(user, access) ? 'allowed' : 403;
  if (!recipeCase) throw new Error('an endpoint on one recipe needs a recipe to be tried against');
  const recipe = {
    ownerId: recipeCase.owner === 'caller' ? user.id : 'someone else',
    visibility: recipeCase.visibility,
  };
  if ('trashedRecipe' in access) return can(user, access.trashedRecipe, recipe) ? 'allowed' : 404;
  if (!can(user, 'recipe.read', recipe)) return 404;
  if ('comment' in access) {
    if (!commentAuthor)
      throw new Error('an endpoint on one comment needs a comment to be tried against');
    const authorId = commentAuthor === 'caller' ? user.id : 'someone else';
    return can(user, access.comment, { authorId, recipe }) ? 'allowed' : 403;
  }
  return can(user, access.recipe, recipe) ? 'allowed' : 403;
}

interface Run {
  caller: Caller;
  recipeCase: RecipeCase | undefined;
  commentAuthor: CommentAuthor | undefined;
}

/**
 * The users, recipes and comments `endpoint` is tried with: one run per caller, or per caller and
 * recipe, or per caller, recipe and comment.
 */
function runsOf(endpoint: EndpointCase): Run[] {
  const { access } = endpoint;
  const mine = (caller: Caller, whose: 'caller' | 'someone else') =>
    caller !== 'anonymous' || whose !== 'caller';
  return CALLERS.flatMap((caller): Run[] => {
    if (typeof access !== 'object')
      return [{ caller, recipeCase: undefined, commentAuthor: undefined }];
    const recipeCases = RECIPE_CASES.filter(({ owner }) => mine(caller, owner));
    return recipeCases.flatMap((recipeCase): Run[] =>
      'comment' in access
        ? COMMENT_AUTHORS.filter((author) => mine(caller, author)).map((commentAuthor) => ({
            caller,
            recipeCase,
            commentAuthor,
          }))
        : [{ caller, recipeCase, commentAuthor: undefined }],
    );
  });
}

/** Someone other than the caller, to own the recipes that aren't theirs. */
async function someoneElse(t: TestApp): Promise<string> {
  const created = await createUserWithPassword(t.auth, {
    name: 'Someone Else',
    email: `someone-else-${randomUUID()}@example.com`,
    password: 'Someone else password 1',
    role: 'editor',
  });
  return created.id;
}

/**
 * Sends `endpoint`'s request as every caller (and, for an endpoint on one recipe, about each kind
 * of recipe), each on a fresh app from `createApp`, and describes each status that doesn't match
 * the policy. "Allowed" means anything but 401, 403 or a 5xx, and on a recipe, anything but 404
 * too: the matrix checks who gets through, not what the endpoint does then.
 */
export async function findMismatches(
  endpoint: EndpointCase,
  createApp: () => TestApp,
): Promise<string[]> {
  const mismatches: string[] = [];
  for (const { caller, recipeCase, commentAuthor } of runsOf(endpoint)) {
    const t = createApp();
    const signedIn = caller === 'anonymous' ? undefined : await signedInAs(t, caller);
    let recipeId = '';
    let commentId = '';
    if (recipeCase) {
      const other = await someoneElse(t);
      const ownerId = recipeCase.owner === 'caller' && signedIn ? signedIn.user.id : other;
      recipeId = insertRecipe(t.db, ownerId, recipeCase.visibility);
      if (commentAuthor) {
        const authorId = commentAuthor === 'caller' && signedIn ? signedIn.user.id : other;
        commentId = t.db
          .insert(commentTable)
          .values({ recipeId, authorId, bodyMd: 'Lovely.' })
          .returning({ id: commentTable.id })
          .get().id;
      }
      if (typeof endpoint.access === 'object' && 'trashedRecipe' in endpoint.access) {
        t.db
          .update(recipeTable)
          .set({ deletedAt: new Date() })
          .where(eq(recipeTable.id, recipeId))
          .run();
      }
    }
    const { status } = await endpoint.send(t, signedIn?.cookie, recipeId, commentId);
    const expected = expectedOutcome(endpoint.access, caller, recipeCase, commentAuthor);
    const refusals = recipeCase ? [401, 403, 404] : [401, 403];
    const matches =
      expected === 'allowed' ? !refusals.includes(status) && status < 500 : status === expected;
    if (!matches) {
      const whose = (owner: 'caller' | 'someone else') =>
        owner === 'caller' ? 'their own' : "someone else's";
      const about =
        (commentAuthor ? ` on ${whose(commentAuthor)} comment` : '') +
        (recipeCase ? ` on ${whose(recipeCase.owner)} ${recipeCase.visibility} recipe` : '');
      mismatches.push(
        `${caller} ${endpoint.method.toUpperCase()} ${endpoint.path}${about}: expected ${String(expected)}, got ${String(status)}`,
      );
    }
  }
  return mismatches;
}
