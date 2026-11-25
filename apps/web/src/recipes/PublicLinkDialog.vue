<script setup lang="ts">
import { LinkIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  publicLinkQuery,
  publicLinkUrl,
  useCreatePublicLink,
  useRevokePublicLink,
} from './public-links.ts';

/**
 * A recipe's Public link button, and the dialog it opens: creating the link, copying it, and
 * revoking it once confirmed (spec §2). Shown only to whoever may share the recipe, since the API
 * refuses anyone else.
 */
const props = defineProps<{ recipeId: string }>();

const link = useQuery(computed(() => publicLinkQuery(props.recipeId)));
const url = computed(() => link.data.value && publicLinkUrl(link.data.value.token));

/** What happened, like the link copied, and why something failed. */
const notice = ref<string>();
const failure = ref<string>();

function starting() {
  notice.value = undefined;
  failure.value = undefined;
}

const urlField = useTemplateRef<{ $el: HTMLInputElement }>('url-field');
const createButton = useTemplateRef<{ $el: HTMLButtonElement }>('create-button');

const create = useCreatePublicLink();

/** Focus goes to the link, which takes the button's place, ready to be copied. */
async function createLink() {
  if (create.isPending.value) return;
  starting();
  try {
    await create.mutateAsync(props.recipeId);
  } catch (error) {
    failure.value = failureMessage(error);
    return;
  }
  await nextTick();
  const field = urlField.value?.$el;
  field?.focus();
  field?.select();
}

async function copyLink() {
  if (!url.value) return;
  starting();
  try {
    await navigator.clipboard.writeText(url.value);
    notice.value = 'Copied the link.';
  } catch {
    failure.value = 'Couldn’t copy the link. Select it and copy it yourself.';
  }
}

const revoke = useRevokePublicLink();

/** The link and its buttons go: focus goes to the button that creates a new one. */
async function revokeLink() {
  if (revoke.isPending.value) return;
  starting();
  try {
    await revoke.mutateAsync(props.recipeId);
  } catch (error) {
    failure.value = failureMessage(error);
    return;
  }
  notice.value = 'Revoked the link. No one can open it now.';
  await nextTick();
  createButton.value?.$el.focus();
}

/** Each opening starts afresh. */
function opened(open: boolean) {
  if (open) starting();
}
</script>

<template>
  <Dialog @update:open="opened">
    <DialogTrigger as-child>
      <Button
        variant="outline"
        size="sm"
      >
        <LinkIcon aria-hidden="true" />
        Public link
      </Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Public link</DialogTitle>
        <DialogDescription>
          Anyone with the link can see this recipe as it’s published, without signing in: its
          photos, ingredients and steps. Not who wrote it, its ratings or its comments.
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="url"
        class="grid gap-2"
      >
        <Label for="public-link-url">Link</Label>
        <div class="flex gap-2">
          <Input
            id="public-link-url"
            ref="url-field"
            :model-value="url"
            readonly
          />
          <Button @click="copyLink">
            Copy link
          </Button>
        </div>
        <AlertDialog>
          <AlertDialogTrigger as-child>
            <Button
              variant="outline"
              class="w-fit"
            >
              Revoke link
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke the public link?</AlertDialogTitle>
              <AlertDialogDescription>
                No one can open it any more, whoever you gave it to. A link you create afterwards is
                a new one.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                @click="revokeLink"
              >
                Revoke link
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <Button
        v-else-if="link.data.value === null"
        ref="create-button"
        class="w-fit"
        @click="createLink"
      >
        Create public link
      </Button>
      <p
        v-else-if="link.isError.value"
        role="alert"
        class="text-sm text-destructive"
      >
        {{ failureMessage(link.error.value) }}
      </p>
      <p
        v-else
        class="text-sm text-muted-foreground"
      >
        Loading…
      </p>

      <!-- Always there, so screen readers announce what they say as it changes. -->
      <p
        role="status"
        class="text-sm"
      >
        {{ notice }}
      </p>
      <p
        v-if="failure"
        role="alert"
        class="text-sm text-destructive"
      >
        {{ failure }}
      </p>
    </DialogContent>
  </Dialog>
</template>
