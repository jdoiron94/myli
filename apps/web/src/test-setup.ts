import { cleanup } from '@testing-library/vue';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  // Testing Library only unmounts rendered components by itself when test functions are globals,
  // and they're imported from Vitest here.
  cleanup();
  vi.unstubAllGlobals();
  // What the theme leaves behind.
  localStorage.clear();
  document.documentElement.className = '';
});
