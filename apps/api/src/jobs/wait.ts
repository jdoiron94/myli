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
