import { buffer } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';
import type { BlobStore } from './store.ts';

/**
 * What every `BlobStore` must do, run against each one (ADR 0004), so the stores, and the memory
 * one tests use, behave alike. `make` gives a new, empty store for each test.
 */
export function describeBlobStore(name: string, make: () => BlobStore | Promise<BlobStore>) {
  const bytes = (text: string) => new TextEncoder().encode(text);
  const read = async (store: BlobStore, key: string) => {
    const blob = await store.get(key);
    return blob && { ...blob, body: (await buffer(blob.body)).toString() };
  };

  describe(`${name} blob store`, () => {
    it('gives back what was put, with its content type and size', async () => {
      const store = await make();
      await store.put('images/a1/640.webp', bytes('pretend image'), { contentType: 'image/webp' });

      expect(await read(store, 'images/a1/640.webp')).toEqual({
        body: 'pretend image',
        contentType: 'image/webp',
        size: 13,
      });
    });

    it('gives nothing for a key never put, or deleted', async () => {
      const store = await make();
      await store.put('images/a1/640.webp', bytes('one'), { contentType: 'image/webp' });
      await store.put('images/a1/1280.webp', bytes('two'), { contentType: 'image/webp' });

      await store.delete('images/a1/640.webp');

      expect(await store.get('images/a1/640.webp')).toBeNull();
      expect(await store.get('images/b2/640.webp')).toBeNull();
      expect((await read(store, 'images/a1/1280.webp'))?.body).toBe('two');
    });

    it('deletes a key that isn’t there without complaint', async () => {
      const store = await make();

      await expect(store.delete('images/never/640.webp')).resolves.toBeUndefined();
    });

    it('keeps the bytes put, whatever happens to the buffer afterwards', async () => {
      const store = await make();
      const body = bytes('original');
      await store.put('images/a1/640.webp', body, { contentType: 'image/webp' });

      body.fill(0);

      expect((await read(store, 'images/a1/640.webp'))?.body).toBe('original');
    });

    it('refuses a key that could reach outside its place, or name no content type, for every action', async () => {
      const store = await make();
      const keys = [
        '',
        '640.webp/',
        '../640.webp',
        'images/../640.webp',
        'images/./640.webp',
        '/images/640.webp',
        'images//640.webp',
        '.images/640.webp',
        'images/.640.webp',
        'Images/640.webp',
        'images\\640.webp',
        'images/640',
        'images/640.exe',
        `images/${'a'.repeat(200)}.webp`,
      ];
      /** The actions that let the key through. */
      async function allowed(key: string) {
        const actions = {
          put: () => store.put(key, bytes('x'), { contentType: 'image/webp' }),
          get: () => store.get(key),
          delete: () => store.delete(key),
        };
        const through: string[] = [];
        for (const [action, run] of Object.entries(actions)) {
          await run().then(
            () => through.push(action),
            (error: unknown) => {
              if (!String(error).includes('invalid blob key'))
                through.push(`${action}: ${String(error)}`);
            },
          );
        }
        return through;
      }

      const results = await Promise.all(
        keys.map(async (key) => [key, await allowed(key)] as const),
      );
      expect(Object.fromEntries(results)).toEqual(Object.fromEntries(keys.map((key) => [key, []])));
    });

    it('refuses a content type the key’s extension doesn’t name', async () => {
      const store = await make();

      await expect(
        store.put('images/a1/640.webp', bytes('x'), { contentType: 'image/png' }),
      ).rejects.toThrow("can't hold image/png");
      expect(await store.get('images/a1/640.webp')).toBeNull();
    });
  });
}
