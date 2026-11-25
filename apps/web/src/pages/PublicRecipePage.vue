<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed, provide, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { PAGE_UNIT_SYSTEM, pageUnitSystem } from '@/account/preferences.ts';
import { ApiProblem } from '@/api/problem.ts';
import { useRetry } from '@/api/retry.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { PHOTO_ADDRESS } from '@/recipes/photos.ts';
import { publicPhotoAddress, publicRecipeQuery } from '@/recipes/public-links.ts';
import RecipeBody from '@/recipes/RecipeBody.vue';
import { useServings } from '@/recipes/servings.ts';
import { documentTitle } from '@/router.ts';

/**
 * A recipe as its public link shows it, to anyone, signed in or not (spec §2): what it says, as
 * published, and nothing else. Its photos come by the link's token, and the unit system it's shown
 * in is the page's own, since someone not signed in has no preferences.
 */
const props = defineProps<{ token: string }>();

provide(PHOTO_ADDRESS, (id, width) => publicPhotoAddress(props.token)(id, width));
provide(PAGE_UNIT_SYSTEM, pageUnitSystem());

const query = useQuery(computed(() => publicRecipeQuery(props.token)));
const { failure, retrying, stillFailing, retry } = useRetry(query);
const recipe = computed(() => query.data.value);

/** The API answers 404 alike for a link that never was, a revoked one, and a recipe not shared. */
const notFound = computed(
  () => failure.value instanceof ApiProblem && failure.value.status === 404,
);
// The page's one heading is there from the start, so focus can move to it after navigating.
const heading = computed(() => {
  if (recipe.value) return recipe.value.title;
  return notFound.value ? 'Link not found' : 'Recipe';
});

const route = useRoute();
watchEffect(() => {
  // Only while this page is the current one: the router sets the next page's title as it leaves.
  if (route.name === 'public-recipe' && (recipe.value || notFound.value)) {
    document.title = documentTitle(heading.value);
  }
});

const servings = useServings(
  () => props.token,
  () => recipe.value?.servings,
);
</script>

<template>
  <article>
    <h1 class="text-3xl font-semibold break-words">
      {{ heading }}
    </h1>

    <RecipeBody
      v-if="recipe"
      v-model:servings="servings"
      :content="recipe"
    />
    <p
      v-else-if="notFound"
      class="mt-2 text-muted-foreground"
    >
      This link doesn't work. It may have been revoked, or the recipe may no longer be shared.
    </p>
    <RetryableFailure
      v-else-if="failure"
      class="mt-4"
      :error="failure"
      :retrying="retrying"
      :still-failing="stillFailing"
      @retry="retry"
    />
    <p
      v-else
      class="mt-2 text-muted-foreground"
    >
      Loading the recipe…
    </p>
  </article>
</template>
