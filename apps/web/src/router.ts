import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type RouterHistory,
} from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    /** The page's name, shown before the app's name in the browser tab. */
    title?: string;
  }
}

const APP_NAME = 'myli';

// Each page is loaded when it's first visited, so the first load only fetches what it shows.
export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./pages/HomePage.vue') },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('./pages/NotFoundPage.vue'),
    meta: { title: 'Page not found' },
  },
];

/** The app's router. The browser uses the History API; tests pass `createMemoryHistory()`. */
export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({ history, routes });
  // Every page gets its own title (WCAG 2.4.2), which is also what screen readers announce first.
  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · ${APP_NAME}` : APP_NAME;
  });
  return router;
}
