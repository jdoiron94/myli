import { VueQueryPlugin } from '@tanstack/vue-query';
import type { App } from 'vue';
import { createWebHistory, type RouterHistory } from 'vue-router';
import { createAppQueryClient } from './api/query.ts';
import { createAppRouter } from './router.ts';

/**
 * Installs the router and TanStack Query on `app`. main.ts starts the app with it, and so do the
 * tests (`renderApp`), with a memory history instead of the browser's.
 */
export function installApp(app: App, history: RouterHistory = createWebHistory()) {
  const router = createAppRouter(history);
  const queryClient = createAppQueryClient();
  app.use(router).use(VueQueryPlugin, { queryClient });
  return { router, queryClient };
}
