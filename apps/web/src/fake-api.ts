import { setupServer } from 'msw/node';

/**
 * Stands in for the API in every test: give it handlers with `apiServer.use()`. Requests nothing
 * handles fail the test (see test-setup.ts). Kept apart from testing.ts, which imports the whole
 * app, so test-setup.ts can import it in tests that run in Node too.
 */
export const apiServer = setupServer();
