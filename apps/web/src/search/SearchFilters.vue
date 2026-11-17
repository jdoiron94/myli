<script setup lang="ts">
import { BanIcon } from '@lucide/vue';
import { ALLERGENS, DIFFICULTIES, type RecipeSearchQuery } from '@myli/shared';
import { computed, reactive, useId } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DIFFICULTY_LABELS } from '@/recipes/format.ts';
import {
  chosenCount,
  clearedFilters,
  filterValues,
  setValueState,
  shortList,
  TAG_FILTERS,
  type TagFilter,
  timeRanges,
  type ValueState,
} from './filters.ts';
import type { SearchResult } from './search.ts';

/**
 * The filters beside the search results (spec §3.4), each value with how many results it would
 * give. Each change is a new search, in the address; the page makes it.
 */
const props = defineProps<{ search: RecipeSearchQuery; facets: SearchResult['facets'] }>();
const emit = defineEmits<{ change: [changes: Partial<RecipeSearchQuery>] }>();

/** How many of a filter's values show until asked for all. */
const SHORT_LIST = 6;
/** The filters showing all their values. */
const showingAll = reactive(new Set<TagFilter['facet']>());

const tagFilters = computed(() =>
  TAG_FILTERS.map((filter) => {
    const values = filterValues(filter, props.search, props.facets);
    const shown = showingAll.has(filter.facet) ? values : shortList(values, SHORT_LIST);
    return { filter, values, shown };
  }).filter(({ values }) => values.length > 0),
);

function setState(filter: TagFilter, value: string, state: ValueState) {
  emit('change', setValueState(filter, props.search, value, state));
}

function toggleAll(facet: TagFilter['facet']) {
  if (!showingAll.delete(facet)) showingAll.add(facet);
}

function toggleList(key: 'difficulty' | 'excludeAllergen', value: string, on: boolean) {
  const others = (props.search[key] ?? []).filter((item) => item !== value);
  emit('change', { [key]: on ? [...others, value] : others });
}

const ranges = computed(() => timeRanges(props.search));

function chooseRange(value: unknown) {
  const range = ranges.value[0].find((item) => item.value === value);
  if (range) emit('change', { minMinutes: range.minMinutes, maxMinutes: range.maxMinutes });
}

/** Read after a count, only by screen readers: the count alone shows. */
const unit = (count: number) => (count === 1 ? ' recipe' : ' recipes');

const id = useId();
const valueId = (group: string, value: string) => `${id}-${group}-${value.replace(/\W/g, '_')}`;
const headingId = `${id}-heading`;
</script>

<template>
  <section :aria-labelledby="headingId">
    <div class="flex min-h-8 items-center justify-between gap-2">
      <h2
        :id="headingId"
        class="font-semibold"
      >
        Filters
      </h2>
      <Button
        v-if="chosenCount(search) > 0"
        variant="link"
        size="sm"
        class="px-0"
        @click="emit('change', clearedFilters())"
      >
        Clear filters
      </Button>
    </div>

    <div class="mt-3 flex flex-col gap-6">
      <FieldSet
        v-for="{ filter, values, shown } in tagFilters"
        :key="filter.facet"
        class="gap-2"
      >
        <FieldLegend
          variant="label"
          class="mb-0"
        >
          {{ filter.legend }}
        </FieldLegend>
        <FieldDescription class="text-xs">
          {{ filter.combine === 'any' ? 'Any of those checked.' : 'All of those checked.' }}
        </FieldDescription>
        <ul class="flex flex-col gap-1">
          <li
            v-for="item in shown"
            :key="item.value"
            class="flex items-center gap-2"
          >
            <Field
              orientation="horizontal"
              class="min-w-0 flex-1 gap-2"
            >
              <Checkbox
                :id="valueId(filter.facet, item.value)"
                :model-value="item.state === 'included'"
                :aria-describedby="
                  item.state === 'excluded' ? undefined : `${valueId(filter.facet, item.value)}-count`
                "
                @update:model-value="setState(filter, item.value, $event === true ? 'included' : null)"
              />
              <FieldLabel
                :for="valueId(filter.facet, item.value)"
                class="min-w-0 py-1 font-normal break-words"
                :class="item.state === 'excluded' && 'text-muted-foreground line-through'"
              >
                {{ item.value }}
              </FieldLabel>
            </Field>
            <span
              v-if="item.state !== 'excluded'"
              :id="`${valueId(filter.facet, item.value)}-count`"
              class="text-xs text-muted-foreground tabular-nums"
            >
              {{ item.count.toLocaleString() }}<span class="sr-only">{{ unit(item.count) }}</span>
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              class="text-muted-foreground aria-pressed:bg-destructive/10 aria-pressed:text-destructive"
              :aria-label="`Leave out ${item.value}`"
              :aria-pressed="item.state === 'excluded'"
              :title="`Leave out ${item.value}`"
              @click="setState(filter, item.value, item.state === 'excluded' ? null : 'excluded')"
            >
              <BanIcon aria-hidden="true" />
            </Button>
          </li>
        </ul>
        <Button
          v-if="values.length > shown.length || showingAll.has(filter.facet)"
          variant="link"
          size="sm"
          class="self-start px-0"
          :aria-expanded="showingAll.has(filter.facet)"
          @click="toggleAll(filter.facet)"
        >
          {{ showingAll.has(filter.facet) ? 'Show fewer' : `Show all ${values.length} ${filter.plural}` }}
        </Button>
      </FieldSet>

      <FieldSet class="gap-2">
        <FieldLegend
          variant="label"
          class="mb-0"
        >
          Difficulty
        </FieldLegend>
        <FieldDescription class="text-xs">
          Any of those checked.
        </FieldDescription>
        <ul class="flex flex-col gap-1">
          <li
            v-for="difficulty in DIFFICULTIES"
            :key="difficulty"
            class="flex items-center gap-2"
          >
            <Field
              orientation="horizontal"
              class="min-w-0 flex-1 gap-2"
            >
              <Checkbox
                :id="valueId('difficulty', difficulty)"
                :model-value="search.difficulty?.includes(difficulty) ?? false"
                :aria-describedby="`${valueId('difficulty', difficulty)}-count`"
                @update:model-value="toggleList('difficulty', difficulty, $event === true)"
              />
              <FieldLabel
                :for="valueId('difficulty', difficulty)"
                class="py-1 font-normal"
              >
                {{ DIFFICULTY_LABELS[difficulty] }}
              </FieldLabel>
            </Field>
            <span
              :id="`${valueId('difficulty', difficulty)}-count`"
              class="text-xs text-muted-foreground tabular-nums"
            >
              {{ (facets.difficulty[difficulty] ?? 0).toLocaleString() }}<span class="sr-only">{{ unit(facets.difficulty[difficulty] ?? 0) }}</span>
            </span>
            <!-- Where the tag filters have their Leave out button, so the counts line up. -->
            <span class="size-6 shrink-0" />
          </li>
        </ul>
      </FieldSet>

      <FieldSet class="gap-2">
        <FieldLegend
          variant="label"
          class="mb-0"
        >
          Total time
        </FieldLegend>
        <RadioGroup
          :model-value="ranges[1].value"
          class="gap-1"
          @update:model-value="chooseRange"
        >
          <Field
            v-for="range in ranges[0]"
            :key="range.value"
            orientation="horizontal"
            class="gap-2"
          >
            <RadioGroupItem
              :id="valueId('time', range.value)"
              :value="range.value"
            />
            <FieldLabel
              :for="valueId('time', range.value)"
              class="py-1 font-normal"
            >
              {{ range.label }}
            </FieldLabel>
          </Field>
        </RadioGroup>
      </FieldSet>

      <FieldSet class="gap-2">
        <FieldLegend
          variant="label"
          class="mb-0"
        >
          Leave out recipes with
        </FieldLegend>
        <ul class="flex flex-col gap-1">
          <li
            v-for="allergen in ALLERGENS"
            :key="allergen"
            class="flex items-center gap-2"
          >
            <Field
              orientation="horizontal"
              class="min-w-0 flex-1 gap-2"
            >
              <Checkbox
                :id="valueId('allergen', allergen)"
                :model-value="search.excludeAllergen?.includes(allergen) ?? false"
                :aria-describedby="
                  search.excludeAllergen?.includes(allergen) ? undefined : `${valueId('allergen', allergen)}-count`
                "
                @update:model-value="toggleList('excludeAllergen', allergen, $event === true)"
              />
              <FieldLabel
                :for="valueId('allergen', allergen)"
                class="py-1 font-normal"
              >
                {{ allergen }}
              </FieldLabel>
            </Field>
            <!-- How many results contain it: those it would leave out. -->
            <span
              v-if="!search.excludeAllergen?.includes(allergen)"
              :id="`${valueId('allergen', allergen)}-count`"
              class="text-xs text-muted-foreground tabular-nums"
            >
              {{ (facets.allergen[allergen] ?? 0).toLocaleString() }}<span class="sr-only">{{ unit(facets.allergen[allergen] ?? 0) }}</span>
            </span>
            <span class="size-6 shrink-0" />
          </li>
        </ul>
      </FieldSet>
    </div>
  </section>
</template>
