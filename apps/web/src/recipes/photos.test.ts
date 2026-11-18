import { describe, expect, it } from 'vitest';
import { imageSources, imageUrl } from './photos.ts';

describe('a photo’s sources', () => {
  it('offers each size, falling back to the first at least 1280 pixels wide', () => {
    expect(
      imageSources({
        id: 'photo',
        width: 3000,
        height: 2000,
        variants: [
          { width: 640, height: 427 },
          { width: 1280, height: 853 },
          { width: 2048, height: 1365 },
        ],
      }),
    ).toEqual({
      src: '/api/v1/images/photo/1280',
      srcset:
        '/api/v1/images/photo/640 640w, /api/v1/images/photo/1280 1280w, /api/v1/images/photo/2048 2048w',
    });
  });

  it('falls back to the widest of a photo narrower than that', () => {
    expect(
      imageSources({
        id: 'photo',
        width: 900,
        height: 600,
        variants: [
          { width: 640, height: 427 },
          { width: 900, height: 600 },
        ],
      }).src,
    ).toBe('/api/v1/images/photo/900');
  });

  it('keeps an ID to its own part of the address', () => {
    expect(imageUrl('a/b?c', 640)).toBe('/api/v1/images/a%2Fb%3Fc/640');
  });
});
