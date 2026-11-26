import { eq } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { job } from '../db/schema.ts';

export type JobRow = typeof job.$inferSelect;

/**
 * Waits until the job has succeeded or been dead-lettered, and returns its row then. Calls
 * `onChange` each time its status or attempts change, as when an attempt failed. The worker may
 * run in another process, such as the API's when a command line script waits on it.
 */
export async function waitForJob(
  db: Db,
  id: number,
  { pollMs = 500, onChange }: { pollMs?: number; onChange?: (row: JobRow) => void } = {},
): Promise<JobRow> {
  let last: JobRow | undefined;
  for (;;) {
    const row = db.select().from(job).where(eq(job.id, id)).get();
    if (!row) throw new Error(`There is no job ${String(id)}`);
    if (row.status !== last?.status || row.attempts !== last.attempts) onChange?.(row);
    if (row.status === 'succeeded' || row.status === 'dead') return row;
    last = row;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** How long the API may take to start a job before a script asks whether it's running. */
const START_HINT_MS = 10_000;

/**
 * Waits for a job a command line script queued for the running API's worker, as `waitForJob`
 * does, telling the reader, through `say`, when an attempt failed and when the API hasn't
 * started `task` (such as "the backup") after a while.
 */
export async function followJob(
  db: Db,
  id: number,
  { task, say }: { task: string; say: (line: string) => void },
): Promise<JobRow> {
  let started = false;
  const hint = setTimeout(() => {
    if (!started)
      say(`The API hasn’t started ${task} yet. It runs only while the API does: is it running?`);
  }, START_HINT_MS);
  hint.unref();
  try {
    return await waitForJob(db, id, {
      onChange({ status, attempts, lastError }) {
        if (status !== 'pending' || attempts > 0) started = true;
        if (status === 'pending' && lastError !== null) {
          say(`Attempt ${String(attempts)} failed: ${lastError}. The API will try again.`);
        }
      },
    });
  } finally {
    clearTimeout(hint);
  }
}
