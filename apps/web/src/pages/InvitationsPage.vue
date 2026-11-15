<script setup lang="ts">
import type { InvitationStatus } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { nextTick, ref, useId, useTemplateRef } from 'vue';
import InvitationLink from '@/admin/InvitationLink.vue';
import InviteForm from '@/admin/InviteForm.vue';
import {
  type Invitation,
  type InvitationWithLink,
  invitationsQuery,
  useResendInvitation,
  useRevokeInvitation,
} from '@/admin/invitations.ts';
import { failureMessage } from '@/api/failure.ts';
import { useRetry } from '@/api/retry.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ROLE_LABELS } from '@/lib/roles.ts';

const STATUS_LABELS: Readonly<Record<InvitationStatus, string>> = {
  pending: 'Pending',
  expired: 'Expired',
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const invitations = useQuery(invitationsQuery);
const { failure, retrying, stillFailing, retry } = useRetry(invitations);

/** The latest link myli didn't email, shown until the next one. */
const newLink = ref<{ invitation: Invitation; link: string; resent: boolean }>();
/** What the last change did, when there's no link to show. */
const notice = ref('');
/** Why resending or revoking failed. */
const actionFailure = ref<string>();

function showResult({ invitation, link }: InvitationWithLink, resent: boolean) {
  if (link) {
    newLink.value = { invitation, link, resent };
    notice.value = '';
  } else {
    newLink.value = undefined;
    notice.value = resent
      ? `Invitation sent again to ${invitation.email}.`
      : `Invitation emailed to ${invitation.email}.`;
  }
}

function invited(result: InvitationWithLink) {
  actionFailure.value = undefined;
  showResult(result, false);
}

const listHeading = useTemplateRef('listHeading');

/**
 * After a change that removed the row they were on, such as revoking it, focus would be nowhere.
 * It starts on the list again instead.
 */
async function keepFocus() {
  await nextTick();
  if (!document.activeElement || document.activeElement === document.body) {
    listHeading.value?.focus();
  }
}

const resend = useResendInvitation();

async function resendInvitation(invitation: Invitation) {
  if (resend.isPending.value) return;
  actionFailure.value = undefined;
  try {
    showResult(await resend.mutateAsync(invitation.id), true);
  } catch (error) {
    actionFailure.value = failureMessage(error);
  }
  await keepFocus();
}

const revoke = useRevokeInvitation();

async function revokeInvitation(invitation: Invitation) {
  if (revoke.isPending.value) return;
  actionFailure.value = undefined;
  try {
    await revoke.mutateAsync(invitation.id);
    // Its link stopped working, so it's no use any more.
    if (newLink.value?.invitation.id === invitation.id) newLink.value = undefined;
    notice.value = `Revoked the invitation for ${invitation.email}.`;
  } catch (error) {
    actionFailure.value = failureMessage(error);
  }
  await keepFocus();
}

const inviteHeadingId = useId();
const listHeadingId = useId();
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Invitations
  </h1>
  <p class="mt-2 text-muted-foreground">
    Invite people to myli, and manage the invitations they haven't accepted yet.
  </p>

  <section
    class="mt-8 max-w-xl"
    :aria-labelledby="inviteHeadingId"
  >
    <h2
      :id="inviteHeadingId"
      class="text-lg font-semibold"
    >
      Invite someone
    </h2>
    <InviteForm
      class="mt-4"
      @invited="invited"
    />
    <!-- Always there, so screen readers announce what it says as it changes. -->
    <p
      role="status"
      class="mt-4 text-sm"
    >
      {{ notice }}
    </p>
    <InvitationLink
      v-if="newLink"
      :key="newLink.link"
      class="mt-2"
      :invitation="newLink.invitation"
      :link="newLink.link"
      :resent="newLink.resent"
    />
  </section>

  <section
    class="mt-8"
    :aria-labelledby="listHeadingId"
  >
    <h2
      :id="listHeadingId"
      ref="listHeading"
      tabindex="-1"
      class="text-lg font-semibold outline-none"
    >
      Open invitations
    </h2>
    <p class="mt-1 text-sm text-muted-foreground">
      Newest first. An expired link no longer works: resend it, or revoke the invitation.
    </p>
    <p
      v-if="actionFailure"
      role="alert"
      class="mt-4 text-sm text-destructive"
    >
      {{ actionFailure }}
    </p>
    <div
      v-if="invitations.data.value"
      class="mt-4"
    >
      <p v-if="invitations.data.value.length === 0">
        No open invitations.
      </p>
      <Table v-else>
        <TableCaption class="sr-only">
          Open invitations
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>
              <span class="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="invitation in invitations.data.value"
            :key="invitation.id"
          >
            <TableCell>{{ invitation.email }}</TableCell>
            <TableCell>{{ ROLE_LABELS[invitation.role] }}</TableCell>
            <TableCell>
              <Badge :variant="invitation.status === 'expired' ? 'destructive' : 'secondary'">
                {{ STATUS_LABELS[invitation.status] }}
              </Badge>
            </TableCell>
            <TableCell>
              <time :datetime="invitation.expiresAt">{{
                dateFormat.format(new Date(invitation.expiresAt))
              }}</time>
            </TableCell>
            <TableCell>
              <div class="flex justify-end gap-2">
                <!-- Each name says whose invitation it is, and starts with the visible text, so
                     voice control finds it by that (WCAG 2.5.3). -->
                <Button
                  variant="outline"
                  size="sm"
                  class="aria-disabled:opacity-50"
                  :aria-label="`Resend invitation to ${invitation.email}`"
                  :aria-disabled="resend.isPending.value ? true : undefined"
                  @click="resendInvitation(invitation)"
                >
                  Resend
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger as-child>
                    <Button
                      variant="outline"
                      size="sm"
                      :aria-label="`Revoke invitation for ${invitation.email}`"
                    >
                      Revoke
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Revoke the invitation for {{ invitation.email }}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Their link stops working. You can invite this email again later.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        @click="revokeInvitation(invitation)"
                      >
                        Revoke
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <RetryableFailure
      v-else-if="failure"
      class="mt-4"
      :error="failure"
      :retrying="retrying"
      :still-failing="stillFailing"
      @retry="retry"
    />
    <p
      v-else
      role="status"
      class="mt-4 text-muted-foreground"
    >
      Loading invitations…
    </p>
  </section>
</template>
