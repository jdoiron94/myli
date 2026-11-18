import { Readable } from 'node:stream';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  can,
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_TYPES,
  imageFileParamsSchema,
  imageResultSchema,
  NOT_AN_IMAGE_DETAIL,
  type PolicyRecipe,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  TOO_LARGE_DETAIL,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { notFound, requirePermission } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { BlobStore } from '../blobs/store.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { image } from '../db/schema.ts';
import { mediaType } from '../json-only.ts';
import { errorResponses, HttpProblem, InvalidFields } from '../problems.ts';
import { findRecipeAccess } from '../recipes/recipes.ts';
import { saveUpload } from './images.ts';
import { MAX_PIXELS, processImage } from './process.ts';

const UNREADABLE_DETAIL = {
  unreadable: "This image can't be read. The file may be damaged.",
  'too-many-pixels': `This image has too many pixels: ${String(MAX_PIXELS / 1_000_000)} megapixels at most.`,
} as const;

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

/** Refuses a body over the limit, from its Content-Length or as it arrives, before reading it all. */
// Typed with the app's env, so it doesn't undo requirePermission's narrowing of `c.var.user`.
const uploadLimit: MiddlewareHandler<AppEnv> = bodyLimit({
  maxSize: IMAGE_MAX_BYTES,
  onError: () => {
    throw new HttpProblem(413, TOO_LARGE_DETAIL);
  },
});

const binary = z.string().openapi({ format: 'binary' });

const postImage = createRoute({
  method: 'post',
  path: '/images',
  tags: ['Images'],
  summary: 'Upload a photo',
  description:
    'Editors and admins. The body is the file itself, with its type as `Content-Type`: a JPEG, ' +
    'PNG or WebP image of up to 10 MB, checked by its first bytes. It is turned upright, ' +
    'stripped of its metadata and resized. Until a recipe is saved with it, only its uploader can ' +
    'see it or use it, and it is deleted after a day.',
  middleware: [requirePermission('image.upload'), uploadLimit] as const,
  request: {
    body: {
      required: true,
      content: Object.fromEntries(IMAGE_UPLOAD_TYPES.map((type) => [type, { schema: binary }])),
    },
  },
  responses: {
    201: {
      description: 'The photo, at each size it is served at.',
      content: { 'application/json': { schema: imageResultSchema } },
    },
    413: problem('The file is larger than 10 MB.'),
    415: problem('The file is not a JPEG, PNG or WebP image.'),
    ...errorResponses,
  },
});

/**
 * What decides who may see an image, under `recipe.read`: the recipe it belongs to, or until a
 * recipe is saved with it, its uploader alone, as for a private recipe of theirs. `undefined` when
 * its recipe was deleted.
 */
function imageAccess(
  db: Db,
  row: { recipeId: string | null; uploaderId: string },
): PolicyRecipe | undefined {
  if (row.recipeId === null) return { ownerId: row.uploaderId, visibility: 'private' };
  return findRecipeAccess(db, row.recipeId);
}

/** A size's address never changes what it serves (ADR 0004), so browsers keep it for good. */
export const IMAGE_CACHE_CONTROL = 'private, max-age=31536000, immutable';

const getImageFile = createRoute({
  method: 'get',
  path: '/images/{id}/{width}',
  tags: ['Images'],
  summary: 'Get a photo at one of its sizes',
  description:
    'Any signed-in user who may see the recipe it belongs to; until a recipe is saved with it, ' +
    'only its uploader. Anyone else gets 404, as for a photo that doesn’t exist. `width` is one ' +
    'of the widths in its `variants`. What an address serves never changes, so it can be cached ' +
    'for good.',
  middleware: [requireSession] as const,
  request: { params: imageFileParamsSchema },
  responses: {
    200: {
      description: 'The photo at that size, as WebP.',
      content: { 'image/webp': { schema: binary } },
    },
    404: problem('No photo has this ID or size, or the caller may not see it.'),
    ...errorResponses,
  },
});

export function registerImageRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db; blobs: BlobStore }) {
  v1.openapi(postImage, async (c) => {
    // JSON gets past jsonOnly(), as on every route; only an image type is an upload.
    const declared = mediaType(c.req.header('content-type'));
    if (!IMAGE_UPLOAD_TYPES.some((type) => type === declared)) {
      throw new HttpProblem(415, NOT_AN_IMAGE_DETAIL);
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const processed = await processImage(bytes);
    if (!processed.ok) {
      if (processed.problem === 'not-an-image') throw new HttpProblem(415, NOT_AN_IMAGE_DETAIL);
      throw new InvalidFields([{ path: [], detail: UNREADABLE_DETAIL[processed.problem] }]);
    }
    const image = await saveUpload(deps, c.var.user.id, processed.image);
    c.var.logger.info(
      { imageId: image.id, type: processed.image.type, bytes: bytes.byteLength },
      'image uploaded',
    );
    return c.json({ image }, 201);
  });

  v1.openapi(getImageFile, async (c) => {
    const { id, width } = c.req.valid('param');
    const row = deps.db.select().from(image).where(eq(image.id, id)).get();
    const access = row && imageAccess(deps.db, row);
    if (!row || !access || !can(c.var.user, 'recipe.read', access)) throw notFound('Image');
    const variant = row.variants.find((each) => each.width === width);
    if (!variant) throw notFound('Image');

    const blob = await deps.blobs.get(variant.key);
    if (!blob) {
      // Its row says it's there: a store that lost files, or was restored without them.
      c.var.logger.error({ imageId: id, key: variant.key }, 'image blob missing');
      throw notFound('Image');
    }
    return c.body(Readable.toWeb(blob.body) as ReadableStream, 200, {
      'Content-Type': blob.contentType,
      'Content-Length': String(blob.size),
      'Cache-Control': IMAGE_CACHE_CONTROL,
    });
  });
}
