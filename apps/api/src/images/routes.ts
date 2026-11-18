import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_TYPES,
  imageResultSchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
} from '@myli/shared';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requirePermission } from '../auth/authorize.ts';
import type { BlobStore } from '../blobs/store.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { mediaType } from '../json-only.ts';
import { errorResponses, HttpProblem, InvalidFields } from '../problems.ts';
import { saveUpload } from './images.ts';
import { MAX_PIXELS, processImage } from './process.ts';

export const NOT_AN_IMAGE_DETAIL = 'Upload a JPEG, PNG or WebP image.';
export const TOO_LARGE_DETAIL = `The file is larger than ${String(IMAGE_MAX_BYTES / 1024 / 1024)} MB.`;
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
}
