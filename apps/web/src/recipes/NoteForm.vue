<script setup lang="ts">
import { noteRequestSchema } from '@myli/shared';
import { useForm } from 'vee-validate';
import { ref, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import MarkdownField from '@/components/MarkdownField.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { apiFieldErrors, focusFirstInvalidField, formSchema } from '@/lib/forms.ts';
import { type Note, useDeleteNote, useSaveNote } from './notes.ts';

/** Writes the reader's note on a recipe, changes it or deletes it, starting from `note`. */
const props = defineProps<{ recipeId: string; note: Note | null }>();
const emit = defineEmits<{ saved: []; deleted: []; changing: [] }>();

const { handleSubmit, isSubmitting, setErrors, resetForm } = useForm({
  validationSchema: formSchema(noteRequestSchema),
  initialValues: { body: props.note?.body ?? '' },
});

const form = useTemplateRef('form');
/** Why saving or deleting failed, when it isn't a problem with what it says. */
const failure = ref<string>();

const save = useSaveNote();
const saveOnSubmit = handleSubmit(
  async ({ body }) => {
    emit('changing');
    failure.value = undefined;
    try {
      const saved = await save.mutateAsync({ id: props.recipeId, body });
      resetForm({ values: { body: saved.body } });
      emit('saved');
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, ['body']);
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
  if (!isSubmitting.value) void saveOnSubmit(event);
}

const remove = useDeleteNote();

async function deleteNote() {
  if (remove.isPending.value) return;
  emit('changing');
  failure.value = undefined;
  try {
    await remove.mutateAsync(props.recipeId);
  } catch (error) {
    failure.value = failureMessage(error);
    return;
  }
  resetForm({ values: { body: '' } });
  emit('deleted');
}
</script>

<template>
  <form
    ref="form"
    novalidate
    class="flex flex-col gap-3"
    @submit="submit"
  >
    <!-- Milkdown loads once the field is focused: most who open a recipe don't change their note. -->
    <MarkdownField
      name="body"
      label="Note"
      description="Only you can see it."
      lazy
    />
    <p
      v-if="failure"
      role="alert"
      class="text-sm text-destructive"
    >
      {{ failure }}
    </p>
    <div class="flex gap-2">
      <Button
        type="submit"
        size="sm"
        class="aria-disabled:opacity-50"
        :aria-disabled="isSubmitting ? true : undefined"
      >
        Save note
      </Button>
      <AlertDialog v-if="note">
        <AlertDialogTrigger as-child>
          <Button
            type="button"
            variant="outline"
            size="sm"
          >
            Delete note
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your note?</AlertDialogTitle>
            <AlertDialogDescription>
              It's gone for good: it can't be restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              @click="deleteNote"
            >
              Delete note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </form>
</template>
