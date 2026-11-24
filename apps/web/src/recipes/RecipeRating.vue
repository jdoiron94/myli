<script setup lang="ts">
import { StarIcon } from '@lucide/vue';
import { can } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import { sessionQuery } from '@/auth/session.ts';
import { Button } from '@/components/ui/button';
import { ratingText, recipeRatingQuery, useRateRecipe } from './ratings.ts';
import type { Recipe } from './recipe.ts';

/**
 * A recipe's ratings (spec §3.2), which everyone who sees it sees, and the buttons that rate it, for
 * whoever may. Five buttons, not radios: moving through radios with the arrow keys checks each in
 * turn, which would rate the recipe at every step. None of it is printed.
 */
const props = defineProps<{ recipe: Pick<Recipe, 'id' | 'owner' | 'visibility'> }>();

const { data: user } = useQuery(sessionQuery);
const canRate = computed(() =>
  can(user.value ?? null, 'recipe.interact', {
    ownerId: props.recipe.owner.id,
    visibility: props.recipe.visibility,
  }),
);
const rating = useQuery(computed(() => recipeRatingQuery(props.recipe.id)));
const mine = computed(() => rating.data.value?.mine ?? null);

const rate = useRateRecipe();
const failure = ref<string>();
const stars = useTemplateRef('stars');

async function choose(value: number | null) {
  if (rate.isPending.value) return;
  failure.value = undefined;
  try {
    await rate.mutateAsync({ id: props.recipe.id, stars: value });
  } catch (error) {
    failure.value = failureMessage(error);
    return;
  }
  // The button to take it back is gone with the rating: focus goes back to the stars.
  if (value === null) {
    await nextTick();
    stars.value?.querySelector('button')?.focus();
  }
}
</script>

<template>
  <div
    v-if="rating.data.value"
    class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden"
  >
    <p class="inline-flex items-center gap-1.5 text-sm">
      <StarIcon
        class="size-4 fill-current"
        aria-hidden="true"
      />
      {{ ratingText(rating.data.value) }}
    </p>
    <div
      v-if="canRate"
      class="flex flex-wrap items-center gap-2"
    >
      <div
        ref="stars"
        role="group"
        aria-label="Your rating"
        class="flex"
      >
        <Button
          v-for="value in 5"
          :key="value"
          variant="ghost"
          size="icon-sm"
          class="aria-disabled:opacity-50"
          :aria-pressed="mine === value"
          :aria-disabled="rate.isPending.value ? true : undefined"
          @click="choose(value)"
        >
          <StarIcon
            aria-hidden="true"
            :class="{ 'fill-current': mine !== null && value <= mine }"
          />
          <span class="sr-only">{{ value === 1 ? '1 star' : `${String(value)} stars` }}</span>
        </Button>
      </div>
      <Button
        v-if="mine !== null"
        variant="link"
        size="sm"
        class="aria-disabled:opacity-50"
        :aria-disabled="rate.isPending.value ? true : undefined"
        @click="choose(null)"
      >
        Remove my rating
      </Button>
    </div>
    <p
      v-if="failure"
      role="alert"
      class="w-full text-sm text-destructive"
    >
      {{ failure }}
    </p>
  </div>
</template>
