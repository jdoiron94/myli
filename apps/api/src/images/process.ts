import { IMAGE_UPLOAD_TYPES, IMAGE_WIDTHS, type ImageUploadType } from '@myli/shared';
import sharp from 'sharp';

/**
 * Turning an upload into the images served (spec §3.2 Images): checked by its own bytes, turned
 * upright, stripped of its metadata (EXIF, location included), and resized to `IMAGE_WIDTHS` as
 * WebP. The upload itself isn't kept.
 */

/** More pixels than this is refused: decoding it would take too much memory. 100 megapixels. */
export const MAX_PIXELS = 100_000_000;

/** What the start of each type's files always is. */
const SIGNATURES: readonly [ImageUploadType, (bytes: Uint8Array) => boolean][] = [
  ['image/jpeg', (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff])],
  ['image/png', (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  // RIFF, a length, then WEBP.
  [
    'image/webp',
    (bytes) =>
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  ],
];

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

/** The upload type a file's first bytes say it is, whatever it claims to be. */
export function sniffImageType(bytes: Uint8Array): ImageUploadType | undefined {
  return SIGNATURES.find(([, matches]) => matches(bytes))?.[0];
}

/** sharp's name for each type, to check it read the file as what its first bytes say. */
const SHARP_FORMATS = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const satisfies Record<(typeof IMAGE_UPLOAD_TYPES)[number], string>;

export interface ProcessedImage {
  type: ImageUploadType;
  /** Of the upload, turned upright. */
  width: number;
  height: number;
  /** Narrowest first. */
  variants: { width: number; height: number; bytes: Buffer }[];
}

export type ProcessResult =
  | { ok: true; image: ProcessedImage }
  | { ok: false; problem: 'not-an-image' | 'unreadable' | 'too-many-pixels' };

/** The widths to serve an image `width` pixels wide at: never wider than it, and at least one. */
export function variantWidths(width: number): number[] {
  const narrower: number[] = IMAGE_WIDTHS.filter((each) => each < width);
  const widest = Math.min(width, IMAGE_WIDTHS.at(-1) ?? width);
  return narrower.includes(widest) ? narrower : [...narrower, widest];
}

export async function processImage(bytes: Uint8Array): Promise<ProcessResult> {
  const type = sniffImageType(bytes);
  if (!type) return { ok: false, problem: 'not-an-image' };
  // Only the first frame of an animation.
  const input = () => sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'error' });
  try {
    // Read from the header alone, without decoding, so the pixels can be counted before they are:
    // with the limit on, sharp would refuse to say how many there are.
    const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
    if (metadata.format !== SHARP_FORMATS[type]) return { ok: false, problem: 'unreadable' };
    if (metadata.width * metadata.height > MAX_PIXELS) {
      return { ok: false, problem: 'too-many-pixels' };
    }
    const { width, height } = metadata.autoOrient;
    const upright = input().autoOrient();
    const variants = await Promise.all(
      variantWidths(width).map(async (variantWidth) => {
        // sharp writes no metadata unless asked: EXIF, XMP and the color profile are dropped, and
        // the colors converted to sRGB.
        const { data, info } = await upright
          .clone()
          .resize({ width: variantWidth })
          .webp({ quality: 80 })
          .toBuffer({ resolveWithObject: true });
        return { width: info.width, height: info.height, bytes: data };
      }),
    );
    return { ok: true, image: { type, width, height, variants } };
  } catch {
    // A damaged or truncated file, or one sharp can't decode: nothing to log, it's the upload.
    return { ok: false, problem: 'unreadable' };
  }
}
