import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { type BlobStore, blobContentType, checkBlob } from './store.ts';

/**
 * Blobs as files under `root`, each at its key's path (ADR 0004's default). Only the API's
 * container mounts the volume it's on.
 */
export function createLocalBlobStore(root: string): BlobStore {
  const base = resolve(root);
  const pathOf = (key: string) => join(base, ...key.split('/'));

  return {
    async put(key, body, { contentType }) {
      checkBlob(key, contentType);
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      // Written beside it, then renamed into place in one step: a reader never sees part of it.
      const partial = `${path}.${randomUUID()}.partial`;
      try {
        await writeFile(partial, body, { flag: 'wx' });
        await rename(partial, path);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
    },

    async get(key) {
      const contentType = blobContentType(key);
      let file;
      try {
        file = await open(pathOf(key));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      // Read through the open file, so it stays readable even if it's deleted meanwhile.
      const { size } = await file.stat();
      return { body: file.createReadStream(), contentType, size };
    },

    async delete(key) {
      blobContentType(key);
      const path = pathOf(key);
      await rm(path, { force: true });
      // Takes away the folders that leaves empty, up to the root. The keys in one folder belong to
      // one upload, and nothing is put there once its blobs are being deleted.
      for (let folder = dirname(path); folder !== base; folder = dirname(folder)) {
        try {
          await rmdir(folder);
        } catch {
          break;
        }
      }
    },
  };
}

const isMissing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';
