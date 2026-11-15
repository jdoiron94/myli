import { Meilisearch, MeilisearchApiError, MeilisearchRequestError } from 'meilisearch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../logger.ts';
import { createSearchService, retryDelayMs } from './service.ts';
import { RECIPES_INDEX } from './settings.ts';

const apiError = (status: number, code: string) =>
  new MeilisearchApiError(new Response(null, { status }), {
    message: `Meilisearch says ${code}`,
    code,
    type: 'invalid_request',
    link: '',
  });

const unreachable = () =>
  new MeilisearchRequestError('http://meilisearch.test/keys', new TypeError('fetch failed'));

/** A client whose `getIndex`, the readiness check, answers as told. Nothing reaches a network. */
function fakeClient() {
  const client = new Meilisearch({ host: 'http://meilisearch.test', apiKey: 'api-key' });
  const getIndex = vi.spyOn(client, 'getIndex').mockResolvedValue(client.index(RECIPES_INDEX));
  return { client, getIndex };
}

function serviceWith(setUp: () => Promise<Meilisearch>) {
  const logs: Record<string, unknown>[] = [];
  const logger = createLogger('debug', {
    write(line: string) {
      logs.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  const service = createSearchService({ setUp, logger });
  return { service, logs, messages: () => logs.map((line) => line.msg) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('retryDelayMs', () => {
  it('doubles from a second after each failure, up to a minute', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 100].map(retryDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ]);
  });
});

describe('createSearchService', () => {
  it('is not ready and has no client until setup succeeds', async () => {
    const { client, getIndex } = fakeClient();
    const setUp = vi.fn(() => Promise.resolve(client));
    const { service, logs } = serviceWith(setUp);

    expect(service.client).toBeUndefined();
    expect(await service.isReady()).toBe(false);
    expect(setUp).not.toHaveBeenCalled();

    service.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(setUp).toHaveBeenCalledOnce();
    expect(service.client).toBe(client);
    expect(await service.isReady()).toBe(true);
    expect(getIndex).toHaveBeenCalledWith(RECIPES_INDEX);
    expect(logs).toEqual([
      expect.objectContaining({ level: 30, msg: 'search is ready', attempts: 1 }),
    ]);
  });

  it('retries with backoff until Meilisearch answers, warning only the first time', async () => {
    const { client } = fakeClient();
    const setUp = vi
      .fn<() => Promise<Meilisearch>>()
      .mockRejectedValueOnce(unreachable())
      .mockRejectedValueOnce(unreachable())
      .mockResolvedValue(client);
    const { service, logs, messages } = serviceWith(setUp);

    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(setUp).toHaveBeenCalledTimes(1);
    expect(await service.isReady()).toBe(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(setUp).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(setUp).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(setUp).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(setUp).toHaveBeenCalledTimes(3);
    expect(await service.isReady()).toBe(true);

    expect(messages()).toEqual([
      'search is unavailable, retrying in the background',
      'search is still unavailable',
      'search is ready',
    ]);
    expect(logs[0]).toMatchObject({
      level: 40,
      retryInMs: 1_000,
      // pino's `type` is the minified class name; `name` is the real one.
      err: {
        name: 'MeilisearchRequestError',
        message: expect.stringContaining('fetch failed') as unknown,
      },
    });
    expect(logs[1]).toMatchObject({ level: 20, attempt: 2, retryInMs: 2_000 });
    expect(logs[2]).toMatchObject({ level: 30, attempts: 3 });
  });

  it('runs one setup at a time, however often it is started', async () => {
    const { client } = fakeClient();
    const setUp = vi.fn(() => Promise.resolve(client));
    const { service } = serviceWith(setUp);

    service.start();
    service.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(setUp).toHaveBeenCalledOnce();
  });

  it('stops retrying when stopped while waiting to retry', async () => {
    const setUp = vi.fn(() => Promise.reject(unreachable()));
    const { service } = serviceWith(setUp);

    service.start();
    await vi.advanceTimersByTimeAsync(0);
    service.stop();
    await vi.advanceTimersByTimeAsync(300_000);
    service.start();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(setUp).toHaveBeenCalledOnce();
  });

  it.each([
    ["the API's key is gone", apiError(403, 'invalid_api_key')],
    ['the index is gone', apiError(404, 'index_not_found')],
  ])('sets up again when %s, as after Meilisearch lost its data', async (_, lost) => {
    const { client, getIndex } = fakeClient();
    const { promise: setUpAgain, resolve: finishSetUpAgain } = Promise.withResolvers<Meilisearch>();
    const setUp = vi
      .fn<() => Promise<Meilisearch>>()
      .mockResolvedValueOnce(client)
      .mockReturnValueOnce(setUpAgain);
    const { service, logs, messages } = serviceWith(setUp);
    service.start();
    await vi.advanceTimersByTimeAsync(0);

    getIndex.mockRejectedValueOnce(lost);
    expect(await service.isReady()).toBe(false);
    expect(setUp).toHaveBeenCalledTimes(2);

    // Not ready, and no client to use, until the new setup is done.
    expect(service.client).toBeUndefined();
    expect(await service.isReady()).toBe(false);
    finishSetUpAgain(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(service.client).toBe(client);
    expect(await service.isReady()).toBe(true);
    expect(messages()).toEqual([
      'search is ready',
      'search lost its key or index, setting it up again',
      'search is ready',
    ]);
    expect(logs[1]).toMatchObject({ level: 40 });
  });

  it.each([
    ['unreachable', unreachable()],
    ['failing', apiError(502, 'bad_gateway')],
  ])(
    'keeps its client while Meilisearch is %s, and is ready once it is back',
    async (_, failure) => {
      const { client, getIndex } = fakeClient();
      const setUp = vi.fn(() => Promise.resolve(client));
      const { service, messages } = serviceWith(setUp);
      service.start();
      await vi.advanceTimersByTimeAsync(0);

      getIndex.mockRejectedValueOnce(failure);
      expect(await service.isReady()).toBe(false);
      await vi.advanceTimersByTimeAsync(0);

      expect(service.client).toBe(client);
      expect(await service.isReady()).toBe(true);
      expect(setUp).toHaveBeenCalledOnce();
      expect(messages()).toEqual(['search is ready']);
    },
  );
});
