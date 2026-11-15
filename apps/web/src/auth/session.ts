import { type User, userSchema } from '@myli/shared';
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { useRouter } from 'vue-router';
import { z } from 'zod';
import { authClient, unwrap } from './client.ts';

/** The part of Better Auth's session the app uses: the user, role included. Extra fields drop. */
const sessionSchema = z.object({ user: userSchema }).nullable();

/**
 * The signed-in user, or `null` when no one is. The router waits for it before each navigation
 * (router.ts). Signing in and out here update it. Nothing else refetches it: it's only fetched
 * again if the first try failed.
 */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async (): Promise<User | null> => {
    const session = sessionSchema.parse(await unwrap(authClient.getSession()));
    return session?.user ?? null;
  },
  staleTime: Infinity,
  // When the session couldn't be fetched, the router sends people to the unavailable page, which
  // tries again when they ask. A component showing the session doesn't try again on its own.
  retryOnMount: false,
});

export interface Credentials {
  email: string;
  password: string;
}

/** Signs in, then fetches the new session, so the app knows the user's role. */
export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: Credentials) => {
      await unwrap(authClient.signIn.email(credentials));
      return queryClient.query({ ...sessionQuery, staleTime: 0 });
    },
  });
}

/**
 * After signing out, or finding the session ended: no one is signed in any more. Goes where
 * `navigate` says, then forgets everything else fetched while signed in, only once the pages that
 * showed it are gone, so nothing the last user saw stays behind.
 */
export async function forgetSession(queryClient: QueryClient, navigate: () => Promise<unknown>) {
  queryClient.setQueryData(sessionQuery.queryKey, null);
  await navigate();
  queryClient.removeQueries({
    predicate: ({ queryKey }) => queryKey[0] !== sessionQuery.queryKey[0],
  });
}

/** Signs out, then goes to the sign-in page and forgets everything fetched while signed in. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => unwrap(authClient.signOut()),
    onSuccess: () => forgetSession(queryClient, () => router.push({ name: 'login' })),
  });
}
