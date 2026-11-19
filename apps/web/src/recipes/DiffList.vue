<script setup lang="ts" generic="T">
import type { ListEntry } from '@myli/shared';

/**
 * A list compared between two versions: every entry in order, each added, removed or changed marked
 * so in words, and those alike in both muted. The `item` slot shows an entry; `changed`, one that
 * changed.
 */
defineProps<{ entries: ListEntry<T>[]; label: string }>();
defineSlots<{
  item: (props: { item: T }) => unknown;
  changed: (props: { before: T; after: T }) => unknown;
}>();

const MARKS = {
  added: { text: 'Added', class: 'bg-added text-added-foreground' },
  removed: { text: 'Removed', class: 'bg-removed text-removed-foreground' },
  changed: { text: 'Changed', class: 'bg-secondary text-secondary-foreground' },
} as const;
</script>

<template>
  <ul
    :aria-label="label"
    class="max-w-prose divide-y border-y"
  >
    <li
      v-for="(entry, index) in entries"
      :key="index"
      class="flex items-start gap-3 py-2"
      :class="{ 'text-muted-foreground': entry.change === 'same' }"
    >
      <span
        v-if="entry.change !== 'same'"
        class="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
        :class="MARKS[entry.change].class"
      >
        {{ MARKS[entry.change].text }}
      </span>
      <div class="min-w-0">
        <slot
          v-if="entry.change === 'changed'"
          name="changed"
          :before="entry.before"
          :after="entry.after"
        />
        <slot
          v-else
          name="item"
          :item="entry.item"
        />
      </div>
    </li>
  </ul>
</template>
