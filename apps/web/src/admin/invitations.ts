import { queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import type { components } from '@/api/schema.ts';

export type Invitation = components['schemas']['Invitation'];
/** A new or resent invitation, with its link when myli didn't email it. */
export type InvitationWithLink = components['schemas']['InvitationWithLink'];
export type CreateInvitationRequest = components['schemas']['CreateInvitationRequest'];

/** The open invitations, newest first, as admins see them. */
export const invitationsQuery = queryOptions({
  queryKey: ['invitations'],
  queryFn: async () => responseData(await api.GET('/invitations')).invitations,
});

/**
 * A mutation that changes the invitations, then refreshes the list, whether it worked or not: a
 * refusal, like a 404 for an invitation accepted meanwhile, usually means the list is out of date.
 * The mutation isn't done until the list is, so nothing shows a list that's behind.
 */
function useInvitationChange<TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: invitationsQuery.queryKey }),
  });
}

/** Invites someone. The answer has the link when myli doesn't email it. */
export const useCreateInvitation = () =>
  useInvitationChange(async (body: CreateInvitationRequest) =>
    responseData(await api.POST('/invitations', { body })),
  );

/** Issues a new link for an invitation, stopping the old one. */
export const useResendInvitation = () =>
  useInvitationChange(async (id: string) =>
    responseData(await api.POST('/invitations/{id}/resend', { params: { path: { id } } })),
  );

/** Stops an invitation's link. The email can be invited again. */
export const useRevokeInvitation = () =>
  useInvitationChange(async (id: string) => {
    await api.POST('/invitations/{id}/revoke', { params: { path: { id } } });
  });
