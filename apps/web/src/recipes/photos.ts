import {
  API_BASE_PATH,
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_TYPES,
  NOT_AN_IMAGE_DETAIL,
  TOO_LARGE_DETAIL,
} from '@myli/shared';
import type { InjectionKey } from 'vue';
import { api, responseData } from '@/api/client.ts';
import type { Image } from './recipe.ts';

/** What the API would refuse a file for, said before sending it, or `undefined`. */
export function photoFileProblem(file: File): string | undefined {
  if (!(IMAGE_UPLOAD_TYPES as readonly string[]).includes(file.type)) return NOT_AN_IMAGE_DETAIL;
  if (file.size > IMAGE_MAX_BYTES) return TOO_LARGE_DETAIL;
  return undefined;
}

/**
 * Uploads a photo, which no recipe has until one is saved with it. The body is the file itself, of
 * its own type: the API's one exception to JSON (CLAUDE.md, Cross-site requests).
 */
export async function uploadPhoto(file: File): Promise<Image> {
  const { image } = responseData(
    await api.POST('/images', {
      body: file,
      bodySerializer: (body) => body,
      headers: { 'content-type': file.type },
    }),
  );
  return image;
}

/** Where one size of a photo is served. */
export type PhotoAddress = (id: string, width: number) => string;

/** Where the signed-in reader gets a photo. The API decides who may see it, as for its recipe. */
export const imageUrl: PhotoAddress = (id, width) =>
  `${API_BASE_PATH}/images/${encodeURIComponent(id)}/${String(width)}`;

/**
 * Where the photos on a page come from, for a page whose reader isn't signed in: a public link's
 * gives its token's. Every other page gets `imageUrl`.
 */
export const PHOTO_ADDRESS: InjectionKey<PhotoAddress> = Symbol('photo address');

/**
 * What an `<img>` needs to let the browser pick the size of a photo it shows: each size the API
 * made, and for `src`, the first at least 1280 pixels wide, or the widest.
 */
export function imageSources(image: Image, address: PhotoAddress = imageUrl) {
  const fallback = image.variants.find(({ width }) => width >= 1280) ?? image.variants.at(-1);
  return {
    src: fallback && address(image.id, fallback.width),
    srcset: image.variants
      .map(({ width }) => `${address(image.id, width)} ${String(width)}w`)
      .join(', '),
  };
}

// How wide each photo shows, for `sizes`, from the layout's classes: content at most 64rem wide
// (`max-w-5xl`) less a 1rem gutter each side, so 992 pixels; the recipe page's grid from `md` up.
// A change to those classes needs a change here. The browser picks the next size up, so an
// estimate a little off costs nothing.

/** The recipe page's cover, and the photos in its slideshow: the content's whole width. */
export const COVER_SIZES = '(min-width: 64rem) 992px, calc(100vw - 2rem)';

/**
 * A step's photo: the steps' column, 3/5 of the grid after its 3rem gap from `md` up, less the
 * list's 1.75rem indent, and on phones, the content's whole width.
 */
export const STEP_PHOTO_SIZES =
  '(min-width: 64rem) 538px, (min-width: 48rem) calc((100vw - 5rem) * 0.6 - 1.75rem), calc(100vw - 2rem)';

/**
 * A photo in the editor: four to a row from `md` up, three from `sm`, 1rem apart, and on phones,
 * one, the content's whole width.
 */
export const EDITOR_PHOTO_SIZES =
  '(min-width: 64rem) 236px, (min-width: 48rem) calc((100vw - 5rem) / 4), (min-width: 40rem) calc((100vw - 4rem) / 3), calc(100vw - 2rem)';

/** A step's photo in the editor: 12rem wide from `sm` up, 10rem on phones. */
export const STEP_EDITOR_PHOTO_SIZES = '(min-width: 40rem) 12rem, 10rem';

/**
 * A recipe card's cover: as wide as the widest card in either list, two to a row beside search's
 * filters (`lg:w-60`, 2rem from the results) from `lg` up, two from `sm`, one on phones.
 */
export const CARD_SIZES =
  '(min-width: 64rem) 352px, (min-width: 40rem) calc((100vw - 3rem) / 2), calc(100vw - 2rem)';
