<script setup lang="ts">
import { LockIcon, StarIcon, TriangleAlertIcon } from '@lucide/vue';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { DIFFICULTY_LABELS, formatMinutes } from '@/recipes/format.ts';
import { CARD_SIZES } from './photos.ts';
import RecipePhoto from './RecipePhoto.vue';
import { ratingText } from './ratings.ts';
import type { RecipeSummary } from './recipe.ts';

/**
 * One recipe in a list or in search results. The whole card goes to the recipe, through its title's link,
 * so the link's name is just the title.
 */
const props = defineProps<{ recipe: RecipeSummary }>();

const facts = computed(() =>
  [
    props.recipe.totalMinutes === null ? undefined : formatMinutes(props.recipe.totalMinutes),
    props.recipe.difficulty === null ? undefined : DIFFICULTY_LABELS[props.recipe.difficulty],
  ].filter((fact) => fact !== undefined),
);
const rated = computed(() => props.recipe.rating.count > 0);
const tags = computed(() => [
  ...props.recipe.cuisine,
  ...props.recipe.mealType,
  ...props.recipe.diet,
  ...props.recipe.tags,
]);
</script>

<template>
  <article
    class="relative flex h-full flex-col overflow-hidden rounded-lg border transition-colors has-[a:hover]:border-foreground/40 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50"
  >
    <RecipePhoto
      v-if="recipe.cover"
      :image="recipe.cover"
      :sizes="CARD_SIZES"
      class="aspect-[3/2] w-full object-cover"
    />
    <div class="flex flex-1 flex-col gap-2 p-4">
      <h2 class="font-semibold break-words">
        <!-- Its box covers the card, so anywhere on it opens the recipe. -->
        <RouterLink
          :to="{ name: 'recipe', params: { id: recipe.id } }"
          class="outline-none after:absolute after:inset-0 after:rounded-lg"
        >
          {{ recipe.title }}
        </RouterLink>
      </h2>
      <p
        v-if="facts.length > 0 || rated || recipe.visibility === 'private'"
        class="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"
      >
        <span v-if="facts.length > 0">{{ facts.join(' · ') }}</span>
        <span
          v-if="rated"
          class="inline-flex items-center gap-1"
        >
          <StarIcon
            class="size-3.5 fill-current"
            aria-hidden="true"
          />
          {{ ratingText(recipe.rating) }}
        </span>
        <span
          v-if="recipe.visibility === 'private'"
          class="inline-flex items-center gap-1"
        >
          <LockIcon
            class="size-3.5"
            aria-hidden="true"
          />
          Private
        </span>
      </p>
      <ul
        v-if="recipe.allergens.length > 0 || tags.length > 0"
        aria-label="Tags"
        class="mt-auto flex flex-wrap gap-1.5 pt-1"
      >
        <li
          v-if="recipe.allergens.length > 0"
          class="inline-flex items-center gap-1 rounded-full bg-caution px-2 py-0.5 text-xs font-medium break-words text-caution-foreground"
        >
          <TriangleAlertIcon
            class="size-3 shrink-0"
            aria-hidden="true"
          />
          Contains {{ recipe.allergens.join(', ') }}
        </li>
        <li
          v-for="tag in tags"
          :key="tag"
          class="rounded-full bg-secondary px-2 py-0.5 text-xs break-words text-secondary-foreground"
        >
          {{ tag }}
        </li>
      </ul>
    </div>
  </article>
</template>
