<script setup lang="ts">
import { ArrowLeftIcon, CheckIcon, PrinterIcon } from '@lucide/vue';
import { displayTotal, formatAmount, groceryList } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, useId, watchEffect } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useUnitSystem } from '@/account/preferences.ts';
import { failureMessage } from '@/api/failure.ts';
import { ApiProblem } from '@/api/problem.ts';
import { useRetry } from '@/api/retry.ts';
import { collectionIngredientsQuery, useGroceryChoices } from '@/collections/groceries.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import ServingsControl from '@/recipes/ServingsControl.vue';
import UnitSystemChoice from '@/recipes/UnitSystemChoice.vue';
import { documentTitle } from '@/router.ts';

/**
 * A collection's grocery list (spec §3.5): its recipes' ingredients, each at the servings chosen
 * here, added up into one line per ingredient, to tick off on screen or on paper. The servings and
 * the ticks live in the address; nothing is saved.
 */
const props = defineProps<{ id: string }>();

const query = useQuery(computed(() => collectionIngredientsQuery(props.id)));
const { failure, retrying, stillFailing, retry } = useRetry(query);
const collection = computed(() => query.data.value);
// Asked for as the page opens, alongside the recipes, so the amounts show as soon as they do.
const units = useUnitSystem();

/** The API answers 404 alike for a collection that doesn't exist and someone else's. */
const notFound = computed(
  () => failure.value instanceof ApiProblem && failure.value.status === 404,
);
const heading = computed(() => (notFound.value ? 'Collection not found' : 'Grocery list'));

const route = useRoute();
watchEffect(() => {
  // Only while this page is the current one: the router sets the next page's title as it leaves.
  if (route.name !== 'collection-groceries') return;
  if (collection.value) document.title = documentTitle(`Grocery list: ${collection.value.name}`);
  else if (notFound.value) document.title = documentTitle(heading.value);
});

const choices = useGroceryChoices();

const lines = computed(() =>
  groceryList(
    (collection.value?.recipes ?? []).map((recipe) => ({
      recipe,
      servings: choices.servingsOf(recipe),
    })),
  ).map(({ key, name, amounts, recipes }) => ({
    key,
    text: [
      name,
      amounts.map((amount) => formatAmount(displayTotal(amount, units.system.value))).join(', '),
    ]
      .filter(Boolean)
      .join(': '),
    recipes: recipes.map(({ title }) => title).join(', '),
  })),
);

const servingsText = (count: number) => `${String(count)} ${count === 1 ? 'serving' : 'servings'}`;

/** A recipe's page, at the servings chosen here. */
function recipeLink(recipe: { id: string; servings: number }) {
  const servings = choices.servingsOf(recipe);
  return {
    name: 'recipe',
    params: { id: recipe.id },
    query: servings === recipe.servings ? {} : { servings: String(servings) },
  };
}

const ids = useId();

/** The browser's own dialog, which prints the list as it's shown. */
function print() {
  window.print();
}
</script>

<template>
  <article>
    <RouterLink
      :to="{ name: 'collection', params: { id } }"
      class="inline-flex items-center gap-1.5 rounded-md text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none print:hidden"
    >
      <ArrowLeftIcon
        class="size-4"
        aria-hidden="true"
      />
      Back to collection
    </RouterLink>
    <h1 class="mt-4 text-2xl font-semibold break-words print:mt-0">
      {{ heading }}
    </h1>

    <template v-if="collection">
      <p class="mt-1 break-words text-muted-foreground">
        {{ collection.name }}
      </p>
      <div class="mt-4 flex flex-wrap items-center gap-2 print:hidden">
        <Button
          variant="outline"
          size="sm"
          @click="print"
        >
          <PrinterIcon aria-hidden="true" />
          Print
        </Button>
        <UnitSystemChoice
          v-if="units.ready.value"
          :model-value="units.system.value"
          @update:model-value="units.choose"
        />
      </div>
      <p
        v-if="units.failure.value"
        role="alert"
        class="mt-3 text-sm text-destructive print:hidden"
      >
        Your choice of units couldn't be saved. {{ failureMessage(units.failure.value) }}
      </p>

      <template v-if="collection.recipes.length > 0">
        <section
          aria-labelledby="recipes-heading"
          class="mt-8"
        >
          <h2
            id="recipes-heading"
            class="mb-3 text-lg font-semibold"
          >
            Recipes
          </h2>
          <ul class="space-y-3 print:space-y-1">
            <li
              v-for="recipe in collection.recipes"
              :key="recipe.id"
              class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
            >
              <span class="min-w-0 break-words">
                <RouterLink
                  :to="recipeLink(recipe)"
                  class="rounded-md font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >{{ recipe.title }}</RouterLink>
                <!-- On paper, the servings the control shows on screen. -->
                <span class="hidden print:inline">, {{ servingsText(choices.servingsOf(recipe)) }}</span>
              </span>
              <ServingsControl
                class="print:hidden"
                :of="recipe.title"
                :model-value="choices.servingsOf(recipe)"
                @update:model-value="choices.setServings(recipe, $event)"
              />
            </li>
          </ul>
        </section>

        <section
          aria-labelledby="groceries-heading"
          class="mt-8"
        >
          <h2
            id="groceries-heading"
            class="mb-3 text-lg font-semibold"
          >
            To buy
          </h2>
          <ul
            v-if="units.ready.value && lines.length > 0"
            class="divide-y"
          >
            <li
              v-for="(line, index) in lines"
              :key="line.key"
              class="py-2.5 print:break-inside-avoid print:py-1.5"
            >
              <Field
                orientation="horizontal"
                class="items-start"
              >
                <!-- A box to tick on screen, and one drawn for paper, ticked as it's shown. The
                     checkbox is named here: reka-ui otherwise names it once, from its label's text
                     as it mounts, which the amounts then outgrow. -->
                <Checkbox
                  :id="`${ids}-${index}`"
                  class="mt-0.5 print:hidden"
                  :aria-label="line.text"
                  :model-value="choices.isTicked(line.key)"
                  :aria-describedby="`${ids}-${index}-recipes`"
                  @update:model-value="choices.tick(line.key, $event === true)"
                />
                <span
                  aria-hidden="true"
                  class="mt-0.5 hidden size-4 shrink-0 items-center justify-center rounded-[4px] border border-foreground print:flex"
                >
                  <CheckIcon
                    v-if="choices.isTicked(line.key)"
                    class="size-3.5"
                  />
                </span>
                <FieldContent>
                  <FieldLabel
                    :for="`${ids}-${index}`"
                    class="text-base font-normal break-words"
                    :class="{ 'text-muted-foreground line-through': choices.isTicked(line.key) }"
                  >
                    {{ line.text }}
                  </FieldLabel>
                  <FieldDescription :id="`${ids}-${index}-recipes`">
                    {{ line.recipes }}
                  </FieldDescription>
                </FieldContent>
              </Field>
            </li>
          </ul>
          <p
            v-else-if="units.ready.value"
            class="text-muted-foreground"
          >
            Its recipes have no ingredients yet.
          </p>
        </section>
      </template>
      <p
        v-else
        class="mt-6 text-muted-foreground"
      >
        There are no recipes in this collection, so there's nothing to buy yet.
      </p>
    </template>

    <p
      v-else-if="notFound"
      class="mt-2 text-muted-foreground"
    >
      This collection doesn't exist, or was deleted.
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
      Loading the grocery list…
    </p>
  </article>
</template>
