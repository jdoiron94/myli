<script setup lang="ts">
import { confirmPasswordResetRequestSchema } from '@myli/shared';
import { useQueryClient } from '@tanstack/vue-query';
import { useForm } from 'vee-validate';
import { nextTick, ref, useTemplateRef } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { z } from 'zod';
import { useResetPassword } from '@/account/password-reset.ts';
import { failureMessage } from '@/api/failure.ts';
import { ApiProblem } from '@/api/problem.ts';
import { forgetSession } from '@/auth/session.ts';
import { goToSignIn } from '@/auth/sign-in-handoff.ts';
import PasswordField from '@/components/PasswordField.vue';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import {
  apiFieldErrors,
  focusFirstInvalidField,
  formSchema,
  newPasswordSchema,
} from '@/lib/forms.ts';

const FIELDS = ['newPassword'] as const;

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();

/**
 * The token from the link, which carries it in the fragment so it never reaches a server log
 * (spec §3.1). Kept in memory only. Something that can't be a token isn't worth asking the API about.
 */
const token = (() => {
  const parsed = confirmPasswordResetRequestSchema.shape.token.safeParse(route.hash.slice(1));
  return parsed.success ? parsed.data : undefined;
})();
// Out of the address, so it isn't left on screen, in the browser's history or in a bookmark.
if (route.hash) void router.replace({ path: route.path, query: route.query });

const { handleSubmit, isSubmitting, setErrors } = useForm({
  validationSchema: formSchema(z.object({ newPassword: newPasswordSchema })),
  initialValues: { newPassword: '' },
});
const form = useTemplateRef('form');
const heading = useTemplateRef('heading');
const resetPassword = useResetPassword();
/** Set once the link turned out not to work: the API's words for it. */
const unusable = ref<string>();
/** Why resetting failed, when it isn't the link or the field. */
const failure = ref<string>();

const resetOnSubmit = handleSubmit(
  async ({ newPassword }) => {
    // The form only shows with a token.
    if (token === undefined) return;
    failure.value = undefined;
    let email: string;
    try {
      ({ email } = await resetPassword.mutateAsync({ token, newPassword }));
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, FIELDS);
      if (fieldErrors) {
        setErrors(fieldErrors);
        focusFirstInvalidField(form.value);
      } else if (error instanceof ApiProblem && error.status === 404) {
        unusable.value = failureMessage(error);
        // What they were using is gone: start them on the page again.
        await nextTick();
        heading.value?.focus();
      } else {
        failure.value = failureMessage(error);
      }
      return;
    }
    // The reset ended every session of the account, and whoever was signed in here may have been
    // them: this browser starts signed out either way.
    await forgetSession(queryClient, () =>
      goToSignIn(router, {
        email,
        notice:
          "Your password is reset, and you've been signed out everywhere. Sign in with your new password.",
      }),
    );
  },
  () => {
    focusFirstInvalidField(form.value);
  },
);

/** One reset at a time. */
function submit(event: Event) {
  event.preventDefault();
  if (!isSubmitting.value) void resetOnSubmit(event);
}
</script>

<template>
  <div class="mx-auto max-w-sm">
    <h1
      ref="heading"
      tabindex="-1"
      class="text-2xl font-semibold outline-none"
    >
      Reset your password
    </h1>
    <p
      v-if="token === undefined"
      class="mt-2 text-muted-foreground"
    >
      This page needs a reset link. Open the link again, exactly as you received it.
    </p>
    <template v-else-if="unusable">
      <p
        role="alert"
        class="mt-2"
      >
        {{ unusable }}
      </p>
      <RouterLink
        :to="{ name: 'forgot-password' }"
        class="mt-4 inline-block font-medium underline underline-offset-4"
      >
        Ask for a new link
      </RouterLink>
    </template>
    <template v-else>
      <p class="mt-2 text-muted-foreground">
        Choose a new password. Setting it signs your account out everywhere.
      </p>
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
          <PasswordField
            name="newPassword"
            label="New password"
          />
          <Button
            type="submit"
            class="aria-disabled:opacity-50"
            :aria-disabled="isSubmitting ? true : undefined"
          >
            Reset password
          </Button>
        </FieldGroup>
      </form>
    </template>
  </div>
</template>
