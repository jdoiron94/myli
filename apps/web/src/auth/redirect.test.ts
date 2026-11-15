import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect.ts';

describe('where to go after signing in', () => {
  it.each(['/', '/recipes/1', '/recipes?tag=soup&sort=newest', '/recipes/1#steps'])(
    'is %s, a path on this site',
    (path) => {
      expect(safeRedirect(path)).toBe(path);
    },
  );

  it.each([
    ['another site', 'https://example.com/'],
    ['another site, without a scheme', '//example.com/'],
    ['another site, behind a backslash', '/\\example.com/'],
    ['another site, behind a tab', '/\t/example.com/'],
    ['a script', 'javascript:alert(1)'],
    ['a relative path', 'recipes/1'],
    ['nothing', ''],
  ])('is the home page instead of %s', (_, value) => {
    expect(safeRedirect(value)).toBe('/');
  });

  it.each([
    ['missing', undefined],
    ['empty', null],
    ['repeated', ['/recipes/1', '/recipes/2']],
  ])('is the home page when `redirect` is %s', (_, value) => {
    expect(safeRedirect(value)).toBe('/');
  });
});
