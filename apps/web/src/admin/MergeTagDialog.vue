<script setup lang="ts">
import { mergeTagRequestSchema } from '@myli/shared';
import { useForm } from 'vee-validate';
import { computed, ref, useTemplateRef } from 'vue';
import { z } from 'zod';
import { failureMessage } from '@/api/failure.ts';
import FormRadioField from '@/components/FormRadioField.vue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { apiFieldErrors, focusFirstInvalidField, formSchema } from '@/lib/forms.ts';
import type { Tag } from '@/recipes/recipe.ts';
import { type ManagedTag, useMergeTag } from './tags.ts';

/** A tag's Merge button, and the dialog it opens to choose the tag of its type to merge it into. */
const props = defineProps<{
  tag: Tag;
  /** The other tags of its type. */
  others: readonly ManagedTag[];
  /**
   * Called with the tag it went into, and the tag as it was. A callback, not an event: merging
   * takes the tag's row off the list, and this dialog with it, before it can say so, and Vue drops
   * events from a component that's gone.
   */
  onMerged: (into: Tag, from: Tag) => void;
}>();

const CHOOSE = 'Choose the tag to merge it into.';

/** Radios hold text: the chosen tag's ID, as the API takes it. */
const mergeFormSchema = z
  .object({ intoId: z.string({ error: CHOOSE }).min(1, CHOOSE).transform(Number) })
  .pipe(mergeTagRequestSchema);

const open = ref(false);
/** Why merging failed, when it isn't a problem with the choice. */
const failure = ref<string>();

const { handleSubmit, isSubmitting, setErrors, resetForm } = useForm({
  validationSchema: formSchema(mergeFormSchema),
  initialValues: { intoId: '' },
});

function setOpen(value: boolean) {
  if (value) {
    resetForm({ values: { intoId: '' } });
    failure.value = undefined;
  }
  open.value = value;
}

const recipeCount = (count: number) => (count === 1 ? '1 recipe' : `${String(count)} recipes`);
const choices = computed(() =>
  props.others.map((other) => ({
    value: String(other.id),
    label: other.name,
    description: recipeCount(other.recipes),
  })),
);

const form = useTemplateRef('form');
const merge = useMergeTag();

const mergeOnSubmit = handleSubmit(
  async ({ intoId }) => {
    failure.value = undefined;
    const from = { ...props.tag };
    try {
      const into = await merge.mutateAsync({ id: props.tag.id, intoId });
      open.value = false;
      props.onMerged(into, from);
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, ['intoId'] as const);
      if (fieldErrors) {
        setErrors(fieldErrors);
        focusFirstInvalidField(form.value);
      } else {
        failure.value = failureMessage(error);
      }
    }
  },
  () => {
    focusFirstInvalidField(form.value);
  },
);

function submit(event: Event) {
  event.preventDefault();
  if (!isSubmitting.value) void mergeOnSubmit(event);
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="setOpen"
  >
    <DialogTrigger as-child>
      <Button
        variant="outline"
        size="sm"
        :aria-label="`Merge ${tag.name}`"
      >
        Merge
      </Button>
    </DialogTrigger>
    <DialogContent>
      <form
        ref="form"
        novalidate
        class="grid gap-6"
        @submit="submit"
      >
        <DialogHeader>
          <DialogTitle>Merge “{{ tag.name }}” into another tag</DialogTitle>
          <DialogDescription>
            Every recipe with “{{ tag.name }}” gets the tag you choose instead, and “{{ tag.name }}”
            is deleted.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <p
            v-if="failure"
            role="alert"
            class="text-sm text-destructive"
          >
            {{ failure }}
          </p>
          <!-- A type can have dozens of tags: the list scrolls rather than the dialog. -->
          <div class="max-h-72 overflow-y-auto p-1">
            <FormRadioField
              name="intoId"
              label="Merge into"
              :choices="choices"
            />
          </div>
        </FieldGroup>
        <DialogFooter>
          <DialogClose as-child>
            <Button
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            class="aria-disabled:opacity-50"
            :aria-disabled="isSubmitting ? true : undefined"
          >
            Merge
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
