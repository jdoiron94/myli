<script setup lang="ts">
import { confirmEmailVerificationRequestSchema } from '@myli/shared';
import { computed, ref, shallowRef } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useConfirmEmailVerification } from '@/account/email-verification.ts';
import { failureMessage } from '@/api/failure.ts';
import { ApiProblem } from '@/api/problem.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';

const route = useRoute();
const router = useRouter();

/**
 * The token from the link, which carries it in the fragment so it never reaches a server log
 * (spec §3.1). Kept in memory only. Something that can't be a token isn't worth asking the API about.
 */
const token = (() => {
  const parsed = confirmEmailVerificationRequestSchema.shape.token.safeParse(route.hash.slice(1));
  return parsed.success ? parsed.data : undefined;
})();
// Out of the address, so it isn't left on screen, in the browser's history or in a bookmark.
if (route.hash) void router.replace({ path: route.path, query: route.query });

const confirm = useConfirmEmailVerification();
/** Why the last try failed. Kept while trying again, so the failure stays on screen meanwhile. */
const failure = shallowRef<unknown>();
const failures = ref(0);

async function verify() {
  if (token === undefined || confirm.isPending.value) return;
  try {
    await confirm.mutateAsync(token);
    failure.value = undefined;
  } catch (error) {
    failure.value = error;
    failures.value += 1;
  }
}
// The link is all it takes: opening it verifies the address.
void verify();

type View =
  | { kind: 'no-link' }
  | { kind: 'verifying' }
  | { kind: 'verified'; email: string }
  | { kind: 'unusable'; message: string }
  | { kind: 'failed'; error: unknown };

const view = computed((): View => {
  if (token === undefined) return { kind: 'no-link' };
  if (confirm.data.value) return { kind: 'verified', email: confirm.data.value.email };
  const error = failure.value;
  if (error instanceof ApiProblem && error.status === 404) {
    return { kind: 'unusable', message: failureMessage(error) };
  }
  return error === undefined ? { kind: 'verifying' } : { kind: 'failed', error };
});
</script>

<template>
  <div class="mx-auto max-w-sm">
    <h1 class="text-2xl font-semibold">
      Verify your email address
    </h1>
    <!-- Always there, so screen readers announce what it says as it changes. -->
    <p
      role="status"
      class="mt-2"
    >
      <template v-if="view.kind === 'verifying'">
        Verifying your address…
      </template>
      <template v-else-if="view.kind === 'verified'">
        Your address {{ view.email }} is verified.
      </template>
    </p>
    <p
      v-if="view.kind === 'no-link'"
      class="mt-2 text-muted-foreground"
    >
      This page needs the link from your email. Open that link again, exactly as you received it.
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
      :retrying="confirm.isPending.value"
      :still-failing="failures > 1"
      @retry="verify"
    />
    <RouterLink
      v-if="view.kind === 'verified' || view.kind === 'unusable'"
      :to="{ name: 'account' }"
      class="mt-4 inline-block font-medium underline underline-offset-4"
    >
      Go to your account
    </RouterLink>
  </div>
</template>
