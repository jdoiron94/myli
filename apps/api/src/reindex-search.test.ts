// Runs the reindex script under plain Node (no Vitest transform), the way it's run for real. The
// test stands in for the API's worker, moving the job along as the worker would.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Db, migrateDatabase, openDatabase } from './db/database.ts';
import { job } from './db/schema.ts';
import type { JobRow } from './jobs/wait.ts';

const SCRIPT = fileURLToPath(new URL('./reindex-search.ts', import.meta.url));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function tempDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'myli-reindex-'));
  const path = join(dir, 'myli.db');
  const db = openDatabase(path);
  migrateDatabase(db);
  cleanups.push(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, path };
}

/** Starts the script with exactly these variables, so the shell and .env can't leak in. */
function startReindex(databasePath: string) {
  const child = spawn(process.execPath, [SCRIPT], {
    env: {
      PUBLIC_URL: 'https://myli.example',
      BETTER_AUTH_SECRET: 'Vq7mZ2x9Lk4pR8tW1nB6cY3hJ0fS5gD8aE2uQ7iO4rM=',
      MEILI_MASTER_KEY: 'master-key-hunter2-secret',
      DATABASE_PATH: databasePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanups.push(() => child.kill());
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output.stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output.stderr += chunk));
  const exited = once(child, 'exit').then(([code]) => code as number | null);
  return { output, exited };
}

/** Waits until the script has printed this, giving it time to start under a busy test run. */
async function printed(output: { stdout: string }, text: string) {
  await vi.waitFor(
    () => {
      expect(output.stdout).toContain(text);
    },
    { timeout: 10_000, interval: 50 },
  );
}

/** The rebuild the script queued, once it has, and a way to move it along as the worker would. */
async function queuedRebuild(db: Db) {
  const row = await vi.waitFor(
    () => {
      const found = db.select().from(job).where(eq(job.type, 'search.reindex')).get();
      if (!found) throw new Error('not queued yet');
      return found;
    },
    { timeout: 10_000, interval: 50 },
  );
  return (values: Partial<JobRow>) => db.update(job).set(values).where(eq(job.id, row.id)).run();
}

// Each test starts Node; a busy run can take seconds to get it going.
describe('reindex-search.ts', { timeout: 30_000 }, () => {
  it('queues a rebuild, tells of failed attempts, and says when it’s done', async () => {
    const { db, path } = tempDatabase();
    const { output, exited } = startReindex(path);

    const set = await queuedRebuild(db);
    await printed(output, 'Rebuilding the search index.');
    set({ status: 'pending', attempts: 1, lastError: 'Search is unavailable' });
    await printed(output, 'Attempt 1 failed: Search is unavailable. The API will try again.');
    set({ status: 'succeeded', attempts: 2, lastError: null });

    expect(await exited).toBe(0);
    expect(output.stdout.trimEnd().split('\n').at(-1)).toBe('Rebuilt the search index.');
    expect(db.select().from(job).all()).toHaveLength(1);
  });

  it('fails when the rebuild did, with why', async () => {
    const { db, path } = tempDatabase();
    const { output, exited } = startReindex(path);

    const set = await queuedRebuild(db);
    set({ status: 'dead', attempts: 24, lastError: 'Search is unavailable' });

    expect(await exited).toBe(1);
    expect(output.stderr).toBe('The rebuild failed for the last time: Search is unavailable\n');
  });

  it('waits for a rebuild already queued, rather than queue another', async () => {
    const { db, path } = tempDatabase();
    const waiting = db
      .insert(job)
      .values({ type: 'search.reindex', payload: {} })
      .returning()
      .get();
    const { output, exited } = startReindex(path);

    await printed(output, 'Rebuilding the search index.');
    db.update(job).set({ status: 'succeeded', attempts: 1 }).where(eq(job.id, waiting.id)).run();

    expect(await exited).toBe(0);
    expect(db.select().from(job).all()).toHaveLength(1);
  });
});
