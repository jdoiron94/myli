import type { User } from '@myli/shared';
import type { QueryClient } from '@tanstack/vue-query';
import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteRecordRaw,
  type RouterHistory,
} from 'vue-router';
import { safeRedirect } from './auth/redirect.ts';
import { sessionQuery } from './auth/session.ts';

declare module 'vue-router' {
  interface RouteMeta {
    /** The page's name, shown before the app's name in the browser tab. */
    title?: string;
    /**
     * Who can open the page. Pages are for signed-in users unless this says otherwise:
     * - `signed-out`: only for someone not signed in, like the sign-in page
     * - `public`: for anyone, without checking the session
     */
    access?: 'signed-out' | 'public';
  }
}

const APP_NAME = 'myli';

// Each page is loaded when it's first visited, so the first load only fetches what it shows.
export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./pages/HomePage.vue') },
  {
    path: '/login',
    name: 'login',
    component: () => import('./pages/LoginPage.vue'),
    meta: { title: 'Sign in', access: 'signed-out' },
  },
  {
    path: '/unavailable',
    name: 'unavailable',
    component: () => import('./pages/UnavailablePage.vue'),
    meta: { title: "Can't reach myli", access: 'public' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('./pages/NotFoundPage.vue'),
    meta: { title: 'Page not found' },
  },
];

/** `redirect` for a page to come back to afterwards. Home needs none. */
const comeBackTo = (to: RouteLocationNormalized) =>
  to.fullPath === '/' ? {} : { redirect: to.fullPath };

/**
 * The app's router. The browser uses the History API; tests pass `createMemoryHistory()`. Before
 * each navigation, it waits for the session from `queryClient` and sends people who can't open the
 * page elsewhere: signed-out visitors to the sign-in page, and signed-in users away from it.
 */
export function createAppRouter(
  queryClient: QueryClient,
  history: RouterHistory = createWebHistory(),
) {
  const router = createRouter({ history, routes });

  router.beforeEach(async (to) => {
    if (to.meta.access === 'public') return true;
    let user: User | null;
    try {
      user = await queryClient.query(sessionQuery);
    } catch {
      // Signing in doesn't need to know: it fetches the session again.
      if (to.meta.access === 'signed-out') return true;
      return { name: 'unavailable', query: comeBackTo(to), replace: true };
    }
    if (to.meta.access === 'signed-out') {
      if (!user) return true;
      const { path, query, hash } = router.resolve(safeRedirect(to.query.redirect));
      return { path, query, hash, replace: true };
    }
    return user ? true : { name: 'login', query: comeBackTo(to), replace: true };
  });

  // Every page gets its own title (WCAG 2.4.2), which is also what screen readers announce first.
  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · ${APP_NAME}` : APP_NAME;
  });
  return router;
}
