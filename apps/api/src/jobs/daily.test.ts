import { eq } from 'drizzle-orm';
import { afterEach, expect, it, vi } from 'vitest';
import { job } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { createLogger } from '../logger.ts';
import { DAY_MS } from '../trash/trash.ts';
import { scheduleDailyJobs } from './daily.ts';

afterEach(() => {
  vi.useRealTimers();
});

it('queues a trash purge on startup and every day at 03:30, until stopped', () => {
  // In the server's time zone, as the schedule is.
  const started = new Date(2026, 10, 16, 12, 0);
  const nextDay = new Date(2026, 10, 17, 3, 30);
  const retentionBefore = (date: Date) => new Date(date.getTime() - 30 * DAY_MS).toISOString();
  vi.useFakeTimers({ now: started });
  const db = createTestDatabase();
  const purges = () =>
    db
      .select({ payload: job.payload })
      .from(job)
      .where(eq(job.type, 'trash.purge'))
      .all()
      .map(({ payload }) => payload);
  const finishAll = () => db.update(job).set({ status: 'succeeded' }).run();

  const daily = scheduleDailyJobs({ db, logger: createLogger('silent'), trashRetentionDays: 30 });

  expect(purges()).toEqual([{ deletedBefore: retentionBefore(started) }]);
  finishAll();
  vi.advanceTimersByTime(nextDay.getTime() - started.getTime() - 1000);
  expect(purges()).toHaveLength(1);
  vi.advanceTimersByTime(1000);
  expect(purges()).toEqual([
    { deletedBefore: retentionBefore(started) },
    { deletedBefore: retentionBefore(nextDay) },
  ]);

  daily.stop();
  finishAll();
  vi.advanceTimersByTime(24 * 60 * 60 * 1000);
  expect(purges()).toHaveLength(2);
});
