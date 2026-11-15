import type { Role } from '@myli/shared';
import { queryOptions } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import { useRefreshingMutation } from '@/api/refreshing-mutation.ts';
import type { components } from '@/api/schema.ts';

/** A user as admins see them, deactivated ones included. */
export type UserAccount = components['schemas']['UserAccount'];

/** Every user, oldest first. */
export const usersQuery = queryOptions({
  queryKey: ['users'],
  queryFn: async () => responseData(await api.GET('/users')).users,
});

/** Changes someone's role, from their next request. Never the admin's own. */
export const useChangeRole = () =>
  useRefreshingMutation(usersQuery.queryKey, async ({ id, role }: { id: string; role: Role }) => {
    const result = await api.PUT('/users/{id}/role', { params: { path: { id } }, body: { role } });
    return responseData(result).user;
  });

/** Ends someone's sessions and refuses their sign-ins. Their recipes stay as they are. */
export const useDeactivateUser = () =>
  useRefreshingMutation(usersQuery.queryKey, async (id: string) => {
    const result = await api.POST('/users/{id}/deactivate', { params: { path: { id } } });
    return responseData(result).user;
  });

/** Lets a deactivated user sign in again. */
export const useReactivateUser = () =>
  useRefreshingMutation(usersQuery.queryKey, async (id: string) => {
    const result = await api.POST('/users/{id}/reactivate', { params: { path: { id } } });
    return responseData(result).user;
  });
