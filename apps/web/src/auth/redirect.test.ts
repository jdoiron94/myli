import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect.ts';

describe('where to go after signing in', () => {
  it('is the path asked for when it’s on this site, and the home page otherwise', () => {
    const redirects = {
      '/': '/',
      '/recipes/1': '/recipes/1',
      '/recipes?tag=soup&sort=newest': '/recipes?tag=soup&sort=newest',
      '/recipes/1#steps': '/recipes/1#steps',
      'https://example.com/': '/',
      '//example.com/': '/',
      '/\\example.com/': '/',
      '/\t/example.com/': '/',
      'javascript:alert(1)': '/',
      'recipes/1': '/',
      '': '/',
    };

    expect(
      Object.fromEntries(Object.keys(redirects).map((value) => [value, safeRedirect(value)])),
    ).toEqual(redirects);
  });

  it('is the home page when `redirect` is missing, empty or repeated', () => {
    expect([undefined, null, ['/recipes/1', '/recipes/2']].map(safeRedirect)).toEqual([
      '/',
      '/',
      '/',
    ]);
  });
});
