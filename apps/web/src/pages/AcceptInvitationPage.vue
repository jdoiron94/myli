<script setup lang="ts">
import { acceptInvitationRequestSchema, invitationLookupRequestSchema } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { useForm } from 'vee-validate';
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { failureMessage } from '@/api/failure.ts';
import { ApiProblem } from '@/api/problem.ts';
import { useRetry } from '@/api/retry.ts';
import { invitationQuery, useAcceptInvitation } from '@/auth/invitation.ts';
import { sessionQuery } from '@/auth/session.ts';
import { goToSignIn } from '@/auth/sign-in-handoff.ts';
import FormTextField from '@/components/FormTextField.vue';
import PasswordField from '@/components/PasswordField.vue';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  apiFieldErrors,
  focusFirstInvalidField,
  formSchema,
  newPasswordSchema,
} from '@/lib/forms.ts';
import { ROLE_WITH_ARTICLE } from '@/lib/roles.ts';

const FIELDS = ['name', 'password'] as const;

const expiryFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' });

const route = useRoute();
const router = useRouter();

/**
 * The token from the link, which carries it in the fragment so it never reaches a server log
 * (spec §3.1). Kept in memory only. Something that can't be a token isn't worth asking the API about.
 */
const token = (() => {
  const parsed = invitationLookupRequestSchema.shape.token.safeParse(route.hash.slice(1));
  return parsed.success ? parsed.data : undefined;
})();
// Out of the address, so it isn't left on screen, in the browser's history or in a bookmark.
if (route.hash) void router.replace({ path: route.path, query: route.query });

// The route is public, so the router hasn't checked the session.
const session = useQuery(sessionQuery);

const lookup = useQuery({
  ...invitationQuery(token ?? ''),
  // Someone signed in can't accept it, so there's nothing to look up for them.
  enabled: () => token !== undefined && !session.isPending.value && !session.data.value,
});
type Invitation = NonNullable<typeof lookup.data.value>;
const { failure: lookupFailure, retrying, stillFailing, retry } = useRetry(lookup);

/** The API's answer for an invitation link that doesn't work (any more). */
const isUnusable = (error: unknown) => error instanceof ApiProblem && error.status === 404;

/** Set when accepting found the invitation no longer works: revoked, used or expired since. */
const goneMessage = ref<string>();
/** Why accepting failed, when it isn't a problem with one of the fields. */
const failure = ref<string>();
/** Someone already has an account with the invitation's email. */
const userExists = ref(false);

type View =
  | { kind: 'no-link' }
  | { kind: 'checking' }
  | { kind: 'signed-in'; name: string }
  | { kind: 'unusable'; message: string }
  | { kind: 'failed'; error: Error }
  | { kind: 'ready'; invitation: Invitation };

const view = computed((): View => {
  if (token === undefined) return { kind: 'no-link' };
  if (session.isPending.value) return { kind: 'checking' };
  if (session.data.value) return { kind: 'signed-in', name: session.data.value.name };
  if (goneMessage.value) return { kind: 'unusable', message: goneMessage.value };
  if (lookup.data.value) return { kind: 'ready', invitation: lookup.data.value };
  const error = lookupFailure.value;
  if (!error) return { kind: 'checking' };
  return isUnusable(error)
    ? { kind: 'unusable', message: failureMessage(error) }
    : { kind: 'failed', error };
});

const heading = useTemplateRef('heading');

/**
 * Starts screen-reader and keyboard users on the page again once what they were using is gone, as the
 * layout does after a navigation.
 */
async function focusHeading() {
  await nextTick();
  heading.value?.focus();
}

const { handleSubmit, isSubmitting, setErrors } = useForm({
  validationSchema: formSchema(
    acceptInvitationRequestSchema.pick({ name: true }).extend({ password: newPasswordSchema }),
  ),
  initialValues: { name: '', password: '' },
});

const form = useTemplateRef('form');
const acceptInvitation = useAcceptInvitation();

const acceptOnSubmit = handleSubmit(
  async (values) => {
    const invitation = lookup.data.value;
    // The form only shows once both are known.
    if (token === undefined || !invitation) return;
    failure.value = undefined;
    userExists.value = false;
    try {
      await acceptInvitation.mutateAsync({ token, ...values });
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, FIELDS);
      if (fieldErrors) {
        setErrors(fieldErrors);
        focusFirstInvalidField(form.value);
      } else if (isUnusable(error)) {
        goneMessage.value = failureMessage(error);
        await focusHeading();
      } else {
        failure.value = failureMessage(error);
        userExists.value = error instanceof ApiProblem && error.status === 409;
      }
      return;
    }
    // Accepting doesn't sign them in (spec §3.1).
    await goToSignIn(router, {
      email: invitation.email,
      notice: 'Your account is ready. Sign in with your email and password.',
    });
  },
  () => {
    focusFirstInvalidField(form.value);
  },
);

/** One account at a time, as on the setup page. */
function submit(event: Event) {
  event.preventDefault();
  if (!isSubmitting.value) void acceptOnSubmit(event);
}

const emailId = useId();
const emailDescriptionId = `${emailId}-description`;
</script>

<template>
  <div class="mx-auto max-w-sm">
    <h1
      ref="heading"
      tabindex="-1"
      class="text-2xl font-semibold outline-none"
    >
      Accept invitation
    </h1>
    <p
      v-if="view.kind === 'no-link'"
      class="mt-2 text-muted-foreground"
    >
      This page needs the link from your invitation. Open that link again, exactly as you received it.
    </p>
    <p
      v-else-if="view.kind === 'checking'"
      role="status"
      class="mt-2 text-muted-foreground"
    >
      Checking your invitation…
    </p>
    <p
      v-else-if="view.kind === 'signed-in'"
      class="mt-2"
    >
      You're signed in as {{ view.name }}. This invitation is for a new account: sign out, then open
      the invitation link again.
    </p>
    <p
      v-else-if="view.kind === 'unusable'"
      role="alert"
      class="mt-2"
    >
      {{ view.message }}
    </p>
    <RetryableFailure
      v-else-if="view.kind === 'failed'"
      class="mt-2"
      :error="view.error"
      :retrying="retrying"
      :still-failing="stillFailing"
      @retry="retry"
    />
    <template v-else-if="view.kind === 'ready'">
      <p class="mt-2 text-muted-foreground">
        You're invited to join myli as {{ ROLE_WITH_ARTICLE[view.invitation.role] }}. Choose your name
        and a password to create your account.
      </p>
      <p class="mt-2 text-sm text-muted-foreground">
        This invitation expires on
        <time :datetime="view.invitation.expiresAt">{{
          expiryFormat.format(new Date(view.invitation.expiresAt))
        }}</time>.
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
              v-if="userExists"
              :to="{ name: 'login' }"
              class="underline underline-offset-4"
            >
              Go to sign-in
            </RouterLink>
          </div>
          <!-- Read-only, and still an input: password managers save the new password with it. -->
          <Field>
            <FieldLabel :for="emailId">
              Email
            </FieldLabel>
            <Input
              :id="emailId"
              :model-value="view.invitation.email"
              type="email"
              autocomplete="username"
              readonly
              :aria-describedby="emailDescriptionId"
            />
            <FieldDescription :id="emailDescriptionId">
              Your account gets the address the invitation was sent to.
            </FieldDescription>
          </Field>
          <FormTextField
            name="name"
            label="Name"
            autocomplete="name"
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
            Create account
          </Button>
        </FieldGroup>
      </form>
    </template>
  </div>
</template>
