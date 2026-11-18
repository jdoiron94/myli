<script setup lang="ts">
import { LockIcon, TriangleAlertIcon } from '@lucide/vue';
import { recipeTotalMinutes, scaleFactor } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, ref, useTemplateRef, watch, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { useUnitSystem } from '@/account/preferences.ts';
import { failureMessage } from '@/api/failure.ts';
import { ApiProblem } from '@/api/problem.ts';
import { useRetry } from '@/api/retry.ts';
import MarkdownContent from '@/components/MarkdownContent.vue';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { Button } from '@/components/ui/button';
import { USER_LINK_REL } from '@/lib/markdown.ts';
import {
  DIFFICULTY_LABELS,
  formatMinutes,
  formatNumber,
  nutritionFacts,
  shownTags,
} from '@/recipes/format.ts';
import IngredientList from '@/recipes/IngredientList.vue';
import { COVER_SIZES, GALLERY_SIZES, STEP_PHOTO_SIZES } from '@/recipes/photos.ts';
import RecipeActions from '@/recipes/RecipeActions.vue';
import RecipePhoto from '@/recipes/RecipePhoto.vue';
import { recipeQuery } from '@/recipes/recipe.ts';
import ServingsControl from '@/recipes/ServingsControl.vue';
import UnitSystemChoice from '@/recipes/UnitSystemChoice.vue';
import { documentTitle } from '@/router.ts';

const props = defineProps<{ id: string }>();

const query = useQuery(computed(() => recipeQuery(props.id)));
const { failure, retrying, stillFailing, retry } = useRetry(query);
const recipe = computed(() => query.data.value);

/** The cover shows at the top, and the recipe's other photos, in order, after everything else. */
const cover = computed(() =>
  recipe.value?.images.find(({ id }) => id === recipe.value?.coverImageId),
);
const gallery = computed(() => recipe.value?.images.filter((image) => image !== cover.value) ?? []);

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

// Scaling changes only what's shown (spec §3.2). It starts at the recipe's own servings, and again
// for each recipe.
const chosenServings = ref<number>();
watch(
  () => props.id,
  () => {
    chosenServings.value = undefined;
  },
);
const servings = computed({
  get: () => chosenServings.value ?? recipe.value?.servings ?? 1,
  set: (value: number) => {
    chosenServings.value = value;
  },
});
const scaled = computed(
  () => recipe.value !== undefined && servings.value !== recipe.value.servings,
);
const factor = computed(() =>
  recipe.value ? scaleFactor(recipe.value.servings, servings.value) : 1,
);
const servingsText = (count: number) => `${String(count)} ${count === 1 ? 'serving' : 'servings'}`;

const servingsControl = useTemplateRef('servingsControl');
/** Back to the recipe's own servings. The button goes, so focus goes to the number instead. */
async function unscale() {
  chosenServings.value = undefined;
  await nextTick();
  servingsControl.value?.focus();
}

const units = useUnitSystem();

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
      <RecipePhoto
        v-if="cover"
        :image="cover"
        :sizes="COVER_SIZES"
        eager
        class="mt-6 aspect-[3/2] w-full rounded-lg object-cover md:aspect-[2/1]"
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
            <template v-if="recipe.ingredientGroups.length > 0">
              <div class="mb-4">
                <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
                  <ServingsControl
                    ref="servingsControl"
                    v-model="servings"
                  />
                  <UnitSystemChoice
                    v-if="units.ready.value"
                    :model-value="units.system.value"
                    @update:model-value="units.choose"
                  />
                </div>
                <!-- Always there, so screen readers announce what it says as it changes: hiding it while
                     empty would stop that, so it only loses its margin. -->
                <p
                  role="status"
                  class="text-sm text-muted-foreground not-empty:mt-3"
                >
                  <template v-if="scaled">
                    Amounts for {{ servingsText(servings) }}, scaled from the recipe's
                    {{ recipe.servings }}.
                  </template>
                </p>
                <Button
                  v-if="scaled"
                  variant="outline"
                  size="sm"
                  class="mt-2"
                  @click="unscale"
                >
                  Back to {{ servingsText(recipe.servings) }}
                </Button>
                <p
                  v-if="units.failure.value"
                  role="alert"
                  class="mt-3 text-sm text-destructive"
                >
                  Your choice of units couldn't be saved. {{ failureMessage(units.failure.value) }}
                </p>
              </div>
              <IngredientList
                v-if="units.ready.value"
                :groups="recipe.ingredientGroups"
                :system="units.system.value"
                :factor="factor"
              />
            </template>
            <p
              v-else
              class="text-muted-foreground"
            >
              No ingredients yet.
            </p>
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
          <ol
            v-if="recipe.steps.length > 0"
            class="list-decimal space-y-4 ps-6 marker:font-semibold"
          >
            <li
              v-for="(step, index) in recipe.steps"
              :key="index"
              class="ps-1"
            >
              <MarkdownContent
                :source="step.body"
              />
              <!-- Shown whole, never cropped, as it may show how something's done. -->
              <RecipePhoto
                v-if="step.image"
                :image="step.image"
                :sizes="STEP_PHOTO_SIZES"
                class="mt-3 h-auto max-h-[32rem] w-auto max-w-full rounded-md"
              />
            </li>
          </ol>
          <p
            v-else
            class="text-muted-foreground"
          >
            No steps yet.
          </p>
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

      <div
        v-if="gallery.length > 0"
        class="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3"
      >
        <RecipePhoto
          v-for="image in gallery"
          :key="image.id"
          :image="image"
          :sizes="GALLERY_SIZES"
          class="aspect-[4/3] w-full rounded-md object-cover"
        />
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
