import { cleanup } from '@testing-library/vue';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { apiServer } from './fake-api.ts';

// Tests that run in Node (`// @vitest-environment node`), like the dev server's, have no page to
// clean up and don't use the fake API.
if (typeof window !== 'undefined') {
  // jsdom has no layout, so it leaves out what measures it. The markdown editor (ProseMirror)
  // measures the cursor's range to scroll it into view, and gets nothing to scroll to.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  // Lists that scroll the highlighted item into view, like the ingredient picker's, have none.
  Element.prototype.scrollIntoView = () => undefined;

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
}
