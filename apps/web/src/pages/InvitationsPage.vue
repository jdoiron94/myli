<script setup lang="ts">
import type { InvitationStatus } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { invitationsQuery } from '@/admin/invitations.ts';
import { useRetry } from '@/api/retry.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { Badge } from '@/components/ui/badge';
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
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Invitations
  </h1>
  <p class="mt-2 text-muted-foreground">
    Everyone invited who hasn't accepted yet, newest first. An expired link no longer works.
  </p>
  <div
    v-if="invitations.data.value"
    class="mt-6"
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
        </TableRow>
      </TableBody>
    </Table>
  </div>
  <RetryableFailure
    v-else-if="failure"
    class="mt-6"
    :error="failure"
    :retrying="retrying"
    :still-failing="stillFailing"
    @retry="retry"
  />
  <p
    v-else
    role="status"
    class="mt-6 text-muted-foreground"
  >
    Loading invitations…
  </p>
</template>
