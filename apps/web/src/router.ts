import { can, INVITATION_ACCEPT_PATH, type RoleAction, type User } from '@myli/shared';
import type { QueryClient } from '@tanstack/vue-query';
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type RouterHistory,
} from 'vue-router';
import { comeBackTo, safeRedirect } from './auth/redirect.ts';
import { sessionQuery } from './auth/session.ts';
import { setupStatusQuery } from './auth/setup.ts';

declare module 'vue-router' {
  interface RouteMeta {
    /** The page's name, shown before the app's name in the browser tab. */
    title?: string;
    /**
     * Who can open the page. Pages are for signed-in users unless this says otherwise:
     * - `signed-out`: only for someone not signed in, like the sign-in page
     * - `setup`: only while first-run setup is needed, which is the only page then
     * - `public`: for anyone, without checking the session
     */
    access?: 'signed-out' | 'setup' | 'public';
    /**
     * What a signed-in user must be allowed to do (`can()`) to open the page. Anyone else sees the
     * no-access page at its address.
     */
    permission?: RoleAction;
  }
}

const APP_NAME = 'myli';

/** The browser tab's title for a page: its name, then the app's. */
export const documentTitle = (pageTitle?: string) =>
  pageTitle ? `${pageTitle} · ${APP_NAME}` : APP_NAME;

// Each page is loaded when it's first visited, so the first load only fetches what it shows.
export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./pages/HomePage.vue') },
  {
    path: '/search',
    name: 'search',
    component: () => import('./pages/SearchPage.vue'),
    meta: { title: 'Search' },
  },
  {
    path: '/favorites',
    name: 'favorites',
    component: () => import('./pages/FavoritesPage.vue'),
    meta: { title: 'Favorites', permission: 'personal.write' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('./pages/LoginPage.vue'),
    meta: { title: 'Sign in', access: 'signed-out' },
  },
  {
    path: '/setup',
    name: 'setup',
    component: () => import('./pages/SetupPage.vue'),
    meta: { title: 'Set up myli', access: 'setup' },
  },
  {
    // Open to anyone: the page itself explains why a signed-in user can't accept. Redirecting them
    // would lose the token without saying why.
    path: INVITATION_ACCEPT_PATH,
    name: 'accept-invitation',
    component: () => import('./pages/AcceptInvitationPage.vue'),
    meta: { title: 'Accept invitation', access: 'public' },
  },
  {
    path: '/admin/invitations',
    name: 'invitations',
    component: () => import('./pages/InvitationsPage.vue'),
    meta: { title: 'Invitations', permission: 'user.invite' },
  },
  {
    path: '/admin/users',
    name: 'users',
    component: () => import('./pages/UsersPage.vue'),
    meta: { title: 'Users', permission: 'user.manage' },
  },
  {
    path: '/admin/search',
    name: 'search-index',
    component: () => import('./pages/SearchIndexPage.vue'),
    meta: { title: 'Search index', permission: 'search.reindex' },
  },
  {
    path: '/admin/tags',
    name: 'tags',
    component: () => import('./pages/TagsPage.vue'),
    meta: { title: 'Tags', permission: 'tag.manage' },
  },
  {
    // Ahead of `/recipes/:id` whatever the order: the router ranks fixed segments first.
    path: '/recipes/new',
    name: 'new-recipe',
    component: () => import('./pages/NewRecipePage.vue'),
    meta: { title: 'New recipe', permission: 'recipe.create' },
  },
  {
    // Who may edit depends on the recipe, so the page checks once it's loaded.
    path: '/recipes/:id/edit',
    name: 'edit-recipe',
    component: () => import('./pages/EditRecipePage.vue'),
    props: true,
    meta: { title: 'Edit recipe' },
  },
  {
    // For everyone who may read the recipe, so the page needs no check of its own.
    path: '/recipes/:id/cook',
    name: 'cook',
    component: () => import('./pages/CookPage.vue'),
    props: true,
    meta: { title: 'Cook mode' },
  },
  {
    // The page sets the tab's title to the recipe's once it's loaded.
    path: '/recipes/:id',
    name: 'recipe',
    component: () => import('./pages/RecipePage.vue'),
    props: true,
    meta: { title: 'Recipe' },
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
  {
    // Matches any address too, but after the route above, so it's only shown when the router sends
    // someone here by name, keeping the address of the page they can't open.
    path: '/:pathMatch(.*)*',
    name: 'no-access',
    component: () => import('./pages/NoAccessPage.vue'),
    meta: { title: 'No access' },
  },
];

/**
 * The app's router. The browser uses the History API; tests pass `createMemoryHistory()`. Before
 * each navigation, it waits for the session from `queryClient` and sends people who can't open the
 * page elsewhere: everyone to setup while it's needed, signed-out visitors to the sign-in page,
 * signed-in users away from it, and to the no-access page when their role doesn't allow a page.
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
      // No one is signed in: maybe no one exists yet. Someone signed in means setup is done.
      if (!user && (await queryClient.query(setupStatusQuery))) {
        return to.meta.access === 'setup' ? true : { name: 'setup', replace: true };
      }
    } catch {
      // The sign-in page works without knowing: signing in fetches the session again.
      if (to.meta.access === 'signed-out') return true;
      return { name: 'unavailable', query: comeBackTo(to), replace: true };
    }
    switch (to.meta.access) {
      case 'setup':
        return { name: user ? 'home' : 'login', replace: true };
      case 'signed-out': {
        if (!user) return true;
        const { path, query, hash } = router.resolve(safeRedirect(to.query.redirect));
        return { path, query, hash, replace: true };
      }
      default:
        if (!user) return { name: 'login', query: comeBackTo(to), replace: true };
        if (to.meta.permission && !can(user, to.meta.permission)) {
          const { path, query, hash } = to;
          return {
            name: 'no-access',
            params: { pathMatch: path.slice(1).split('/') },
            query,
            hash,
            replace: true,
          };
        }
        return true;
    }
  });

  // Every page gets its own title (WCAG 2.4.2), which is also what screen readers announce first.
  router.afterEach((to) => {
    document.title = documentTitle(to.meta.title);
  });
  return router;
}
