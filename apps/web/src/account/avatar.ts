import type { Avatar } from '@myli/shared';
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/vue-query';
import { api, responseData } from '@/api/client.ts';
import { uploadPhoto } from '@/recipes/photos.ts';

/** The reader's profile photo, or `null` for their initials. */
export const myAvatarQuery = queryOptions({
  queryKey: ['me', 'avatar'],
  queryFn: async () => responseData(await api.GET('/me/avatar')).avatar,
});

/**
 * The reader's photo is `avatar` now. Lists that show them with the one before fetch it again
 * when next shown, and until then show their initials in its place (`UserAvatar`).
 */
function changed(queryClient: QueryClient, avatar: Avatar | null) {
  queryClient.setQueryData(myAvatarQuery.queryKey, avatar);
}

/** Uploads a photo, then makes it the reader's profile photo. */
export function useSetAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const { id } = await uploadPhoto(file);
      return responseData(await api.PUT('/me/avatar', { body: { imageId: id } })).avatar;
    },
    onSuccess: (avatar) => {
      changed(queryClient, avatar);
    },
  });
}

/** Removes the reader's profile photo, leaving their initials. */
export function useRemoveAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // It answers 204 with no body; a failure has thrown already.
      await api.DELETE('/me/avatar');
    },
    onSuccess: () => {
      changed(queryClient, null);
    },
  });
}
