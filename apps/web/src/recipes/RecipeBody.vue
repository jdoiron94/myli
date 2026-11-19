<script setup lang="ts">
import { TriangleAlertIcon } from '@lucide/vue';
import { recipeTotalMinutes } from '@myli/shared';
import { computed } from 'vue';
import MarkdownContent from '@/components/MarkdownContent.vue';
import { USER_LINK_REL } from '@/lib/markdown.ts';
import {
  DIFFICULTY_LABELS,
  formatMinutes,
  formatNumber,
  nutritionFacts,
  shownTags,
} from './format.ts';
import RecipeCover from './RecipeCover.vue';
import RecipeSteps from './RecipeSteps.vue';
import type { RecipeRevisionContent } from './recipe.ts';
import ScaledIngredients from './ScaledIngredients.vue';

/**
 * What a recipe says, under its title: photos, description, source, tags, facts, ingredients scaled
 * to `servings`, equipment, steps and nutrition. As published, or as one of its revisions has it.
 */
const props = defineProps<{ content: RecipeRevisionContent }>();
const servings = defineModel<number>('servings', { required: true });

/** The cover shows at the top, and with it, in a slideshow, the recipe's other photos in order. */
const cover = computed(() =>
  props.content.images.find(({ id }) => id === props.content.coverImageId),
);
const otherPhotos = computed(() => props.content.images.filter((image) => image !== cover.value));

const facts = computed(() => {
  const shown = props.content;
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

const tags = computed(() => shownTags(props.content.tags));

const source = computed(() => {
  const value = props.content.source;
  if (value.url === null && value.title === null && value.author === null) return null;
  const linkText = value.title ?? (value.url === null ? null : new URL(value.url).hostname);
  return { url: value.url, linkText, author: value.author };
});

const nutrition = computed(() => nutritionFacts(props.content.nutrition));
</script>

<template>
  <div>
    <RecipeCover
      v-if="cover"
      :cover="cover"
      :others="otherPhotos"
      class="mt-6"
    />

    <MarkdownContent
      v-if="content.description"
      class="mt-6 max-w-prose"
      :source="content.description"
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
            :recipe="content"
          />
        </section>

        <section
          v-if="content.equipment.length > 0"
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
              v-for="(item, index) in content.equipment"
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
        <RecipeSteps :steps="content.steps" />
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
  </div>
</template>
