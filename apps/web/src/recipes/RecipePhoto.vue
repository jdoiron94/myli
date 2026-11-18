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
}>();

const sources = computed(() => imageSources(props.image));
</script>

<template>
  <!-- Photos have no descriptions of their own yet, so they're left out for screen readers: the
       text around each says what it shows. The width and height keep its place while it loads. -->
  <img
    :src="sources.src"
    :srcset="sources.srcset"
    :sizes="sizes"
    :width="image.width"
    :height="image.height"
    alt=""
    :loading="eager ? 'eager' : 'lazy'"
    :fetchpriority="eager ? 'high' : 'auto'"
    decoding="async"
    class="bg-muted"
  >
</template>
