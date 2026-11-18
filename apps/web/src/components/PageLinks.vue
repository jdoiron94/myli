<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
import { type RouteLocationRaw, RouterLink } from 'vue-router';

/** Links to the pages before and after this one, of a list in more than one. */
defineProps<{ page: number; totalPages: number; link: (page: number) => RouteLocationRaw }>();
defineEmits<{ go: [] }>();
</script>

<template>
  <nav
    v-if="totalPages > 1"
    aria-label="Pages"
    class="mt-8 flex items-center justify-center gap-4 text-sm"
  >
    <RouterLink
      v-if="page > 1"
      :to="link(page - 1)"
      class="inline-flex h-9 items-center gap-1 rounded-md px-3 font-medium hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      @click="$emit('go')"
    >
      <ChevronLeftIcon
        class="size-4"
        aria-hidden="true"
      />
      Previous page
    </RouterLink>
    <span>Page {{ page }} of {{ totalPages }}</span>
    <RouterLink
      v-if="page < totalPages"
      :to="link(page + 1)"
      class="inline-flex h-9 items-center gap-1 rounded-md px-3 font-medium hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      @click="$emit('go')"
    >
      Next page
      <ChevronRightIcon
        class="size-4"
        aria-hidden="true"
      />
    </RouterLink>
  </nav>
</template>
