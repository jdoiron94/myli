<script setup lang="ts">
import { LogOutIcon } from '@lucide/vue';
import type { User } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import type { Component } from 'vue';
import { type RouteLocationResolved, RouterLink } from 'vue-router';
import { myAvatarQuery } from '@/account/avatar.ts';
import UserAvatar from '@/components/UserAvatar.vue';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMenuNavigation } from '@/lib/menu-navigation.ts';
import { ROLE_LABELS } from '@/lib/roles.ts';

/** Who's signed in, the pages of theirs they may open (`AppLayout`), and signing out. */
defineProps<{ user: User; pages: { icon: Component; route: RouteLocationResolved }[] }>();
const emit = defineEmits<{ signOut: [] }>();
const { selected, closeAutoFocus } = useMenuNavigation();
// Their initials until it's loaded, or if it can't be.
const { data: avatar } = useQuery(myAvatarQuery);
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <!-- Its name includes the visible text, so voice control finds it by that (WCAG 2.5.3). -->
      <Button
        variant="ghost"
        class="max-w-48 min-w-0 shrink"
        :aria-label="`Account: ${user.name}`"
      >
        <UserAvatar :person="{ id: user.id, name: user.name, avatar: avatar ?? null }" />
        <span class="truncate">{{ user.name }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      @close-auto-focus="closeAutoFocus"
    >
      <DropdownMenuLabel class="flex flex-col gap-0.5">
        <span>{{ user.name }}</span>
        <span class="font-normal text-muted-foreground">{{ user.email }}</span>
        <span class="font-normal text-muted-foreground">{{ ROLE_LABELS[user.role] }}</span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <template v-if="pages.length > 0">
        <!-- RouterLink marks the current page's item with aria-current="page". -->
        <DropdownMenuItem
          v-for="page in pages"
          :key="page.route.fullPath"
          as-child
          @select="selected(page.route)"
        >
          <RouterLink
            :to="page.route.fullPath"
            class="aria-[current=page]:font-medium"
          >
            <component
              :is="page.icon"
              aria-hidden="true"
            />
            {{ page.route.meta.title }}
          </RouterLink>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
      </template>
      <DropdownMenuItem @select="emit('signOut')">
        <LogOutIcon aria-hidden="true" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
