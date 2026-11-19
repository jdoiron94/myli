import { computed, type Ref, ref, shallowRef, watch } from 'vue';

/** The parts of a TanStack query that `useRetry` uses. */
interface RetryableQuery {
  error: Readonly<Ref<Error | null>>;
  isFetching: Readonly<Ref<boolean>>;
  refetch: () => Promise<{ error: Error | null }>;
}

/**
 * Queries a page needs together, as one for `useRetry`: failed while any of them is, and tried again
 * together, each that failed.
 */
export function allOf(...queries: RetryableQuery[]): RetryableQuery {
  return {
    error: computed(() => queries.find(({ error }) => error.value)?.error.value ?? null),
    isFetching: computed(() => queries.some(({ isFetching }) => isFetching.value)),
    refetch: async () => {
      const failed = queries.filter(({ error }) => error.value);
      const results = await Promise.all(failed.map((query) => query.refetch()));
      return { error: results.find(({ error }) => error)?.error ?? null };
    },
  };
}

/**
 * Tries a failed query again when asked, for a page that shows the failure with a Try again button
 * (`RetryableFailure`). Tried again before it has any data, a query goes back to pending and loses
 * its error until the new answer. `failure` keeps the last one meanwhile, so the page goes on showing
 * it, and the button they pressed, instead of jumping back to its loading state.
 */
export function useRetry(query: RetryableQuery) {
  const lastFailure = shallowRef<Error>();
  watch(query.error, (error) => {
    if (error) lastFailure.value = error;
  });

  /** The query's error, or while it's being tried again, the last one. */
  const failure = computed(
    () => query.error.value ?? (query.isFetching.value ? lastFailure.value : undefined),
  );

  /** The last try failed too, so the message alone wouldn't show that anything happened. */
  const stillFailing = ref(false);

  async function retry() {
    stillFailing.value = false;
    const { error } = await query.refetch();
    stillFailing.value = error !== null;
  }

  return { failure, retrying: query.isFetching, stillFailing, retry };
}
