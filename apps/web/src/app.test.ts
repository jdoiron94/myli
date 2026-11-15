import { useQueryClient } from '@tanstack/vue-query';
import { expect, it } from 'vitest';
import { createApp } from 'vue';
import { createMemoryHistory, useRouter } from 'vue-router';
import { createAppQueryClient } from './api/query.ts';
import { installApp } from './app.ts';

const createEmptyApp = () => createApp({ render: () => null });

it('installs the router and the query client, for every component to use', () => {
  const app = createEmptyApp();

  const { router, queryClient } = installApp(app, createMemoryHistory());

  expect(app.runWithContext(() => useRouter())).toBe(router);
  expect(app.runWithContext(() => useQueryClient())).toBe(queryClient);
});

it('uses the query client it was given', () => {
  const app = createEmptyApp();
  const given = createAppQueryClient();

  const { queryClient } = installApp(app, createMemoryHistory(), given);

  expect(queryClient).toBe(given);
  expect(app.runWithContext(() => useQueryClient())).toBe(given);
});
