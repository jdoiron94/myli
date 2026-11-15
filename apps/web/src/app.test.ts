import { useQueryClient } from '@tanstack/vue-query';
import { expect, it } from 'vitest';
import { createApp } from 'vue';
import { createMemoryHistory, useRouter } from 'vue-router';
import { installApp } from './app.ts';

it('installs the router and the query client, for every component to use', () => {
  const app = createApp({ render: () => null });

  const { router, queryClient } = installApp(app, createMemoryHistory());

  expect(app.runWithContext(() => useRouter())).toBe(router);
  expect(app.runWithContext(() => useQueryClient())).toBe(queryClient);
});
