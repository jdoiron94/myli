<script setup lang="ts">
import { can } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, onBeforeUnmount, useTemplateRef } from 'vue';
import { RouterLink, RouterView, START_LOCATION, useRouter } from 'vue-router';
import { sessionQuery, useSignOut } from '@/auth/session.ts';
import AccountMenu from './AccountMenu.vue';
import ThemeMenu from './ThemeMenu.vue';

const main = useTemplateRef('main');
const router = useRouter();
const { data: signedInUser } = useQuery(sessionQuery);
const signOut = useSignOut();
const canInvite = computed(() => can(signedInUser.value ?? null, 'user.invite'));

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
  <header class="border-b">
    <div class="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
      <div class="flex items-center gap-6">
        <RouterLink
          :to="{ name: 'home' }"
          class="rounded-md text-lg font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          myli
        </RouterLink>
        <nav
          v-if="canInvite"
          aria-label="Main"
        >
          <!-- RouterLink marks the current page's link with aria-current="page". -->
          <RouterLink
            :to="{ name: 'invitations' }"
            class="rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:font-medium aria-[current=page]:text-foreground"
          >
            Invitations
          </RouterLink>
        </nav>
      </div>
      <!-- min-w-0: on a narrow screen, the account button's name is cut short rather than the header
           overflowing. -->
      <div class="flex min-w-0 items-center gap-1">
        <ThemeMenu />
        <AccountMenu
          v-if="signedInUser"
          :user="signedInUser"
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
