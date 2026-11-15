<script setup lang="ts">
import { nextTick, onBeforeUnmount, useTemplateRef } from 'vue';
import { RouterLink, RouterView, START_LOCATION, useRouter } from 'vue-router';
import ThemeMenu from './ThemeMenu.vue';

const main = useTemplateRef('main');
const router = useRouter();

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
</script>

<template>
  <!-- Focuses <main> without changing the URL, which the router would treat as navigating. -->
  <a
    href="#main"
    class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
    @click.prevent="focusMain"
  >Skip to content</a>
  <header class="border-b">
    <div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
      <RouterLink
        :to="{ name: 'home' }"
        class="rounded-md text-lg font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        myli
      </RouterLink>
      <ThemeMenu />
    </div>
  </header>
  <main
    id="main"
    ref="main"
    tabindex="-1"
    class="mx-auto max-w-5xl px-4 py-6"
  >
    <RouterView />
  </main>
</template>
