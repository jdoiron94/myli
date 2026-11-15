import {
  API_BASE_PATH,
  AUTH_BASE_PATH,
  PROBLEM_CONTENT_TYPE,
  type Role,
  type User,
} from '@myli/shared';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/vue';
import axe from 'axe-core';
import { HttpHandler, HttpResponse, http } from 'msw';
import { vi } from 'vitest';
import type { App as VueApp } from 'vue';
import { createMemoryHistory } from 'vue-router';
import App from './App.vue';
import { createAppQueryClient } from './api/query.ts';
import { installApp } from './app.ts';
import { apiServer } from './fake-api.ts';

export { apiServer };

/** An RFC 9457 problem response, as the API sends for an error. */
export function problemResponse(status: number, detail: string, extra: object = {}) {
  return HttpResponse.json(
    { type: 'about:blank', title: 'Error', status, detail, ...extra },
    { status, headers: { 'content-type': PROBLEM_CONTENT_TYPE } },
  );
}

/** A user with each role, as the session shows them. */
export const testUsers: Readonly<Record<Role, User>> = {
  admin: { id: 'user-admin', name: 'Grace Hopper', email: 'grace@example.com', role: 'admin' },
  editor: { id: 'user-editor', name: 'Ada Lovelace', email: 'ada@example.com', role: 'editor' },
  viewer: { id: 'user-viewer', name: 'Alan Turing', email: 'alan@example.com', role: 'viewer' },
};

/** Better Auth's answer to `GET /get-session`: `user` signed in, or `null` for no one. */
export function sessionResponse(user: User | null) {
  if (!user) return HttpResponse.json(null);
  const now = new Date().toISOString();
  return HttpResponse.json({
    session: {
      id: 'session-1',
      token: 'session-token',
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    },
    user: {
      ...user,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
      banned: false,
      banReason: null,
      banExpires: null,
    },
  });
}

const SESSION_PATH = `${AUTH_BASE_PATH}/get-session`;
const SETUP_PATH = `${API_BASE_PATH}/setup`;

/** Answers `GET /api/auth/get-session` with `user` signed in, or `null` for no one. */
export function answerSession(user: User | null) {
  apiServer.use(http.get(SESSION_PATH, () => sessionResponse(user)));
}

/** Answers `GET /api/v1/setup`: whether first-run setup is needed. */
export function answerSetup(needed: boolean) {
  apiServer.use(http.get(SETUP_PATH, () => HttpResponse.json({ needed })));
}

/** Whether the current test already answers `method path` itself. */
function answered(method: string, path: string) {
  return apiServer
    .listHandlers()
    .some(
      (handler) =>
        handler instanceof HttpHandler &&
        handler.info.method === method &&
        handler.info.path === path,
    );
}

export interface RenderAppOptions {
  /** The role of the signed-in user (`testUsers`), or `null` for no one. An editor by default. */
  signedInAs?: Role | null;
  /** Whether first-run setup is needed, which the router asks when no one is signed in. */
  setupNeeded?: boolean;
}

/**
 * Renders the whole app at `path`, once the page there has loaded. As in main.ts, the app mounts
 * while the router is still making its first navigation, which waits for the session and, when no
 * one is signed in, for whether setup is needed. It answers both from the options, unless the test
 * already answers them itself. Queries retry without waiting in between.
 */
export async function renderApp(
  path: string,
  { signedInAs = 'editor', setupNeeded = false }: RenderAppOptions = {},
) {
  if (!answered('GET', SESSION_PATH)) answerSession(signedInAs ? testUsers[signedInAs] : null);
  if (!answered('GET', SETUP_PATH)) answerSetup(setupNeeded);
  // As index.html does: jsdom's blank document has no language.
  document.documentElement.lang = 'en';
  const history = createMemoryHistory();
  history.replace(path);
  const queryClient = createAppQueryClient();
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retryDelay: 0 },
  });
  const started = Promise.withResolvers<ReturnType<typeof installApp>>();
  const plugin = {
    install(app: VueApp) {
      started.resolve(installApp(app, history, queryClient));
    },
  };
  render(App, { global: { plugins: [plugin] } });
  const { router } = await started.promise;
  await router.isReady();
  await screen.findByRole('heading', { level: 1 });
  return { router, queryClient, user: userEvent.setup() };
}

/**
 * Stands in for the device's light or dark setting, which jsdom doesn't have. `change` switches it
 * the way the device would, telling every listener.
 */
export function fakeDeviceScheme(initial: 'light' | 'dark') {
  const query = '(prefers-color-scheme: dark)';
  let dark = initial === 'dark';
  const listeners = new Set<(event: { matches: boolean }) => void>();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    get matches() {
      return media === query && dark;
    },
    addEventListener: (_type: 'change', listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: 'change', listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    },
  }));
  return {
    change(scheme: 'light' | 'dark') {
      dark = scheme === 'dark';
      for (const listener of listeners) listener({ matches: dark });
    },
  };
}

/** The classes on `<html>`, where the theme is applied. */
export const htmlClasses = () => [...document.documentElement.classList];

/**
 * What axe finds wrong with the page as it is now: each rule broken, with the elements breaking it.
 * Pass rule IDs in `skip` to leave them out, with a reason where it's called.
 */
export async function accessibilityViolations({ skip = [] }: { skip?: string[] } = {}) {
  const { violations } = await axe.run(document, {
    rules: Object.fromEntries(
      // jsdom has no layout, so color contrast can't be measured here (Playwright checks it).
      ['color-contrast', ...skip].map((id) => [id, { enabled: false }]),
    ),
  });
  return violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
}

/** The elements an input points to with `aria-describedby`. */
export function describedElements(input: HTMLElement) {
  return (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => {
      const element = document.getElementById(id);
      if (!element) throw new Error(`aria-describedby points to a missing #${id}`);
      return element;
    });
}

/** The text of the messages an input points to with `aria-describedby`, one per element. */
export const describedBy = (input: HTMLElement) =>
  describedElements(input).map((element) => element.textContent.replace(/\s+/g, ' ').trim());

/** The text of each item of the list in `element`. */
export function listItems(element: HTMLElement | undefined) {
  if (!element) throw new Error('no element to look for a list in');
  return within(element)
    .getAllByRole('listitem')
    .map((item) => item.textContent.trim());
}
