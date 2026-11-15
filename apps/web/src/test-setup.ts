import { cleanup } from '@testing-library/vue';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { apiServer } from './testing.ts';

/** Requests that no handler answered during the current test. */
const unhandledRequests: string[] = [];

beforeAll(() => {
  apiServer.listen({
    // The request fails like a network error. MSW's own 'error' strategy stops there, which a test
    // passes through when the code under test handles that failure, so afterEach fails it too.
    async onUnhandledFrame({ frame }) {
      unhandledRequests.push(await frame.getUnhandledMessage());
      throw new Error('No request handler matched this request.');
    },
  });
});

afterEach(() => {
  // Testing Library only unmounts rendered components by itself when test functions are globals,
  // and they're imported from Vitest here.
  cleanup();
  apiServer.resetHandlers();
  vi.unstubAllGlobals();
  // What the theme leaves behind.
  localStorage.clear();
  document.documentElement.className = '';

  const unhandled = unhandledRequests.splice(0);
  if (unhandled.length > 0) throw new Error(`MSW ${unhandled.join('\n\n')}`);
});

afterAll(() => {
  apiServer.close();
});
