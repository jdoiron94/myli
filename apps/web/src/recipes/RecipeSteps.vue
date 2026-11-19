<script setup lang="ts">
import MarkdownContent from '@/components/MarkdownContent.vue';
import { STEP_PHOTO_SIZES } from './photos.ts';
import RecipePhoto from './RecipePhoto.vue';
import type { Recipe } from './recipe.ts';

/** A recipe's steps, numbered, each with its photo. */
defineProps<{ steps: Recipe['steps'] }>();
</script>

<template>
  <ol
    v-if="steps.length > 0"
    class="list-decimal space-y-4 ps-6 marker:font-semibold"
  >
    <li
      v-for="(step, index) in steps"
      :key="index"
      class="ps-1"
    >
      <MarkdownContent :source="step.body" />
      <!-- Shown whole, never cropped, as it may show how something's done. On phones it takes back
           the list's indent (1.75rem), so it's as far from either side. -->
      <RecipePhoto
        v-if="step.image"
        :image="step.image"
        :sizes="STEP_PHOTO_SIZES"
        class="-ms-7 mt-3 block h-auto max-h-[32rem] w-auto max-w-[calc(100%_+_1.75rem)] rounded-md md:ms-0 md:max-w-full"
      />
    </li>
  </ol>
  <p
    v-else
    class="text-muted-foreground"
  >
    No steps yet.
  </p>
</template>
