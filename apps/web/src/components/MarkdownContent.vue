<script setup lang="ts">
import { computed } from 'vue';
import { type MarkdownOptions, renderMarkdown } from '@/lib/markdown.ts';

/** Markdown someone wrote, rendered and sanitized (`renderMarkdown`). */
const props = withDefaults(
  defineProps<{
    source: string;
    /** The level a `#` heading becomes: one below the heading of the section it's shown in. */
    headingLevel?: MarkdownOptions['headingLevel'];
  }>(),
  { headingLevel: 3 },
);

const html = computed(() => renderMarkdown(props.source, { headingLevel: props.headingLevel }));
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- renderMarkdown sanitizes it with DOMPurify. -->
  <div
    class="markdown"
    v-html="html"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>
