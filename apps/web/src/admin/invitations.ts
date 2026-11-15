import { queryOptions } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';

/** The open invitations, newest first, as admins see them. */
export const invitationsQuery = queryOptions({
  queryKey: ['invitations'],
  queryFn: async () => responseData(await api.GET('/invitations')).invitations,
});
