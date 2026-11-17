import type { Meilisearch } from 'meilisearch';
import type { Logger } from '../logger.ts';
import type { SearchClient } from './query.ts';
import { RECIPES_INDEX } from './settings.ts';
import { isMeilisearchError } from './setup.ts';

/** What Meilisearch answers once it has lost its data: the API's key or the index is gone. */
const LOST_SETUP = ['invalid_api_key', 'index_not_found'];

/** Waits after each failed attempt: 1 s, 2 s, 4 s… up to a minute. */
export const retryDelayMs = (attempt: number) => Math.min(1_000 * 2 ** (attempt - 1), 60_000);

export interface SearchService {
  /** A client with the API's own key, once Meilisearch is set up. */
  readonly client: Meilisearch | undefined;
  /**
   * Whether search works now: Meilisearch answers the API's key, and the recipe index exists. If
   * either is gone (Meilisearch lost its data), this starts setting it up again.
   */
  isReady(): Promise<boolean>;
  /** Starts setting up Meilisearch in the background, trying until it succeeds. */
  start(): void;
  /** Stops trying: no attempt starts after this. */
  stop(): void;
}

/** What request handlers need of search: whether it works, and a client to search with. */
export type SearchAccess = Pick<SearchService, 'isReady'> & {
  readonly client: SearchClient | undefined;
};

export interface SearchServiceOptions {
  /** Prepares Meilisearch and returns a client with the API's key (`setUpSearch`). */
  setUp: () => Promise<Meilisearch>;
  logger: Logger;
  retryDelayMs?: (attempt: number) => number;
}

/**
 * Keeps Meilisearch set up for the API. The API serves requests without it (spec §4, degraded
 * mode), so setup runs in the background and retries until Meilisearch answers.
 */
export function createSearchService({
  setUp,
  logger,
  retryDelayMs: delayFor = retryDelayMs,
}: SearchServiceOptions): SearchService {
  let client: Meilisearch | undefined;
  let running = false;
  let stopped = false;

  // Never keeps the process alive. After `stop()`, the loop ends when the wait does.
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms).unref();
    });

  async function setUpUntilReady() {
    for (let attempt = 1; !stopped; attempt += 1) {
      try {
        client = await setUp();
        logger.info({ attempts: attempt }, 'search is ready');
        return;
      } catch (error) {
        const retryInMs = delayFor(attempt);
        // Once, then quietly: Meilisearch can be down for a long time, such as in development.
        if (attempt === 1) {
          logger.warn(
            { err: error, retryInMs },
            'search is unavailable, retrying in the background',
          );
        } else {
          logger.debug({ err: error, attempt, retryInMs }, 'search is still unavailable');
        }
        await pause(retryInMs);
      }
    }
  }

  function start() {
    if (running || stopped) return;
    running = true;
    void setUpUntilReady().finally(() => {
      running = false;
    });
  }

  return {
    get client() {
      return client;
    },
    async isReady() {
      if (!client) return false;
      try {
        await client.getIndex(RECIPES_INDEX);
        return true;
      } catch (error) {
        // Meilisearch answered without the key or the index: set them up again. Otherwise it's
        // unreachable or failing, and the client works again once it's back.
        if (LOST_SETUP.some((code) => isMeilisearchError(error, code))) {
          logger.warn({ err: error }, 'search lost its key or index, setting it up again');
          client = undefined;
          start();
        }
        return false;
      }
    },
    start,
    stop() {
      stopped = true;
    },
  };
}
