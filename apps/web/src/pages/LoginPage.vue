<script setup lang="ts">
import { emailSchema } from '@myli/shared';
import { useForm } from 'vee-validate';
import { computed, useTemplateRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { z } from 'zod';
import { ApiProblem } from '@/api/problem.ts';
import { AuthProblem } from '@/auth/client.ts';
import { safeRedirect } from '@/auth/redirect.ts';
import { useSignIn } from '@/auth/session.ts';
import FormTextField from '@/components/FormTextField.vue';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { focusFirstInvalidField, formSchema } from '@/lib/forms.ts';

const signInSchema = z.object({
  email: emailSchema,
  // Only "not empty": the password rules apply when one is set, not when signing in.
  password: z.string().min(1, 'Enter your password.'),
});

const { handleSubmit, isSubmitting } = useForm({
  validationSchema: formSchema(signInSchema),
  initialValues: { email: '', password: '' },
});

const route = useRoute();
const router = useRouter();
const form = useTemplateRef('form');
const signIn = useSignIn();

const signInOnSubmit = handleSubmit(
  async (credentials) => {
    try {
      await signIn.mutateAsync(credentials);
    } catch {
      return; // `failure` below says what went wrong.
    }
    await router.replace(safeRedirect(route.query.redirect));
  },
  () => {
    focusFirstInvalidField(form.value);
  },
);

/**
 * One sign-in at a time. VeeValidate marks the form as submitting as soon as a submit starts, before
 * checking the fields, and until the sign-in and the navigation after it are done.
 */
function submit(event: Event) {
  event.preventDefault();
  if (!isSubmitting.value) void signInOnSubmit(event);
}

/** Why signing in failed, in words for the person signing in. */
const failure = computed(() => {
  const error = signIn.error.value;
  if (!error) return undefined;
  if (error instanceof AuthProblem) {
    if (error.code === 'INVALID_EMAIL_OR_PASSWORD') return 'Wrong email or password.';
    // Better Auth only says so once the password was right.
    if (error.code === 'BANNED_USER') {
      return 'This account is deactivated. Ask an admin to reactivate it.';
    }
    if (error.status === 429) return 'Too many sign-in attempts. Wait a moment, then try again.';
  }
  if (error instanceof ApiProblem) return "Signing in didn't work. Try again in a moment.";
  return "Couldn't reach myli. Check your connection, then try again.";
});
</script>

<template>
  <div class="mx-auto max-w-sm">
    <h1 class="text-2xl font-semibold">
      Sign in
    </h1>
    <!-- novalidate: the form's own messages, not the browser's, which differ and can't be styled. -->
    <form
      ref="form"
      class="mt-6"
      novalidate
      @submit="submit"
    >
      <FieldGroup>
        <p
          v-if="failure"
          role="alert"
          class="text-sm text-destructive"
        >
          {{ failure }}
        </p>
        <FormTextField
          name="email"
          label="Email"
          type="email"
          autocomplete="username"
        />
        <FormTextField
          name="password"
          label="Password"
          type="password"
          autocomplete="current-password"
        />
        <Button
          type="submit"
          class="aria-disabled:opacity-50"
          :aria-disabled="isSubmitting ? true : undefined"
        >
          Sign in
        </Button>
      </FieldGroup>
    </form>
  </div>
</template>
