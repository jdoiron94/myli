<script setup lang="ts">
import { UserRoundIcon } from '@lucide/vue';
import type { Person } from '@myli/shared';
import { computed, ref, watch } from 'vue';
import { avatarColor, initials } from '@/lib/avatars.ts';
import { cn } from '@/lib/utils';
import { imageUrl } from '@/recipes/photos.ts';

/**
 * Someone's profile photo, or without one, their initials in a circle of their own color. It only
 * ever shows beside their name, which says who it is, so screen readers skip it. Not printed: the
 * circle's color wouldn't be, leaving white initials on white.
 */
const { person, size = 'sm' } = defineProps<{ person: Person; size?: 'sm' | 'md' | 'lg' }>();

const SIZES = {
  sm: 'size-6 text-[0.625rem]',
  md: 'size-8 text-xs',
  lg: 'size-24 text-3xl',
};

/**
 * Drawn from `data-initials` (`::before`), not text in the page. As text, inside a button named
 * for the person, they'd be visible words missing from its name (WCAG 2.5.3).
 */
const letters = computed(() => initials(person.name));
/**
 * A photo that didn't load, as one replaced since this page fetched who it shows: its file is
 * gone. Their initials show instead.
 */
const failed = ref(false);
watch(
  () => person.avatar?.id,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <img
    v-if="person.avatar && !failed"
    :src="imageUrl(person.avatar.id, person.avatar.width)"
    alt=""
    :class="cn('shrink-0 rounded-full object-cover print:hidden', SIZES[size])"
    @error="failed = true"
  >
  <span
    v-else
    aria-hidden="true"
    :data-initials="letters || undefined"
    :class="
      cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white select-none before:content-[attr(data-initials)] print:hidden',
        SIZES[size],
      )
    "
    :style="{ backgroundColor: avatarColor(person.id) }"
  >
    <UserRoundIcon
      v-if="!letters"
      class="size-1/2"
    />
  </span>
</template>
