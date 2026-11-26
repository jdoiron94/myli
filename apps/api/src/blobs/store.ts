import type { Readable } from 'node:stream';

/**
 * Where uploaded files live (ADR 0004): a local directory by default (`local.ts`), or an S3 bucket
 * (`s3.ts`).
 *
 * Keys are opaque and immutable, such as `images/<uuid>/640.webp`. A changed file gets a new key,
 * so nothing is overwritten and what's served can be cached for good. A key's extension names its
 * content type (`BLOB_CONTENT_TYPES`), so stores without metadata, like a directory, keep it too.
 */
export interface BlobStore {
  /**
   * Stores `body` under `key`. A reader sees all of it or nothing, never a part. Bodies are
   * buffers: resized images are small enough to hold in memory. Callers never put a key twice.
   */
  put(key: string, body: Uint8Array, options: { contentType: string }): Promise<void>;
  /** The blob under `key`, or `null` if there's none. */
  get(key: string): Promise<StoredBlob | null>;
  /** Removes the blob under `key`. Removing one that isn't there is not an error. */
  delete(key: string): Promise<void>;
}

export interface StoredBlob {
  body: Readable;
  contentType: string;
  /** In bytes. */
  size: number;
}

export const BLOB_CONTENT_TYPES: Readonly<Record<string, string>> = {
  webp: 'image/webp',
};

/**
 * Lowercase path segments of letters, digits, dots and dashes, none starting with a dot, so a key
 * can't name a parent folder, an absolute path or a hidden file. Its last segment has an extension.
 */
const KEY = /^(?:[a-z0-9][a-z0-9.-]*\/)*[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;
const KEY_MAX_LENGTH = 200;

/** The content type `key` holds. Throws if the key isn't valid, or its extension isn't known. */
export function blobContentType(key: string): string {
  const type = KEY.test(key) && key.length <= KEY_MAX_LENGTH && BLOB_CONTENT_TYPES[extension(key)];
  if (!type) throw new Error(`invalid blob key: ${key}`);
  return type;
}

/** Throws unless `key` is valid and `contentType` is the one its extension names. */
export function checkBlob(key: string, contentType: string): void {
  if (blobContentType(key) !== contentType) {
    throw new Error(`blob key ${key} can't hold ${contentType}`);
  }
}

const extension = (key: string) => key.slice(key.lastIndexOf('.') + 1);
