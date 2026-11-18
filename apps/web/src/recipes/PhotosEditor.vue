<script setup lang="ts">
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ImagePlusIcon,
  XIcon,
} from '@lucide/vue';
import { RECIPE_LIMITS } from '@myli/shared';
import { useField, useFieldArray, useFieldError, useFormErrors } from 'vee-validate';
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import FormTextField from '@/components/FormTextField.vue';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldError, FieldLegend, FieldSet } from '@/components/ui/field';
import { useForgetErrors } from '@/lib/forms.ts';
import PhotoPicker from './PhotoPicker.vue';
import type { PhotoLibrary } from './photo-library.ts';
import { EDITOR_PHOTO_SIZES, photoFileProblem } from './photos.ts';
import RecipePhoto from './RecipePhoto.vue';
import type { PhotoValues } from './recipe-form.ts';

/** The recipe's photos, in order, each with its alt text, and which is its cover (spec §3.2). */
const props = defineProps<{ library: PhotoLibrary }>();

const photos = useFieldArray<PhotoValues>('images');
const { value: cover } = useField<string | null>('coverImageId');
const listError = useFieldError('images');
const formErrors = useFormErrors();
const forgetRefusals = useForgetErrors((path) => /^images\[\d+\]\.id$/.test(path));

const id = useId();
const root = useTemplateRef('root');
const shown = computed(() =>
  photos.fields.value.map((field, index) => ({
    key: field.key,
    id: field.value.id,
    image: props.library.get(field.value.id),
    // Set by the API's refusal of a save, for the photo at this place.
    error: formErrors.value[`images[${String(index)}].id`],
  })),
);
const full = () => shown.value.length >= RECIPE_LIMITS.images;
const TOO_MANY = `A recipe can have up to ${String(RECIPE_LIMITS.images)} photos.`;

/** Which of the photos picked is uploading, while they are. */
const progress = ref<{ at: number; of: number }>();
/** What went wrong with the files picked last, each with its name. */
const problems = ref<string[]>([]);

/** Uploads the files picked one after another, in order, refusing what the API would. */
async function add(files: File[]) {
  forgetRefusals();
  problems.value = [];
  const room = RECIPE_LIMITS.images - shown.value.length;
  const accepted: File[] = [];
  for (const file of files) {
    const problem = photoFileProblem(file) ?? (accepted.length >= room ? TOO_MANY : undefined);
    if (problem === undefined) accepted.push(file);
    else problems.value.push(`${file.name}: ${problem}`);
  }
  for (const [index, file] of accepted.entries()) {
    progress.value = { at: index + 1, of: accepted.length };
    try {
      const image = await props.library.upload(file);
      photos.push({ id: image.id, alt: '' });
      // The first photo is the cover until another is chosen.
      cover.value ??= image.id;
    } catch (error) {
      problems.value.push(`${file.name}: ${failureMessage(error)}`);
    }
  }
  progress.value = undefined;
}

const cards = () => [...(root.value?.querySelectorAll('[data-photo]') ?? [])];

/** Focus stays on the button pressed, on the photo in its new place. */
async function move(index: number, by: -1 | 1) {
  forgetRefusals();
  photos.swap(index, index + by);
  await nextTick();
  const moved = cards()[index + by];
  moved?.querySelector<HTMLElement>(`[data-move="${String(by)}"]`)?.focus();
}

/**
 * Removing the cover makes the first photo left the cover. Focus goes to the photo that takes its
 * place, or the one before, or the button to add photos.
 */
async function remove(index: number) {
  forgetRefusals();
  const removed = shown.value[index]?.id;
  photos.remove(index);
  if (cover.value === removed) cover.value = shown.value[0]?.id ?? null;
  await nextTick();
  const next = cards()[index] ?? cards()[index - 1];
  const target =
    next?.querySelector<HTMLElement>('[data-remove]') ??
    root.value?.querySelector<HTMLElement>('[data-add-photos]');
  target?.focus();
}
</script>

<template>
  <div ref="root">
    <FieldSet>
      <FieldLegend>Photos</FieldLegend>
      <FieldDescription>
        JPEG, PNG or WebP, up to 10 MB each. The cover shows at the top of the recipe and in lists.
        Alt text says what a photo shows, for people who can’t see it.
      </FieldDescription>
      <ul
        v-if="shown.length > 0"
        class="grid grid-cols-1 gap-4 sm:grid-cols-3 md:grid-cols-4"
      >
        <li
          v-for="(photo, index) in shown"
          :key="photo.key"
          class="flex flex-col gap-2"
          data-photo
        >
          <RecipePhoto
            v-if="photo.image"
            :image="photo.image"
            :sizes="EDITOR_PHOTO_SIZES"
            alt=""
            class="aspect-[4/3] w-full rounded-md object-cover"
          />
          <div class="flex flex-wrap items-center justify-between gap-1">
            <!-- Native radios, grouped by name: a radio group's role allows nothing but radios
                 inside it, and each photo has buttons too. -->
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="coverImageId"
                class="size-4 cursor-pointer accent-primary"
                :value="photo.id"
                :checked="cover === photo.id"
                :aria-label="`Cover: photo ${index + 1}`"
                :aria-invalid="photo.error ? true : undefined"
                :aria-describedby="photo.error ? `${id}-${index}-error` : undefined"
                @change="cover = photo.id"
              >
              Cover
            </label>
            <div class="flex">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="aria-disabled:opacity-50"
                :aria-label="`Move photo ${index + 1} earlier`"
                :aria-disabled="index === 0 ? true : undefined"
                data-move="-1"
                @click="index === 0 || move(index, -1)"
              >
                <!-- Up on phones, where the photos are one to a row; left beside each other. -->
                <ArrowUpIcon
                  aria-hidden="true"
                  class="sm:hidden"
                />
                <ArrowLeftIcon
                  aria-hidden="true"
                  class="hidden sm:block"
                />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="aria-disabled:opacity-50"
                :aria-label="`Move photo ${index + 1} later`"
                :aria-disabled="index === shown.length - 1 ? true : undefined"
                data-move="1"
                @click="index === shown.length - 1 || move(index, 1)"
              >
                <ArrowDownIcon
                  aria-hidden="true"
                  class="sm:hidden"
                />
                <ArrowRightIcon
                  aria-hidden="true"
                  class="hidden sm:block"
                />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                :aria-label="`Remove photo ${index + 1}`"
                data-remove
                @click="remove(index)"
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          </div>
          <FieldError
            :id="`${id}-${index}-error`"
            :errors="photo.error ? [photo.error] : []"
          />
          <FormTextField
            :name="`images[${index}].alt`"
            :label="`Alt text for photo ${index + 1}`"
            multiline
          />
        </li>
      </ul>
      <FieldError :errors="listError ? [listError] : []" />
      <div class="flex flex-wrap items-center gap-3">
        <PhotoPicker
          multiple
          data-add-photos
          :unavailable="full() || progress !== undefined"
          @picked="add"
        >
          <ImagePlusIcon aria-hidden="true" />
          Add photos
        </PhotoPicker>
        <p
          role="status"
          class="text-sm text-muted-foreground"
        >
          <template v-if="progress">
            Uploading photo {{ progress.at }} of {{ progress.of }}…
          </template>
        </p>
      </div>
      <FieldError :errors="problems" />
    </FieldSet>
  </div>
</template>
