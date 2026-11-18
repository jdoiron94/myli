import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { afterEach, describe, expect, it } from 'vitest';
import { describeBlobStore } from './contract.ts';
import { createLocalBlobStore } from './local.ts';

const roots: string[] = [];
function newRoot() {
  const root = mkdtempSync(join(tmpdir(), 'myli-blobs-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describeBlobStore('local', () => createLocalBlobStore(newRoot()));

describe('local blob store', () => {
  const body = new TextEncoder().encode('pretend image');
  const webp = { contentType: 'image/webp' };

  it('keeps each blob as a file at its key’s path, leaving nothing else behind', async () => {
    const root = newRoot();
    const store = createLocalBlobStore(root);

    await store.put('images/a1/640.webp', body, webp);

    expect(readFileSync(join(root, 'images', 'a1', '640.webp'), 'utf8')).toBe('pretend image');
    expect(readdirSync(join(root, 'images', 'a1'))).toEqual(['640.webp']);
  });

  it('takes away the folders a delete leaves empty, but never the root', async () => {
    const root = newRoot();
    const store = createLocalBlobStore(root);
    await store.put('images/a1/640.webp', body, webp);
    await store.put('images/a1/1280.webp', body, webp);
    await store.put('images/b2/640.webp', body, webp);

    await store.delete('images/a1/640.webp');
    expect(readdirSync(join(root, 'images', 'a1'))).toEqual(['1280.webp']);

    await store.delete('images/a1/1280.webp');
    expect(readdirSync(join(root, 'images'))).toEqual(['b2']);

    await store.delete('images/b2/640.webp');
    expect(existsSync(join(root, 'images'))).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it('still reads a blob opened before it was deleted', async () => {
    const store = createLocalBlobStore(newRoot());
    await store.put('images/a1/640.webp', body, webp);
    const blob = await store.get('images/a1/640.webp');
    if (!blob) throw new Error('the blob was just put');

    await store.delete('images/a1/640.webp');

    expect((await buffer(blob.body)).toString()).toBe('pretend image');
  });

  it('makes its root when first written to', async () => {
    const root = join(newRoot(), 'blobs');
    const store = createLocalBlobStore(root);

    await store.put('images/a1/640.webp', body, webp);

    expect(existsSync(join(root, 'images', 'a1', '640.webp'))).toBe(true);
  });
});
