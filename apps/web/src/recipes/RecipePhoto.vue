<script setup lang="ts">
import { computed } from 'vue';
import { imageSources } from './photos.ts';
import type { Image } from './recipe.ts';

const props = defineProps<{
  image: Image;
  /** How wide it shows, so the browser picks the size it needs (`COVER_SIZES` and the like). */
  sizes: string;
  /** For the photo at the top of a page: loaded first, rather than once it's scrolled to. */
  eager?: boolean;
  /**
   * In place of its alt text as saved: `""` where it's shown beside its alt text field, which
   * says what it shows, and may say something new.
   */
  alt?: string;
}>();

const sources = computed(() => imageSources(props.image));
</script>

<template>
  <!-- Without alt text, it's left out for screen readers: the recipe's text says what it shows.
       The width and height keep its place while it loads. -->
  <img
    :src="sources.src"
    :srcset="sources.srcset"
    :sizes="sizes"
    :width="image.width"
    :height="image.height"
    :alt="alt ?? image.alt"
    :loading="eager ? 'eager' : 'lazy'"
    :fetchpriority="eager ? 'high' : 'auto'"
    decoding="async"
    class="bg-muted"
  >
</template>
