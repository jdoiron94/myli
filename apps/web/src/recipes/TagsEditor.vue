<script setup lang="ts">
import { can, type TagType, type USER_TAG_TYPES } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { useField, useFieldError } from 'vee-validate';
import { computed, nextTick, useId, useTemplateRef } from 'vue';
import { useRetry } from '@/api/retry.ts';
import { sessionQuery } from '@/auth/session.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
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

function toggle(tag: Tag, on: boolean) {
  const others = chosen.value.filter((tagId) => tagId !== tag.id);
  chosen.value = on ? [...others, tag.id] : others;
}

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
      <FieldDescription>
        Allergen and diet tags are added by the people who use myli, and nobody checks them.
      </FieldDescription>
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
