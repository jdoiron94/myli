import { API_BASE_PATH } from '@myli/shared';
import type { Image } from './recipe.ts';

/** Where one size of a photo is served. The API decides who may see it, as for its recipe. */
export const imageUrl = (id: string, width: number) =>
  `${API_BASE_PATH}/images/${encodeURIComponent(id)}/${String(width)}`;

/**
 * What an `<img>` needs to let the browser pick the size of a photo it shows: each size the API
 * made, and for `src`, the first at least 1280 pixels wide, or the widest.
 */
export function imageSources(image: Image) {
  const fallback = image.variants.find(({ width }) => width >= 1280) ?? image.variants.at(-1);
  return {
    src: fallback && imageUrl(image.id, fallback.width),
    srcset: image.variants
      .map(({ width }) => `${imageUrl(image.id, width)} ${String(width)}w`)
      .join(', '),
  };
}

// How wide each photo shows, for `sizes`, from the layout's classes: content at most 64rem wide
// (`max-w-5xl`) less a 1rem gutter each side, so 992 pixels; the recipe page's grid from `md` up.
// A change to those classes needs a change here. The browser picks the next size up, so an
// estimate a little off costs nothing.

/** The recipe page's cover: the content's whole width. */
export const COVER_SIZES = '(min-width: 64rem) 992px, calc(100vw - 2rem)';

/**
 * A step's photo: the steps' column, 3/5 of the grid after its 3rem gap from `md` up, less the
 * list's 1.75rem indent.
 */
export const STEP_PHOTO_SIZES =
  '(min-width: 64rem) 538px, (min-width: 48rem) calc((100vw - 5rem) * 0.6 - 1.75rem), calc(100vw - 3.75rem)';

/** The recipe page's other photos: three to a row from `md` up, two on phones, 0.75rem apart. */
export const GALLERY_SIZES =
  '(min-width: 64rem) 323px, (min-width: 48rem) calc((100vw - 3.5rem) / 3), calc((100vw - 2.75rem) / 2)';
