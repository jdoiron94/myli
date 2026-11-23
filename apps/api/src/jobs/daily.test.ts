import { afterEach, expect, it, vi } from 'vitest';
import { job } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { createLogger } from '../logger.ts';
import { DAY_MS } from '../trash/trash.ts';
import { scheduleDailyJobs } from './daily.ts';

afterEach(() => {
  vi.useRealTimers();
});

it('queues a trash purge and a photo sweep on startup and every day at 03:30, until stopped', () => {
  // In the server's time zone, as the schedule is.
  const started = new Date(2026, 10, 16, 12, 0);
  const nextDay = new Date(2026, 10, 17, 3, 30);
  const daysBefore = (date: Date, days: number) =>
    new Date(date.getTime() - days * DAY_MS).toISOString();
  /** What's queued at `date`. */
  const dailyAt = (date: Date) => [
    { type: 'trash.purge', payload: { deletedBefore: daysBefore(date, 30) } },
    { type: 'images.sweep-unused', payload: { uploadedBefore: daysBefore(date, 1) } },
  ];
  vi.useFakeTimers({ now: started });
  const db = createTestDatabase();
  const queued = () => db.select({ type: job.type, payload: job.payload }).from(job).all();
  const finishAll = () => db.update(job).set({ status: 'succeeded' }).run();

  const daily = scheduleDailyJobs({ db, logger: createLogger('silent'), trashRetentionDays: 30 });

  expect(queued()).toEqual(dailyAt(started));
  finishAll();
  vi.advanceTimersByTime(nextDay.getTime() - started.getTime() - 1000);
  expect(queued()).toHaveLength(2);
  vi.advanceTimersByTime(1000);
  expect(queued()).toEqual([...dailyAt(started), ...dailyAt(nextDay)]);

  daily.stop();
  finishAll();
  vi.advanceTimersByTime(DAY_MS);
  expect(queued()).toHaveLength(4);
});
