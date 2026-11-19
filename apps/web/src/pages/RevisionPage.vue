<script setup lang="ts">
import { ArrowLeftIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, watchEffect } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { preferencesQuery } from '@/account/preferences.ts';
import { ApiProblem } from '@/api/problem.ts';
import { allOf, useRetry } from '@/api/retry.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import RecipeBody from '@/recipes/RecipeBody.vue';
import { recipeQuery, recipeRevisionQuery } from '@/recipes/recipe.ts';
import { useServings } from '@/recipes/servings.ts';
import { documentTitle } from '@/router.ts';

/**
 * One revision of a recipe (spec §3.3): the recipe as it was then, its tags with the names they had
 * and its photos with the alt text they had, for anyone who may read it.
 */
const props = defineProps<{ id: string; number: number }>();

const revisionResult = useQuery(computed(() => recipeRevisionQuery(props.id, props.number)));
// The recipe says which revision is published now.
const recipeResult = useQuery(computed(() => recipeQuery(props.id)));
// Asked for alongside the revision, not after it, so its amounts can show as soon as it does.
useQuery(preferencesQuery);
const { failure, retrying, stillFailing, retry } = useRetry(allOf(revisionResult, recipeResult));
const revision = computed(() => revisionResult.data.value);
const recipe = computed(() => recipeResult.data.value);

/** The API answers 404 alike for a revision that doesn't exist and a recipe the reader may not see. */
const notFound = computed(
  () => failure.value instanceof ApiProblem && failure.value.status === 404,
);

// The page's one heading is there from the start, so focus can move to it after navigating.
const heading = computed(() => {
  if (revision.value) return revision.value.content.title;
  return notFound.value ? 'Revision not found' : 'Revision';
});

const route = useRoute();
watchEffect(() => {
  // Only while this page is the current one: the router sets the next page's title as it leaves.
  if (route.name !== 'recipe-revision') return;
  if (revision.value) {
    document.title = documentTitle(`Revision ${String(props.number)}: ${heading.value}`);
  } else if (notFound.value) document.title = documentTitle(heading.value);
});

const servings = useServings(
  () => `${props.id}/${String(props.number)}`,
  () => revision.value?.content.servings,
);

const savedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<template>
  <article>
    <RouterLink
      :to="{ name: 'recipe-history', params: { id } }"
      class="inline-flex items-center gap-1.5 rounded-md text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ArrowLeftIcon
        class="size-4"
        aria-hidden="true"
      />
      Back to history
    </RouterLink>
    <p class="mt-4 text-sm font-medium text-muted-foreground">
      Revision {{ number }}
    </p>
    <h1 class="text-3xl font-semibold break-words">
      {{ heading }}
    </h1>

    <template v-if="revision && recipe">
      <div class="mt-4 max-w-prose space-y-1 rounded-md border px-4 py-3 text-sm">
        <p>
          {{ revision.author.name }} saved this revision on
          <time :datetime="revision.createdAt">{{
            savedFormat.format(new Date(revision.createdAt))
          }}</time>.
        </p>
        <p
          v-if="revision.message"
          class="break-words"
        >
          What changed: {{ revision.message }}
        </p>
        <p v-if="revision.number === recipe.revision">
          It’s the one published.
        </p>
        <p v-else>
          The recipe was published again since, and is at revision {{ recipe.revision }} now.
          <RouterLink
            :to="{ name: 'recipe', params: { id } }"
            class="underline underline-offset-2"
          >
            See it as published
          </RouterLink>
        </p>
      </div>

      <RecipeBody
        v-model:servings="servings"
        :content="revision.content"
      />
    </template>

    <p
      v-else-if="notFound"
      class="mt-2 text-muted-foreground"
    >
      This revision doesn't exist, or its recipe was deleted or isn't shared with you.
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
      Loading the revision…
    </p>
  </article>
</template>
