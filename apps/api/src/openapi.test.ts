import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPENAPI_DOCUMENT_FILE, renderOpenApiDocument } from './openapi-document.ts';
import { createTestApp } from './testing.ts';

describe('GET /api/v1/openapi.json', () => {
  it('serves an OpenAPI 3.1 document for the versioned API', async () => {
    const res = await createTestApp().app.request('/api/v1/openapi.json');
    expect(res.status).toBe(200);

    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'myli API', version: 'v1' },
      servers: [{ url: '/api/v1' }],
    });
  });

  it('documents the problem responses on every operation', async () => {
    const doc = JSON.parse(await renderOpenApiDocument()) as {
      paths?: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    for (const [path, operations] of Object.entries(doc.paths ?? {})) {
      for (const [method, operation] of Object.entries(operations)) {
        expect(Object.keys(operation.responses), `${method.toUpperCase()} ${path}`).toEqual(
          expect.arrayContaining(['422', 'default']),
        );
      }
    }
  });

  it('leaves out operational endpoints such as /healthz', async () => {
    const doc = JSON.parse(await renderOpenApiDocument()) as { paths?: Record<string, unknown> };
    expect(Object.keys(doc.paths ?? {})).not.toContain('/healthz');
  });
});

describe('apps/api/openapi.json', () => {
  it('matches the generated document (run `pnpm openapi:generate` to update it)', async () => {
    expect(readFileSync(OPENAPI_DOCUMENT_FILE, 'utf8')).toBe(await renderOpenApiDocument());
  });
});
