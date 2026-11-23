<script setup lang="ts">
import { ChevronDownIcon, ShieldIcon } from '@lucide/vue';
import { type Component, computed } from 'vue';
import { type RouteLocationResolved, RouterLink, useRoute } from 'vue-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMenuNavigation } from '@/lib/menu-navigation.ts';

/**
 * The admin pages the signed-in user may open, in one menu, so the header stays short as they
 * grow. Its button looks like the header's links, and like them shows only its icon on a phone.
 */
const props = defineProps<{ pages: { icon: Component; route: RouteLocationResolved }[] }>();

const route = useRoute();
/** Whether the current page is one of these, which marks the button as the current link is. */
const current = computed(() => props.pages.some((page) => page.route.path === route.path));
const { selected, closeAutoFocus } = useMenuNavigation();
</script>

<template>
  <DropdownMenu>
    <!-- On a phone only the icons fit: "Admin" is still the button's name, for screen readers and
         voice control. -->
    <DropdownMenuTrigger
      :data-current="current ? '' : undefined"
      class="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-current:font-medium data-current:text-foreground"
    >
      <ShieldIcon
        class="size-4 shrink-0"
        aria-hidden="true"
      />
      <span class="sr-only sm:not-sr-only">Admin</span>
      <ChevronDownIcon
        class="size-3.5 shrink-0"
        aria-hidden="true"
      />
    </DropdownMenuTrigger>
    <DropdownMenuContent
      class="w-auto"
      @close-auto-focus="closeAutoFocus"
    >
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
    </DropdownMenuContent>
  </DropdownMenu>
</template>
