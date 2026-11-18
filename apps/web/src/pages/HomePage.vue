<script setup lang="ts">
import { can, recipeListQuerySchema } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, useTemplateRef } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useRetry } from '@/api/retry.ts';
import { sessionQuery } from '@/auth/session.ts';
import PageLinks from '@/components/PageLinks.vue';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { pageNotice } from '@/lib/page-notice.ts';
import { useFocusAfterPaging } from '@/lib/paging.ts';
import RecipeCard from '@/recipes/RecipeCard.vue';
import { recipeListQuery } from '@/recipes/recipe.ts';

/**
 * Every recipe the reader may see, newest first (spec §3.4, Browsing), from the database rather
 * than search, so it works while search is unavailable. Searching has its own page.
 */

const router = useRouter();
const route = useRoute();
/** Taken once: what the page that sent someone here said happened. */
const notice = pageNotice(router);
const { data: user } = useQuery(sessionQuery);
const canCreate = computed(() => can(user.value ?? null, 'recipe.create'));

/** The page the address asks for, or the first, if it asks for none or for one that can't be. */
const page = computed(() => recipeListQuerySchema.safeParse(route.query).data?.page ?? 1);
const list = useQuery(computed(() => recipeListQuery(page.value)));
const { failure, retrying, stillFailing, retry } = useRetry(list);

const data = computed(() => list.data.value);
const countText = computed(() => {
  if (!data.value) return '';
  const { total } = data.value;
  if (total === 0) return 'No recipes yet.';
  return total === 1 ? '1 recipe' : `${total.toLocaleString()} recipes`;
});

const pageLink = (to: number) => ({ query: to > 1 ? { page: String(to) } : {} });

const count = useTemplateRef('count');
const { paged } = useFocusAfterPaging(() => data.value?.page, count);
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
      aria-label="Recipes"
      :aria-busy="list.isPlaceholderData.value || undefined"
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
    <p
      v-else-if="canCreate"
      class="mt-4 text-sm"
    >
      <RouterLink
        :to="{ name: 'new-recipe' }"
        class="font-medium underline underline-offset-4"
      >
        Write the first one
      </RouterLink>
    </p>

    <PageLinks
      :page="data.page"
      :total-pages="data.totalPages"
      :link="pageLink"
      @go="paged"
    />
  </template>
</template>
