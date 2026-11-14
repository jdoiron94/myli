// Smoke test for the monorepo wiring. Replace it once the API has real tests that import @myli/shared.
import { API_BASE_PATH } from '@myli/shared';
import { expect, it } from 'vitest';

it('resolves @myli/shared from the workspace', () => {
  expect(API_BASE_PATH).toBe('/api/v1');
});
