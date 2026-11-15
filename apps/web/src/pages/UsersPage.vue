<script setup lang="ts">
import type { Role } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { nextTick, ref, useId } from 'vue';
import {
  type UserAccount,
  useChangeRole,
  useDeactivateUser,
  useReactivateUser,
  usersQuery,
} from '@/admin/users.ts';
import { failureMessage } from '@/api/failure.ts';
import { useRetry } from '@/api/retry.ts';
import { sessionQuery } from '@/auth/session.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import RoleChoice from '@/components/RoleChoice.vue';
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ROLE_LABELS, ROLE_WITH_ARTICLE } from '@/lib/roles.ts';

const joinedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

const users = useQuery(usersQuery);
const { failure, retrying, stillFailing, retry } = useRetry(users);
const { data: me } = useQuery(sessionQuery);

/** What the last change did. */
const notice = ref('');
/** Why deactivating or reactivating failed. */
const actionFailure = ref<string>();

const idPrefix = useId();
/** The row's Deactivate or Reactivate button, to keep focus in the row when one replaces the other. */
const buttonId = (action: 'deactivate' | 'reactivate', user: UserAccount) =>
  `${idPrefix}-${action}-${user.id}`;

async function focusButton(id: string) {
  await nextTick();
  document.getElementById(id)?.focus();
}

/** The user whose role is being changed, in the dialog. */
const roleDialogFor = ref<string>();
const chosenRole = ref<Role>('viewer');
/** Why changing the role failed, shown in the dialog. */
const roleFailure = ref<string>();

/** Opening the dialog starts from their current role. Only the open one can close. */
function setRoleDialog(user: UserAccount, open: boolean) {
  if (open) {
    chosenRole.value = user.role;
    roleFailure.value = undefined;
  }
  roleDialogFor.value = open ? user.id : undefined;
}

const changeRole = useChangeRole();

async function saveRole(user: UserAccount) {
  if (changeRole.isPending.value) return;
  // Nothing to change.
  if (chosenRole.value === user.role) {
    roleDialogFor.value = undefined;
    return;
  }
  roleFailure.value = undefined;
  try {
    const updated = await changeRole.mutateAsync({ id: user.id, role: chosenRole.value });
    roleDialogFor.value = undefined;
    notice.value = `${updated.name} is now ${ROLE_WITH_ARTICLE[updated.role]}.`;
  } catch (error) {
    roleFailure.value = failureMessage(error);
  }
}

const deactivate = useDeactivateUser();

async function deactivateUser(user: UserAccount) {
  if (deactivate.isPending.value) return;
  actionFailure.value = undefined;
  try {
    await deactivate.mutateAsync(user.id);
    notice.value = `Deactivated ${user.name}. They've been signed out.`;
    await focusButton(buttonId('reactivate', user));
  } catch (error) {
    actionFailure.value = failureMessage(error);
  }
}

const reactivate = useReactivateUser();

async function reactivateUser(user: UserAccount) {
  if (reactivate.isPending.value) return;
  actionFailure.value = undefined;
  try {
    await reactivate.mutateAsync(user.id);
    notice.value = `Reactivated ${user.name}. They can sign in again.`;
    await focusButton(buttonId('deactivate', user));
  } catch (error) {
    actionFailure.value = failureMessage(error);
  }
}
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Users
  </h1>
  <p class="mt-2 text-muted-foreground">
    Everyone with an account, oldest first. Change what someone can do, or deactivate them to stop
    them signing in.
  </p>
  <p class="mt-2 text-sm text-muted-foreground">
    You can't change your own role or deactivate yourself. Another admin has to.
  </p>
  <!-- Always there, so screen readers announce what it says as it changes. -->
  <p
    role="status"
    class="mt-4 text-sm"
  >
    {{ notice }}
  </p>
  <p
    v-if="actionFailure"
    role="alert"
    class="mt-2 text-sm text-destructive"
  >
    {{ actionFailure }}
  </p>
  <div
    v-if="users.data.value"
    class="mt-4"
  >
    <Table>
      <TableCaption class="sr-only">
        Users
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead>
            <span class="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="user in users.data.value"
          :key="user.id"
        >
          <TableCell>
            {{ user.name }}
            <Badge
              v-if="user.id === me?.id"
              variant="outline"
              class="ml-1"
            >
              You
            </Badge>
          </TableCell>
          <TableCell>{{ user.email }}</TableCell>
          <TableCell>{{ ROLE_LABELS[user.role] }}</TableCell>
          <TableCell>
            <Badge :variant="user.deactivated ? 'destructive' : 'secondary'">
              {{ user.deactivated ? 'Deactivated' : 'Active' }}
            </Badge>
          </TableCell>
          <TableCell>
            <time :datetime="user.createdAt">{{
              joinedFormat.format(new Date(user.createdAt))
            }}</time>
          </TableCell>
          <TableCell>
            <!-- None on their own row: the API refuses, so an active admin always remains. -->
            <div
              v-if="user.id !== me?.id"
              class="flex justify-end gap-2"
            >
              <Dialog
                :open="roleDialogFor === user.id"
                @update:open="(open: boolean) => setRoleDialog(user, open)"
              >
                <DialogTrigger as-child>
                  <!-- Each name says whose account it is, and starts with the visible text
                       (WCAG 2.5.3). -->
                  <Button
                    variant="outline"
                    size="sm"
                    :aria-label="`Change role for ${user.name}`"
                  >
                    Change role
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <form
                    class="grid gap-6"
                    @submit.prevent="saveRole(user)"
                  >
                    <DialogHeader>
                      <DialogTitle>Change {{ user.name }}'s role</DialogTitle>
                      <DialogDescription>
                        The change applies the next time they use myli.
                      </DialogDescription>
                    </DialogHeader>
                    <p
                      v-if="roleFailure"
                      role="alert"
                      class="text-sm text-destructive"
                    >
                      {{ roleFailure }}
                    </p>
                    <RoleChoice v-model="chosenRole" />
                    <DialogFooter>
                      <DialogClose as-child>
                        <Button
                          type="button"
                          variant="outline"
                        >
                          Cancel
                        </Button>
                      </DialogClose>
                      <Button
                        type="submit"
                        class="aria-disabled:opacity-50"
                        :aria-disabled="changeRole.isPending.value ? true : undefined"
                      >
                        Save
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              <Button
                v-if="user.deactivated"
                :id="buttonId('reactivate', user)"
                variant="outline"
                size="sm"
                class="aria-disabled:opacity-50"
                :aria-label="`Reactivate ${user.name}`"
                :aria-disabled="reactivate.isPending.value ? true : undefined"
                @click="reactivateUser(user)"
              >
                Reactivate
              </Button>
              <AlertDialog v-else>
                <AlertDialogTrigger as-child>
                  <Button
                    :id="buttonId('deactivate', user)"
                    variant="outline"
                    size="sm"
                    :aria-label="`Deactivate ${user.name}`"
                  >
                    Deactivate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Deactivate {{ user.name }}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      They're signed out everywhere and can't sign in until an admin reactivates
                      them. Their recipes stay as they are: private ones stay private, and shared
                      ones stay shared.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      @click="deactivateUser(user)"
                    >
                      Deactivate
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
    Loading users…
  </p>
</template>
