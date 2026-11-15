import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { API_TYPES_FILE, renderApiTypes } from './api-types.ts';

it('apps/web/src/api/schema.ts matches the OpenAPI document (run `pnpm openapi:generate`)', async () => {
  expect(readFileSync(API_TYPES_FILE, 'utf8')).toBe(await renderApiTypes());
});
