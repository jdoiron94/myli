<script setup lang="ts">
import { commentRequestSchema } from '@myli/shared';
import { useForm } from 'vee-validate';
import { ref, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import MarkdownField from '@/components/MarkdownField.vue';
import { Button } from '@/components/ui/button';
import { apiFieldErrors, focusFirstInvalidField, formSchema } from '@/lib/forms.ts';

/**
 * Writes a comment, or changes one. `save` sends it: a refusal it throws shows here, at the field
 * for a 422. Once it's saved, the form empties again.
 */
const props = defineProps<{
  label: string;
  submitLabel: string;
  initial?: string;
  save: (body: string) => Promise<void>;
  /** Offers to give up, as when changing a comment. */
  cancellable?: boolean;
}>();
const emit = defineEmits<{ cancel: [] }>();

const { handleSubmit, isSubmitting, setErrors, resetForm } = useForm({
  validationSchema: formSchema(commentRequestSchema),
  initialValues: { body: props.initial ?? '' },
});

const form = useTemplateRef('form');
/** Why saving failed, when it isn't a problem with what it says. */
const failure = ref<string>();

const saveOnSubmit = handleSubmit(
  async ({ body }) => {
    failure.value = undefined;
    try {
      await props.save(body);
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, ['body']);
      if (fieldErrors) {
        setErrors(fieldErrors);
        focusFirstInvalidField(form.value);
      } else {
        failure.value = failureMessage(error);
      }
      return;
    }
    resetForm({ values: { body: '' } });
  },
  () => {
    focusFirstInvalidField(form.value);
  },
);

function submit(event: Event) {
  event.preventDefault();
  if (!isSubmitting.value) void saveOnSubmit(event);
}
</script>

<template>
  <form
    ref="form"
    novalidate
    class="flex flex-col gap-3"
    @submit="submit"
  >
    <!-- Milkdown loads once the field is focused: most who open a recipe don't comment. -->
    <MarkdownField
      name="body"
      :label="label"
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
        {{ submitLabel }}
      </Button>
      <Button
        v-if="cancellable"
        type="button"
        variant="outline"
        size="sm"
        @click="emit('cancel')"
      >
        Cancel
      </Button>
    </div>
  </form>
</template>
