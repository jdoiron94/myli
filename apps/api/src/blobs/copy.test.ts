import { describe, expect, it } from 'vitest';
import { uploadImage } from '../images/testing.ts';
import { createLogger } from '../logger.ts';
import { createTestApp, signedInAs } from '../testing.ts';
import { copyPhotos } from './copy.ts';
import { createMemoryBlobStore } from './memory.ts';

describe('copying the photos to another store', () => {
  it('copies every size of every photo, leaving those there already, and names those missing', async () => {
    const from = createMemoryBlobStore();
    const t = createTestApp({ blobs: from });
    const { cookie } = await signedInAs(t, 'editor');
    // Uploads that no recipe has yet are photos too.
    await uploadImage(t, cookie);
    await uploadImage(t, cookie);
    const keys = from.keys();
    const [lost = '', copiedBefore = ''] = keys;
    await from.delete(lost);
    const to = createMemoryBlobStore();
    await to.put(copiedBefore, new TextEncoder().encode('copied before'), {
      contentType: 'image/webp',
    });
    const warnings: unknown[] = [];
    const logger = createLogger('warn', {
      write: (line: string) => warnings.push(JSON.parse(line)),
    });

    const result = await copyPhotos(t.db, { from, to, logger });

    expect(result).toEqual({ copied: keys.length - 2, present: 1, missing: [lost] });
    expect(to.keys()).toEqual(keys.filter((key) => key !== lost));
    expect(await (await to.get(copiedBefore))?.body.toArray()).toEqual([
      Buffer.from('copied before'),
    ]);
    expect(warnings).toEqual([
      expect.objectContaining({ key: lost, msg: 'photo missing from the store copied from' }),
    ]);
  });
});
