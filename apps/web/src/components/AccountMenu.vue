<script setup lang="ts">
import { LogOutIcon, UserRoundIcon } from '@lucide/vue';
import type { User } from '@myli/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ROLE_LABELS } from '@/lib/roles.ts';

defineProps<{ user: User }>();
const emit = defineEmits<{ signOut: [] }>();
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <!-- Its name includes the visible text, so voice control finds it by that (WCAG 2.5.3). -->
      <Button
        variant="ghost"
        class="max-w-48"
        :aria-label="`Account: ${user.name}`"
      >
        <UserRoundIcon aria-hidden="true" />
        <span class="truncate">{{ user.name }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel class="flex flex-col gap-0.5">
        <span>{{ user.name }}</span>
        <span class="font-normal text-muted-foreground">{{ user.email }}</span>
        <span class="font-normal text-muted-foreground">{{ ROLE_LABELS[user.role] }}</span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="emit('signOut')">
        <LogOutIcon aria-hidden="true" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
