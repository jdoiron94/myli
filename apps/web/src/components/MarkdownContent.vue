<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '@/lib/markdown.ts';

/** Markdown someone wrote, rendered and sanitized (`renderMarkdown`). */
const props = defineProps<{ source: string }>();

const html = computed(() => renderMarkdown(props.source));
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- renderMarkdown sanitizes it with DOMPurify. -->
  <div
    class="markdown"
    v-html="html"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>
