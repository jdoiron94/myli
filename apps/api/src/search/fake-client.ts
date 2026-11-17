import type {
  MultiSearchParams,
  MultiSearchQuery,
  MultiSearchResponse,
  SearchForFacetValuesParams,
  SearchForFacetValuesResponse,
} from 'meilisearch';
import type { SearchClient } from './query.ts';

/**
 * Stands in for Meilisearch in tests that don't run it: answers every query as an empty index
 * would, or as `answers` says, and keeps what it was asked. The search container tests run the real
 * thing.
 */
export function fakeSearchClient(
  answers: {
    search?: (query: MultiSearchQuery) => MultiSearchResponse['results'][number];
    facetSearch?: (params: SearchForFacetValuesParams) => SearchForFacetValuesResponse['facetHits'];
  } = {},
) {
  const sent: MultiSearchQuery[][] = [];
  const facetSearches: SearchForFacetValuesParams[] = [];
  const client: SearchClient = {
    multiSearch({ queries }: MultiSearchParams) {
      sent.push(queries);
      return Promise.resolve({
        results: queries.map(
          (query) =>
            answers.search?.(query) ?? {
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
    index: () => ({
      searchForFacetValues(params) {
        facetSearches.push(params);
        return Promise.resolve({
          facetHits: answers.facetSearch?.(params) ?? [],
          facetQuery: params.facetQuery ?? null,
          processingTimeMs: 0,
        });
      },
    }),
  };
  return { client, sent, facetSearches };
}
