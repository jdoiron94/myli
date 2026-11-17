<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from '@lucide/vue';
import { can, type RecipeSearchQuery, type SearchSort } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useRetry } from '@/api/retry.ts';
import { sessionQuery } from '@/auth/session.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { pageNotice } from '@/lib/page-notice.ts';
import RecipeCard from '@/search/RecipeCard.vue';
import { narrowed, queryFromSearch, recipeSearchQuery, searchFromQuery } from '@/search/search.ts';

/**
 * Home is search (spec §3.4): every recipe the reader may see, newest first, until they search.
 * The whole search lives in the address, so it can be bookmarked, shared, and gone back to.
 */

const router = useRouter();
const route = useRoute();
/** Taken once: what the page that sent someone here said happened. */
const notice = pageNotice(router);
const { data: user } = useQuery(sessionQuery);
const canCreate = computed(() => can(user.value ?? null, 'recipe.create'));

type SortOption = keyof typeof SORT_LABELS;
const SORT_LABELS: Readonly<Record<Exclude<SearchSort, 'rating'>, string>> = {
  relevance: 'Best match',
  newest: 'Newest',
  quickest: 'Quickest',
  slowest: 'Longest',
};
/**
 * The orders offered, the API's default for the search first. Sorting by rating waits for ratings
 * (Phase 2), and the best match needs words to match.
 */
const sortsFor = (q: string | undefined): SortOption[] =>
  q ? ['relevance', 'newest', 'quickest', 'slowest'] : ['newest', 'quickest', 'slowest'];

/** The search the address describes, without an order the page doesn't offer: it shows what it asks for. */
const search = computed((): RecipeSearchQuery => {
  const { sort, ...rest } = searchFromQuery(route.query);
  return sortsFor(rest.q).some((option) => option === sort) ? { ...rest, sort } : rest;
});
const sorts = computed(() => sortsFor(search.value.q));
const sort = computed(() => search.value.sort ?? sorts.value[0]);
const results = useQuery(computed(() => recipeSearchQuery(search.value)));
const { failure, retrying, stillFailing, retry } = useRetry(results);

/** What's typed, searched for when submitted. It follows the address, as when going back. */
const text = ref('');
const ingredientsOnly = ref(false);
watch(
  search,
  (current) => {
    text.value = current.q ?? '';
    ingredientsOnly.value = current.in === 'ingredients';
  },
  { immediate: true },
);

/** Searches again with these changes. Any change but the page's starts from the first page. */
function go(changes: Partial<RecipeSearchQuery>) {
  void router.push({ query: queryFromSearch({ ...search.value, page: 1, ...changes }) });
}

function submit() {
  go({ q: text.value.trim(), in: ingredientsOnly.value ? 'ingredients' : 'all' });
}

function chooseSort(event: Event) {
  go({ sort: (event.target as HTMLSelectElement).value as SearchSort });
}

const data = computed(() => results.data.value);
const countText = computed(() => {
  if (!data.value) return '';
  const { totalHits } = data.value;
  if (totalHits === 0) return narrowed(search.value) ? 'No recipes match.' : 'No recipes yet.';
  return totalHits === 1 ? '1 recipe' : `${totalHits.toLocaleString()} recipes`;
});

const pageLink = (page: number) => ({ query: queryFromSearch({ ...search.value, page }) });

// After going to another page, focus goes to the count above its results, and the page scrolls
// there, rather than staying on a link at the bottom of what was the last page.
const count = useTemplateRef('count');
const paging = ref(false);
watch(
  () => results.isPlaceholderData.value,
  async (waiting) => {
    if (waiting || !paging.value) return;
    paging.value = false;
    await nextTick();
    count.value?.focus();
  },
);

const searchId = useId();
const onlyId = useId();
const sortId = useId();
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Recipes
  </h1>
  <p
    role="status"
    class="mt-2 text-sm"
  >
    {{ notice }}
  </p>

  <form
    role="search"
    aria-label="Recipes"
    class="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3"
    @submit.prevent="submit"
  >
    <div class="flex min-w-0 flex-[1_1_20rem] gap-2">
      <Label
        :for="searchId"
        class="sr-only"
      >
        Search recipes
      </Label>
      <Input
        :id="searchId"
        v-model="text"
        type="search"
        placeholder="Titles, ingredients, tags…"
        maxlength="200"
      />
      <Button type="submit">
        <SearchIcon aria-hidden="true" />
        Search
      </Button>
    </div>
    <Field
      orientation="horizontal"
      class="w-auto"
    >
      <Checkbox
        :id="onlyId"
        :model-value="ingredientsOnly"
        @update:model-value="
          ingredientsOnly = $event === true;
          submit();
        "
      />
      <FieldLabel
        :for="onlyId"
        class="font-normal"
      >
        Ingredient names only
      </FieldLabel>
    </Field>
  </form>

  <RetryableFailure
    v-if="failure"
    class="mt-6"
    :error="failure"
    :retrying="retrying"
    :still-failing="stillFailing"
    @retry="retry"
  />
  <p
    v-else-if="!data"
    class="mt-6 text-sm text-muted-foreground"
  >
    Searching…
  </p>
  <template v-else>
    <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
      <!-- Announced as each search finds its recipes. Focused after going to another page. -->
      <p
        ref="count"
        role="status"
        tabindex="-1"
        class="rounded-md text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {{ countText }}
      </p>
      <div
        v-if="data.totalHits > 1"
        class="flex items-center gap-2"
      >
        <Label
          :for="sortId"
          class="font-normal text-muted-foreground"
        >
          Sort by
        </Label>
        <select
          :id="sortId"
          :value="sort"
          class="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          @change="chooseSort"
        >
          <option
            v-for="option in sorts"
            :key="option"
            :value="option"
          >
            {{ SORT_LABELS[option] }}
          </option>
        </select>
      </div>
    </div>

    <ul
      v-if="data.hits.length > 0"
      aria-label="Recipes"
      :aria-busy="results.isPlaceholderData.value || undefined"
      class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <li
        v-for="hit in data.hits"
        :key="hit.id"
      >
        <RecipeCard :recipe="hit" />
      </li>
    </ul>
    <p
      v-else-if="data.totalHits > 0"
      class="mt-4 text-sm"
    >
      There are no recipes on this page.
      <RouterLink
        :to="pageLink(1)"
        class="font-medium underline underline-offset-4"
      >
        Go to the first page
      </RouterLink>
    </p>
    <p
      v-else-if="!narrowed(search) && canCreate"
      class="mt-4 text-sm"
    >
      <RouterLink
        :to="{ name: 'new-recipe' }"
        class="font-medium underline underline-offset-4"
      >
        Write the first one
      </RouterLink>
    </p>
    <p
      v-else-if="narrowed(search)"
      class="mt-4 text-sm text-muted-foreground"
    >
      Try other words, or fewer of them.
    </p>

    <nav
      v-if="data.totalPages > 1"
      aria-label="Pages"
      class="mt-8 flex items-center justify-center gap-4 text-sm"
    >
      <RouterLink
        v-if="data.page > 1"
        :to="pageLink(data.page - 1)"
        class="inline-flex h-9 items-center gap-1 rounded-md px-3 font-medium hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        @click="paging = true"
      >
        <ChevronLeftIcon
          class="size-4"
          aria-hidden="true"
        />
        Previous page
      </RouterLink>
      <span>Page {{ data.page }} of {{ data.totalPages }}</span>
      <RouterLink
        v-if="data.page < data.totalPages"
        :to="pageLink(data.page + 1)"
        class="inline-flex h-9 items-center gap-1 rounded-md px-3 font-medium hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        @click="paging = true"
      >
        Next page
        <ChevronRightIcon
          class="size-4"
          aria-hidden="true"
        />
      </RouterLink>
    </nav>
  </template>
</template>
