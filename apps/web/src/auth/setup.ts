import type { SetupRequest } from '@myli/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';

/**
 * Whether first-run setup is still needed: no user exists yet. The router asks only when no one is
 * signed in (router.ts). Once it's `false` it never changes, so it isn't asked again. While it's
 * `true`, each navigation asks again, in case someone else has finished setup meanwhile.
 */
export const setupStatusQuery = queryOptions({
  queryKey: ['setup'],
  queryFn: async () => responseData(await api.GET('/setup')).needed,
  staleTime: ({ state }) => (state.data === false ? Infinity : 0),
});

/** Creates the first admin. It doesn't sign them in (spec §3.1). */
export function useCompleteSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: SetupRequest) => responseData(await api.POST('/setup', { body })),
    onSuccess: () => {
      queryClient.setQueryData(setupStatusQuery.queryKey, false);
    },
  });
}
