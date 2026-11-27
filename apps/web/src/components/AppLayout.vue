<script setup lang="ts">
import {
  ArchiveIcon,
  FolderIcon,
  HeartIcon,
  MailIcon,
  PlusIcon,
  SearchCheckIcon,
  SearchIcon,
  TagsIcon,
  TrashIcon,
  UserCogIcon,
  UserRoundIcon,
} from '@lucide/vue';
import { can } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { type Component, computed, nextTick, onBeforeUnmount, useTemplateRef } from 'vue';
import { RouterLink, RouterView, START_LOCATION, useRouter } from 'vue-router';
import { sessionQuery, useSignOut } from '@/auth/session.ts';
import AccountMenu from './AccountMenu.vue';
import AdminMenu from './AdminMenu.vue';
import ThemeMenu from './ThemeMenu.vue';

const main = useTemplateRef('main');
const router = useRouter();
const { data: signedInUser } = useQuery(sessionQuery);
const signOut = useSignOut();
/**
 * The pages in the header, with their icons: links, then the admin pages in one menu, and in the
 * account menu, the ones of the reader's own that they open now and then. Each shows only for
 * someone whose role allows its `meta.permission`.
 */
const NAV_PAGES = [
  { name: 'search', icon: SearchIcon },
  { name: 'favorites', icon: HeartIcon },
  { name: 'collections', icon: FolderIcon },
  { name: 'new-recipe', icon: PlusIcon },
] as const;
const ADMIN_PAGES = [
  { name: 'invitations', icon: MailIcon },
  { name: 'users', icon: UserCogIcon },
  { name: 'search-index', icon: SearchCheckIcon },
  { name: 'tags', icon: TagsIcon },
  { name: 'export', icon: ArchiveIcon },
] as const;
const ACCOUNT_PAGES = [
  { name: 'account', icon: UserRoundIcon },
  { name: 'trash', icon: TrashIcon },
] as const;

function allowed(pages: readonly { name: string; icon: Component }[]) {
  return pages
    .map(({ name, icon }) => ({ icon, route: router.resolve({ name }) }))
    .filter(
      ({ route }) =>
        !route.meta.permission || can(signedInUser.value ?? null, route.meta.permission),
    );
}
const navLinks = computed(() => allowed(NAV_PAGES));
const adminLinks = computed(() => allowed(ADMIN_PAGES));
const accountLinks = computed(() => allowed(ACCOUNT_PAGES));

function focusMain() {
  main.value?.focus();
}

function focusHeading() {
  const heading = main.value?.querySelector('h1');
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus();
}

// After moving to another page, focus its heading, so keyboard and screen-reader users start on
// the new content instead of wherever the old page left them. Not on the first load, where the
// browser starts at the top anyway, nor when only the query or hash changed.
const stopFocusing = router.afterEach((to, from, failure) => {
  if (failure || from === START_LOCATION || to.path === from.path) return;
  void nextTick(focusHeading);
});
onBeforeUnmount(stopFocusing);

// A failed sign-out's message stays until they try again or go to another page.
const stopForgetting = router.afterEach(() => {
  signOut.reset();
});
onBeforeUnmount(stopForgetting);
</script>

<template>
  <!-- Focuses <main> without changing the URL, which the router would treat as navigating. -->
  <a
    href="#main"
    class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
    @click.prevent="focusMain"
  >Skip to content</a>
  <header class="border-b print:hidden">
    <div class="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
      <div class="flex items-center gap-4 sm:gap-6">
        <RouterLink
          :to="{ name: 'home' }"
          class="rounded-md text-lg font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          myli
        </RouterLink>
        <nav
          v-if="signedInUser && navLinks.length + adminLinks.length > 0"
          aria-label="Main"
          class="flex gap-1 sm:gap-4"
        >
          <!-- RouterLink marks the current page's link with aria-current="page". On a phone only the
               icons fit: the page's name is still the link's, for screen readers and voice control. -->
          <RouterLink
            v-for="link in navLinks"
            :key="link.route.fullPath"
            :to="link.route.fullPath"
            class="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:font-medium aria-[current=page]:text-foreground"
          >
            <component
              :is="link.icon"
              class="size-4 shrink-0"
              aria-hidden="true"
            />
            <span class="sr-only sm:not-sr-only">{{ link.route.meta.title }}</span>
          </RouterLink>
          <AdminMenu
            v-if="adminLinks.length > 0"
            :pages="adminLinks"
          />
        </nav>
      </div>
      <!-- min-w-0: on a narrow screen, the account button's name is cut short rather than the header
           overflowing. -->
      <div class="flex min-w-0 items-center gap-1">
        <ThemeMenu />
        <AccountMenu
          v-if="signedInUser"
          :user="signedInUser"
          :pages="accountLinks"
          @sign-out="signOut.mutate()"
        />
      </div>
    </div>
  </header>
  <main
    id="main"
    ref="main"
    tabindex="-1"
    class="mx-auto max-w-5xl px-4 py-6"
  >
    <p
      v-if="signOut.isError.value"
      role="alert"
      class="mb-6 text-sm text-destructive"
    >
      Couldn't sign out. Check your connection, then try again.
    </p>
    <RouterView />
  </main>
</template>
