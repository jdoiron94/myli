import { type QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import type { App } from 'vue';
import { createWebHistory, type RouterHistory } from 'vue-router';
import { createAppQueryClient } from './api/query.ts';
import { watchSession } from './auth/session-watch.ts';
import { createAppRouter } from './router.ts';

/**
 * Installs the router and TanStack Query on `app`. main.ts starts the app with it, and so do the
 * tests (`renderApp`), with a memory history and a query client that doesn't wait between retries.
 */
export function installApp(
  app: App,
  history: RouterHistory = createWebHistory(),
  queryClient: QueryClient = createAppQueryClient(),
) {
  const router = createAppRouter(queryClient, history);
  watchSession(queryClient, router);
  app.use(router).use(VueQueryPlugin, { queryClient });
  return { router, queryClient };
}
