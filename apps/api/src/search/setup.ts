import { type Key, Meilisearch, MeilisearchApiError, type Task } from 'meilisearch';
import { API_KEY, RECIPES_INDEX, RECIPES_SETTINGS } from './settings.ts';

/** How long one request to Meilisearch may take. */
const REQUEST_TIMEOUT_MS = 5_000;
/** How long to wait for Meilisearch to apply a change, such as new settings on a full index. */
const TASK_TIMEOUT_MS = 120_000;

export interface SearchConfig {
  url: string;
  masterKey: string;
}

export const isMeilisearchError = (error: unknown, code: string) =>
  error instanceof MeilisearchApiError && error.cause?.code === code;

const sameItems = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

// `Key` says expiresAt is a Date, but Meilisearch sends null for a key that never expires.
const grantsExactly = (key: Key) =>
  sameItems(key.actions, API_KEY.actions) &&
  sameItems(key.indexes, API_KEY.indexes) &&
  (key.expiresAt as Key['expiresAt'] | null) === null;

/**
 * Returns the API's key, creating it with the master key if it doesn't exist yet. A key whose
 * actions or indexes differ from `API_KEY` is replaced, since Meilisearch can't change them.
 */
export async function ensureApiKey(
  master: Pick<Meilisearch, 'getKey' | 'deleteKey' | 'createKey'>,
): Promise<string> {
  try {
    const existing = await master.getKey(API_KEY.uid);
    if (grantsExactly(existing)) return existing.key;
    await master.deleteKey(API_KEY.uid);
  } catch (error) {
    if (!isMeilisearchError(error, 'api_key_not_found')) throw error;
  }
  return (await master.createKey(API_KEY)).key;
}

function succeeded(task: Task, what: string, allowedError?: string) {
  if (task.status === 'succeeded') return;
  if (task.status === 'failed' && task.error?.code === allowedError) return;
  throw new Error(`Meilisearch could not ${what}: ${task.error?.message ?? task.status}`);
}

/**
 * Prepares Meilisearch for the API: its key, the recipe index and the index's settings. Safe to
 * run again: it changes only what differs. Returns a client with the API's key.
 */
export async function setUpSearch({ url, masterKey }: SearchConfig): Promise<Meilisearch> {
  const master = new Meilisearch({ host: url, apiKey: masterKey, timeout: REQUEST_TIMEOUT_MS });
  const apiKey = await ensureApiKey(master);
  const client = new Meilisearch({ host: url, apiKey, timeout: REQUEST_TIMEOUT_MS });
  const wait = { timeout: TASK_TIMEOUT_MS };

  const created = await client.createIndex(RECIPES_INDEX, { primaryKey: 'id' }).waitTask(wait);
  succeeded(created, `create the ${RECIPES_INDEX} index`, 'index_already_exists');

  const configured = await client
    .index(RECIPES_INDEX)
    .updateSettings(RECIPES_SETTINGS)
    .waitTask(wait);
  succeeded(configured, `apply the ${RECIPES_INDEX} index's settings`);
  return client;
}
