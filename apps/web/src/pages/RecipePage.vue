<script setup lang="ts">
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DIFFICULTY_LABELS,
  formatMinutes,
  formatNumber,
  nutritionFacts,
  TAG_TYPE_LABELS,
  tagsByType,
} from '@/recipes/format.ts';
import IngredientList from '@/recipes/IngredientList.vue';
import { recipeQuery } from '@/recipes/recipe.ts';
import ServingsControl from '@/recipes/ServingsControl.vue';
import UnitSystemChoice from '@/recipes/UnitSystemChoice.vue';
import { documentTitle } from '@/router.ts';

const props = defineProps<{ id: string }>();

const query = useQuery(computed(() => recipeQuery(props.id)));
const { failure, retrying, stillFailing, retry } = useRetry(query);
const recipe = computed(() => query.data.value);

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

const tagGroups = computed(() => tagsByType(recipe.value?.tags ?? []));
/** Allergen and diet tags are set by hand (spec §3.2), which the page says next to them. */
const hasUnverifiedTags = computed(() =>
  tagGroups.value.some(({ type }) => type === 'allergen' || type === 'diet'),
);

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
    <h1 class="text-3xl font-semibold break-words">
      {{ heading }}
    </h1>

    <template v-if="recipe">
      <p class="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>By {{ recipe.owner.name }}</span>
        <span aria-hidden="true">·</span>
        <span>Updated {{ updatedFormat.format(new Date(recipe.updatedAt)) }}</span>
        <Badge
          v-if="recipe.visibility === 'private'"
          variant="outline"
        >
          Private: only you can see it
        </Badge>
      </p>

      <dl class="mt-4 flex flex-wrap gap-x-6 gap-y-2">
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

      <div
        v-if="tagGroups.length > 0"
        class="mt-4"
      >
        <dl class="space-y-2">
          <div
            v-for="group in tagGroups"
            :key="group.type"
            class="flex flex-wrap items-baseline gap-2"
          >
            <dt class="text-sm text-muted-foreground">
              {{ TAG_TYPE_LABELS[group.type] }}
            </dt>
            <dd
              v-for="tag in group.tags"
              :key="tag.id"
              class="rounded-full bg-secondary px-2.5 py-0.5 text-sm break-words text-secondary-foreground"
            >
              {{ tag.name }}
            </dd>
          </div>
        </dl>
        <p
          v-if="hasUnverifiedTags"
          class="mt-2 text-sm text-muted-foreground"
        >
          Allergen and diet tags are added by the people who use myli, and nobody checks them.
          Read the ingredients too.
        </p>
      </div>

      <MarkdownContent
        v-if="recipe.description"
        class="mt-6"
        :source="recipe.description"
        :heading-level="2"
      />

      <p
        v-if="source"
        class="mt-4 text-sm break-words"
      >
        From
        <a
          v-if="source.url"
          :href="source.url"
          rel="ugc nofollow noreferrer"
          class="underline underline-offset-2"
        >{{ source.linkText }}</a>
        <template v-else-if="source.linkText">
          {{ source.linkText }}
        </template>
        <template v-if="source.author">
          by {{ source.author }}
        </template>
      </p>

      <div class="mt-8 grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div class="space-y-8">
          <section aria-labelledby="ingredients-heading">
            <h2
              id="ingredients-heading"
              class="mb-3 text-xl font-semibold"
            >
              Ingredients
            </h2>
            <template v-if="recipe.ingredientGroups.length > 0">
              <div class="mb-4">
                <ServingsControl
                  ref="servingsControl"
                  v-model="servings"
                />
                <UnitSystemChoice
                  v-if="units.ready.value"
                  class="mt-3"
                  :model-value="units.system.value"
                  @update:model-value="units.choose"
                />
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
            <ul class="list-disc space-y-1 ps-6">
              <li
                v-for="(item, index) in recipe.equipment"
                :key="index"
              >
                {{ item }}
              </li>
            </ul>
          </section>
        </div>

        <div class="space-y-8">
          <section aria-labelledby="steps-heading">
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
                  :heading-level="3"
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
          >
            <h2
              id="nutrition-heading"
              class="text-xl font-semibold"
            >
              Nutrition
            </h2>
            <p class="mb-3 text-sm text-muted-foreground">
              Per serving, as entered by hand.
            </p>
            <dl class="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1">
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
