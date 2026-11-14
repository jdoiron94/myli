import { describe, expect, it } from 'vitest';
import { requirePermission } from './auth/authorize.ts';
import { requireSession } from './auth/session.ts';
import { renderOpenApiDocument } from './openapi-document.ts';
import {
  type Access,
  CALLERS,
  ENDPOINTS,
  type EndpointCase,
  expectedOutcome,
  findMismatches,
} from './permission-matrix.ts';
import { createTestApp } from './testing.ts';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const label = ({ method, path }: Pick<EndpointCase, 'method' | 'path'>) =>
  `${method.toUpperCase()} ${path}`;

describe('the permission matrix', () => {
  it('lists exactly the operations in the OpenAPI document, each once', async () => {
    const document = JSON.parse(await renderOpenApiDocument()) as {
      paths?: Record<string, Record<string, unknown>>;
    };
    const operations = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((key) => HTTP_METHODS.has(key))
        .map((method) => label({ method: method as EndpointCase['method'], path })),
    );
    const listed = ENDPOINTS.map(label);

    expect(listed.toSorted()).toEqual(operations.toSorted());
    expect(new Set(listed).size).toBe(listed.length);
  });

  for (const endpoint of ENDPOINTS) {
    it(`${label(endpoint)} lets in exactly the callers the policy allows`, async () => {
      expect(await findMismatches(endpoint, () => createTestApp())).toEqual([]);
    });
  }
});

describe('expectedOutcome', () => {
  it.each([
    ['public', ['allowed', 'allowed', 'allowed', 'allowed']],
    ['signed-in', [401, 'allowed', 'allowed', 'allowed']],
    ['user.invite', [401, 'allowed', 403, 403]],
    ['recipe.create', [401, 'allowed', 'allowed', 403]],
  ] as const)('%s, for %j', (access, expected) => {
    expect(CALLERS).toEqual(['anonymous', 'admin', 'editor', 'viewer']);
    expect(CALLERS.map((caller) => expectedOutcome(access, caller))).toEqual(expected);
  });
});

describe('the harness itself', () => {
  /** The test app with routes protected in each way, plus one that crashes. */
  function appWithTestRoutes() {
    const t = createTestApp();
    t.app.get('/api/v1/test/open', (c) => c.json({}));
    t.app.get('/api/v1/test/members', requireSession, (c) => c.json({}));
    t.app.get('/api/v1/test/admins', requirePermission('user.invite'), (c) => c.json({}));
    t.app.get('/api/v1/test/crashes', requireSession, () => {
      throw new Error('a bug in the handler');
    });
    return t;
  }

  const endpoint = (path: string, access: Access): EndpointCase => ({
    method: 'get',
    path,
    access,
    send: (t, cookie) =>
      t.app.request(`/api/v1/test${path}`, { headers: cookie ? { cookie } : {} }),
  });

  it('finds nothing wrong with endpoints protected as listed', async () => {
    for (const [path, access] of [
      ['/open', 'public'],
      ['/members', 'signed-in'],
      ['/admins', 'user.invite'],
    ] as const) {
      expect(await findMismatches(endpoint(path, access), appWithTestRoutes)).toEqual([]);
    }
  });

  it('reports an endpoint that lets in more callers than the policy allows', async () => {
    expect(await findMismatches(endpoint('/members', 'user.invite'), appWithTestRoutes)).toEqual([
      'editor GET /members: expected 403, got 200',
      'viewer GET /members: expected 403, got 200',
    ]);
  });

  it('reports an endpoint that turns away callers the policy allows', async () => {
    expect(await findMismatches(endpoint('/admins', 'signed-in'), appWithTestRoutes)).toEqual([
      'editor GET /admins: expected allowed, got 403',
      'viewer GET /admins: expected allowed, got 403',
    ]);
    expect(await findMismatches(endpoint('/members', 'public'), appWithTestRoutes)).toEqual([
      'anonymous GET /members: expected allowed, got 401',
    ]);
  });

  it('does not count a crash as getting through', async () => {
    expect(await findMismatches(endpoint('/crashes', 'signed-in'), appWithTestRoutes)).toEqual([
      'admin GET /crashes: expected allowed, got 500',
      'editor GET /crashes: expected allowed, got 500',
      'viewer GET /crashes: expected allowed, got 500',
    ]);
  });
});
