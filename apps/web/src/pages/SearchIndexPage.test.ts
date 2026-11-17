import { screen, waitFor } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { type RebuildState, type SearchIndexStatus, STATUS_POLL_MS } from '@/admin/search-index.ts';
import { accessibilityViolations, apiServer, problemResponse, renderApp } from '@/testing.ts';

const PATH = '/admin/search';
const ASKED = '2026-11-17T14:02:00.000Z';
const asked = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(ASKED));

const status = (available: boolean, state?: RebuildState): SearchIndexStatus => ({
  available,
  rebuild: state ? { state, queuedAt: ASKED } : null,
});

/** Answers the status with each of these in turn, the last one from then on. */
function answerStatus(...answers: SearchIndexStatus[]) {
  let count = 0;
  apiServer.use(
    http.get('/api/v1/search/index', () => {
      const answer = answers[Math.min(count, answers.length - 1)];
      count++;
      return HttpResponse.json(answer);
    }),
  );
  return { count: () => count };
}

/** What the page says about search and the latest rebuild, once it does. */
async function statusText() {
  const region = await screen.findByRole('status');
  return [...region.querySelectorAll('p')].map((p) => p.textContent.trim()).join(' ');
}
const rebuildButton = () => screen.findByRole('button', { name: 'Rebuild index' });

describe('the search index page', () => {
  it('says search works, and that there has been no rebuild yet', async () => {
    answerStatus(status(true));
    await renderApp(PATH, { signedInAs: 'admin' });

    await rebuildButton();
    expect(await statusText()).toBe('Search is working. There hasn’t been a rebuild yet.');
    expect(document.title).toBe('Search index · myli');
    expect(await accessibilityViolations()).toEqual([]);
  });

  it.each([
    ['succeeded', `The last rebuild, asked for ${asked}, finished.`],
    ['failed', `The last rebuild, asked for ${asked}, failed. The API’s log says why.`],
  ] as const)('tells how the latest rebuild went: %s', async (state, text) => {
    answerStatus(status(true, state));
    await renderApp(PATH, { signedInAs: 'admin' });

    await rebuildButton();
    expect(await statusText()).toBe(`Search is working. ${text}`);
  });

  // It waits for the page to check again, twice, then for it not to.
  it('says when search is unavailable, and checks again until it’s back', {
    timeout: 10_000,
  }, async () => {
    const asks = answerStatus(
      status(false, 'retrying'),
      status(true, 'running'),
      status(true, 'succeeded'),
    );
    await renderApp(PATH, { signedInAs: 'admin' });

    await rebuildButton();
    expect(await statusText()).toBe(
      'Search is unavailable right now. Everything else works, and search comes back by itself ' +
        `once it can be reached. A rebuild asked for ${asked} is waiting for search to be ` +
        'available, and will try again by itself.',
    );

    await waitFor(
      async () => {
        expect(await statusText()).toBe(
          `Search is working. Rebuilding now, as asked for ${asked}. Search keeps working meanwhile.`,
        );
      },
      { timeout: 2 * STATUS_POLL_MS },
    );
    await waitFor(
      async () => {
        expect(await statusText()).toBe(
          `Search is working. The last rebuild, asked for ${asked}, finished.`,
        );
      },
      { timeout: 2 * STATUS_POLL_MS },
    );
    // Once nothing will change by itself, it stops asking.
    const settled = asks.count();
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS + 500));
    expect(asks.count()).toBe(settled);
  });

  it('rebuilds the index when asked, then shows the rebuild waiting to start', async () => {
    answerStatus(status(true, 'succeeded'));
    const sent: (string | null)[] = [];
    apiServer.use(
      http.post('/api/v1/search/index/rebuild', ({ request }) => {
        sent.push(request.headers.get('content-type'));
        answerStatus(status(true, 'queued'), status(true, 'succeeded'));
        return HttpResponse.json(status(true, 'queued'), { status: 202 });
      }),
    );
    const { user } = await renderApp(PATH, { signedInAs: 'admin' });

    await user.click(await rebuildButton());

    await waitFor(async () => {
      expect(await statusText()).toBe(
        `Search is working. A rebuild asked for ${asked} is waiting to start.`,
      );
    });
    expect(sent).toEqual(['application/json']);
    expect(document.activeElement).toBe(await rebuildButton());
    expect(screen.getByRole('alert').textContent.trim()).toBe('');
  });

  it('says so when asking for a rebuild fails', async () => {
    answerStatus(status(true));
    apiServer.use(http.post('/api/v1/search/index/rebuild', () => problemResponse(500, 'Boom')));
    const { user } = await renderApp(PATH, { signedInAs: 'admin' });

    await user.click(await rebuildButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent.trim()).toBe(
        "Something went wrong on myli's server. Try again in a moment.",
      );
    });
  });

  it('offers to try again when the status can’t be loaded', async () => {
    let fail = true;
    apiServer.use(
      http.get('/api/v1/search/index', () =>
        fail ? problemResponse(500, 'Boom') : HttpResponse.json(status(true)),
      ),
    );
    const { user } = await renderApp(PATH, { signedInAs: 'admin' });

    const tryAgain = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    await user.click(tryAgain);

    await rebuildButton();
    expect(await statusText()).toBe('Search is working. There hasn’t been a rebuild yet.');
  });

  it.each(['editor', 'viewer'] as const)('isn’t for an %s', async (role) => {
    await renderApp(PATH, { signedInAs: role });

    await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" });
  });
});
