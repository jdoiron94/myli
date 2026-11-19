<script setup lang="ts">
import { ArrowLeftIcon } from '@lucide/vue';
import { compareRecipes, diffText, type Nutrient, type RecipeStep } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, watchEffect } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ApiProblem } from '@/api/problem.ts';
import { allOf, useRetry } from '@/api/retry.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { coverOf, DETAIL_LABELS, DETAIL_TEXT } from '@/recipes/comparison.ts';
import DiffList from '@/recipes/DiffList.vue';
import { DiffText } from '@/recipes/DiffText.ts';
import { formatNutrient, NUTRIENT_FACTS } from '@/recipes/format.ts';
import RecipePhoto from '@/recipes/RecipePhoto.vue';
import {
  type Image,
  type RecipeRevisionContent,
  recipeQuery,
  recipeRevisionQuery,
} from '@/recipes/recipe.ts';
import { documentTitle } from '@/router.ts';

/**
 * Two revisions of a recipe compared (spec §3.3), the earlier first: each detail that differs, the
 * description word by word, and each list entry by entry. Text shows as typed, markdown included.
 */
const props = defineProps<{ id: string; from: number; to: number }>();

const recipeResult = useQuery(computed(() => recipeQuery(props.id)));
const fromResult = useQuery(computed(() => recipeRevisionQuery(props.id, props.from)));
const toResult = useQuery(computed(() => recipeRevisionQuery(props.id, props.to)));
const { failure, retrying, stillFailing, retry } = useRetry(
  allOf(recipeResult, fromResult, toResult),
);
const recipe = computed(() => recipeResult.data.value);
const before = computed(() => fromResult.data.value);
const after = computed(() => toResult.data.value);
const comparison = computed(
  () => before.value && after.value && compareRecipes(before.value.content, after.value.content),
);
/** The two revisions' content, the earlier first, each with its cover. */
const sides = computed(() =>
  [before.value, after.value].flatMap((revision) =>
    revision ? [{ content: revision.content, cover: coverOf(revision.content) }] : [],
  ),
);
const unchanged = computed(() => {
  const value = comparison.value;
  if (!value) return false;
  const { details, description, tags, photos, ingredients, equipment, steps, nutrition } = value;
  return (
    [description, tags, photos, ingredients, equipment, steps].every((part) => part === null) &&
    details.length === 0 &&
    nutrition.length === 0
  );
});

/** The API answers 404 alike for a revision that doesn't exist and a recipe the reader may not see. */
const notFound = computed(
  () => failure.value instanceof ApiProblem && failure.value.status === 404,
);

// The page's one heading is there from the start, so focus can move to it after navigating.
const heading = computed(() => {
  if (recipe.value) return recipe.value.title;
  return notFound.value ? 'Revision not found' : 'Compare revisions';
});

const route = useRoute();
watchEffect(() => {
  // Only while this page is the current one: the router sets the next page's title as it leaves.
  if (route.name !== 'compare-revisions') return;
  if (recipe.value) document.title = documentTitle(`Compare revisions: ${recipe.value.title}`);
  else if (notFound.value) document.title = documentTitle(heading.value);
});

const savedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const saved = (revision: { author: { name: string }; createdAt: string }) =>
  `saved by ${revision.author.name} on ${savedFormat.format(new Date(revision.createdAt))}`;

const altText = (image: Image | null) => {
  if (!image) return 'No photo';
  return image.alt === '' ? 'A photo without alt text' : image.alt;
};
const nutrientText = (content: RecipeRevisionContent, nutrient: Nutrient) => {
  const value = content.nutrition[nutrient];
  return value === null ? 'None' : formatNutrient(nutrient, value);
};
const PHOTO_SIZES = '6rem';
const stepPhotoChanged = (was: RecipeStep, is: RecipeStep) =>
  was.image?.id !== is.image?.id || was.image?.alt !== is.image?.alt;
</script>

<template>
  <article>
    <RouterLink
      :to="{ name: 'recipe-history', params: { id } }"
      class="inline-flex items-center gap-1.5 rounded-md text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ArrowLeftIcon
        class="size-4"
        aria-hidden="true"
      />
      Back to history
    </RouterLink>
    <p class="mt-4 text-sm font-medium text-muted-foreground">
      Compare revisions
    </p>
    <h1 class="text-3xl font-semibold break-words">
      {{ heading }}
    </h1>

    <template v-if="recipe && before && after && comparison">
      <p class="mt-2 max-w-prose text-sm text-muted-foreground">
        Revision {{ from }}, {{ saved(before) }}, compared with revision {{ to }},
        {{ saved(after) }}. Text shows as typed.
      </p>

      <p
        v-if="unchanged"
        class="mt-6"
      >
        Nothing changed between these two revisions.
      </p>

      <section
        v-if="comparison.details.length > 0"
        aria-labelledby="details-heading"
        class="mt-8"
      >
        <h2
          id="details-heading"
          class="mb-3 text-xl font-semibold"
        >
          Details
        </h2>
        <table
          aria-labelledby="details-heading"
          class="w-full max-w-prose text-left text-sm"
        >
          <thead class="border-b text-muted-foreground">
            <tr>
              <td />
              <th
                scope="col"
                class="py-2 pe-4 font-medium"
              >
                Revision {{ from }}
              </th>
              <th
                scope="col"
                class="py-2 font-medium"
              >
                Revision {{ to }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr
              v-for="detail in comparison.details"
              :key="detail"
            >
              <th
                scope="row"
                class="py-2 pe-4 align-top font-medium"
              >
                {{ DETAIL_LABELS[detail] }}
              </th>
              <td
                v-for="(side, index) in sides"
                :key="index"
                class="py-2 pe-4 align-top break-words"
              >
                <template v-if="detail === 'coverImageId'">
                  <RecipePhoto
                    v-if="side.cover"
                    :image="side.cover"
                    :sizes="PHOTO_SIZES"
                    class="w-24 rounded-md"
                  />
                  <template v-else>
                    None
                  </template>
                </template>
                <template v-else>
                  {{ DETAIL_TEXT[detail](side.content) ?? 'None' }}
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section
        v-if="comparison.description"
        aria-labelledby="description-heading"
        class="mt-8"
      >
        <h2
          id="description-heading"
          class="mb-3 text-xl font-semibold"
        >
          Description
        </h2>
        <p class="max-w-prose">
          <DiffText :parts="comparison.description" />
        </p>
      </section>

      <section
        v-if="comparison.tags"
        aria-labelledby="tags-heading"
        class="mt-8"
      >
        <h2
          id="tags-heading"
          class="mb-3 text-xl font-semibold"
        >
          Tags
        </h2>
        <DiffList
          :entries="comparison.tags"
          label="Tags"
        >
          <template #item="{ item }">
            {{ item.name }}
          </template>
          <template #changed="{ after: tag }">
            {{ tag.name }}
          </template>
        </DiffList>
      </section>

      <section
        v-if="comparison.photos"
        aria-labelledby="photos-heading"
        class="mt-8"
      >
        <h2
          id="photos-heading"
          class="mb-3 text-xl font-semibold"
        >
          Photos
        </h2>
        <DiffList
          :entries="comparison.photos"
          label="Photos"
        >
          <template #item="{ item }">
            <div class="flex items-start gap-3">
              <RecipePhoto
                :image="item"
                :sizes="PHOTO_SIZES"
                alt=""
                class="w-24 shrink-0 rounded-md"
              />
              <span class="break-words">{{ altText(item) }}</span>
            </div>
          </template>
          <template #changed="{ before: was, after: is }">
            <div class="flex items-start gap-3">
              <RecipePhoto
                :image="is"
                :sizes="PHOTO_SIZES"
                alt=""
                class="w-24 shrink-0 rounded-md"
              />
              <DiffText :parts="diffText(was.alt, is.alt)" />
            </div>
          </template>
        </DiffList>
      </section>

      <section
        v-if="comparison.ingredients"
        aria-labelledby="ingredients-heading"
        class="mt-8"
      >
        <h2
          id="ingredients-heading"
          class="mb-3 text-xl font-semibold"
        >
          Ingredients
        </h2>
        <DiffList
          :entries="comparison.ingredients"
          label="Ingredients"
        >
          <template #item="{ item }">
            <span :class="{ 'font-semibold': item.kind === 'group' }">{{ item.text }}</span>
          </template>
          <template #changed="{ before: was, after: is }">
            <span :class="{ 'font-semibold': is.kind === 'group' }">
              <DiffText :parts="diffText(was.text, is.text)" />
            </span>
          </template>
        </DiffList>
      </section>

      <section
        v-if="comparison.equipment"
        aria-labelledby="equipment-heading"
        class="mt-8"
      >
        <h2
          id="equipment-heading"
          class="mb-3 text-xl font-semibold"
        >
          Equipment
        </h2>
        <DiffList
          :entries="comparison.equipment"
          label="Equipment"
        >
          <template #item="{ item }">
            {{ item }}
          </template>
          <template #changed="{ before: was, after: is }">
            <DiffText :parts="diffText(was, is)" />
          </template>
        </DiffList>
      </section>

      <section
        v-if="comparison.steps"
        aria-labelledby="steps-heading"
        class="mt-8"
      >
        <h2
          id="steps-heading"
          class="mb-3 text-xl font-semibold"
        >
          Steps
        </h2>
        <DiffList
          :entries="comparison.steps"
          label="Steps"
        >
          <template #item="{ item }">
            <span class="whitespace-pre-wrap break-words">{{ item.body }}</span>
            <span
              v-if="item.image"
              class="mt-1 block text-sm"
            >Photo: {{ altText(item.image) }}</span>
          </template>
          <template #changed="{ before: was, after: is }">
            <DiffText :parts="diffText(was.body, is.body)" />
            <span
              v-if="stepPhotoChanged(was, is)"
              class="mt-1 block text-sm"
            >Photo: {{ altText(was.image) }} → {{ altText(is.image) }}</span>
          </template>
        </DiffList>
      </section>

      <section
        v-if="comparison.nutrition.length > 0"
        aria-labelledby="nutrition-heading"
        class="mt-8"
      >
        <h2
          id="nutrition-heading"
          class="mb-3 text-xl font-semibold"
        >
          Nutrition
        </h2>
        <table
          aria-labelledby="nutrition-heading"
          class="w-full max-w-prose text-left text-sm"
        >
          <thead class="border-b text-muted-foreground">
            <tr>
              <td />
              <th
                scope="col"
                class="py-2 pe-4 font-medium"
              >
                Revision {{ from }}
              </th>
              <th
                scope="col"
                class="py-2 font-medium"
              >
                Revision {{ to }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr
              v-for="nutrient in comparison.nutrition"
              :key="nutrient"
            >
              <th
                scope="row"
                class="py-2 pe-4 font-medium"
              >
                {{ NUTRIENT_FACTS[nutrient].label }}
              </th>
              <td
                v-for="(side, index) in sides"
                :key="index"
                class="py-2 pe-4"
              >
                {{ nutrientText(side.content, nutrient) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <p
      v-else-if="notFound"
      class="mt-2 text-muted-foreground"
    >
      One of these revisions doesn't exist, or the recipe was deleted or isn't shared with you.
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
      Loading the revisions…
    </p>
  </article>
</template>
