<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { useForm } from 'vee-validate';
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue';
import { z } from 'zod';
import { myAvatarQuery, useRemoveAvatar, useSetAvatar } from '@/account/avatar.ts';
import { emailVerificationQuery, useSendVerificationLink } from '@/account/email-verification.ts';
import { useChangePassword } from '@/account/password.ts';
import { failureMessage } from '@/api/failure.ts';
import { allOf, useRetry } from '@/api/retry.ts';
import { AuthProblem } from '@/auth/client.ts';
import { sessionQuery } from '@/auth/session.ts';
import FormTextField from '@/components/FormTextField.vue';
import PasswordField from '@/components/PasswordField.vue';
import RetryableFailure from '@/components/RetryableFailure.vue';
import UserAvatar from '@/components/UserAvatar.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { focusFirstInvalidField, formSchema, newPasswordSchema } from '@/lib/forms.ts';
import PhotoPicker from '@/recipes/PhotoPicker.vue';
import { photoFileProblem } from '@/recipes/photos.ts';

// The router waits for the session before showing a page that needs one.
const { data: user } = useQuery(sessionQuery);
const verification = useQuery(emailVerificationQuery);
const avatar = useQuery(myAvatarQuery);
const { failure, retrying, stillFailing, retry } = useRetry(allOf(verification, avatar));

const sendLink = useSendVerificationLink();
/** Where the last link went, once it's on its way. */
const sentTo = ref<string>();
const sendFailure = ref<string>();

async function send(email: string) {
  if (sendLink.isPending.value) return;
  sentTo.value = undefined;
  sendFailure.value = undefined;
  try {
    await sendLink.mutateAsync();
    sentTo.value = email;
  } catch (error) {
    sendFailure.value = failureMessage(error);
  }
}

const setAvatar = useSetAvatar();
const removeAvatar = useRemoveAvatar();
const photoBusy = computed(() => setAvatar.isPending.value || removeAvatar.isPending.value);
/** What the last change to the photo did, once it's done. */
const photoChanged = ref<'set' | 'removed'>();
const photoFailure = ref<string>();
const pickerId = useId();

async function pickPhoto([file]: File[]) {
  if (!file || photoBusy.value) return;
  photoChanged.value = undefined;
  // Refused here as the API would, without sending it.
  photoFailure.value = photoFileProblem(file);
  if (photoFailure.value) return;
  try {
    await setAvatar.mutateAsync(file);
    photoChanged.value = 'set';
  } catch (error) {
    photoFailure.value = failureMessage(error);
  }
}

async function removePhoto() {
  if (photoBusy.value) return;
  photoChanged.value = undefined;
  photoFailure.value = undefined;
  try {
    await removeAvatar.mutateAsync();
  } catch (error) {
    photoFailure.value = failureMessage(error);
    return;
  }
  photoChanged.value = 'removed';
  // Its button is gone with the photo: the picker is what's left.
  await nextTick();
  document.getElementById(pickerId)?.focus();
}

const { handleSubmit, isSubmitting, resetForm, setErrors } = useForm({
  validationSchema: formSchema(
    z.object({
      currentPassword: z.string().min(1, 'Enter your current password.'),
      newPassword: newPasswordSchema,
    }),
  ),
  initialValues: { currentPassword: '', newPassword: '' },
});
const form = useTemplateRef('form');
const changePassword = useChangePassword();
const passwordChanged = ref(false);
const passwordFailure = ref<string>();

const changeOnSubmit = handleSubmit(
  async (passwords) => {
    passwordChanged.value = false;
    passwordFailure.value = undefined;
    try {
      await changePassword.mutateAsync(passwords);
    } catch (error) {
      if (error instanceof AuthProblem && error.code === 'INVALID_PASSWORD') {
        setErrors({ currentPassword: "That isn't your current password." });
        focusFirstInvalidField(form.value);
      } else if (error instanceof AuthProblem && error.status === 429) {
        passwordFailure.value = 'Too many attempts. Wait a moment, then try again.';
      } else {
        passwordFailure.value = failureMessage(error);
      }
      return;
    }
    resetForm();
    passwordChanged.value = true;
  },
  () => {
    focusFirstInvalidField(form.value);
  },
);

/** One change at a time. */
function submit(event: Event) {
  event.preventDefault();
  if (!isSubmitting.value) void changeOnSubmit(event);
}

const photoHeadingId = useId();
const passwordHeadingId = useId();
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Account
  </h1>
  <p class="mt-2 text-muted-foreground">
    Your name, email address and profile photo, and your password.
  </p>
  <dl
    v-if="user"
    class="mt-6 grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]"
  >
    <dt class="text-muted-foreground">
      Name
    </dt>
    <dd>{{ user.name }}</dd>
    <dt class="text-muted-foreground">
      Email
    </dt>
    <dd class="flex flex-wrap items-center gap-2">
      <span class="break-all">{{ user.email }}</span>
      <Badge
        v-if="verification.data.value"
        :variant="verification.data.value.verified ? 'secondary' : 'outline'"
      >
        {{ verification.data.value.verified ? 'Verified' : 'Not verified' }}
      </Badge>
    </dd>
  </dl>

  <RetryableFailure
    v-if="failure"
    class="mt-4"
    :error="failure"
    :retrying="retrying"
    :still-failing="stillFailing"
    @retry="retry"
  />
  <template v-else-if="verification.data.value && !verification.data.value.verified">
    <template v-if="verification.data.value.emailEnabled">
      <p class="mt-4 text-sm text-muted-foreground">
        Verify your address so myli knows it reaches you. We'll send it a link that works for a day.
      </p>
      <Button
        type="button"
        class="mt-4 aria-disabled:opacity-50"
        :aria-disabled="sendLink.isPending.value ? true : undefined"
        @click="send(verification.data.value.email)"
      >
        Send verification link
      </Button>
    </template>
    <p
      v-else
      class="mt-4 text-sm text-muted-foreground"
    >
      This server doesn't send email, so your address can't be verified.
    </p>
  </template>
  <!-- Always there, so screen readers announce what it says as it changes. -->
  <p
    role="status"
    class="mt-4 text-sm"
  >
    <template v-if="sentTo">
      We sent a link to {{ sentTo }}. Open it to verify your address.
    </template>
  </p>
  <p
    v-if="sendFailure"
    role="alert"
    class="mt-2 text-sm text-destructive"
  >
    {{ sendFailure }}
  </p>

  <section
    class="mt-10"
    :aria-labelledby="photoHeadingId"
  >
    <h2
      :id="photoHeadingId"
      class="text-lg font-semibold"
    >
      Profile photo
    </h2>
    <p class="mt-1 text-sm text-muted-foreground">
      It shows beside your name to everyone signed in, but never on public links. Without one, your
      initials show.
    </p>
    <div
      v-if="user && avatar.data.value !== undefined"
      class="mt-4 flex flex-wrap items-center gap-4"
    >
      <UserAvatar
        size="lg"
        :person="{ id: user.id, name: user.name, avatar: avatar.data.value }"
      />
      <div class="flex flex-wrap gap-2">
        <PhotoPicker
          :id="pickerId"
          :unavailable="photoBusy"
          @picked="pickPhoto"
        >
          {{ avatar.data.value ? 'Change photo' : 'Upload photo' }}
        </PhotoPicker>
        <Button
          v-if="avatar.data.value"
          type="button"
          variant="outline"
          size="sm"
          class="aria-disabled:opacity-50"
          :aria-disabled="photoBusy ? true : undefined"
          @click="removePhoto"
        >
          Remove photo
        </Button>
      </div>
    </div>
    <!-- Always there, so screen readers announce what it says as it changes. -->
    <p
      role="status"
      class="mt-4 text-sm"
    >
      <template v-if="setAvatar.isPending.value">
        Uploading your photo…
      </template>
      <template v-else-if="photoChanged === 'set'">
        Your profile photo is changed.
      </template>
      <template v-else-if="photoChanged === 'removed'">
        Your profile photo is removed. Your initials show instead.
      </template>
    </p>
    <p
      v-if="photoFailure"
      role="alert"
      class="mt-2 text-sm text-destructive"
    >
      {{ photoFailure }}
    </p>
  </section>

  <section
    class="mt-10"
    :aria-labelledby="passwordHeadingId"
  >
    <h2
      :id="passwordHeadingId"
      class="text-lg font-semibold"
    >
      Change password
    </h2>
    <p class="mt-1 text-sm text-muted-foreground">
      Changing it signs you out on your other devices.
    </p>
    <form
      ref="form"
      class="mt-4 max-w-sm"
      novalidate
      @submit="submit"
    >
      <FieldGroup>
        <!-- For password managers, which save the new password with the account's address. -->
        <input
          v-if="user"
          hidden
          readonly
          autocomplete="username"
          :value="user.email"
        >
        <FormTextField
          name="currentPassword"
          label="Current password"
          type="password"
          autocomplete="current-password"
        />
        <PasswordField
          name="newPassword"
          label="New password"
        />
        <Button
          type="submit"
          class="aria-disabled:opacity-50"
          :aria-disabled="isSubmitting ? true : undefined"
        >
          Change password
        </Button>
      </FieldGroup>
    </form>
    <!-- Always there, so screen readers announce what it says as it changes. -->
    <p
      role="status"
      class="mt-4 text-sm"
    >
      <template v-if="passwordChanged">
        Your password is changed. You've been signed out on your other devices.
      </template>
    </p>
    <p
      v-if="passwordFailure"
      role="alert"
      class="mt-2 text-sm text-destructive"
    >
      {{ passwordFailure }}
    </p>
  </section>
</template>
