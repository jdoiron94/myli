import type { AcceptInvitationRequest } from '@myli/shared';
import { queryOptions, useMutation } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';

/**
 * What the invitation behind `token` is for, if its link still works. The token goes in the request
 * body, never the address. Forgotten as soon as the page stops showing it.
 */
export const invitationQuery = (token: string) =>
  queryOptions({
    queryKey: ['invitation', token],
    queryFn: async () => responseData(await api.POST('/invitations/lookup', { body: { token } })),
    staleTime: Infinity,
    gcTime: 0,
  });

/** Creates the invited account. It doesn't sign them in (spec §3.1). */
export function useAcceptInvitation() {
  return useMutation({
    mutationFn: async (body: AcceptInvitationRequest) =>
      responseData(await api.POST('/invitations/accept', { body })),
  });
}
