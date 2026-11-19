<script setup lang="ts">
import { ArrowLeftIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, watchEffect } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { preferencesQuery } from '@/account/preferences.ts';
import { ApiProblem } from '@/api/problem.ts';
import { useRetry } from '@/api/retry.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { useScreenWakeLock, type WakeLockState } from '@/lib/wake-lock.ts';
import RecipeSteps from '@/recipes/RecipeSteps.vue';
import { recipeQuery } from '@/recipes/recipe.ts';
import ScaledIngredients from '@/recipes/ScaledIngredients.vue';
import { servingsQuery, useServings } from '@/recipes/servings.ts';
import { documentTitle } from '@/router.ts';

/**
 * Cook mode (spec §3.6): a recipe's ingredients, scaled, the equipment it needs, and all its steps
 * on one page, in large type, with the screen kept on while it's open.
 */
const props = defineProps<{ id: string }>();

const query = useQuery(computed(() => recipeQuery(props.id)));
// Asked for alongside the recipe, not after it, so its amounts can show as soon as it does.
useQuery(preferencesQuery);
const { failure, retrying, stillFailing, retry } = useRetry(query);
const recipe = computed(() => query.data.value);

/** The API answers 404 alike for a recipe that doesn't exist and one the reader may not see. */
const notFound = computed(
  () => failure.value instanceof ApiProblem && failure.value.status === 404,
);

// The page's one heading is there from the start, so focus can move to it after navigating.
const heading = computed(() => {
  if (recipe.value) return recipe.value.title;
  return notFound.value ? 'Recipe not found' : 'Cook mode';
});

const route = useRoute();
watchEffect(() => {
  // Only while this page is the current one: the router sets the next page's title as it leaves.
  if (route.name !== 'cook') return;
  if (recipe.value) document.title = documentTitle(`Cook mode: ${recipe.value.title}`);
  else if (notFound.value) document.title = documentTitle(heading.value);
});

const servings = useServings(
  () => props.id,
  () => recipe.value?.servings,
);
const backLink = computed(() => ({
  name: 'recipe',
  params: { id: props.id },
  query: servingsQuery(route.query),
}));

const wakeLock = useScreenWakeLock();
const WAKE_LOCK_TEXT: Record<WakeLockState, string> = {
  asking: '',
  on: 'Your screen stays on while cook mode is open.',
  unsupported: "This browser can't keep your screen on, so it may turn off while you cook.",
  refused: "Your screen couldn't be kept on, so it may turn off while you cook.",
};
</script>

<template>
  <article>
    <RouterLink
      :to="backLink"
      class="inline-flex items-center gap-1.5 rounded-md text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ArrowLeftIcon
        class="size-4"
        aria-hidden="true"
      />
      Back to recipe
    </RouterLink>
    <p class="mt-4 text-sm font-medium text-muted-foreground">
      Cook mode
    </p>
    <h1 class="text-3xl font-semibold break-words sm:text-4xl">
      {{ heading }}
    </h1>
    <!-- Always there, so screen readers announce it once the browser answers. -->
    <p
      role="status"
      class="text-sm text-muted-foreground not-empty:mt-2"
    >
      {{ WAKE_LOCK_TEXT[wakeLock] }}
    </p>

    <!-- Large type, to read from across the counter. -->
    <div
      v-if="recipe"
      class="mt-8 grid gap-x-12 gap-y-10 text-lg sm:text-xl md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
    >
      <!-- What to gather first: the ingredients, then the equipment, as on the recipe's page. -->
      <div class="space-y-10">
        <section aria-labelledby="ingredients-heading">
          <h2
            id="ingredients-heading"
            class="mb-3 text-2xl font-semibold"
          >
            Ingredients
          </h2>
          <ScaledIngredients
            v-model:servings="servings"
            :recipe="recipe"
          />
        </section>
        <section
          v-if="recipe.equipment.length > 0"
          aria-labelledby="equipment-heading"
        >
          <h2
            id="equipment-heading"
            class="mb-3 text-2xl font-semibold"
          >
            Equipment
          </h2>
          <ul class="space-y-2">
            <li
              v-for="(item, index) in recipe.equipment"
              :key="index"
            >
              {{ item }}
            </li>
          </ul>
        </section>
      </div>
      <section aria-labelledby="steps-heading">
        <h2
          id="steps-heading"
          class="mb-3 text-2xl font-semibold"
        >
          Steps
        </h2>
        <RecipeSteps :steps="recipe.steps" />
      </section>
    </div>
    <p
      v-else-if="notFound"
      class="mt-2 text-muted-foreground"
    >
      This recipe doesn't exist, was deleted, or isn't shared with you.
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
