<script setup lang="ts">
import { passwordResetRequestSchema } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { useForm } from 'vee-validate';
import { ref, useTemplateRef } from 'vue';
import { RouterLink } from 'vue-router';
import {
  passwordResetAvailabilityQuery,
  useRequestPasswordReset,
} from '@/account/password-reset.ts';
import { failureMessage } from '@/api/failure.ts';
import { useRetry } from '@/api/retry.ts';
import FormTextField from '@/components/FormTextField.vue';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { focusFirstInvalidField, formSchema } from '@/lib/forms.ts';

const availability = useQuery(passwordResetAvailabilityQuery);
const { failure: loadFailure, retrying, stillFailing, retry } = useRetry(availability);

const { handleSubmit, isSubmitting } = useForm({
  validationSchema: formSchema(passwordResetRequestSchema),
  initialValues: { email: '' },
});
const form = useTemplateRef('form');
const requestReset = useRequestPasswordReset();
/** The address the last request was for, once it's asked. */
const askedFor = ref<string>();
const failure = ref<string>();

const requestOnSubmit = handleSubmit(
  async ({ email }) => {
    askedFor.value = undefined;
    failure.value = undefined;
    try {
      await requestReset.mutateAsync(email);
      askedFor.value = email;
    } catch (error) {
      failure.value = failureMessage(error);
    }
  },
  () => {
    focusFirstInvalidField(form.value);
  },
);

/** One request at a time. */
function submit(event: Event) {
  event.preventDefault();
  if (!isSubmitting.value) void requestOnSubmit(event);
}
</script>

<template>
  <div class="mx-auto max-w-sm">
    <h1 class="text-2xl font-semibold">
      Forgot your password?
    </h1>
    <RetryableFailure
      v-if="loadFailure"
      class="mt-2"
      :error="loadFailure"
      :retrying="retrying"
      :still-failing="stillFailing"
      @retry="retry"
    />
    <template v-else-if="availability.data.value?.emailEnabled">
      <p class="mt-2 text-muted-foreground">
        Enter your account's email address. If it's verified, we'll email it a link to choose a new
        password.
      </p>
      <form
        ref="form"
        class="mt-6"
        novalidate
        @submit="submit"
      >
        <FieldGroup>
          <FormTextField
            name="email"
            label="Email"
            type="email"
            autocomplete="username"
          />
          <Button
            type="submit"
            class="aria-disabled:opacity-50"
            :aria-disabled="isSubmitting ? true : undefined"
          >
            Send reset link
          </Button>
        </FieldGroup>
      </form>
    </template>
    <p
      v-else-if="availability.data.value"
      class="mt-2"
    >
      This server doesn't send email. Ask whoever runs myli to make you a reset link.
    </p>
    <!-- Always there, so screen readers announce what it says as it changes. -->
    <p
      role="status"
      class="mt-4 text-sm"
    >
      <template v-if="askedFor">
        If {{ askedFor }} is the verified address of an account here, a link is on its way. It works
        for an hour. If none arrives, ask whoever runs myli to make you one.
      </template>
    </p>
    <p
      v-if="failure"
      role="alert"
      class="mt-2 text-sm text-destructive"
    >
      {{ failure }}
    </p>
    <RouterLink
      :to="{ name: 'login' }"
      class="mt-4 inline-block font-medium underline underline-offset-4"
    >
      Back to sign in
    </RouterLink>
  </div>
</template>
