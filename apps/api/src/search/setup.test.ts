import { type Key, type KeyCreation, MeilisearchApiError } from 'meilisearch';
import { describe, expect, it, vi } from 'vitest';
import { API_KEY } from './settings.ts';
import { ensureApiKey } from './setup.ts';

const apiError = (status: number, code: string) =>
  new MeilisearchApiError(new Response(null, { status }), {
    message: `Meilisearch says ${code}`,
    code,
    type: 'invalid_request',
    link: '',
  });

/** The key as Meilisearch returns it, with `fields` changed. */
function storedKey(fields: Record<string, unknown> = {}) {
  return {
    uid: API_KEY.uid,
    key: 'existing-api-key',
    name: API_KEY.name,
    description: API_KEY.description,
    actions: [...API_KEY.actions],
    indexes: [...API_KEY.indexes],
    expiresAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...fields,
  } as unknown as Key; // `Key` says expiresAt is a Date, but Meilisearch sends null or a string.
}

/** The master key's client: holds at most the API's key, and records changes. */
function fakeMaster(existing: Key | undefined, getKeyError?: Error) {
  return {
    getKey: vi.fn((uid: string) => {
      if (getKeyError) return Promise.reject(getKeyError);
      if (existing?.uid === uid) return Promise.resolve(existing);
      return Promise.reject(apiError(404, 'api_key_not_found'));
    }),
    deleteKey: vi.fn(() => Promise.resolve()),
    createKey: vi.fn((options: KeyCreation) =>
      Promise.resolve(storedKey({ ...options, key: 'new-api-key' })),
    ),
  };
}

describe('ensureApiKey', () => {
  it('creates the key when it does not exist', async () => {
    const master = fakeMaster(undefined);

    expect(await ensureApiKey(master)).toBe('new-api-key');
    expect(master.getKey).toHaveBeenCalledWith(API_KEY.uid);
    expect(master.deleteKey).not.toHaveBeenCalled();
    expect(master.createKey).toHaveBeenCalledExactlyOnceWith(API_KEY);
  });

  it('returns the existing key when it grants exactly what the API needs', async () => {
    const master = fakeMaster(
      storedKey({ actions: [...API_KEY.actions].reverse(), indexes: [...API_KEY.indexes] }),
    );

    expect(await ensureApiKey(master)).toBe('existing-api-key');
    expect(master.deleteKey).not.toHaveBeenCalled();
    expect(master.createKey).not.toHaveBeenCalled();
  });

  it('replaces a key that grants anything else, since Meilisearch cannot change one', async () => {
    for (const [, grants] of [
      ['has an action fewer', { actions: API_KEY.actions.slice(1) }],
      ['has an action more', { actions: [...API_KEY.actions, 'keys.get'] }],
      ['has a different action', { actions: [...API_KEY.actions.slice(1), 'keys.get'] }],
      ['reaches other indexes', { indexes: ['*'] }],
      ['reaches another index as well', { indexes: [...API_KEY.indexes, 'users'] }],
      ['expires', { expiresAt: '2099-01-01T00:00:00Z' }],
    ] as const) {
      const master = fakeMaster(storedKey(grants));

      expect(await ensureApiKey(master)).toBe('new-api-key');
      expect(master.deleteKey).toHaveBeenCalledExactlyOnceWith(API_KEY.uid);
      expect(master.createKey).toHaveBeenCalledExactlyOnceWith(API_KEY);
      expect(master.deleteKey.mock.invocationCallOrder[0]).toBeLessThan(
        master.createKey.mock.invocationCallOrder[0] ?? 0,
      );
    }
  });

  it('fails without creating anything when Meilisearch refuses the master key', async () => {
    const master = fakeMaster(undefined, apiError(403, 'invalid_api_key'));

    await expect(ensureApiKey(master)).rejects.toThrow('Meilisearch says invalid_api_key');
    expect(master.deleteKey).not.toHaveBeenCalled();
    expect(master.createKey).not.toHaveBeenCalled();
  });
});
