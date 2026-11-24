<script setup lang="ts">
import { LockIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { preferencesQuery } from '@/account/preferences.ts';
import { ApiProblem } from '@/api/problem.ts';
import { useRetry } from '@/api/retry.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import RecipeActions from '@/recipes/RecipeActions.vue';
import RecipeBody from '@/recipes/RecipeBody.vue';
import RecipeComments from '@/recipes/RecipeComments.vue';
import RecipeNote from '@/recipes/RecipeNote.vue';
import RecipeRating from '@/recipes/RecipeRating.vue';
import { recipeQuery } from '@/recipes/recipe.ts';
import { useServings } from '@/recipes/servings.ts';
import { documentTitle } from '@/router.ts';

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

// The page's one heading is there from the start, so focus can move to it after navigating (the
// layout does that), and changes from a placeholder to the recipe's title.
const heading = computed(() => {
  if (recipe.value) return recipe.value.title;
  return notFound.value ? 'Recipe not found' : 'Recipe';
});

const route = useRoute();
watchEffect(() => {
  // Only while this page is the current one: the router sets the next page's title as it leaves.
  if (route.name === 'recipe' && (recipe.value || notFound.value)) {
    document.title = documentTitle(heading.value);
  }
});

// Scaling changes only what's shown (spec §3.2), and goes with the reader to cook mode and back.
const servings = useServings(
  () => props.id,
  () => recipe.value?.servings,
);

const updatedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
</script>

<template>
  <article>
    <!-- The actions sit beside the title while there's room, and go below it when there isn't. -->
    <div class="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
      <div class="min-w-0 flex-[1_1_20rem]">
        <h1 class="text-3xl font-semibold break-words">
          {{ heading }}
        </h1>
        <p
          v-if="recipe"
          class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
        >
          <span>Added by {{ recipe.owner.name }}</span>
          <span aria-hidden="true">·</span>
          <span>Updated {{ updatedFormat.format(new Date(recipe.updatedAt)) }}</span>
          <span aria-hidden="true">·</span>
          <span>Revision {{ recipe.revision }}</span>
          <template v-if="recipe.visibility === 'private'">
            <span aria-hidden="true">·</span>
            <span class="inline-flex items-center gap-1">
              <LockIcon
                class="size-3.5"
                aria-hidden="true"
              />
              Private
            </span>
          </template>
        </p>
        <RecipeRating
          v-if="recipe"
          :recipe="recipe"
        />
      </div>
      <RecipeActions
        v-if="recipe"
        :recipe="recipe"
      />
    </div>

    <template v-if="recipe">
      <RecipeBody
        v-model:servings="servings"
        :content="recipe"
      />
      <RecipeNote :recipe="recipe" />
      <RecipeComments :recipe="recipe" />
    </template>

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
