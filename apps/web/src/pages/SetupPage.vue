<script setup lang="ts">
import { setupRequestSchema } from '@myli/shared';
import { useForm } from 'vee-validate';
import { ref, useTemplateRef } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { failureMessage } from '@/api/failure.ts';
import { ApiProblem } from '@/api/problem.ts';
import { useCompleteSetup } from '@/auth/setup.ts';
import { goToSignIn } from '@/auth/sign-in-handoff.ts';
import FormTextField from '@/components/FormTextField.vue';
import PasswordField from '@/components/PasswordField.vue';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import {
  apiFieldErrors,
  focusFirstInvalidField,
  formSchema,
  newPasswordSchema,
} from '@/lib/forms.ts';

const FIELDS = ['name', 'email', 'password'] as const;

const { handleSubmit, isSubmitting, setErrors } = useForm({
  validationSchema: formSchema(setupRequestSchema.extend({ password: newPasswordSchema })),
  initialValues: { name: '', email: '', password: '' },
});

const router = useRouter();
const form = useTemplateRef('form');
const completeSetup = useCompleteSetup();
/** Why setup failed, when it isn't a problem with one of the fields. */
const failure = ref<string>();
/** Someone finished setup first, or is finishing it right now. */
const alreadySetUp = ref(false);

const setUpOnSubmit = handleSubmit(
  async (values) => {
    failure.value = undefined;
    alreadySetUp.value = false;
    try {
      await completeSetup.mutateAsync(values);
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, FIELDS);
      if (fieldErrors) {
        setErrors(fieldErrors);
        focusFirstInvalidField(form.value);
      } else {
        failure.value = failureMessage(error);
        alreadySetUp.value = error instanceof ApiProblem && error.status === 409;
      }
      return;
    }
    await goToSignIn(router, {
      email: values.email,
      notice: 'Your admin account is ready. Sign in with its email and password.',
    });
  },
  () => {
    focusFirstInvalidField(form.value);
  },
);

/** One setup at a time, as on the sign-in page. */
function submit(event: Event) {
  event.preventDefault();
  if (!isSubmitting.value) void setUpOnSubmit(event);
}
</script>

<template>
  <div class="mx-auto max-w-sm">
    <h1 class="text-2xl font-semibold">
      Set up myli
    </h1>
    <p class="mt-2 text-muted-foreground">
      Create the first admin account. Admins invite everyone else.
    </p>
    <form
      ref="form"
      class="mt-6"
      novalidate
      @submit="submit"
    >
      <FieldGroup>
        <div
          v-if="failure"
          role="alert"
          class="text-sm text-destructive"
        >
          {{ failure }}
          <RouterLink
            v-if="alreadySetUp"
            :to="{ name: 'login' }"
            class="underline underline-offset-4"
          >
            Go to sign-in
          </RouterLink>
        </div>
        <FormTextField
          name="name"
          label="Name"
          autocomplete="name"
        />
        <FormTextField
          name="email"
          label="Email"
          type="email"
          autocomplete="username"
        />
        <PasswordField
          name="password"
          label="Password"
        />
        <Button
          type="submit"
          class="aria-disabled:opacity-50"
          :aria-disabled="isSubmitting ? true : undefined"
        >
          Create admin account
        </Button>
      </FieldGroup>
    </form>
  </div>
</template>
