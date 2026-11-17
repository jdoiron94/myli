import type { MultiSearchParams, MultiSearchQuery, MultiSearchResponse } from 'meilisearch';
import type { SearchClient } from './query.ts';

/**
 * Stands in for Meilisearch in tests that don't run it: answers every query as an empty index
 * would, or with `answer`, and keeps the queries it was sent. The search container tests run the
 * real thing.
 */
export function fakeSearchClient(
  answer?: (query: MultiSearchQuery) => MultiSearchResponse['results'][number],
) {
  const sent: MultiSearchQuery[][] = [];
  const client: SearchClient = {
    multiSearch({ queries }: MultiSearchParams) {
      sent.push(queries);
      return Promise.resolve({
        results: queries.map(
          (query) =>
            answer?.(query) ?? {
              indexUid: query.indexUid,
              query: query.q ?? '',
              processingTimeMs: 0,
              hits: [],
              facetDistribution: Object.fromEntries(
                (query.facets ?? []).map((facet) => [facet, {}]),
              ),
              totalHits: 0,
              hitsPerPage: query.hitsPerPage ?? 0,
              page: query.page ?? 1,
              totalPages: 0,
            },
        ),
      });
    },
  };
  return { client, sent };
}
