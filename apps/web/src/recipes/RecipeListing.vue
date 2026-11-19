<script setup lang="ts">
import { recipeListQuerySchema } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, useTemplateRef } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useRetry } from '@/api/retry.ts';
import PageLinks from '@/components/PageLinks.vue';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { useFocusAfterPaging } from '@/lib/paging.ts';
import RecipeCard from './RecipeCard.vue';
import { type RecipeListName, recipeListQuery } from './recipe.ts';

/**
 * A list of recipes as cards, a page at a time, the page in the address (`?page=2`): what it holds,
 * or what stopped it loading. Its `empty` slot says what to do when it holds none.
 */
const props = defineProps<{
  list: RecipeListName;
  /** The list's accessible name. */
  label: string;
  /** What the count says when the list holds none. */
  emptyText: string;
}>();

const route = useRoute();
/** The page the address asks for, or the first, if it asks for none or for one that can't be. */
const page = computed(() => recipeListQuerySchema.safeParse(route.query).data?.page ?? 1);
const query = useQuery(computed(() => recipeListQuery(props.list, page.value)));
const { failure, retrying, stillFailing, retry } = useRetry(query);

const data = computed(() => query.data.value);
const countText = computed(() => {
  if (!data.value) return '';
  const { total } = data.value;
  if (total === 0) return props.emptyText;
  return total === 1 ? '1 recipe' : `${total.toLocaleString()} recipes`;
});

const pageLink = (to: number) => ({ query: to > 1 ? { page: String(to) } : {} });

const count = useTemplateRef('count');
const { paged } = useFocusAfterPaging(() => data.value?.page, count);
</script>

<template>
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
    Loading recipes…
  </p>
  <template v-else>
    <!-- Announced once loaded. Focused after going to another page. -->
    <p
      ref="count"
      role="status"
      tabindex="-1"
      class="mt-6 w-fit rounded-md text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {{ countText }}
    </p>

    <ul
      v-if="data.recipes.length > 0"
      :aria-label="label"
      :aria-busy="query.isPlaceholderData.value || undefined"
      class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <li
        v-for="recipe in data.recipes"
        :key="recipe.id"
      >
        <RecipeCard :recipe="recipe" />
      </li>
    </ul>
    <p
      v-else-if="data.total > 0"
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
    <slot
      v-else
      name="empty"
    />

    <PageLinks
      :page="data.page"
      :total-pages="data.totalPages"
      :link="pageLink"
      @go="paged"
    />
  </template>
</template>
