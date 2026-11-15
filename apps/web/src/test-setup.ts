import { cleanup } from '@testing-library/vue';
import { afterEach } from 'vitest';

// Testing Library only unmounts rendered components by itself when test functions are globals,
// and they're imported from Vitest here.
afterEach(() => {
  cleanup();
});
