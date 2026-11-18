import { Readable } from 'node:stream';
import { type BlobStore, blobContentType, checkBlob } from './store.ts';

/** Blobs in memory, for tests. It passes the same contract tests as the real stores. */
export function createMemoryBlobStore(): BlobStore & { keys(): string[] } {
  const blobs = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    put: (key, body, { contentType }) =>
      settle(() => {
        checkBlob(key, contentType);
        blobs.set(key, { bytes: Uint8Array.from(body), contentType });
      }),
    get: (key) =>
      settle(() => {
        blobContentType(key);
        const blob = blobs.get(key);
        return blob
          ? {
              body: Readable.from([Buffer.from(blob.bytes)]),
              contentType: blob.contentType,
              size: blob.bytes.byteLength,
            }
          : null;
      }),
    delete: (key) =>
      settle(() => {
        blobContentType(key);
        blobs.delete(key);
      }),
    keys: () => [...blobs.keys()].sort(),
  };
}

/** What `run` returns or throws, as a promise: a refused key rejects, as in the real stores. */
const settle = <T>(run: () => T) =>
  new Promise<T>((resolve) => {
    resolve(run());
  });
