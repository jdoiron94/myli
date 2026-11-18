import { z } from 'zod';

/** Recipe photos (spec §3.2 Images). */

/** What can be uploaded, by the file's own bytes, whatever it's called. */
export const IMAGE_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageUploadType = (typeof IMAGE_UPLOAD_TYPES)[number];

/** The largest upload, in bytes: 10 MB. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** What's wrong with a file that isn't one of `IMAGE_UPLOAD_TYPES`, for the API and the editor. */
export const NOT_AN_IMAGE_DETAIL = 'Upload a JPEG, PNG or WebP image.';

/** What's wrong with a file larger than `IMAGE_MAX_BYTES`. */
export const TOO_LARGE_DETAIL = `The file is larger than ${String(IMAGE_MAX_BYTES / 1024 / 1024)} MB.`;

/**
 * The widths each image is served at, as WebP, never wider than the upload. They follow the
 * layouts photos appear in, at the screen densities phones and laptops have: a card is up to
 * about 600 CSS pixels wide on a phone and 320 on a wide screen; a recipe's photo up to 992.
 */
export const IMAGE_WIDTHS = [640, 1280, 2048] as const;

export const imageVariantSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
});

export const imageSchema = z
  .object({
    id: z.string(),
    alt: z
      .string()
      .describe('What it shows, for people who can’t see it. Empty when it isn’t described.'),
    width: z.number().int().describe('Of the upload, in pixels, turned upright.'),
    height: z.number().int(),
    variants: z
      .array(imageVariantSchema)
      .describe('The sizes it’s served at, narrowest first, each from /images/{id}/{width}.'),
  })
  .meta({ id: 'Image' });

export type Image = z.infer<typeof imageSchema>;

/**
 * An image, or `null` for none. Not `imageSchema.nullable()`, with which the OpenAPI document
 * would make the Image component itself nullable, everywhere it's used.
 */
export const optionalImageSchema = z.union([imageSchema, z.null()]);

export const imageResultSchema = z.object({ image: imageSchema }).meta({ id: 'ImageResult' });

/** One size of one image: `/images/{id}/{width}`, a width from its `variants`. */
export const imageFileParamsSchema = z.object({
  id: z.string().min(1).max(100),
  width: z.coerce.number().int().min(1).max(100_000),
});
