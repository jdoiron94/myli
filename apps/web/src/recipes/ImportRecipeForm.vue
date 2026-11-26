<script setup lang="ts">
import { importRecipeRequestSchema } from '@myli/shared';
import { useForm } from 'vee-validate';
import { ref, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import FormTextField from '@/components/FormTextField.vue';
import { Button } from '@/components/ui/button';
import { apiFieldErrors, focusFirstInvalidField, formSchema } from '@/lib/forms.ts';
import { type ImportRecipeResult, useImportRecipe } from './import.ts';

/**
 * Imports a recipe from another site's page (spec §3.7). Why a page can't be imported shows at the
 * address field, as the API says it.
 */
const emit = defineEmits<{ imported: [result: ImportRecipeResult] }>();

const { handleSubmit, isSubmitting, setErrors } = useForm({
  validationSchema: formSchema(importRecipeRequestSchema),
  initialValues: { url: '' },
});

const importRecipe = useImportRecipe();
const form = useTemplateRef('form');
/** Why importing failed, when the API didn't say it of the address. */
const failure = ref<string>();

const importOnSubmit = handleSubmit(
  async ({ url }) => {
    failure.value = undefined;
    try {
      emit('imported', await importRecipe.mutateAsync(url));
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, ['url']);
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
  if (!isSubmitting.value) void importOnSubmit(event);
}
</script>

<template>
  <section
    aria-labelledby="import-heading"
    class="rounded-lg border p-4"
  >
    <h2
      id="import-heading"
      class="text-lg font-semibold"
    >
      Import from a link
    </h2>
    <form
      ref="form"
      novalidate
      class="mt-3 flex flex-col gap-3"
      @submit="submit"
    >
      <FormTextField
        name="url"
        label="Address of the recipe's page"
        inputmode="url"
        autocomplete="url"
        description="It fills in the form below, replacing what's there, for you to check before creating the recipe. Most recipe sites work."
      />
      <p
        v-if="failure"
        role="alert"
        class="text-sm text-destructive"
      >
        {{ failure }}
      </p>
      <div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          class="aria-disabled:opacity-50"
          :aria-disabled="isSubmitting ? true : undefined"
        >
          {{ isSubmitting ? 'Importing…' : 'Import' }}
        </Button>
      </div>
    </form>
  </section>
</template>
