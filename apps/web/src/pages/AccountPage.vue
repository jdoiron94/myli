<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { ref } from 'vue';
import { emailVerificationQuery, useSendVerificationLink } from '@/account/email-verification.ts';
import { failureMessage } from '@/api/failure.ts';
import { useRetry } from '@/api/retry.ts';
import { sessionQuery } from '@/auth/session.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// The router waits for the session before showing a page that needs one.
const { data: user } = useQuery(sessionQuery);
const verification = useQuery(emailVerificationQuery);
const { failure, retrying, stillFailing, retry } = useRetry(verification);

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
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Account
  </h1>
  <p class="mt-2 text-muted-foreground">
    Your name and email address.
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
</template>
