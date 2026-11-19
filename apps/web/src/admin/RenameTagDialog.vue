<script setup lang="ts">
import { renameTagRequestSchema } from '@myli/shared';
import { useForm } from 'vee-validate';
import { ref, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import FormTextField from '@/components/FormTextField.vue';
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
import { useRenameTag } from './tags.ts';

/** A tag's Rename button, and the dialog it opens. */
const props = defineProps<{ tag: Tag }>();
/** The tag as it was, and as it is: by the time it's renamed, the list shows the new name. */
const emit = defineEmits<{ renamed: [from: Tag, to: Tag] }>();

const open = ref(false);
/** Why renaming failed, when it isn't a problem with the name. */
const failure = ref<string>();

const { handleSubmit, isSubmitting, setErrors, resetForm } = useForm({
  validationSchema: formSchema(renameTagRequestSchema),
  initialValues: { name: props.tag.name },
});

/** Each opening starts from the tag's current name. */
function setOpen(value: boolean) {
  if (value) {
    resetForm({ values: { name: props.tag.name } });
    failure.value = undefined;
  }
  open.value = value;
}

const form = useTemplateRef('form');
const rename = useRenameTag();

const renameOnSubmit = handleSubmit(
  async ({ name }) => {
    // Nothing to change.
    if (name === props.tag.name) {
      open.value = false;
      return;
    }
    failure.value = undefined;
    const from = { ...props.tag };
    try {
      const renamed = await rename.mutateAsync({ id: props.tag.id, name });
      open.value = false;
      emit('renamed', from, renamed);
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, ['name'] as const);
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
  if (!isSubmitting.value) void renameOnSubmit(event);
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="setOpen"
  >
    <DialogTrigger as-child>
      <!-- Names start with the visible text (WCAG 2.5.3). -->
      <Button
        variant="outline"
        size="sm"
        :aria-label="`Rename ${tag.name}`"
      >
        Rename
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
          <DialogTitle>Rename “{{ tag.name }}”</DialogTitle>
          <DialogDescription>The new name shows on every recipe with this tag.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <p
            v-if="failure"
            role="alert"
            class="text-sm text-destructive"
          >
            {{ failure }}
          </p>
          <FormTextField
            name="name"
            label="Name"
          />
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
            Save
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
