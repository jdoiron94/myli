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
  // Lists that scroll the highlighted item into view, like the ingredient picker's, have none, and
  // the API docs' sidebar, which scrolls to the section in view, has nowhere to go.
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.scrollTo = () => undefined;
  // Nor is there a canvas, which axe draws text on to tell icon fonts apart. jsdom answers null too,
  // after printing that it isn't implemented.
  HTMLCanvasElement.prototype.getContext = () => null;
  // The photo slideshow's carousel (Embla) watches its slides' sizes and which are in view, and
  // media queries, which jsdom doesn't have. Here, sizes never change, everything is in view as
  // soon as it's watched, and no media query matches (`fakeDeviceScheme()` makes the device's
  // dark setting one that can). With no sizes, the carousel can't move between slides here: the
  // end-to-end tests do that.
  globalThis.matchMedia = (media: string) =>
    ({
      media,
      matches: false,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
      // Without the deprecated `addListener` and `removeListener`, which nothing here calls.
    }) as unknown as MediaQueryList;
  globalThis.ResizeObserver = class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  };
  globalThis.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly scrollMargin = '0px';
    readonly thresholds = [0];
    readonly #callback: IntersectionObserverCallback;
    #watched = new Set<Element>();
    constructor(callback: IntersectionObserverCallback) {
      this.#callback = callback;
    }
    observe = (target: Element) => {
      this.#watched.add(target);
      setTimeout(() => {
        if (!this.#watched.has(target)) return;
        const rect = new DOMRect();
        this.#callback(
          [
            {
              target,
              isIntersecting: true,
              intersectionRatio: 1,
              boundingClientRect: rect,
              intersectionRect: rect,
              rootBounds: null,
              time: performance.now(),
            },
          ],
          this,
        );
      });
    };
    unobserve = (target: Element) => {
      this.#watched.delete(target);
    };
    disconnect = () => {
      this.#watched.clear();
    };
    takeRecords = () => [];
  };

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
