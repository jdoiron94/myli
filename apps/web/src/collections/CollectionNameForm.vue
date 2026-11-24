<script setup lang="ts">
import { collectionRequestSchema } from '@myli/shared';
import { useForm } from 'vee-validate';
import { ref, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import FormTextField from '@/components/FormTextField.vue';
import { Button } from '@/components/ui/button';
import { apiFieldErrors, focusFirstInvalidField, formSchema } from '@/lib/forms.ts';

/**
 * Names a collection, new or renamed. `save` sends the name: a refusal it throws shows here, at the
 * field for a 422, like a name the reader already has. Once it's saved, the form empties again.
 */
const props = defineProps<{
  label: string;
  submitLabel: string;
  initial?: string;
  save: (name: string) => Promise<void>;
  /** Offers to give up, as when renaming. */
  cancellable?: boolean;
}>();
const emit = defineEmits<{ cancel: [] }>();

const { handleSubmit, isSubmitting, setErrors, resetForm } = useForm({
  validationSchema: formSchema(collectionRequestSchema),
  initialValues: { name: props.initial ?? '' },
});

const form = useTemplateRef('form');
/** Why saving failed, when it isn't a problem with the name. */
const failure = ref<string>();

const saveOnSubmit = handleSubmit(
  async ({ name }) => {
    failure.value = undefined;
    try {
      await props.save(name);
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, ['name']);
      if (fieldErrors) {
        setErrors(fieldErrors);
        focusFirstInvalidField(form.value);
      } else {
        failure.value = failureMessage(error);
      }
      return;
    }
    resetForm({ values: { name: '' } });
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
    class="flex max-w-sm flex-col gap-3"
    @submit="submit"
  >
    <FormTextField
      name="name"
      :label="label"
      autocomplete="off"
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
