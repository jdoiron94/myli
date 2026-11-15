import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';
import { useRetry } from './retry.ts';

/** A query's state, changed by hand, and a `refetch` that ends with `answer`. */
function fakeQuery() {
  const error = ref<Error | null>(null);
  const isFetching = ref(true);
  let settle: (failure: Error | null) => void = () => undefined;
  const query = {
    error,
    isFetching,
    refetch: () => {
      // As TanStack Query does for a query with no data: back to pending, error cleared.
      error.value = null;
      isFetching.value = true;
      return new Promise<{ error: Error | null }>((resolve) => {
        settle = (failure) => {
          error.value = failure;
          isFetching.value = false;
          resolve({ error: failure });
        };
      });
    },
  };
  return {
    query,
    settle: (failure: Error | null) => {
      settle(failure);
    },
  };
}

describe('trying a query again', () => {
  it('has no failure while the query is first loading', () => {
    const { query } = fakeQuery();

    expect(useRetry(query).failure.value).toBeUndefined();
  });

  it('keeps the last failure while trying again, and drops it once that works', async () => {
    const { query, settle } = fakeQuery();
    const { failure, retrying, stillFailing, retry } = useRetry(query);
    const offline = new TypeError('Failed to fetch');
    query.error.value = offline;
    query.isFetching.value = false;
    await nextTick();
    expect(failure.value).toBe(offline);

    const trying = retry();

    expect(retrying.value).toBe(true);
    expect(failure.value).toBe(offline);
    settle(null);
    await trying;
    expect(failure.value).toBeUndefined();
    expect(stillFailing.value).toBe(false);
  });

  it('says it is still failing after a try that failed, until the next try starts', async () => {
    const { query, settle } = fakeQuery();
    const { failure, stillFailing, retry } = useRetry(query);
    query.error.value = new TypeError('Failed to fetch');
    query.isFetching.value = false;
    await nextTick();

    let trying = retry();
    const serverError = new Error('Internal Server Error');
    settle(serverError);
    await trying;

    expect(stillFailing.value).toBe(true);
    expect(failure.value).toBe(serverError);

    trying = retry();
    expect(stillFailing.value).toBe(false);
    settle(null);
    await trying;
  });
});
