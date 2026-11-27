import { queryOptions, useMutation } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';

/** Whether this server emails reset links, for someone who isn't signed in. */
export const passwordResetAvailabilityQuery = queryOptions({
  queryKey: ['password-reset'],
  queryFn: async () => responseData(await api.GET('/password-reset')),
});

/** Asks for a reset link to `email`. The answer is the same whether one goes out or not. */
export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: async (email: string) => {
      // It answers 202 with no body; a failure has thrown already.
      await api.POST('/password-reset', { body: { email } });
    },
  });
}

/**
 * Sets a new password with the token from a reset link, sent in the body, never the address. Never
 * retried by itself, as every mutation: a second try after a lost answer would find the link used.
 */
export function useResetPassword() {
  return useMutation({
    mutationFn: async (body: { token: string; newPassword: string }) =>
      responseData(await api.POST('/password-reset/confirm', { body })),
  });
}
