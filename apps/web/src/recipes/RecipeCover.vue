<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
import { computed, ref, shallowRef } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from '@/components/ui/carousel';
import { COVER_SIZES } from './photos.ts';
import RecipePhoto from './RecipePhoto.vue';
import type { Image } from './recipe.ts';

/**
 * The top of a recipe's page: its cover, and when it has other photos, a slideshow of them all,
 * the cover first, then the others in order (spec §3.2).
 */
const props = defineProps<{ cover: Image; others: Image[] }>();

const photos = computed(() => [props.cover, ...props.others]);

const carousel = shallowRef<CarouselApi>();
/** Which photo shows. The carousel says, since it also moves when swiped or with arrow keys. */
const shown = ref(0);

function follow(api: CarouselApi) {
  carousel.value = api;
  const update = () => (shown.value = api?.selectedScrollSnap() ?? 0);
  api?.on('select', update);
  api?.on('reInit', update);
}

function go(by: -1 | 1) {
  const to = shown.value + by;
  if (to >= 0 && to < photos.value.length) carousel.value?.scrollTo(to);
}
</script>

<template>
  <RecipePhoto
    v-if="others.length === 0"
    :image="cover"
    :sizes="COVER_SIZES"
    eager
    class="aspect-[3/2] w-full rounded-lg object-cover md:aspect-[2/1]"
  />
  <!-- The Carousel's own buttons (CarouselPrevious, CarouselNext) are disabled at either end,
       which drops focus there. These are only marked aria-disabled, as the editor's are. -->
  <Carousel
    v-else
    aria-label="Photos"
    class="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    @init-api="follow"
  >
    <CarouselContent>
      <CarouselItem
        v-for="(photo, index) in photos"
        :key="photo.id"
        :aria-label="`${index + 1} of ${photos.length}`"
      >
        <RecipePhoto
          :image="photo"
          :sizes="COVER_SIZES"
          :eager="index === 0"
          class="aspect-[3/2] w-full rounded-lg object-cover md:aspect-[2/1]"
        />
      </CarouselItem>
    </CarouselContent>
    <Button
      type="button"
      variant="secondary"
      size="icon"
      class="absolute inset-y-0 start-3 my-auto rounded-full shadow-sm aria-disabled:opacity-50"
      aria-label="Previous photo"
      :aria-disabled="shown === 0 ? true : undefined"
      @click="go(-1)"
    >
      <ChevronLeftIcon aria-hidden="true" />
    </Button>
    <Button
      type="button"
      variant="secondary"
      size="icon"
      class="absolute inset-y-0 end-3 my-auto rounded-full shadow-sm aria-disabled:opacity-50"
      aria-label="Next photo"
      :aria-disabled="shown === photos.length - 1 ? true : undefined"
      @click="go(1)"
    >
      <ChevronRightIcon aria-hidden="true" />
    </Button>
    <!-- Says which photo shows once it changes; each slide says where it is, too. -->
    <p
      aria-live="polite"
      aria-atomic="true"
      class="pointer-events-none absolute end-3 bottom-3 rounded-full bg-background px-2.5 py-0.5 text-sm font-medium"
    >
      <span class="sr-only">Photo</span>
      {{ shown + 1 }} of {{ photos.length }}
    </p>
  </Carousel>
</template>
