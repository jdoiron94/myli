/**
 * The permission matrix (CLAUDE.md, Authorization): every endpoint of the versioned API, who may
 * call it, and a valid request to it. `permission-matrix.test.ts` sends each request as every kind
 * of caller and checks the status against the policy, and fails if an endpoint in the OpenAPI
 * document is missing here.
 */
import { can, ROLES, type Role, type RoleAction } from '@myli/shared';
import { signedInAs, type TestApp } from './testing.ts';

export const CALLERS = ['anonymous', ...ROLES] as const;
export type Caller = 'anonymous' | Role;

/**
 * Who may call an endpoint: anyone, any signed-in user, or users whose role allows an action.
 * (Endpoints on one recipe or comment will add the ownership cases in Phase 1.)
 */
export type Access = 'public' | 'signed-in' | RoleAction;

export interface EndpointCase {
  /** Lower case, as in the OpenAPI document. */
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** The OpenAPI path, relative to `API_BASE_PATH`, e.g. `/invitations/{id}`. */
  path: string;
  access: Access;
  /**
   * Sends a valid request to the endpoint, with `cookie` as the `Cookie` header when it's set.
   * Each caller gets a fresh app, so this can create whatever the request needs first.
   */
  send: (t: TestApp, cookie: string | undefined) => Response | Promise<Response>;
}

/** Every endpoint of the versioned API. Add an entry with each new endpoint. */
export const ENDPOINTS: readonly EndpointCase[] = [];

/** What the policy says should happen: the request goes through, or exactly this status. */
export function expectedOutcome(access: Access, caller: Caller): 'allowed' | 401 | 403 {
  if (access === 'public') return 'allowed';
  if (caller === 'anonymous') return 401;
  if (access === 'signed-in') return 'allowed';
  return can({ id: 'matrix', role: caller }, access) ? 'allowed' : 403;
}

/**
 * Sends `endpoint`'s request as every caller, each on a fresh app from `createApp`, and describes
 * each status that doesn't match the policy. "Allowed" means anything but 401, 403 or a 5xx: the
 * matrix checks who gets through, not what the endpoint does then.
 */
export async function findMismatches(
  endpoint: EndpointCase,
  createApp: () => TestApp,
): Promise<string[]> {
  const mismatches: string[] = [];
  for (const caller of CALLERS) {
    const t = createApp();
    const cookie = caller === 'anonymous' ? undefined : (await signedInAs(t, caller)).cookie;
    const { status } = await endpoint.send(t, cookie);
    const expected = expectedOutcome(endpoint.access, caller);
    const matches =
      expected === 'allowed'
        ? status !== 401 && status !== 403 && status < 500
        : status === expected;
    if (!matches) {
      mismatches.push(
        `${caller} ${endpoint.method.toUpperCase()} ${endpoint.path}: expected ${String(expected)}, got ${String(status)}`,
      );
    }
  }
  return mismatches;
}
