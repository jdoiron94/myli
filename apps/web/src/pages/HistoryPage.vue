<script setup lang="ts">
import { ArrowLeftIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, useId, watchEffect } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ApiProblem } from '@/api/problem.ts';
import { allOf, useRetry } from '@/api/retry.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import UserAvatar from '@/components/UserAvatar.vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { recipeQuery, recipeRevisionsQuery } from '@/recipes/recipe.ts';
import { documentTitle } from '@/router.ts';

/** A recipe's history (spec §3.3): every revision, newest first, for anyone who may read it. */
const props = defineProps<{ id: string }>();

const recipeResult = useQuery(computed(() => recipeQuery(props.id)));
const revisionsResult = useQuery(computed(() => recipeRevisionsQuery(props.id)));
const { failure, retrying, stillFailing, retry } = useRetry(allOf(recipeResult, revisionsResult));
const recipe = computed(() => recipeResult.data.value);
const revisions = computed(() => revisionsResult.data.value);

/** The API answers 404 alike for a recipe that doesn't exist and one the reader may not see. */
const notFound = computed(
  () => failure.value instanceof ApiProblem && failure.value.status === 404,
);

// The page's one heading is there from the start, so focus can move to it after navigating.
const heading = computed(() => {
  if (recipe.value) return recipe.value.title;
  return notFound.value ? 'Recipe not found' : 'History';
});

const route = useRoute();
watchEffect(() => {
  // Only while this page is the current one: the router sets the next page's title as it leaves.
  if (route.name !== 'recipe-history') return;
  if (recipe.value) document.title = documentTitle(`History: ${recipe.value.title}`);
  else if (notFound.value) document.title = documentTitle(heading.value);
});

const savedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Any two revisions can be compared: at first, the one published and the one before it.
const chosenFrom = ref<number>();
const chosenTo = ref<number>();
const compareFrom = computed({
  get: () => chosenFrom.value ?? revisions.value?.[1]?.number,
  set: (number) => (chosenFrom.value = number),
});
const compareTo = computed({
  get: () => chosenTo.value ?? revisions.value?.[0]?.number,
  set: (number) => (chosenTo.value = number),
});
const fromId = useId();
const toId = useId();
const router = useRouter();
/** Compares them the earlier first, whichever way round they were chosen. */
function compare() {
  if (compareFrom.value === undefined || compareTo.value === undefined) return;
  const [from, to] = [compareFrom.value, compareTo.value].sort((a, b) => a - b);
  void router.push({ name: 'compare-revisions', params: { id: props.id, from, to } });
}
const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';
</script>

<template>
  <article>
    <RouterLink
      :to="{ name: 'recipe', params: { id } }"
      class="inline-flex items-center gap-1.5 rounded-md text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ArrowLeftIcon
        class="size-4"
        aria-hidden="true"
      />
      Back to recipe
    </RouterLink>
    <p class="mt-4 text-sm font-medium text-muted-foreground">
      History
    </p>
    <h1 class="text-3xl font-semibold break-words">
      {{ heading }}
    </h1>

    <form
      v-if="recipe && revisions && revisions.length > 1"
      aria-label="Compare two revisions"
      class="mt-6 flex flex-wrap items-end gap-3"
      @submit.prevent="compare"
    >
      <div class="grid gap-1.5">
        <Label :for="fromId">Compare revision</Label>
        <select
          :id="fromId"
          v-model.number="compareFrom"
          :class="SELECT_CLASS"
        >
          <option
            v-for="revision in revisions"
            :key="revision.number"
            :value="revision.number"
          >
            Revision {{ revision.number }}
          </option>
        </select>
      </div>
      <div class="grid gap-1.5">
        <Label :for="toId">With revision</Label>
        <select
          :id="toId"
          v-model.number="compareTo"
          :class="SELECT_CLASS"
        >
          <option
            v-for="revision in revisions"
            :key="revision.number"
            :value="revision.number"
          >
            Revision {{ revision.number }}
          </option>
        </select>
      </div>
      <Button
        type="submit"
        variant="outline"
      >
        Compare
      </Button>
    </form>

    <ol
      v-if="recipe && revisions"
      aria-label="Revisions"
      class="mt-6 max-w-prose divide-y border-y"
    >
      <li
        v-for="(revision, index) in revisions"
        :key="revision.number"
        class="space-y-1 py-4"
      >
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <RouterLink
            :to="{ name: 'recipe-revision', params: { id, number: revision.number } }"
            class="font-medium underline underline-offset-2"
          >
            Revision {{ revision.number }}
          </RouterLink>
          <span
            v-if="index === 0"
            class="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground"
          >
            Published
          </span>
        </p>
        <p
          v-if="revision.message"
          class="break-words"
        >
          {{ revision.message }}
        </p>
        <p
          v-if="revision.number > 1"
          class="text-sm"
        >
          <RouterLink
            :to="{
              name: 'compare-revisions',
              params: { id, from: revision.number - 1, to: revision.number },
            }"
            class="underline underline-offset-2"
          >
            Compare with revision {{ revision.number - 1 }}
          </RouterLink>
        </p>
        <p class="flex items-center gap-2 text-sm text-muted-foreground">
          <UserAvatar :person="revision.author" />
          <span>
            {{ revision.author.name }},
            <time :datetime="revision.createdAt">{{
              savedFormat.format(new Date(revision.createdAt))
            }}</time>
          </span>
        </p>
      </li>
    </ol>

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
      Loading the history…
    </p>
  </article>
</template>
