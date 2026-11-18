<script setup lang="ts">
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ImagePlusIcon,
  ListPlusIcon,
  PlusIcon,
  XIcon,
} from '@lucide/vue';
import { RECIPE_LIMITS } from '@myli/shared';
import { useFieldArray, useFieldError, useFormErrors } from 'vee-validate';
import { computed, nextTick, reactive, useId, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import FormTextField from '@/components/FormTextField.vue';
import MarkdownField from '@/components/MarkdownField.vue';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldError, FieldLegend, FieldSet } from '@/components/ui/field';
import { useForgetErrors } from '@/lib/forms.ts';
import PhotoPicker from './PhotoPicker.vue';
import type { PhotoLibrary } from './photo-library.ts';
import { photoFileProblem, STEP_EDITOR_PHOTO_SIZES } from './photos.ts';
import RecipePhoto from './RecipePhoto.vue';
import { emptyStep, type StepValues } from './recipe-form.ts';

/** The recipe's steps, in order, each written in markdown and with a photo if wanted (spec §3.2). */
const props = defineProps<{ library: PhotoLibrary }>();

const steps = useFieldArray<StepValues>('steps');
const fields = steps.fields;
const error = useFieldError('steps');
const formErrors = useFormErrors();
const forgetRefusals = useForgetErrors((path) => /^steps\[\d+\]\.image\.id$/.test(path));

const id = useId();
type StepKey = (typeof fields.value)[number]['key'];
/** What went wrong adding a photo to a step, by the step's key, so it stays with the step. */
const photoProblems = reactive(new Map<StepKey, string>());
/** The steps a photo is uploading for, by key. */
const uploading = reactive(new Set<StepKey>());

const rows = computed(() =>
  fields.value.map((field, index) => {
    const { image } = field.value;
    // The API's refusal of a save, for the step at this place, or what went wrong adding it.
    const refusal = formErrors.value[`steps[${String(index)}].image.id`];
    const problem = refusal ?? photoProblems.get(field.key);
    return {
      key: field.key,
      photo: image === null ? undefined : props.library.get(image.id),
      hasPhoto: image !== null,
      problem,
    };
  }),
);

const root = useTemplateRef('root');
const full = () => fields.value.length >= RECIPE_LIMITS.steps;
const shownSteps = () => [...(root.value?.querySelectorAll('[data-step]') ?? [])];
/** A step's field: its rendered markdown, which opens the editor when focused, or the editor. */
const stepField = (step: Element | undefined) =>
  step?.querySelector<HTMLElement>('[role="textbox"]');

/** A blank step at `index`, and focus in it, to write it. */
async function add(index: number) {
  if (full()) return;
  forgetRefusals();
  steps.insert(index, emptyStep());
  await nextTick();
  stepField(shownSteps()[index])?.focus();
}

/** Focus stays on the button pressed, on the step now in its new place. */
async function move(index: number, by: -1 | 1) {
  forgetRefusals();
  steps.swap(index, index + by);
  await nextTick();
  const moved = shownSteps()[index + by];
  moved?.querySelector<HTMLElement>(`[data-move="${String(by)}"]`)?.focus();
}

/** Focus goes to the step that takes its place, or the one before, or the button to add one. */
async function remove(index: number) {
  forgetRefusals();
  steps.remove(index);
  await nextTick();
  const shown = shownSteps();
  const next = stepField(shown[index] ?? shown[index - 1]);
  if (next) next.focus();
  else root.value?.querySelector<HTMLElement>('[data-add-step]')?.focus();
}

/** Uploads a photo for the step, refusing what the API would, and gives it to the step. */
async function addPhoto(key: StepKey, [file]: File[]) {
  if (!file) return;
  forgetRefusals();
  photoProblems.delete(key);
  const problem = photoFileProblem(file);
  if (problem !== undefined) {
    photoProblems.set(key, problem);
    return;
  }
  uploading.add(key);
  try {
    const image = await props.library.upload(file);
    // Wherever the step is now: it may have moved, or gone, while the photo uploaded.
    const index = fields.value.findIndex((field) => field.key === key);
    const step = fields.value[index];
    if (step) steps.update(index, { ...step.value, image: { id: image.id, alt: '' } });
  } catch (failure) {
    photoProblems.set(key, failureMessage(failure));
  } finally {
    uploading.delete(key);
  }
}

/** Focus goes to the button to add a photo, which takes the photo's place. */
async function removePhoto(index: number) {
  const step = fields.value[index];
  if (!step) return;
  forgetRefusals();
  steps.update(index, { ...step.value, image: null });
  await nextTick();
  shownSteps()[index]?.querySelector<HTMLElement>('[data-add-photo]')?.focus();
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
          v-for="(row, index) in rows"
          :key="row.key"
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
                  :aria-disabled="index === rows.length - 1 ? true : undefined"
                  data-move="1"
                  @click="index === rows.length - 1 || move(index, 1)"
                >
                  <ArrowDownIcon aria-hidden="true" />
                </Button>
                <PhotoPicker
                  v-if="!row.hasPhoto"
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Add a photo to step ${index + 1}`"
                  :unavailable="uploading.has(row.key)"
                  data-add-photo
                  @picked="addPhoto(row.key, $event)"
                >
                  <ImagePlusIcon aria-hidden="true" />
                </PhotoPicker>
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
          <div
            v-if="row.hasPhoto"
            class="mt-3 flex flex-wrap items-end gap-3"
          >
            <RecipePhoto
              v-if="row.photo"
              :image="row.photo"
              :sizes="STEP_EDITOR_PHOTO_SIZES"
              alt=""
              class="aspect-[4/3] w-40 rounded-md object-cover sm:w-48"
            />
            <div class="flex min-w-48 flex-1 flex-col items-start gap-3">
              <FormTextField
                class="w-full"
                :name="`steps[${index}].image.alt`"
                :label="`Alt text for step ${index + 1}’s photo`"
                multiline
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                :aria-label="`Remove photo from step ${index + 1}`"
                :aria-describedby="row.problem ? `${id}-${index}-photo-error` : undefined"
                @click="removePhoto(index)"
              >
                <XIcon aria-hidden="true" />
                Remove photo
              </Button>
            </div>
          </div>
          <FieldError
            :id="`${id}-${index}-photo-error`"
            class="mt-2"
            :errors="row.problem ? [row.problem] : []"
          />
        </li>
      </ol>
      <FieldError :errors="error ? [error] : []" />
      <div class="flex flex-wrap items-center gap-3">
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
        <p
          role="status"
          class="text-sm text-muted-foreground"
        >
          <template v-if="uploading.size > 0">
            Uploading {{ uploading.size === 1 ? 'a photo' : `${uploading.size} photos` }}…
          </template>
        </p>
      </div>
    </FieldSet>
  </div>
</template>
