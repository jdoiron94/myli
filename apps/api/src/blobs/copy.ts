import type { Db } from '../db/database.ts';
import { image } from '../db/schema.ts';
import type { Logger } from '../logger.ts';
import type { BlobStore } from './store.ts';

export interface CopyResult {
  copied: number;
  /** Already in the store copied to: keys never change, so it's the same file. */
  present: number;
  /** Not in the store copied from either: they were lost before. */
  missing: string[];
}

/**
 * Copies every size of every photo the database has, saved or only uploaded, from one store to
 * another (ADR 0004), to switch `BLOB_STORE`: `src/copy-photos.ts`. Nothing is deleted, and a
 * photo already copied is left as it is, so it can run again after an interruption. `onProgress`
 * hears how many of them it has been through.
 */
export async function copyPhotos(
  db: Db,
  { from, to, logger }: { from: BlobStore; to: BlobStore; logger: Logger },
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<CopyResult> {
  const keys = db
    .select({ variants: image.variants })
    .from(image)
    .all()
    .flatMap(({ variants }) => variants.map(({ key }) => key));
  const result: CopyResult = { copied: 0, present: 0, missing: [] };

  for (const [index, key] of keys.entries()) {
    const there = await to.get(key);
    if (there) {
      // Only whether it's there: its bytes stay unread.
      there.body.destroy();
      result.present++;
    } else {
      const blob = await from.get(key);
      if (blob) {
        await to.put(key, Buffer.concat(await blob.body.toArray()), {
          contentType: blob.contentType,
        });
        result.copied++;
      } else {
        logger.warn({ key }, 'photo missing from the store copied from');
        result.missing.push(key);
      }
    }
    onProgress(index + 1, keys.length);
  }
  return result;
}
