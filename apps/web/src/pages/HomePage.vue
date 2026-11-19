<script setup lang="ts">
import { can } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { sessionQuery } from '@/auth/session.ts';
import { pageNotice } from '@/lib/page-notice.ts';
import RecipeListing from '@/recipes/RecipeListing.vue';

/**
 * Every recipe the reader may see, newest first (spec §3.4, Browsing), from the database rather
 * than search, so it works while search is unavailable. Searching has its own page.
 */

const router = useRouter();
/** Taken once: what the page that sent someone here said happened. */
const notice = pageNotice(router);
const { data: user } = useQuery(sessionQuery);
const canCreate = computed(() => can(user.value ?? null, 'recipe.create'));
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

  <RecipeListing
    list="all"
    label="Recipes"
    empty-text="No recipes yet."
  >
    <template #empty>
      <p
        v-if="canCreate"
        class="mt-4 text-sm"
      >
        <RouterLink
          :to="{ name: 'new-recipe' }"
          class="font-medium underline underline-offset-4"
        >
          Write the first one
        </RouterLink>
      </p>
    </template>
  </RecipeListing>
</template>
