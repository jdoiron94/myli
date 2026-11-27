import { useMutation } from '@tanstack/vue-query';
import { authClient, unwrap } from '@/auth/client.ts';

/**
 * Changes the reader's password, through Better Auth's route. It signs out their other sessions
 * (spec §3.1), which the API makes sure of whatever this asks.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (passwords: { currentPassword: string; newPassword: string }) =>
      unwrap(authClient.changePassword({ ...passwords, revokeOtherSessions: true })),
  });
}
