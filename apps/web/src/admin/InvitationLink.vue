<script setup lang="ts">
import { CopyIcon } from '@lucide/vue';
import { onMounted, ref, useId } from 'vue';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { Invitation } from './invitations.ts';

/**
 * A new invitation link for the admin to share, when myli didn't email it. It's shown once: myli
 * keeps only a hash of the token in it, so it can't be shown again later.
 */
const props = defineProps<{
  invitation: Invitation;
  link: string;
  /** Whether it replaces the invitation's earlier link, which no longer works. */
  resent: boolean;
}>();

const expiryFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' });

const id = useId();
const descriptionId = `${id}-description`;

function linkInput() {
  const input = document.getElementById(id);
  return input instanceof HTMLInputElement ? input : undefined;
}

/**
 * Starts on the link, selected: they can copy it with the keyboard straight away, even where the
 * Copy button can't reach the clipboard (it needs HTTPS or localhost).
 */
function selectLink() {
  const input = linkInput();
  input?.focus();
  input?.select();
}
onMounted(selectLink);

const copyMessage = ref('');

async function copy() {
  try {
    await navigator.clipboard.writeText(props.link);
    copyMessage.value = 'Copied.';
  } catch {
    selectLink();
    copyMessage.value =
      "Couldn't copy it. The link is selected: copy it with Ctrl+C, or ⌘C on a Mac.";
  }
}
</script>

<template>
  <div class="rounded-lg border p-4">
    <p :id="descriptionId">
      <template v-if="resent">
        Here's the new link for <strong>{{ invitation.email }}</strong>. Their earlier link no longer
        works.
      </template>
      <template v-else>
        Share this link with <strong>{{ invitation.email }}</strong>.
      </template>
      It's shown only once, and works until
      <time :datetime="invitation.expiresAt">{{
        expiryFormat.format(new Date(invitation.expiresAt))
      }}</time>.
    </p>
    <Field class="mt-4">
      <FieldLabel :for="id">
        Invitation link
      </FieldLabel>
      <div class="flex gap-2">
        <Input
          :id="id"
          :model-value="link"
          readonly
          :aria-describedby="descriptionId"
        />
        <Button
          variant="outline"
          @click="copy"
        >
          <CopyIcon aria-hidden="true" />
          Copy
        </Button>
      </div>
    </Field>
    <p
      role="status"
      class="mt-2 text-sm"
    >
      {{ copyMessage }}
    </p>
  </div>
</template>
