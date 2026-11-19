/**
 * The permission matrix (CLAUDE.md, Authorization): every endpoint of the versioned API, who may
 * call it, and a valid request to it. `permission-matrix.test.ts` sends each request as every kind
 * of caller and checks the status against the policy, and fails if an endpoint in the OpenAPI
 * document is missing here.
 */
import { randomUUID } from 'node:crypto';
import {
  API_BASE_PATH,
  can,
  type RecipeAction,
  ROLES,
  type Role,
  type RoleAction,
  type Visibility,
} from '@myli/shared';
import { createUserWithPassword } from './auth/users.ts';
import { insertRecipeImage, testImage } from './images/testing.ts';
import { createInvitation } from './invitations/invitations.ts';
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
 * an endpoint on one recipe, users the policy lets do an action to that recipe.
 */
export type Access = 'public' | 'signed-in' | RoleAction | { recipe: RecipeAction };

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

export interface EndpointCase {
  /** Lower case, as in the OpenAPI document. */
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** The OpenAPI path, relative to `API_BASE_PATH`, e.g. `/invitations/{id}`. */
  path: string;
  access: Access;
  /**
   * Sends a valid request to the endpoint, with `cookie` as the `Cookie` header when it's set.
   * Each caller gets a fresh app, so this can create whatever the request needs first. Endpoints
   * on one recipe get the ID of the recipe to send it about.
   */
  send: (t: TestApp, cookie: string | undefined, recipeId: string) => Response | Promise<Response>;
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

/** The ID of a new viewer, made directly in the database, for user-management requests. */
/** A cuisine tag's ID, created if there isn't one with this name. */
function someTagId(t: TestApp, name: string): string {
  return String(findOrCreateTag(t.db, 'cuisine', name).tag.id);
}

async function someUserId(t: TestApp): Promise<string> {
  const created = await createUserWithPassword(t.auth, {
    name: 'Managed User',
    email: `managed-${randomUUID()}@example.com`,
    password: 'A managed user password 1',
    role: 'viewer',
  });
  return created.id;
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
];

export type Outcome = 'allowed' | 401 | 403 | 404;

/**
 * What the policy says should happen: the request goes through, or exactly this status. For an
 * endpoint on one recipe, a recipe the caller may not see answers 404, before any other check.
 */
export function expectedOutcome(access: Access, caller: Caller, recipeCase?: RecipeCase): Outcome {
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
  if (!can(user, 'recipe.read', recipe)) return 404;
  return can(user, access.recipe, recipe) ? 'allowed' : 403;
}

/** The users and recipes `endpoint` is tried with: one run per caller, or per caller and recipe. */
function runsOf(endpoint: EndpointCase): { caller: Caller; recipeCase: RecipeCase | undefined }[] {
  return CALLERS.flatMap((caller): { caller: Caller; recipeCase: RecipeCase | undefined }[] =>
    typeof endpoint.access === 'object'
      ? RECIPE_CASES.filter(({ owner }) => caller !== 'anonymous' || owner !== 'caller').map(
          (recipeCase) => ({ caller, recipeCase }),
        )
      : [{ caller, recipeCase: undefined }],
  );
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
  for (const { caller, recipeCase } of runsOf(endpoint)) {
    const t = createApp();
    const signedIn = caller === 'anonymous' ? undefined : await signedInAs(t, caller);
    let recipeId = '';
    if (recipeCase) {
      const ownerId =
        recipeCase.owner === 'caller' && signedIn ? signedIn.user.id : await someoneElse(t);
      recipeId = insertRecipe(t.db, ownerId, recipeCase.visibility);
    }
    const { status } = await endpoint.send(t, signedIn?.cookie, recipeId);
    const expected = expectedOutcome(endpoint.access, caller, recipeCase);
    const refusals = recipeCase ? [401, 403, 404] : [401, 403];
    const matches =
      expected === 'allowed' ? !refusals.includes(status) && status < 500 : status === expected;
    if (!matches) {
      const about = recipeCase
        ? ` on ${recipeCase.owner === 'caller' ? 'their own' : "someone else's"} ${recipeCase.visibility} recipe`
        : '';
      mismatches.push(
        `${caller} ${endpoint.method.toUpperCase()} ${endpoint.path}${about}: expected ${String(expected)}, got ${String(status)}`,
      );
    }
  }
  return mismatches;
}
