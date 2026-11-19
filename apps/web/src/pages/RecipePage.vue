<script setup lang="ts">
import { LockIcon, TriangleAlertIcon } from '@lucide/vue';
import { recipeTotalMinutes } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { preferencesQuery } from '@/account/preferences.ts';
import { ApiProblem } from '@/api/problem.ts';
import { useRetry } from '@/api/retry.ts';
import MarkdownContent from '@/components/MarkdownContent.vue';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { USER_LINK_REL } from '@/lib/markdown.ts';
import {
  DIFFICULTY_LABELS,
  formatMinutes,
  formatNumber,
  nutritionFacts,
  shownTags,
} from '@/recipes/format.ts';
import RecipeActions from '@/recipes/RecipeActions.vue';
import RecipeCover from '@/recipes/RecipeCover.vue';
import RecipeSteps from '@/recipes/RecipeSteps.vue';
import { recipeQuery } from '@/recipes/recipe.ts';
import ScaledIngredients from '@/recipes/ScaledIngredients.vue';
import { useServings } from '@/recipes/servings.ts';
import { documentTitle } from '@/router.ts';

const props = defineProps<{ id: string }>();

const query = useQuery(computed(() => recipeQuery(props.id)));
// Asked for alongside the recipe, not after it, so its amounts can show as soon as it does.
useQuery(preferencesQuery);
const { failure, retrying, stillFailing, retry } = useRetry(query);
const recipe = computed(() => query.data.value);

/** The cover shows at the top, and with it, in a slideshow, the recipe's other photos in order. */
const cover = computed(() =>
  recipe.value?.images.find(({ id }) => id === recipe.value?.coverImageId),
);
const otherPhotos = computed(
  () => recipe.value?.images.filter((image) => image !== cover.value) ?? [],
);

/** The API answers 404 alike for a recipe that doesn't exist and one the reader may not see. */
const notFound = computed(
  () => failure.value instanceof ApiProblem && failure.value.status === 404,
);

// The page's one heading is there from the start, so focus can move to it after navigating (the
// layout does that), and changes from a placeholder to the recipe's title.
const heading = computed(() => {
  if (recipe.value) return recipe.value.title;
  return notFound.value ? 'Recipe not found' : 'Recipe';
});

const route = useRoute();
watchEffect(() => {
  // Only while this page is the current one: the router sets the next page's title as it leaves.
  if (route.name === 'recipe' && (recipe.value || notFound.value)) {
    document.title = documentTitle(heading.value);
  }
});

// Scaling changes only what's shown (spec §3.2), and goes with the reader to cook mode and back.
const servings = useServings(
  () => props.id,
  () => recipe.value?.servings,
);

const updatedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

const facts = computed(() => {
  const shown = recipe.value;
  if (!shown) return [];
  const total = recipeTotalMinutes(shown);
  const list: { label: string; value: string }[] = [];
  if (shown.prepMinutes !== null)
    list.push({ label: 'Prep', value: formatMinutes(shown.prepMinutes) });
  if (shown.cookMinutes !== null)
    list.push({ label: 'Cook', value: formatMinutes(shown.cookMinutes) });
  if (total !== null) list.push({ label: 'Total', value: formatMinutes(total) });
  list.push({ label: 'Servings', value: String(shown.servings) });
  if (shown.yield) {
    const amount = formatNumber(shown.yield.qty);
    list.push({
      label: 'Makes',
      value: shown.yield.unit ? `${amount} ${shown.yield.unit}` : amount,
    });
  }
  if (shown.difficulty)
    list.push({ label: 'Difficulty', value: DIFFICULTY_LABELS[shown.difficulty] });
  return list;
});

const tags = computed(() => shownTags(recipe.value?.tags ?? []));

const source = computed(() => {
  const value = recipe.value?.source;
  if (!value || (value.url === null && value.title === null && value.author === null)) return null;
  const linkText = value.title ?? (value.url === null ? null : new URL(value.url).hostname);
  return { url: value.url, linkText, author: value.author };
});

const nutrition = computed(() => (recipe.value ? nutritionFacts(recipe.value.nutrition) : []));
</script>

<template>
  <article>
    <!-- The actions sit beside the title while there's room, and go below it when there isn't. -->
    <div class="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
      <div class="min-w-0 flex-[1_1_20rem]">
        <h1 class="text-3xl font-semibold break-words">
          {{ heading }}
        </h1>
        <p
          v-if="recipe"
          class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
        >
          <span>Added by {{ recipe.owner.name }}</span>
          <span aria-hidden="true">·</span>
          <span>Updated {{ updatedFormat.format(new Date(recipe.updatedAt)) }}</span>
          <template v-if="recipe.visibility === 'private'">
            <span aria-hidden="true">·</span>
            <span class="inline-flex items-center gap-1">
              <LockIcon
                class="size-3.5"
                aria-hidden="true"
              />
              Private
            </span>
          </template>
        </p>
      </div>
      <RecipeActions
        v-if="recipe"
        :recipe="recipe"
      />
    </div>

    <template v-if="recipe">
      <RecipeCover
        v-if="cover"
        :cover="cover"
        :others="otherPhotos"
        class="mt-6"
      />

      <MarkdownContent
        v-if="recipe.description"
        class="mt-6 max-w-prose"
        :source="recipe.description"
      />

      <!-- "From" names where it was published; with only an author, there's nowhere to name. -->
      <p
        v-if="source"
        class="mt-3 text-sm break-words text-muted-foreground"
      >
        <template v-if="source.linkText">
          From
          <a
            v-if="source.url"
            :href="source.url"
            :rel="USER_LINK_REL"
            class="underline underline-offset-2"
          >{{ source.linkText }}</a>
          <template v-else>
            {{ source.linkText }}
          </template>
          <template v-if="source.author">
            by {{ source.author }}
          </template>
        </template>
        <template v-else>
          Recipe by {{ source.author }}
        </template>
      </p>

      <!-- What the recipe contains comes first, and stands out: someone may need to avoid it. -->
      <ul
        v-if="tags.allergens.length > 0 || tags.tags.length > 0"
        aria-label="Tags"
        class="mt-4 flex flex-wrap gap-2"
      >
        <li
          v-if="tags.allergens.length > 0"
          class="inline-flex items-center gap-1.5 rounded-full bg-caution px-2.5 py-0.5 text-sm font-medium break-words text-caution-foreground"
        >
          <TriangleAlertIcon
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />
          Contains {{ tags.allergens.map(({ name }) => name).join(', ') }}
        </li>
        <li
          v-for="tag in tags.tags"
          :key="tag.id"
          class="rounded-full bg-secondary px-2.5 py-0.5 text-sm break-words text-secondary-foreground"
        >
          {{ tag.name }}
        </li>
      </ul>

      <dl class="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-y py-4">
        <div
          v-for="fact in facts"
          :key="fact.label"
        >
          <dt class="text-sm text-muted-foreground">
            {{ fact.label }}
          </dt>
          <dd class="font-medium">
            {{ fact.value }}
          </dd>
        </div>
      </dl>

      <!-- On wide screens, nutrition goes under the ingredients, beside the steps. Narrow, it stays
           after the steps, where it is in the page's order. -->
      <div
        class="mt-8 grid gap-x-12 gap-y-10 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:grid-rows-[auto_1fr]"
      >
        <div class="space-y-10">
          <section aria-labelledby="ingredients-heading">
            <h2
              id="ingredients-heading"
              class="mb-3 text-xl font-semibold"
            >
              Ingredients
            </h2>
            <ScaledIngredients
              v-model:servings="servings"
              :recipe="recipe"
            />
          </section>

          <section
            v-if="recipe.equipment.length > 0"
            aria-labelledby="equipment-heading"
          >
            <h2
              id="equipment-heading"
              class="mb-3 text-xl font-semibold"
            >
              Equipment
            </h2>
            <ul class="space-y-2">
              <li
                v-for="(item, index) in recipe.equipment"
                :key="index"
              >
                {{ item }}
              </li>
            </ul>
          </section>
        </div>

        <section
          aria-labelledby="steps-heading"
          class="md:row-span-2"
        >
          <h2
            id="steps-heading"
            class="mb-3 text-xl font-semibold"
          >
            Steps
          </h2>
          <RecipeSteps :steps="recipe.steps" />
        </section>

        <section
          v-if="nutrition.length > 0"
          aria-labelledby="nutrition-heading"
          class="md:col-start-1"
        >
          <h2
            id="nutrition-heading"
            class="text-xl font-semibold"
          >
            Nutrition
          </h2>
          <p class="mb-3 text-sm text-muted-foreground">
            Per serving
          </p>
          <dl class="grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            <template
              v-for="fact in nutrition"
              :key="fact.label"
            >
              <dt>{{ fact.label }}</dt>
              <dd class="text-end font-medium">
                {{ fact.value }}
              </dd>
            </template>
          </dl>
        </section>
      </div>
    </template>

    <p
      v-else-if="notFound"
      class="mt-2 text-muted-foreground"
    >
      This recipe doesn't exist, was deleted, or isn't shared with you.
    </p>
    <RetryableFailure
      v-else-if="failure"
      class="mt-4"
      :error="failure"
      :retrying="retrying"
      :still-failing="stillFailing"
      @retry="retry"
    />
    <p
      v-else
      class="mt-2 text-muted-foreground"
    >
      Loading the recipe…
    </p>
  </article>
</template>
