<script setup lang="ts">
import { ArrowDownIcon, ArrowUpIcon, ListPlusIcon, PlusIcon, XIcon } from '@lucide/vue';
import { RECIPE_LIMITS } from '@myli/shared';
import { useFieldArray, useFieldError } from 'vee-validate';
import { nextTick, useTemplateRef } from 'vue';
import MarkdownField from '@/components/MarkdownField.vue';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldError, FieldLegend, FieldSet } from '@/components/ui/field';
import { emptyStep, type StepValues } from './recipe-form.ts';

/** The recipe's steps, in order, each written in markdown (spec §3.2). */
const steps = useFieldArray<StepValues>('steps');
const fields = steps.fields;
const error = useFieldError('steps');

const root = useTemplateRef('root');
const full = () => fields.value.length >= RECIPE_LIMITS.steps;
const shownSteps = () => [...(root.value?.querySelectorAll('[data-step]') ?? [])];
/** A step's field: its rendered markdown, which opens the editor when focused, or the editor. */
const stepField = (step: Element | undefined) =>
  step?.querySelector<HTMLElement>('[role="textbox"]');

/** A blank step at `index`, and focus in it, to write it. */
async function add(index: number) {
  if (full()) return;
  steps.insert(index, emptyStep());
  await nextTick();
  stepField(shownSteps()[index])?.focus();
}

/** Focus stays on the button pressed, on the step now in its new place. */
async function move(index: number, by: -1 | 1) {
  steps.swap(index, index + by);
  await nextTick();
  const moved = shownSteps()[index + by];
  moved?.querySelector<HTMLElement>(`[data-move="${String(by)}"]`)?.focus();
}

/** Focus goes to the step that takes its place, or the one before, or the button to add one. */
async function remove(index: number) {
  steps.remove(index);
  await nextTick();
  const shown = shownSteps();
  const next = stepField(shown[index] ?? shown[index - 1]);
  if (next) next.focus();
  else root.value?.querySelector<HTMLElement>('[data-add-step]')?.focus();
}
</script>

<template>
  <div ref="root">
    <FieldSet>
      <FieldLegend>Steps</FieldLegend>
      <FieldDescription>
        One at a time, in order. Each can have formatting, like the description. Blank steps are
        left out.
      </FieldDescription>
      <ol
        v-if="fields.length > 0"
        class="space-y-4"
        aria-label="Steps"
      >
        <li
          v-for="(field, index) in fields"
          :key="field.key"
          data-step
        >
          <MarkdownField
            :name="`steps[${index}].body`"
            :label="`Step ${index + 1}`"
          >
            <template #actions>
              <div class="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="aria-disabled:opacity-50"
                  :aria-label="`Move step ${index + 1} up`"
                  :aria-disabled="index === 0 ? true : undefined"
                  data-move="-1"
                  @click="index === 0 || move(index, -1)"
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="aria-disabled:opacity-50"
                  :aria-label="`Move step ${index + 1} down`"
                  :aria-disabled="index === fields.length - 1 ? true : undefined"
                  data-move="1"
                  @click="index === fields.length - 1 || move(index, 1)"
                >
                  <ArrowDownIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="aria-disabled:opacity-50"
                  :aria-label="`Add a step after step ${index + 1}`"
                  :aria-disabled="full() ? true : undefined"
                  @click="add(index + 1)"
                >
                  <ListPlusIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Remove step ${index + 1}`"
                  @click="remove(index)"
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
            </template>
          </MarkdownField>
        </li>
      </ol>
      <FieldError :errors="error ? [error] : []" />
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="aria-disabled:opacity-50"
          data-add-step
          :aria-disabled="full() ? true : undefined"
          @click="add(fields.length)"
        >
          <PlusIcon aria-hidden="true" />
          Add a step
        </Button>
      </div>
    </FieldSet>
  </div>
</template>
