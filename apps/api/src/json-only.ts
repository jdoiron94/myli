import { API_BASE_PATH, IMAGE_UPLOAD_TYPES } from '@myli/shared';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './context.ts';
import { HttpProblem } from './problems.ts';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const JSON_ONLY_DETAIL =
  'Send requests that change data with Content-Type: application/json, even when they have no body.';

/**
 * Answers 415 to every request that could change data, unless it says `Content-Type:
 * application/json`, with or without a body. The one exception is uploading an image, whose body
 * is the file itself (`isImageUpload`).
 *
 * This is the cross-site request defense (CLAUDE.md, Content and security). Another origin can
 * make a browser send the session cookie only with a "simple" request: one whose content type is
 * form-encoded, multipart, `text/plain` or absent. Anything else, JSON included, needs a CORS
 * preflight, which this API never approves. `SameSite=Lax` cookies alone aren't enough: they still
 * go with requests from other origins on the same site, such as another app on a different port
 * of the same host.
 */
export function jsonOnly(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const contentType = c.req.header('content-type');
    if (
      !READ_ONLY_METHODS.has(c.req.method) &&
      !isJson(contentType) &&
      !isImageUpload(c.req.method, c.req.path, contentType)
    ) {
      throw new HttpProblem(415, JSON_ONLY_DETAIL);
    }
    await next();
  };
}

/** A content type without its parameters, such as `charset`, in lowercase. */
export function mediaType(contentType: string | undefined): string | undefined {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase();
}

/** `application/json`, in any case, with or without parameters such as `charset`. */
function isJson(contentType: string | undefined) {
  return mediaType(contentType) === 'application/json';
}

const IMAGE_UPLOAD_PATH = `${API_BASE_PATH}/images`;

/**
 * An image upload: a JPEG, PNG or WebP file to `POST /images`, and nothing else. Those types are no
 * more open to other origins than JSON: they aren't among the three a form or a no-CORS fetch can
 * send, so sending one needs the preflight this API never approves.
 */
function isImageUpload(method: string, path: string, contentType: string | undefined) {
  const type = mediaType(contentType);
  return (
    method === 'POST' &&
    path === IMAGE_UPLOAD_PATH &&
    IMAGE_UPLOAD_TYPES.some((uploadType) => uploadType === type)
  );
}
