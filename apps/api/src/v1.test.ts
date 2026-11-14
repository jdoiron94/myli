import { createRoute, z } from '@hono/zod-openapi';
import { validationProblemSchema } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { errorResponses } from './problems.ts';
import { createTestApp } from './testing.ts';
import { createV1Router } from './v1.ts';

/** The v1 router with one route that validates a JSON body and a query parameter. */
function routerWithTestRoute() {
  const v1 = createV1Router(createTestApp());
  v1.openapi(
    createRoute({
      method: 'post',
      path: '/things',
      request: {
        query: z.object({ limit: z.coerce.number().int().min(1).optional() }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                name: z.string().min(1),
                tags: z.array(z.string()).optional(),
                'a/b~c': z.boolean().optional(),
              }),
            },
          },
        },
      },
      responses: { 201: { description: 'Created' }, ...errorResponses },
    }),
    (c) => c.body(null, 201),
  );
  return v1;
}

describe('OpenAPI document', () => {
  it('references the problem schemas as components from routes that spread errorResponses', async () => {
    const res = await routerWithTestRoute().request('/openapi.json');
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.paths['/things']?.post?.responses).toMatchObject({
      422: {
        content: {
          'application/problem+json': {
            schema: { $ref: '#/components/schemas/ValidationProblem' },
          },
        },
      },
      default: {
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
        },
      },
    });
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(['ProblemDetails', 'ValidationProblem']),
    );
  });
});

function postThing(body: unknown, query = '') {
  return routerWithTestRoute().request(`/things${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Asserts a valid ValidationProblem response and returns its field errors. */
async function validationErrors(res: Response) {
  expect(res.status).toBe(422);
  expect(res.headers.get('content-type')).toBe('application/problem+json');
  const body: unknown = await res.json();
  return validationProblemSchema.strict().parse(body).errors;
}

describe('request validation', () => {
  it('lets a valid request through to the handler', async () => {
    expect((await postThing({ name: 'Soup' }, '?limit=5')).status).toBe(201);
  });

  it('answers 422 with a JSON Pointer to the invalid body field', async () => {
    const errors = await validationErrors(await postThing({ name: '' }));
    expect(errors).toEqual([
      { in: 'body', pointer: '#/name', detail: expect.any(String) as unknown },
    ]);
  });

  it('lists every invalid field, including nested ones', async () => {
    const errors = await validationErrors(await postThing({ tags: ['ok', 7] }));
    expect(errors.map((error) => error.pointer).sort()).toEqual(['#/name', '#/tags/1']);
  });

  it('escapes "/" and "~" in field names, as RFC 6901 requires', async () => {
    const errors = await validationErrors(await postThing({ name: 'Soup', 'a/b~c': 'yes' }));
    expect(errors).toMatchObject([{ pointer: '#/a~1b~0c' }]);
  });

  it('reports invalid query parameters as such', async () => {
    const errors = await validationErrors(await postThing({ name: 'Soup' }, '?limit=0'));
    expect(errors).toMatchObject([{ in: 'query', pointer: '#/limit' }]);
  });

  it('never echoes the invalid input', async () => {
    const res = await postThing({ name: 'Soup', tags: [{ password: 'hunter2' }] });
    expect(await res.text()).not.toContain('hunter2');
  });
});
