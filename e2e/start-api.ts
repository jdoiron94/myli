/**
 * Starts the API for one browser's end-to-end run, on an empty database that's deleted afterwards.
 * Playwright runs it as a web server (see playwright.config.ts) with PORT and PUBLIC_URL set.
 *
 * The API gets only the variables below, never the shell's or the repo's `.env`: no first admin,
 * so the run starts at first-run setup, and no SMTP, so invitation links are shown.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { PORT, PUBLIC_URL, PATH } = process.env;
if (!PORT || !PUBLIC_URL) throw new Error('PORT and PUBLIC_URL must be set');

const dataDir = mkdtempSync(join(tmpdir(), 'myli-e2e-'));
const api = spawn(process.execPath, [join(import.meta.dirname, '../apps/api/src/main.ts')], {
  stdio: 'inherit',
  env: {
    PATH,
    // Turns off Better Auth's rate limiter: the journey signs in more often than it allows.
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT,
    PUBLIC_URL,
    DATABASE_PATH: join(dataDir, 'myli.db'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    LOG_LEVEL: 'warn',
  },
});

// Playwright stops web servers by signalling their process group (SIGTERM, set by
// `gracefulShutdown` in playwright.config.ts), as Ctrl+C does with SIGINT. The API is in the same
// group, so it gets the signal too and shuts down cleanly. This waits for it, then deletes the data.
// If shutdown hangs, Playwright kills the whole group.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => undefined);
}
api.once('exit', (code, signal) => {
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(code ?? (signal ? 1 : 0));
});
