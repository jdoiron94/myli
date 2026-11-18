import { expect, test } from './fixtures.ts';

// The page at /api/docs/ (ADR 0011). Against the images, it runs under its own Content Security
// Policy, which the fixture checks.
test('the API docs page shows the API and sends requests, using only this site', async ({
  page,
  context,
  baseURL,
}) => {
  const elsewhere: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).origin !== new URL(String(baseURL)).origin) {
      elsewhere.push(request.url());
    }
  });

  await page.goto('/api/docs');

  // Redirected to the trailing slash. Scalar may add the current section as a fragment.
  await expect(page).toHaveURL(/\/api\/docs\/(#.*)?$/);
  // Scalar is a large bundle. Here it shows the document in about a second, but with Chromium's
  // CPU slowed six times, as on a busy CI runner, it takes almost six: past `expect`'s default 5.
  await expect(page.getByRole('heading', { level: 1, name: 'myli API' })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('button', { name: /^Test Request\s*\(get \/setup\)$/ }).click();
  await page.getByRole('button', { name: /Send get request/ }).click();
  await expect(page.getByText('200 OK')).toBeVisible();

  expect(elsewhere).toEqual([]);
});
