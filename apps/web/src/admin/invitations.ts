import { queryOptions } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import { useRefreshingMutation } from '@/api/refreshing-mutation.ts';
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

/** Invites someone. The answer has the link when myli doesn't email it. */
export const useCreateInvitation = () =>
  useRefreshingMutation(invitationsQuery.queryKey, async (body: CreateInvitationRequest) =>
    responseData(await api.POST('/invitations', { body })),
  );

/** Issues a new link for an invitation, stopping the old one. */
export const useResendInvitation = () =>
  useRefreshingMutation(invitationsQuery.queryKey, async (id: string) =>
    responseData(await api.POST('/invitations/{id}/resend', { params: { path: { id } } })),
  );

/** Stops an invitation's link. The email can be invited again. */
export const useRevokeInvitation = () =>
  useRefreshingMutation(invitationsQuery.queryKey, async (id: string) => {
    await api.POST('/invitations/{id}/revoke', { params: { path: { id } } });
  });
