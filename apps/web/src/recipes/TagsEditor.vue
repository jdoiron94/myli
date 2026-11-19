<script setup lang="ts">
import { can, type TagType, type USER_TAG_TYPES } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { useField, useFieldError, useFormErrors, useSetFieldError } from 'vee-validate';
import { computed, nextTick, useId, useTemplateRef, watch } from 'vue';
import { useRetry } from '@/api/retry.ts';
import { sessionQuery } from '@/auth/session.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { useForgetErrors } from '@/lib/forms.ts';
import NewTagField from './NewTagField.vue';
import type { Tag } from './recipe.ts';
import { tagsQuery } from './tags.ts';

/**
 * The recipe's tags: each type's tags as checkboxes, and for each type but the allergens, a field
 * to add one. A household's tags number in the dozens, so all of them show: picking is one click,
 * and seeing what exists keeps "Italian" from gaining an "Italian food".
 */

type UserTagType = (typeof USER_TAG_TYPES)[number];

/** Each type, in the order the recipe page shows them, with what the editor calls it. */
const TYPES: ({ type: TagType; legend: string } & (
  | { type: 'allergen' }
  | { type: UserTagType; noun: string; example: string }
))[] = [
  { type: 'cuisine', legend: 'Cuisine', noun: 'cuisine', example: 'Like Thai, or Southern.' },
  { type: 'meal_type', legend: 'Meal', noun: 'meal', example: 'Like Breakfast, or Side dish.' },
  { type: 'diet', legend: 'Diet', noun: 'diet', example: 'Like Vegetarian, or Gluten-free.' },
  { type: 'allergen', legend: 'Contains' },
  { type: 'custom', legend: 'Other tags', noun: 'tag', example: 'Like Weeknight, or Holiday.' },
];

const { value: chosen } = useField<number[]>('tagIds');
const error = useFieldError('tagIds');
const setError = useSetFieldError('tagIds');

/**
 * The API refuses a chosen tag that no longer exists, at its place in `tagIds`, which says nothing
 * once the tags chosen change: those refusals are forgotten then.
 */
const formErrors = useFormErrors();
const forgetRefusals = useForgetErrors((path) => /^tagIds\[\d+\]$/.test(path));
const refusalOf = (tag: Tag) => {
  const index = chosen.value.indexOf(tag.id);
  return index === -1 ? undefined : formErrors.value[`tagIds[${String(index)}]`];
};

const tags = useQuery(tagsQuery);
const { failure, retrying, stillFailing, retry } = useRetry(tags);
const { data: user } = useQuery(sessionQuery);
const canCreate = computed(() => can(user.value ?? null, 'tag.create'));

const byType = computed(() => {
  const groups = new Map<TagType, Tag[]>();
  for (const tag of tags.data.value ?? [])
    groups.set(tag.type, [...(groups.get(tag.type) ?? []), tag]);
  return groups;
});

const id = useId();
const checkboxId = (tag: Tag) => `${id}-tag-${String(tag.id)}`;
const refusalId = (tag: Tag) => `${checkboxId(tag)}-refusal`;

function toggle(tag: Tag, on: boolean) {
  const others = chosen.value.filter((tagId) => tagId !== tag.id);
  chosen.value = on ? [...others, tag.id] : others;
  forgetRefusals();
}

/**
 * A tag an admin deleted, or merged into another, leaves the list once it's fetched again. Chosen,
 * it would have no checkbox to take it off, and saving would fail: it's taken off, saying so. Only
 * a tag that was in the list before goes: one the list hasn't caught up with yet, like a tag added
 * to the recipe since the list was fetched, is still to come.
 */
watch(
  () => tags.data.value,
  (now, before) => {
    if (!now || !before) return;
    const exists = new Set(now.map((tag) => tag.id));
    const gone = before.filter((tag) => !exists.has(tag.id) && chosen.value.includes(tag.id));
    if (gone.length === 0) return;
    chosen.value = chosen.value.filter((tagId) => !gone.some((tag) => tag.id === tagId));
    forgetRefusals();
    const names = gone.map((tag) => tag.name);
    setError(
      names.length === 1
        ? `${names.join('')} no longer exists, so it's no longer chosen.`
        : `${names.join(', ')} no longer exist, so they're no longer chosen.`,
    );
  },
);

const root = useTemplateRef('root');

/** A new tag, or one the type already had, is chosen, and focus goes to it. */
async function added(tag: Tag) {
  toggle(tag, true);
  await nextTick();
  root.value?.querySelector<HTMLElement>(`#${CSS.escape(checkboxId(tag))}`)?.focus();
}
</script>

<template>
  <div ref="root">
    <FieldSet>
      <FieldLegend>Tags</FieldLegend>
      <!-- Tags already loaded stay, should loading them again fail. -->
      <template v-if="tags.data.value">
        <FieldSet
          v-for="group in TYPES"
          :key="group.type"
          class="gap-3"
        >
          <FieldLegend variant="label">
            {{ group.legend }}
          </FieldLegend>
          <div
            v-if="byType.get(group.type)"
            class="flex flex-wrap gap-x-5 gap-y-2"
          >
            <Field
              v-for="tag in byType.get(group.type)"
              :key="tag.id"
              orientation="horizontal"
              class="w-auto"
            >
              <Checkbox
                :id="checkboxId(tag)"
                :model-value="chosen.includes(tag.id)"
                :aria-invalid="refusalOf(tag) ? true : undefined"
                :aria-describedby="refusalOf(tag) ? refusalId(tag) : undefined"
                @update:model-value="toggle(tag, $event === true)"
              />
              <FieldLabel
                :for="checkboxId(tag)"
                class="font-normal"
              >
                {{ tag.name }}
              </FieldLabel>
            </Field>
          </div>
          <template
            v-for="tag in byType.get(group.type)"
            :key="tag.id"
          >
            <FieldError
              v-if="refusalOf(tag)"
              :id="refusalId(tag)"
              :errors="[`${tag.name}: ${refusalOf(tag) ?? ''}`]"
            />
          </template>
          <NewTagField
            v-if="group.type !== 'allergen' && canCreate"
            :type="group.type"
            :noun="group.noun"
            :example="group.example"
            @added="added"
          />
        </FieldSet>
      </template>
      <RetryableFailure
        v-else-if="failure"
        :error="failure"
        :retrying="retrying"
        :still-failing="stillFailing"
        @retry="retry"
      />
      <p
        v-else
        class="text-sm text-muted-foreground"
      >
        Loading the tags…
      </p>
      <FieldError :errors="error ? [error] : []" />
    </FieldSet>
  </div>
</template>
