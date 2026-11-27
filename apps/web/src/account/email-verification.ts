import { queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';

/** The reader's address, whether it's verified, and whether the server can send a link. */
export const emailVerificationQuery = queryOptions({
  queryKey: ['me', 'email-verification'],
  queryFn: async () => responseData(await api.GET('/me/email-verification')),
});

/** Emails the reader a link that verifies their address. */
export function useSendVerificationLink() {
  return useMutation({
    mutationFn: async () => {
      // It answers 202 with no body; a failure has thrown already.
      await api.POST('/me/email-verification');
    },
  });
}

/**
 * Verifies an address with the token from its link, sent in the body, never the address. A
 * mutation, not a query, so it isn't retried by itself: if a first try verified the address and
 * its answer was lost, a second would find the link used and say it doesn't work.
 */
export function useConfirmEmailVerification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) =>
      responseData(await api.POST('/email-verification/confirm', { body: { token } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: emailVerificationQuery.queryKey }),
  });
}
