import { useMutation } from '@tanstack/vue-query';
import { computed, ref, shallowReactive } from 'vue';
import { uploadPhoto } from './photos.ts';
import type { Image, Recipe } from './recipe.ts';

/** Every photo a recipe shows: its own, and its steps'. */
export const recipePhotos = (recipe: Recipe) => [
  ...recipe.images,
  ...recipe.steps.flatMap(({ image }) => (image ? [image] : [])),
];

/**
 * The photos a recipe's editor knows, by ID: those it opened with (the recipe's, and its draft's),
 * and those uploaded since. The form holds only their IDs, which is what the API takes; this holds
 * what showing them needs.
 */
export function usePhotoLibrary(photos: Iterable<Image> = []) {
  const known = shallowReactive(new Map<string, Image>());
  for (const image of photos) known.set(image.id, image);

  // A mutation, so the session watcher sees what the API answers, as for any other call.
  const { mutateAsync } = useMutation({ mutationFn: uploadPhoto });
  const pending = ref(0);

  return {
    get: (id: string) => known.get(id),
    /** Whether an upload is under way: saving now would leave its photo out. */
    uploading: computed(() => pending.value > 0),
    /** Uploads a photo, which the library then knows. Throws an `ApiProblem` if refused. */
    async upload(file: File): Promise<Image> {
      pending.value += 1;
      try {
        const image = await mutateAsync(file);
        known.set(image.id, image);
        return image;
      } finally {
        pending.value -= 1;
      }
    },
  };
}

export type PhotoLibrary = ReturnType<typeof usePhotoLibrary>;
