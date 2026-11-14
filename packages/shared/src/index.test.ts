import { describe, expect, it } from 'vitest';
import { API_BASE_PATH } from './index.ts';

describe('API_BASE_PATH', () => {
  it('is a versioned path with no trailing slash, so it can be joined with route paths', () => {
    expect(API_BASE_PATH).toMatch(/^\/api\/v\d+$/);
  });
});
